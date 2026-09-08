import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const {
  copyMock,
  downloadMavenPackageMock,
  ensureDirMock,
  pathExistsMock,
} = vi.hoisted(() => ({
  copyMock: vi.fn(),
  downloadMavenPackageMock: vi.fn(),
  ensureDirMock: vi.fn(),
  pathExistsMock: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  copy: copyMock,
  ensureDir: ensureDirMock,
  pathExists: pathExistsMock,
}));

vi.mock('../../src/core', () => ({
  getCondaDownloader: vi.fn(),
  getDockerDownloader: vi.fn(),
  getMavenDownloader: () => ({ downloadPackage: downloadMavenPackageMock }),
  getNpmDownloader: vi.fn(),
}));

vi.mock('../../src/core/shared', () => ({
  downloadFile: vi.fn(),
  getPyPIDownloadUrl: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  createScopedLogger: () => ({ error: vi.fn() }),
}));

import { createDownloadPackageRouter } from './download-package-router';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('createDownloadPackageRouter Maven 처리', () => {
  const packagesDir = path.join('test-output', 'packages');
  const repositoryDir = path.join(packagesDir, 'm2repo');
  const pomPath = path.join(
    repositoryDir, 'org', 'apache', 'flink', 'flink-metrics', '1.20.5',
    'flink-metrics-1.20.5.pom'
  );

  const createContext = () => ({
    packagesDir,
    options: {},
    progressEmitter: {
      clearPackageProgress: vi.fn(),
      emitPackageProgress: vi.fn(),
    },
    state: {
      isCancelled: () => false,
      isPaused: () => false,
      waitWhilePaused: async () => undefined,
    },
  });

  beforeEach(() => {
    vi.resetAllMocks();
    ensureDirMock.mockResolvedValue(undefined);
    pathExistsMock.mockResolvedValue(true);
    copyMock.mockResolvedValue(undefined);
  });

  it('같은 GAV는 복사까지 직렬화하고 다른 GAV는 동시에 다운로드한다', async () => {
    const copyStarted = deferred();
    const finishCopy = deferred();
    const events: string[] = [];
    downloadMavenPackageMock.mockImplementation(async (pkg) => {
      events.push(`download:${pkg.name}:${pkg.metadata.type}`);
      return path.join(repositoryDir, `${pkg.name.split(':')[1]}.${pkg.metadata.type}`);
    });
    copyMock.mockImplementationOnce(async () => {
      copyStarted.resolve();
      await finishCopy.promise;
      events.push('jar-copy-complete');
    });
    const router = createDownloadPackageRouter();
    const context = createContext();
    const pkg = { id: 'jar', type: 'maven' as const, name: 'org.example:sample', version: '1.0', metadata: { type: 'jar' } };

    const jarTask = router.downloadPackage(pkg, context as never);
    await copyStarted.promise;
    const pomTask = router.downloadPackage({ ...pkg, id: 'pom', metadata: { type: 'pom' } }, context as never);
    const independent = await router.downloadPackage({ ...pkg, id: 'other', name: 'org.example:other' }, context as never);
    const eventsWhileCopying = [...events];
    finishCopy.resolve();
    const results = await Promise.all([jarTask, pomTask]);

    expect(independent.success).toBe(true);
    expect(results.every((result) => result.success)).toBe(true);
    expect(eventsWhileCopying).toEqual([
      'download:org.example:sample:jar', 'download:org.example:other:jar',
    ]);
    expect(events.indexOf('jar-copy-complete')).toBeLessThan(events.indexOf('download:org.example:sample:pom'));
  });

  it('같은 GAV의 앞선 작업이 실패해도 다음 작업을 실행한다', async () => {
    downloadMavenPackageMock.mockRejectedValueOnce(new Error('checksum mismatch')).mockResolvedValue(pomPath);
    const router = createDownloadPackageRouter();
    const pkg = { id: 'jar', type: 'maven' as const, name: 'org.example:sample', version: '1.0', metadata: { type: 'jar' } };

    const [jar, pom] = await Promise.all([
      router.downloadPackage(pkg, createContext() as never),
      router.downloadPackage({ ...pkg, id: 'pom', metadata: { type: 'pom' } }, createContext() as never),
    ]);

    expect(jar).toMatchObject({ success: false, error: 'checksum mismatch' });
    expect(pom).toMatchObject({ success: true });
  });

  it('동일 GAV를 기다리는 동안 취소되면 새 다운로드를 시작하지 않는다', async () => {
    const copyStarted = deferred();
    const finishCopy = deferred();
    downloadMavenPackageMock.mockResolvedValue(pomPath);
    copyMock.mockImplementationOnce(async () => {
      copyStarted.resolve();
      await finishCopy.promise;
    });
    const router = createDownloadPackageRouter();
    const pkg = { id: 'jar', type: 'maven' as const, name: 'org.example:sample', version: '1.0', metadata: { type: 'jar' } };
    const jarTask = router.downloadPackage(pkg, createContext() as never);
    await copyStarted.promise;
    let cancelled = false;
    const context = createContext();
    context.state.isCancelled = () => cancelled;
    const pomTask = router.downloadPackage({ ...pkg, id: 'pom', metadata: { type: 'pom' } }, context as never);
    // 별도 GAV 완료를 기다려 POM 요청이 대기열에 들어갈 시간을 확보한다.
    await router.downloadPackage({ ...pkg, id: 'other', name: 'org.example:other' }, createContext() as never);
    cancelled = true;
    finishCopy.resolve();
    const [, pom] = await Promise.all([jarTask, pomTask]);

    expect(pom).toMatchObject({ success: false, error: 'cancelled' });
    expect(downloadMavenPackageMock).toHaveBeenCalledTimes(2);
  });

  it('POM 전용 패키지 metadata를 다운로더에 전달한다', async () => {
    ensureDirMock.mockResolvedValue(undefined);
    pathExistsMock.mockResolvedValue(false);
    downloadMavenPackageMock.mockResolvedValue(pomPath);

    const router = createDownloadPackageRouter();

    await router.downloadPackage(
      {
        id: 'maven-flink-metrics-pom',
        type: 'maven',
        name: 'org.apache.flink:flink-metrics',
        version: '1.20.5',
        metadata: { type: 'pom' },
      },
      createContext() as never
    );

    expect(downloadMavenPackageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          groupId: 'org.apache.flink',
          artifactId: 'flink-metrics',
          type: 'pom',
        }),
      }),
      repositoryDir,
      expect.any(Function),
      expect.any(Object)
    );
  });

  it('POM 전용 패키지의 평탄화된 복사본을 .pom 확장자로 저장한다', async () => {
    ensureDirMock.mockResolvedValue(undefined);
    pathExistsMock.mockResolvedValue(true);
    downloadMavenPackageMock.mockResolvedValue(pomPath);

    const router = createDownloadPackageRouter();

    await router.downloadPackage(
      {
        id: 'maven-flink-metrics-pom',
        type: 'maven',
        name: 'org.apache.flink:flink-metrics',
        version: '1.20.5',
        metadata: { type: 'pom' },
      },
      createContext() as never
    );

    expect(copyMock).toHaveBeenCalledWith(
      pomPath,
      path.join(packagesDir, 'flink-metrics-1.20.5.pom')
    );
  });
});
