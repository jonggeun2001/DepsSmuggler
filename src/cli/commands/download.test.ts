import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCommand } from './download';
import { resolveAllDependencies } from '../../core/shared';

const {
  ensureDir,
  readFile,
  reset,
  addToQueue,
  on,
  startDownload,
  createArchive,
  generateAllScripts,
  create,
  stop,
} = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  readFile: vi.fn(),
  reset: vi.fn(),
  addToQueue: vi.fn(),
  on: vi.fn(),
  startDownload: vi.fn(),
  createArchive: vi.fn(),
  generateAllScripts: vi.fn(),
  create: vi.fn(() => ({ update: vi.fn() })),
  stop: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: {
    ensureDir,
    readFile,
  },
  ensureDir,
  readFile,
}));

vi.mock('cli-progress', () => ({
  default: {
    MultiBar: vi.fn(function MultiBarMock() {
      return {
        create,
        stop,
      };
    }),
    Presets: {
      shades_classic: {},
    },
  },
}));

vi.mock('./download-runner', () => ({
  DownloadManager: vi.fn(function DownloadManagerMock() {
    return {
      reset,
      addToQueue,
      on,
      startDownload,
    };
  }),
}));

vi.mock('../../core/packager/archive-packager', () => ({
  getArchivePackager: vi.fn(() => ({
    createArchive,
  })),
}));

vi.mock('../../core/packager/script-generator', () => ({
  getScriptGenerator: vi.fn(() => ({
    generateAllScripts,
  })),
}));

vi.mock('../../core/shared', () => ({
  resolveAllDependencies: vi.fn(),
}));

