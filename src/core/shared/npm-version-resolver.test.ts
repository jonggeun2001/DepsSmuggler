import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestNpmResolver, NpmResolver } from '../resolver/npm-resolver';
import { NpmVersionResolver } from './npm-version-resolver';
import { fetchPackument } from './npm-cache';
import type { NpmPackageVersion, NpmPackument } from './npm-types';
import { ResolutionSession } from './internal/resolution-session';
import { attachResolutionSession } from './internal/resolution-session-registry';

vi.mock('./npm-cache', () => ({
  fetchPackument: vi.fn(),
}));

interface NpmResolverTestable {
  versionResolver: NpmVersionResolver;
}

const asTestable = (resolver: NpmResolver): NpmResolverTestable =>
  resolver as unknown as NpmResolverTestable;

const createPackument = (name = 'shared'): NpmPackument => ({
  name,
  'dist-tags': { latest: '1.2.0' },
  versions: {
    '1.0.0': { name, version: '1.0.0' } as NpmPackageVersion,
    '1.2.0': { name, version: '1.2.0' } as NpmPackageVersion,
    '2.0.0': { name, version: '2.0.0' } as NpmPackageVersion,
  },
});

const fetchPackumentMock = vi.mocked(fetchPackument);

describe('NpmVersionResolver 요청 세션', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('같은 요청의 요청 resolver 두 개가 in-flight packument 조회를 한 번만 수행하고 consumer snapshot을 분리한다', async () => {
    let release!: (packument: NpmPackument) => void;
    const pending = new Promise<NpmPackument>((resolve) => {
      release = resolve;
    });
    fetchPackumentMock.mockReturnValue(pending);

    const session = new ResolutionSession();
    const first = asTestable(createRequestNpmResolver(session)).versionResolver;
    const second = asTestable(createRequestNpmResolver(session)).versionResolver;

    const firstResult = first.fetchPackument('@Scope/Shared');
    const secondResult = second.fetchPackument('@scope/shared');
    release(createPackument('@scope/shared'));

    const [firstPackument, secondPackument] = await Promise.all([firstResult, secondResult]);
    firstPackument.versions['1.2.0'].version = 'changed';

    const thirdPackument = await second.fetchPackument('@SCOPE/SHARED');
    expect(fetchPackumentMock).toHaveBeenCalledTimes(1);
    expect(secondPackument.versions['1.2.0'].version).toBe('1.2.0');
    expect(thirdPackument.versions['1.2.0'].version).toBe('1.2.0');
  });

  it('같은 요청에서 package name/spec version candidate 선택을 한 번만 수행한다', async () => {
    const session = new ResolutionSession();
    const first = asTestable(createRequestNpmResolver(session)).versionResolver;
    const second = asTestable(createRequestNpmResolver(session)).versionResolver;
    const resolveVersion = vi.spyOn(NpmVersionResolver.prototype, 'resolveVersion');
    const packument = createPackument('shared');

    await expect(first.resolveVersionForRequest('^1.0.0', packument)).resolves.toBe('1.2.0');
    await expect(second.resolveVersionForRequest('^1.0.0', packument)).resolves.toBe('1.2.0');

    expect(resolveVersion).toHaveBeenCalledTimes(1);
  });

  it('registry URL 또는 version spec이 다르면 session 결과를 재사용하지 않는다', async () => {
    const session = new ResolutionSession();
    const first = new NpmVersionResolver('https://registry-one.example');
    const second = new NpmVersionResolver('https://registry-two.example');
    attachResolutionSession(first, session);
    attachResolutionSession(second, session);
    fetchPackumentMock.mockResolvedValue(createPackument('shared'));
    const resolveVersion = vi.spyOn(NpmVersionResolver.prototype, 'resolveVersion');

    await first.fetchPackument('Shared');
    await second.fetchPackument('shared');
    await first.resolveVersionForRequest('^1.0.0', createPackument('shared'));
    await first.resolveVersionForRequest('^2.0.0', createPackument('shared'));

    expect(fetchPackumentMock).toHaveBeenCalledTimes(2);
    expect(resolveVersion).toHaveBeenCalledTimes(2);
  });

  it('failed packument lookup is evicted so a later root retries it', async () => {
    const session = new ResolutionSession();
    const resolver = asTestable(createRequestNpmResolver(session)).versionResolver;
    fetchPackumentMock
      .mockRejectedValueOnce(new Error('temporary registry failure'))
      .mockResolvedValueOnce(createPackument('shared'));

    await expect(resolver.fetchPackument('shared')).rejects.toThrow('temporary registry failure');
    await expect(resolver.fetchPackument('shared')).resolves.toEqual(createPackument('shared'));

    expect(fetchPackumentMock).toHaveBeenCalledTimes(2);
  });

  it('없는 version candidate는 저장하지 않아 다음 root가 다시 선택한다', async () => {
    const session = new ResolutionSession();
    const first = asTestable(createRequestNpmResolver(session)).versionResolver;
    const second = asTestable(createRequestNpmResolver(session)).versionResolver;
    const resolveVersion = vi.spyOn(NpmVersionResolver.prototype, 'resolveVersion');

    await expect(
      first.resolveVersionForRequest('^2.0.0', {
        ...createPackument('shared'),
        versions: {
          '1.2.0': { name: 'shared', version: '1.2.0' } as NpmPackageVersion,
        },
      }),
    ).resolves.toBeNull();
    await expect(
      second.resolveVersionForRequest('^2.0.0', {
        ...createPackument('shared'),
        versions: {
          '2.0.0': { name: 'shared', version: '2.0.0' } as NpmPackageVersion,
        },
      }),
    ).resolves.toBe('2.0.0');

    expect(resolveVersion).toHaveBeenCalledTimes(2);
  });

  it('session 없는 legacy resolver는 반복 조회를 그대로 수행한다', async () => {
    const resolver = new NpmVersionResolver();
    fetchPackumentMock.mockResolvedValue(createPackument('shared'));

    await resolver.fetchPackument('shared');
    await resolver.fetchPackument('shared');

    expect(fetchPackumentMock).toHaveBeenCalledTimes(2);
  });
});
