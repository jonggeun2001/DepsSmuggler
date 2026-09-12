import * as path from 'node:path';
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

vi.mock('../../core/packager/archive-packager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/packager/archive-packager')>();
  return {
    ...actual,
    getArchivePackager: vi.fn(() => ({
      createArchive,
    })),
  };
});

vi.mock('../../core/packager/script-generator', () => ({
  getScriptGenerator: vi.fn(() => ({
    generateAllScripts,
  })),
}));

vi.mock('../../core/shared', () => ({
  resolveAllDependencies: vi.fn(),
}));

function commandOptions(
  overrides: Record<string, unknown> = {},
): Parameters<typeof downloadCommand>[0] {
  return {
    type: 'pip',
    package: 'requests',
    pkgVersion: '2.28.0',
    arch: 'x86_64',
    targetOS: 'any',
    condaChannel: 'conda-forge',
    output: './output',
    format: 'zip',
    deps: true,
    concurrency: '3',
    ...overrides,
  } as Parameters<typeof downloadCommand>[0];
}

describe('downloadCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAllDependencies).mockReset();

    ensureDir.mockResolvedValue(undefined);
    startDownload.mockResolvedValue({
      success: true,
      totalSize: 1024,
      duration: 1000,
      items: [],
    });
    createArchive.mockResolvedValue(undefined);
    generateAllScripts.mockImplementation(async (_packages, outputDir) => [
      { type: 'bash', path: path.join(outputDir, 'install.sh'), content: '#!/bin/sh' },
      { type: 'powershell', path: path.join(outputDir, 'install.ps1'), content: '# install' },
    ]);
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

  it('지원하지 않는 archive 형식은 resolver와 출력 부수 효과 전에 거부한다', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(downloadCommand(commandOptions({ format: 'rar' }))).rejects.toThrow('process.exit');
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('지원하지 않는 압축 형식입니다: rar. 지원 형식: zip, tar.gz'),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
    expect(createArchive).not.toHaveBeenCalled();
  });

  it('완료된 Maven 항목의 모든 파일을 중복 없이 아카이브하고 실패 항목은 제외한다', async () => {
    const jarPath = '/tmp/output/com/example/demo/1.0.0/demo-1.0.0.jar';
    const pomPath = '/tmp/output/com/example/demo/1.0.0/demo-1.0.0.pom';
    const pomChecksumPath = `${pomPath}.sha1`;
    const staleFailedPath = '/tmp/output/stale/old-artifact.pom';

    startDownload.mockResolvedValueOnce({
      success: true,
      totalSize: 1024,
      duration: 1000,
      items: [
        {
          id: 'maven-demo-1.0.0',
          package: {
            type: 'maven',
            name: 'com.example:demo',
            version: '1.0.0',
          },
          status: 'completed',
          progress: 100,
          filePath: jarPath,
          filePaths: [jarPath, pomPath, pomPath, pomChecksumPath],
        },
        {
          id: 'maven-failed-1.0.0',
          package: {
            type: 'maven',
            name: 'com.example:failed',
            version: '1.0.0',
          },
          status: 'failed',
          progress: 0,
          filePath: staleFailedPath,
          filePaths: [staleFailedPath],
        },
      ],
    });

    await downloadCommand(commandOptions({
      type: 'maven',
      package: 'com.example:demo',
      pkgVersion: '1.0.0',
    }));

    expect(createArchive).toHaveBeenCalledWith(
      [jarPath, pomPath, pomChecksumPath],
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ format: 'zip' }),
    );
  });

  it.each([
    ['partial failure', [
      {
        id: 'pip-completed-2.28.0',
        package: { type: 'pip', name: 'requests', version: '2.28.0' },
        status: 'completed',
        progress: 100,
        filePath: '/tmp/output/requests.whl',
      },
      {
        id: 'pip-failed-2.28.0',
        package: { type: 'pip', name: 'missing', version: '2.28.0' },
        status: 'failed',
        progress: 0,
        error: '404 Not Found',
      },
    ]],
    ['full failure', [
      {
        id: 'pip-failed-2.28.0',
        package: { type: 'pip', name: 'missing', version: '2.28.0' },
        status: 'failed',
        progress: 0,
        error: '404 Not Found',
      },
    ]],
  ] as const)('%s sets a nonzero exit code without creating delivery files', async (_label, items) => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    startDownload.mockResolvedValueOnce({
      success: false,
      totalSize: 0,
      duration: 100,
      items,
    });

    try {
      await downloadCommand(commandOptions());

      expect(process.exitCode).toBe(1);
      expect(createArchive).not.toHaveBeenCalled();
      expect(generateAllScripts).not.toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('deps가 true면 의존성을 해결한 패키지 목록을 큐에 추가한다', async () => {
    await downloadCommand(commandOptions());

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
        maxDepth: 5,
      }),
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

  it('명시한 최대 의존성 탐색 깊이를 resolver에 전달한다', async () => {
    await downloadCommand(commandOptions({ maxDepth: '8' }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ maxDepth: 8 }),
    );
  });

  it.each(['', ' ', '-1', '1.5', 'abc'])('잘못된 최대 깊이는 부작용 전에 실패한다: %j', async (maxDepth) => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(downloadCommand(commandOptions({ maxDepth }))).rejects.toThrow('process.exit');

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--max-depth는 0 이상의 정수여야 합니다.'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it.each(['1.5', '0.5', '.5', '.5e-999', '+.5e-999', '1abc', '9007199254740992', '1.0000000000000001'])(
    '양의 정수가 아닌 동시성 입력은 부작용 전에 실패한다: %j',
    async (concurrency) => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit');
        }) as never);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await expect(downloadCommand(commandOptions({ concurrency }))).rejects.toThrow('process.exit');
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('양의 정수'));
      } finally {
        errorSpy.mockRestore();
        exitSpy.mockRestore();
      }

      expect(resolveAllDependencies).not.toHaveBeenCalled();
      expect(addToQueue).not.toHaveBeenCalled();
      expect(ensureDir).not.toHaveBeenCalled();
      expect(startDownload).not.toHaveBeenCalled();
    },
  );

  it.each(['2', '3'])('유효한 동시성 입력은 숫자로 downloader에 전달한다: %j', async (concurrency) => {
    await downloadCommand(commandOptions({ concurrency }));

    expect(startDownload).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: Number(concurrency),
    }));
  });

  it.each([
    ['0', 0],
    ['-1', -1],
    ['abc', Number.NaN],
  ] as const)('generic legacy 동시성 입력은 기존 결과를 유지한다: %s', async (concurrency, expected) => {
    await downloadCommand(commandOptions({ concurrency }));

    expect(startDownload).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: expected,
    }));
  });

  it('명시한 pip 대상 환경을 resolver와 downloader에 전달한다', async () => {
    await downloadCommand(commandOptions({
      targetOS: 'linux',
      arch: 'arm64',
      pythonVersion: '3.12',
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'arm64',
        targetOS: 'linux',
        pythonVersion: '3.12',
      }),
    );
    expect(startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        pipTargetPlatform: {
          os: 'linux',
          arch: 'aarch64',
          pythonVersion: '3.12',
        },
      }),
    );
  });

  it('같은 Conda 버전의 서로 다른 build를 모두 다운로드 큐에 추가한다', async () => {
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'conda-demo-1.0.0',
          type: 'conda',
          name: 'demo',
          version: '1.0.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'conda-demo-1.0.0',
          type: 'conda',
          name: 'demo',
          version: '1.0.0',
          architecture: 'x86_64',
        },
        {
          id: 'conda-blas-openblas',
          type: 'conda',
          name: 'blas',
          version: '1.0',
          architecture: 'x86_64',
          filename: 'blas-1.0-h123_openblas.conda',
          downloadUrl:
            'https://conda.example/blas-1.0-h123_openblas.conda',
        },
        {
          id: 'conda-blas-mkl',
          type: 'conda',
          name: 'blas',
          version: '1.0',
          architecture: 'x86_64',
          filename: 'blas-1.0-h456_mkl.conda',
          downloadUrl:
            'https://conda.example/blas-1.0-h456_mkl.conda',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });

    await downloadCommand(commandOptions({
      type: 'conda',
      package: 'demo',
      pkgVersion: '1.0.0',
    }));

    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'demo' }),
      expect.objectContaining({
        name: 'blas',
        metadata: expect.objectContaining({
          filename: 'blas-1.0-h123_openblas.conda',
        }),
      }),
      expect.objectContaining({
        name: 'blas',
        metadata: expect.objectContaining({
          filename: 'blas-1.0-h456_mkl.conda',
        }),
      }),
    ]);
  });

  it('pip deps가 false여도 깊이 0 resolver로 루트 아티팩트를 선택한다', async () => {
    await downloadCommand(commandOptions({ deps: false }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'x86_64',
        targetOS: 'any',
        maxDepth: 0,
        resolveRootArtifactsOnly: true,
      }),
    );
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
    await downloadCommand(commandOptions({
      type: 'yum',
      package: 'httpd',
      pkgVersion: '2.4.0',
    }));

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

  it('requirements 파일의 pip 범위 version spec을 resolver에 그대로 전달한다', async () => {
    readFile.mockResolvedValueOnce('native-only>=1,<2\n');

    await downloadCommand(commandOptions({
      file: 'requirements.txt',
      package: undefined,
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: 'pip',
          name: 'native-only',
          version: '>=1,<2',
        }),
      ],
      expect.any(Object),
    );
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
    expect(createArchive).not.toHaveBeenCalled();
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
      downloadCommand(commandOptions({ strict: true })),
    ).rejects.toThrow('process.exit');

    expect(addToQueue).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
    expect(createArchive).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('대상 환경 옵션을 의존성 resolver에 전달한다', async () => {
    await downloadCommand(commandOptions({
      type: 'conda',
      package: 'numpy',
      targetOS: 'linux',
      arch: 'aarch64',
      pythonVersion: '3.12',
      cudaVersion: '12.4',
      condaChannel: 'defaults',
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'aarch64',
        targetOS: 'linux',
        pythonVersion: '3.12',
        cudaVersion: '12.4',
        condaChannel: 'defaults',
        includeDependencies: true,
      }),
    );
  });

  it('환경 옵션이 지정된 pip --no-deps는 깊이 0으로 루트만 해결한다', async () => {
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
          downloadUrl: 'https://files.example.com/requests.whl',
          metadata: {
            checksum: { sha256: 'abc123' },
          },
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

    await downloadCommand(commandOptions({
      deps: false,
      targetOS: 'linux',
      pythonVersion: '3.12',
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        includeDependencies: true,
        maxDepth: 0,
      }),
    );
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'pip',
        name: 'requests',
        metadata: expect.objectContaining({
          downloadUrl: 'https://files.example.com/requests.whl',
        }),
      }),
    ]);
  });

  it('기본 환경의 pip --no-deps도 resolver로 루트 아티팩트를 검증한다', async () => {
    await downloadCommand(commandOptions({ deps: false }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        includeDependencies: true,
        maxDepth: 0,
      }),
    );
  });

  it('기본 환경의 Conda --no-deps도 resolver로 루트 아티팩트를 검증한다', async () => {
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'conda-numpy-2.0.0',
          type: 'conda',
          name: 'numpy',
          version: '2.0.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'conda-numpy-2.0.0',
          type: 'conda',
          name: 'numpy',
          version: '2.0.0',
          architecture: 'x86_64',
          filename: 'numpy-2.0.0-py312_0.conda',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });

    await downloadCommand(commandOptions({
      type: 'conda',
      package: 'numpy',
      pkgVersion: '2.0.0',
      deps: false,
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'x86_64',
        targetOS: 'any',
        maxDepth: 0,
      }),
    );
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'conda',
        name: 'numpy',
        metadata: expect.objectContaining({
          filename: 'numpy-2.0.0-py312_0.conda',
        }),
      }),
    ]);
  });

  it('Conda 스크립트에는 완료된 실제 archive 경로만 전달한다', async () => {
    const outputRoot = path.resolve('tmp', 'conda script output');
    const condaArchive = path.join(outputRoot, 'nested dir', 'six-1.17.0-py312h06a4308_0.tar.bz2');
    const condaDependencyArchive = path.join(outputRoot, 'nested dir', 'python_abi-3.12-0.conda');
    const pipArchive = path.join(outputRoot, 'pip', 'requests-2.32.0.tar.bz2');
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'conda-six-1.17.0',
          type: 'conda',
          name: 'six',
          version: '1.17.0',
          architecture: 'x86_64',
        },
      ],
      allPackages: [
        {
          id: 'conda-six-1.17.0',
          type: 'conda',
          name: 'six',
          version: '1.17.0',
          architecture: 'x86_64',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });
    startDownload.mockResolvedValueOnce({
      success: true,
      totalSize: 1024,
      duration: 1000,
      items: [{
        id: 'conda-six-1.17.0',
        package: { type: 'conda', name: 'six', version: '1.17.0' },
        status: 'completed',
        progress: 100,
        filePath: condaArchive,
        filePaths: [condaArchive, condaDependencyArchive, condaDependencyArchive],
      }, {
        id: 'pip-requests-2.32.0',
        package: { type: 'pip', name: 'requests', version: '2.32.0' },
        status: 'completed',
        progress: 100,
        filePath: pipArchive,
        filePaths: [pipArchive],
      }],
    });

    await downloadCommand(commandOptions({
      type: 'conda',
      package: 'six',
      pkgVersion: '1.17.0',
      deps: false,
      output: outputRoot,
    }));

    expect(generateAllScripts).toHaveBeenCalledWith(
      expect.any(Array),
      outputRoot,
      expect.objectContaining({
        condaPackageFiles: [
          { relativePath: 'nested dir/six-1.17.0-py312h06a4308_0.tar.bz2' },
          { relativePath: 'nested dir/python_abi-3.12-0.conda' },
        ],
      }),
    );
    expect(generateAllScripts.mock.calls[0][2].condaPackageFiles).not.toContainEqual({
      relativePath: 'pip/requests-2.32.0.tar.bz2',
    });
  });

  it('기본 Maven --no-deps의 latest는 concrete root artifact를 resolver로 검증한다', async () => {
    const concreteRoot = {
      id: 'maven-org.example:demo-3.0.2',
      type: 'maven' as const,
      name: 'org.example:demo',
      version: '3.0.2',
      architecture: 'x86_64' as const,
      metadata: {
        groupId: 'org.example',
        artifactId: 'demo',
        type: 'jar',
        filename: 'demo-3.0.2.jar',
      },
    };
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'maven-org.example:demo-latest',
          type: 'maven',
          name: 'org.example:demo',
          version: 'latest',
          architecture: 'x86_64',
        },
      ],
      allPackages: [concreteRoot],
      successfulPackages: [concreteRoot],
      dependencyTrees: [],
      failedPackages: [],
    });

    await downloadCommand(commandOptions({
      type: 'maven',
      package: 'org.example:demo',
      pkgVersion: 'latest',
      deps: false,
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [expect.objectContaining({
        type: 'maven',
        name: 'org.example:demo',
        version: 'latest',
      })],
      expect.objectContaining({
        includeDependencies: true,
        maxDepth: 0,
        resolveRootArtifactsOnly: true,
      }),
    );
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'maven',
        name: 'org.example:demo',
        version: '3.0.2',
        metadata: expect.objectContaining({ filename: 'demo-3.0.2.jar' }),
      }),
    ]);
  });

  it('기본 Maven --no-deps의 명시 버전은 latest resolver 조회를 추가하지 않는다', async () => {
    await downloadCommand(commandOptions({
      type: 'maven',
      package: 'org.example:demo',
      pkgVersion: '3.0.1',
      deps: false,
    }));

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'maven',
        name: 'org.example:demo',
        version: '3.0.1',
      }),
    ]);
  });

  it('--file 입력 패키지에도 선택한 아키텍처를 적용한다', async () => {
    readFile.mockResolvedValueOnce('requests==2.28.0');
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'arm64',
        },
      ],
      allPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'arm64',
          downloadUrl: 'https://files.example.com/requests-arm64.whl',
        },
      ],
      successfulPackages: [
        {
          id: 'pip-requests-2.28.0',
          type: 'pip',
          name: 'requests',
          version: '2.28.0',
          architecture: 'arm64',
          downloadUrl: 'https://files.example.com/requests-arm64.whl',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });

    await downloadCommand(commandOptions({
      package: undefined,
      file: '/tmp/requirements.txt',
      deps: false,
      arch: 'arm64',
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        architecture: 'arm64',
        includeDependencies: true,
        maxDepth: 0,
      }),
    );
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'arm64',
        metadata: expect.objectContaining({
          downloadUrl: 'https://files.example.com/requests-arm64.whl',
        }),
      }),
    ]);
  });

  it.each([
    ['지원하지 않는 아키텍처', { arch: 'sparc64' }],
    ['pip에서 지원하지 않는 아키텍처', { arch: 'i386' }],
    ['지원하지 않는 대상 OS', { targetOS: 'freebsd' }],
    ['npm 대상 OS', { type: 'npm', targetOS: 'linux' }],
    ['잘못된 Python 버전', { pythonVersion: '3.12.1' }],
    ['pip CUDA 버전', { cudaVersion: '12.4' }],
    [
      'classifier 없는 Maven 대상 OS',
      {
        type: 'maven',
        package: 'org.lwjgl:lwjgl',
        targetOS: 'linux',
      },
    ],
    [
      'classifier 없는 Maven 대상 아키텍처',
      {
        type: 'maven',
        package: 'org.lwjgl:lwjgl',
        arch: 'arm64',
      },
    ],
  ])('%s는 모든 부수 효과 전에 실패한다', async (_name, overrides) => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

    try {
      await expect(
        downloadCommand(commandOptions(overrides)),
      ).rejects.toThrow('process.exit');

      expect(resolveAllDependencies).not.toHaveBeenCalled();
      expect(addToQueue).not.toHaveBeenCalled();
      expect(ensureDir).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('Maven classifier를 resolver 입력과 다운로드 큐에 보존한다', async () => {
    vi.mocked(resolveAllDependencies).mockResolvedValueOnce({
      originalPackages: [
        {
          id: 'maven-org.lwjgl:lwjgl-3.3.3',
          type: 'maven',
          name: 'org.lwjgl:lwjgl',
          version: '3.3.3',
          architecture: 'x86_64',
          classifier: 'natives-linux',
        },
      ],
      allPackages: [
        {
          id: 'maven-org.lwjgl:lwjgl-3.3.3',
          type: 'maven',
          name: 'org.lwjgl:lwjgl',
          version: '3.3.3',
          architecture: 'x86_64',
          classifier: 'natives-linux',
        },
      ],
      dependencyTrees: [],
      failedPackages: [],
    });

    await downloadCommand(commandOptions({
      type: 'maven',
      package: 'org.lwjgl:lwjgl',
      pkgVersion: '3.3.3',
      classifier: 'natives-linux',
    }));

    expect(resolveAllDependencies).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          classifier: 'natives-linux',
        }),
      ],
      expect.any(Object),
    );
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'maven',
        name: 'org.lwjgl:lwjgl',
        metadata: expect.objectContaining({
          classifier: 'natives-linux',
        }),
      }),
    ]);
  });

  it.each([
    ['빈 파일', ''],
    ['공백만 있는 파일', '\n \n\t'],
    ['주석만 있는 파일', '# comment only\n\n  # another comment\n'],
  ])('%s는 resolver와 출력 부수 효과 전에 입력 오류로 거부한다', async (_name, content) => {
    readFile.mockResolvedValueOnce(content);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

    try {
      await expect(downloadCommand(commandOptions({
        file: 'empty-packages.txt',
        package: undefined,
        deps: false,
      }))).rejects.toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(resolveAllDependencies).not.toHaveBeenCalled();
      expect(ensureDir).not.toHaveBeenCalled();
      expect(addToQueue).not.toHaveBeenCalled();
      expect(startDownload).not.toHaveBeenCalled();
      expect(createArchive).not.toHaveBeenCalled();
      expect(generateAllScripts).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

});
