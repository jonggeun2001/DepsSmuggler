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

  it('deps가 false면 원본 패키지만 큐에 추가한다', async () => {
    await downloadCommand(commandOptions({ deps: false }));

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

  it('의존성 해결 실패가 있으면 명령을 실패 처리한다', async () => {
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
      downloadCommand(commandOptions()),
    ).rejects.toThrow('process.exit');

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

  it('새 환경 옵션이 없는 --no-deps는 resolver를 호출하지 않는다', async () => {
    await downloadCommand(commandOptions({ deps: false }));

    expect(resolveAllDependencies).not.toHaveBeenCalled();
  });

  it('--file 입력 패키지에도 선택한 아키텍처를 적용한다', async () => {
    readFile.mockResolvedValueOnce('requests==2.28.0');

    await downloadCommand(commandOptions({
      package: undefined,
      file: '/tmp/requirements.txt',
      deps: false,
      arch: 'arm64',
    }));

    expect(resolveAllDependencies).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'pip',
        name: 'requests',
        version: '2.28.0',
        arch: 'arm64',
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
});
