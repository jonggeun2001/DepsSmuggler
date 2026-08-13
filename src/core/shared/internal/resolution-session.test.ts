import { describe, expect, it } from 'vitest';
import { ResolutionSession } from './resolution-session';

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe('ResolutionSession', () => {
  it('같은 resolver, operation, context의 in-flight producer를 한 번만 실행한다', async () => {
    const session = new ResolutionSession();
    const deferred = createDeferred();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      await deferred.promise;
      return { package: { name: 'requests', version: '2.32.0' } };
    };

    const first = session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer);
    const second = session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer);

    deferred.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect([firstResult, secondResult]).toEqual([
      { package: { name: 'requests', version: '2.32.0' } },
      { package: { name: 'requests', version: '2.32.0' } },
    ]);
    firstResult.package.version = '2.33.0';
    expect(secondResult.package.version).toBe('2.32.0');
    expect(secondResult.package).not.toBe(firstResult.package);
    expect(producerCalls).toBe(1);
  });

  it('consumer마다 독립적으로 clone한 값을 반환한다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return { package: { metadata: { requiresPython: '>=3.9' } } };
    };

    const first = await session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer);
    first.package.metadata.requiresPython = '>=3.12';
    const second = await session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer);

    expect(second).toEqual({ package: { metadata: { requiresPython: '>=3.9' } } });
    expect(second).not.toBe(first);
    expect(second.package).not.toBe(first.package);
    expect(producerCalls).toBe(1);
  });

  it('resolver 또는 operation namespace가 다르면 같은 context를 재사용하지 않는다', async () => {
    const session = new ResolutionSession();
    const context = { name: 'requests' };
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return producerCalls;
    };

    const pipPackageInfo = await session.getOrCreate('pip', 'package-info', context, producer);
    const npmPackageInfo = await session.getOrCreate('npm', 'package-info', context, producer);
    const pipLatestVersion = await session.getOrCreate('pip', 'latest-version', context, producer);

    expect([pipPackageInfo, npmPackageInfo, pipLatestVersion]).toEqual([1, 2, 3]);
    expect(producerCalls).toBe(3);
  });

  it('object key 순서가 다른 context는 같은 cache key로 처리한다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return { version: '2.32.0' };
    };

    await session.getOrCreate(
      'pip',
      'latest-version',
      { name: 'requests', target: { os: 'linux', arch: 'x64' } },
      producer,
    );
    const result = await session.getOrCreate(
      'pip',
      'latest-version',
      { target: { arch: 'x64', os: 'linux' }, name: 'requests' },
      producer,
    );

    expect(result).toEqual({ version: '2.32.0' });
    expect(producerCalls).toBe(1);
  });

  it('undefined context 값은 누락된 key와 구분한다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return producerCalls;
    };

    const withoutVersion = await session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer);
    const withUndefinedVersion = await session.getOrCreate(
      'pip',
      'latest-version',
      { name: 'requests', version: undefined },
      producer,
    );

    expect([withoutVersion, withUndefinedVersion]).toEqual([1, 2]);
  });

  it.each([
    ['Date', { value: new Date('2026-01-01T00:00:00.000Z') }],
    ['Map', { value: new Map([['name', 'requests']]) }],
    ['Set', { value: new Set(['requests']) }],
    ['RegExp', { value: /requests/i }],
    ['class instance', { value: new (class PackageContext {})() }],
    ['Symbol', { value: Symbol('requests') }],
    ['function', { value: () => 'requests' }],
  ])('%s context를 거부하고 producer를 실행하지 않는다', async (_kind, invalidContext) => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return { version: '2.32.0' };
    };

    expect(() =>
      session.getOrCreate(
        'pip',
        'latest-version',
        invalidContext as never,
        producer,
      ),
    ).toThrow('Resolution context must be JSON-like');
    await Promise.resolve();

    expect(producerCalls).toBe(0);
  });

  it('cyclic context를 거부하고 producer를 실행하지 않는다', async () => {
    const session = new ResolutionSession();
    const cyclicContext: Record<string, unknown> = { name: 'requests' };
    cyclicContext.self = cyclicContext;
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return { version: '2.32.0' };
    };

    expect(() =>
      session.getOrCreate(
        'pip',
        'latest-version',
        cyclicContext as never,
        producer,
      ),
    ).toThrow('Resolution context must not contain cyclic references');
    await Promise.resolve();

    expect(producerCalls).toBe(0);
  });

  it('reject된 producer 결과를 저장하지 않는다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async (): Promise<string> => {
      producerCalls += 1;
      throw new Error('metadata request failed');
    };

    await expect(session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer)).rejects.toThrow(
      'metadata request failed',
    );
    await expect(session.getOrCreate('pip', 'package-info', { name: 'requests' }, producer)).rejects.toThrow(
      'metadata request failed',
    );

    expect(producerCalls).toBe(2);
  });

  it('기본 cacheable 정책은 null과 undefined를 저장하지 않는다', async () => {
    const nullSession = new ResolutionSession();
    let nullProducerCalls = 0;
    const nullProducer = async (): Promise<null> => {
      nullProducerCalls += 1;
      return null;
    };

    await nullSession.getOrCreate('pip', 'package-info', { name: 'missing' }, nullProducer);
    await nullSession.getOrCreate('pip', 'package-info', { name: 'missing' }, nullProducer);

    const undefinedSession = new ResolutionSession();
    let undefinedProducerCalls = 0;
    const undefinedProducer = async (): Promise<undefined> => {
      undefinedProducerCalls += 1;
      return undefined;
    };

    await undefinedSession.getOrCreate('pip', 'package-info', { name: 'missing' }, undefinedProducer);
    await undefinedSession.getOrCreate('pip', 'package-info', { name: 'missing' }, undefinedProducer);

    expect(nullProducerCalls).toBe(2);
    expect(undefinedProducerCalls).toBe(2);
  });

  it('operation-specific isCacheable가 거부한 빈 문자열을 저장하지 않는다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async (): Promise<string> => {
      producerCalls += 1;
      return '';
    };

    await session.getOrCreate('npm', 'latest-version', { name: 'empty-version' }, producer, {
      isCacheable: Boolean,
    });
    await session.getOrCreate('npm', 'latest-version', { name: 'empty-version' }, producer, {
      isCacheable: Boolean,
    });

    expect(producerCalls).toBe(2);
  });

  it('기본 cacheable 정책은 빈 문자열을 저장한다', async () => {
    const session = new ResolutionSession();
    let producerCalls = 0;
    const producer = async (): Promise<string> => {
      producerCalls += 1;
      return '';
    };

    await session.getOrCreate('npm', 'latest-version', { name: 'empty-version' }, producer);
    await session.getOrCreate('npm', 'latest-version', { name: 'empty-version' }, producer);

    expect(producerCalls).toBe(1);
  });

  it('isCacheable predicate 오류를 consumer에 전파하고 entry를 제거한다', async () => {
    const session = new ResolutionSession();
    const predicateError = new Error('cacheability check failed');
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      return { version: '2.32.0' };
    };
    const options = {
      isCacheable: () => {
        throw predicateError;
      },
    };

    await expect(
      session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer, options),
    ).rejects.toBe(predicateError);
    await expect(
      session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer, options),
    ).rejects.toBe(predicateError);

    expect(producerCalls).toBe(2);
  });

  it('in-flight consumer 모두에 isCacheable predicate 오류를 전파하고 entry를 제거한다', async () => {
    const session = new ResolutionSession();
    const deferred = createDeferred();
    const predicateError = new Error('cacheability check failed');
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      await deferred.promise;
      return { version: '2.32.0' };
    };
    const options = {
      isCacheable: () => {
        throw predicateError;
      },
    };

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      const first = session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer, options);
      const second = session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer, options);
      const firstError = first.then(
        () => undefined,
        (error) => error,
      );
      const secondError = second.then(
        () => undefined,
        (error) => error,
      );

      deferred.resolve();

      const [firstReason, secondReason] = await Promise.all([firstError, secondError]);
      expect(firstReason).toBe(predicateError);
      expect(secondReason).toBe(predicateError);
      expect((firstReason as Error).message).toBe('cacheability check failed');
      expect((secondReason as Error).message).toBe('cacheability check failed');
      expect(producerCalls).toBe(1);

      const retryReason = await session
        .getOrCreate('pip', 'latest-version', { name: 'requests' }, producer, options)
        .then(
          () => undefined,
          (error) => error,
        );
      expect(retryReason).toBe(predicateError);
      expect(producerCalls).toBe(2);

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('cache hit, miss, in-flight join 통계를 제공한다', async () => {
    const session = new ResolutionSession();
    const deferred = createDeferred();
    let producerCalls = 0;
    const producer = async () => {
      producerCalls += 1;
      await deferred.promise;
      return { version: '2.32.0' };
    };

    const first = session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer);
    const second = session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer);
    deferred.resolve();
    await Promise.all([first, second]);
    await session.getOrCreate('pip', 'latest-version', { name: 'requests' }, producer);

    expect(producerCalls).toBe(1);
    expect(session.getStats()).toEqual({ hits: 1, misses: 1, joins: 1 });
  });
});