describe('downloadCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    ensureDir.mockResolvedValue(undefined);
    startDownload.mockResolvedValue({
      success: true,
      totalSize: 1024,
      duration: 1000,
      items: [],
    });
    createArchive.mockResolvedValue(undefined);
    generateAllScripts.mockResolvedValue(undefined);
    vi.mocked(resolveAllDependencies).mockResolvedValue({
      originalPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-urllib3-1.26.0',
          type: 'pip',
          name: 'urllib3',
          version: '1.26.0',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });
  });

  it('deps가 true면 의존성을 해결한 패키지 목록을 큐에 추가한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
      ],
      expect.objectContaining({
        architecture: 'x86_64',
        includeDependencies: true,
      })
    );
    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'x86_64',
      },
      {
        type: 'pip',
        name: 'urllib3',
        version: '1.26.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('pip Python 버전을 의존성 해결에 전달한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        pythonVersion: '3.12',
        targetOS: 'linux',
      })
    );
  });

  it('pip Python 버전 선택 시 wheel 타겟을 다운로드 매니저에 전달한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12',
    });

    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: {
          os: 'linux',
          arch: 'x86_64',
          pythonVersion: '3.12',
        },
      })
    );
  });

  it('pip 타겟의 Python patch 버전을 requires_python 평가용으로 보존한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'i686',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12.2',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'x86_64',
        targetOS: 'linux',
        pythonVersion: '3.12.2',
      })
    );
    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: {
          os: 'linux',
          arch: 'x86_64',
          pythonVersion: '3.12.2',
        },
      })
    );
  });

  it('resolver가 지원하지 않는 pip 아키텍처는 양쪽에서 x86_64로 보정한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'i386',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ architecture: 'x86_64' })
    );
    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: expect.objectContaining({ arch: 'x86_64' }),
      })
    );
  });

  it('Linux ARM64 별칭은 resolver와 downloader에서 aarch64로 통일한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'arm64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ architecture: 'aarch64' })
    );
    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: expect.objectContaining({ arch: 'aarch64' }),
      })
    );
  });

  it('Python 버전이 없어도 pip 아키텍처 타겟을 resolver와 downloader에 전달한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'arm64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'aarch64',
        targetOS: 'linux',
      })
    );
    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: expect.objectContaining({
          os: 'linux',
          arch: 'aarch64',
          pythonVersion: undefined,
        }),
      })
    );
  });

  it('conda Python 버전을 의존성 해결에 전달한다', async () => {
    await downloadCommand({
      type: 'conda',
      package: 'numpy',
      pkgVersion: '1.26.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
      pythonVersion: '3.12',
    });

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ pythonVersion: '3.12' })
    );
  });

  it('deps가 false면 원본 패키지만 큐에 추가한다', async () => {
    await downloadCommand({
      type: 'pip',
      package: 'requests',
      pkgVersion: '2.28.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: false,
      concurrency: '3',
    });

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('yum 타입은 의존성 자동 해결을 시도하지 않고 원본 패키지만 큐에 추가한다', async () => {
    await downloadCommand({
      type: 'yum',
      package: 'httpd',
      pkgVersion: '2.4.0',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      deps: true,
      concurrency: '3',
    });

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'yum',
        name: 'httpd',
        version: '2.4.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('기본 모드에서는 실패한 직접 항목을 제외하고 해결된 패키지를 다운로드한다', async () => {
    readFile.mockResolvedValue('requests==2.28.0\nCrypto-Py==0.0.4\n');
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-Crypto-Py-0.0.4',
          type: 'pip',
          name: 'Crypto-Py',
          version: '0.0.4',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-urllib3-1.26.0',
          type: 'pip',
          name: 'urllib3',
          version: '1.26.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-Crypto-Py-0.0.4',
          type: 'pip',
          name: 'Crypto-Py',
          version: '0.0.4',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [
        {
          name: 'crypto_py',
          version: '0.0.4',
          error: '패키지를 찾을 수 없음',
        },
      ],
    });

    await downloadCommand({
      type: 'pip',
      pkgVersion: 'latest',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      file: 'requirements.txt',
      deps: true,
      concurrency: '3',
    });

    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'x86_64',
      },
      {
        type: 'pip',
        name: 'urllib3',
        version: '1.26.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('성공한 루트가 필요로 하는 실패 루트와 동명 패키지를 다운로드한다', async () => {
    readFile.mockResolvedValue('alpha==1.0.0\nshared==2.0.0\n');
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-alpha-1.0.0',
          type: 'pip',
          name: 'alpha',
          version: '1.0.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-shared-2.0.0',
          type: 'pip',
          name: 'shared',
          version: '2.0.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-alpha-1.0.0',
          type: 'pip',
          name: 'alpha',
          version: '1.0.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-shared-2.0.0',
          type: 'pip',
          name: 'shared',
          version: '2.0.0',
          architecture: 'x86_64',
        },
      ],
      successfulPackages: [
        {
          id: 'pip-alpha-1.0.0',
          type: 'pip',
          name: 'alpha',
          version: '1.0.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-shared-2.0.0',
          type: 'pip',
          name: 'shared',
          version: '2.0.0',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [
        {
          name: 'shared',
          version: '2.0.0',
          error: 'shared root resolution failed',
        },
      ],
    });

    await downloadCommand({
      type: 'pip',
      pkgVersion: 'latest',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      file: 'requirements.txt',
      deps: true,
      concurrency: '3',
    });

    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'pip',
        name: 'alpha',
        version: '1.0.0',
        arch: 'x86_64',
      },
      {
        type: 'pip',
        name: 'shared',
        version: '2.0.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('호환 wheel이 없는 직접 항목도 정상 항목과 함께 best-effort로 건너뛴다', async () => {
    readFile.mockResolvedValue('requests==2.28.0\nnative-only==1.0.0\n');
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-native-only-1.0.0',
          type: 'pip',
          name: 'native-only',
          version: '1.0.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
        {
          id: 'pip-native-only-1.0.0',
          type: 'pip',
          name: 'native-only',
          version: '1.0.0',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [
        {
          name: 'native_only',
          version: '1.0.0',
          error: '호환되는 패키지를 찾을 수 없습니다',
        },
      ],
    });

    await downloadCommand({
      type: 'pip',
      pkgVersion: 'latest',
      arch: 'x86_64',
      output: './output',
      format: 'zip',
      file: 'requirements.txt',
      deps: true,
      concurrency: '3',
    });

    expect(addToQueue).toHaveBeenCalledWith([
      {
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'x86_64',
      },
    ]);
  });

  it('기본 모드에서 모든 직접 항목 해결에 실패하면 빈 아카이브를 만들지 않는다', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-Crypto-Py-0.0.4',
          type: 'pip',
          name: 'Crypto-Py',
          version: '0.0.4',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-Crypto-Py-0.0.4',
          type: 'pip',
          name: 'Crypto-Py',
          version: '0.0.4',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [
        {
          name: 'crypto_py',
          version: '0.0.4',
          error: '패키지를 찾을 수 없음',
        },
      ],
    });

    await expect(
      downloadCommand({
        type: 'pip',
        package: 'Crypto-Py',
        pkgVersion: '0.0.4',
        arch: 'x86_64',
        output: './output',
        format: 'zip',
        deps: true,
        concurrency: '3',
      })
    ).rejects.toThrow('process.exit');

    expect(addToQueue).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('strict 모드에서 의존성 해결 실패가 있으면 명령을 실패 처리한다', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [
        {
          name: 'requests',
          version: '2.28.0',
          error: 'resolver failed',
        },
      ],
    });

    await expect(
      downloadCommand({
        type: 'pip',
        package: 'requests',
        pkgVersion: '2.28.0',
        arch: 'x86_64',
        output: './output',
        format: 'zip',
        deps: true,
        concurrency: '3',
        strict: true,
      })
    ).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
