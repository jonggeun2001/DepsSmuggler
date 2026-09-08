import { describe, expect, it, vi } from 'vitest';
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
