import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCommand } from './download';
import { resolveAllDependencies } from '../../core/shared';

const {
  ensureDir,
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
    readFile: vi.fn(),
  },
  ensureDir,
  readFile: vi.fn(),
}));

vi.mock('cli-progress', () => ({
  default: {
    MultiBar: vi.fn(() => ({
      create,
      stop,
    })),
    Presets: {
      shades_classic: {},
    },
  },
}));

vi.mock('../../core/download-manager', () => ({
  getDownloadManager: vi.fn(() => ({
    reset,
    addToQueue,
    on,
    startDownload,
  })),
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
      downloadCommand({
        type: 'pip',
        package: 'requests',
        pkgVersion: '2.28.0',
        arch: 'x86_64',
        output: './output',
        format: 'zip',
        deps: true,
        concurrency: '3',
      })
    ).rejects.toThrow('process.exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
