import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResolutionSession } from '../../core/shared/internal/resolution-session';
import { downloadCommand } from './download';

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
  createRequestPipResolver,
  resolveDependencies,
  sharedMetadataLookup,
  sessions,
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
  createRequestPipResolver: vi.fn(),
  resolveDependencies: vi.fn(),
  sharedMetadataLookup: vi.fn(),
  sessions: [] as unknown[],
}));

vi.mock('fs-extra', () => ({
  default: { ensureDir, readFile },
  ensureDir,
  readFile,
}));

vi.mock('cli-progress', () => ({
  default: {
    MultiBar: vi.fn(function MultiBarMock() {
      return { create, stop };
    }),
    Presets: { shades_classic: {} },
  },
}));

vi.mock('./download-runner', () => ({
  DownloadManager: vi.fn(function DownloadManagerMock() {
    return { reset, addToQueue, on, startDownload };
  }),
}));

vi.mock('../../core/packager/archive-packager', () => ({
  getArchivePackager: vi.fn(() => ({ createArchive })),
}));

vi.mock('../../core/packager/script-generator', () => ({
  getScriptGenerator: vi.fn(() => ({ generateAllScripts })),
}));

vi.mock('../../core/resolver/pip-resolver', () => ({
  createRequestPipResolver,
}));

describe('downloadCommand request session integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions.length = 0;
    ensureDir.mockResolvedValue(undefined);
    startDownload.mockResolvedValue({
      success: true,
      totalSize: 1024,
      duration: 1000,
      items: [],
    });
    createArchive.mockResolvedValue(undefined);
    generateAllScripts.mockResolvedValue(undefined);
  });

  it('strict 모드는 실제 요청 세션의 재시도 성공 뒤에도 앞선 root 실패를 중단 처리한다', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);
    readFile.mockResolvedValue('alpha==1.0.0\nbeta==1.0.0\n');
    sharedMetadataLookup
      .mockRejectedValueOnce(new Error('temporary metadata failure'))
      .mockResolvedValueOnce({ version: '2.0.0' });

    createRequestPipResolver.mockImplementation((session: ResolutionSession) => {
      sessions.push(session);
      resolveDependencies.mockImplementation(async (name: string) => {
        await session.getOrCreate(
          'pip',
          'package-info',
          { name: 'shared', version: '2.0.0' },
          () => sharedMetadataLookup(),
        );
        const root = { type: 'pip' as const, name, version: '1.0.0' };
        const shared = { type: 'pip' as const, name: 'shared', version: '2.0.0' };
        return {
          root: { package: root, dependencies: [{ package: shared, dependencies: [] }] },
          flatList: [root, shared],
          conflicts: [],
          totalSize: 0,
        };
      });
      return { resolveDependencies };
    });

    await expect(
      downloadCommand({
        type: 'pip',
        pkgVersion: 'latest',
        arch: 'x86_64',
        output: './output',
        format: 'zip',
        file: 'requirements.txt',
        deps: true,
        strict: true,
        concurrency: '3',
      } as Parameters<typeof downloadCommand>[0]),
    ).rejects.toThrow('process.exit');

    expect(createRequestPipResolver).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toBeInstanceOf(ResolutionSession);
    expect(resolveDependencies).toHaveBeenCalledTimes(2);
    expect(sharedMetadataLookup).toHaveBeenCalledTimes(2);
    expect(addToQueue).not.toHaveBeenCalled();
    expect(startDownload).not.toHaveBeenCalled();
    expect(createArchive).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
