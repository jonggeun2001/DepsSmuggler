import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DependencyResolutionResult,
  OSDistribution,
  OSPackageInfo,
  Repository,
} from '../../src/core/downloaders/os-shared/types';
import { createOSDownloadOrchestrator } from './os-download-orchestrator';
import type { OSDownloadStartOptions } from './os-package-router';

const mocks = vi.hoisted(() => ({
  ensureDir: vi.fn(),
  mkdtemp: vi.fn(),
  remove: vi.fn(),
  writeFile: vi.fn(),
  resolverFactory: vi.fn(),
  downloaderFactory: vi.fn(),
  resolve: vi.fn(),
  download: vi.fn(),
  archive: vi.fn(),
  repository: vi.fn(),
  generateScripts: vi.fn(),
  osProgress: vi.fn(),
  resolveProgress: vi.fn(),
}));
vi.mock('fs-extra', () => ({
  ensureDir: mocks.ensureDir,
  mkdtemp: mocks.mkdtemp,
  remove: mocks.remove,
  writeFile: mocks.writeFile,
}));
vi.mock('electron', () => ({ dialog: { showMessageBox: vi.fn() } }));
vi.mock('../utils/logger', () => ({ createScopedLogger: () => ({ info: vi.fn() }) }));
vi.mock('../../src/core', () => ({
  getYumResolver: mocks.resolverFactory,
  getAptResolver: mocks.resolverFactory,
  getApkResolver: mocks.resolverFactory,
  getYumDownloader: mocks.downloaderFactory,
  getAptDownloader: mocks.downloaderFactory,
  getApkDownloader: mocks.downloaderFactory,
}));
vi.mock('../../src/core/downloaders/os-shared/archive-packager', () => ({
  OSArchivePackager: class {
    createArchive = mocks.archive;
  },
}));
vi.mock('../../src/core/downloaders/os-shared/repo-packager', () => ({
  OSRepoPackager: class {
    createLocalRepo = mocks.repository;
  },
}));
vi.mock('../../src/core/downloaders/os-shared/script-generator', () => ({
  OSScriptGenerator: class {
    generateDependencyOrderScript = mocks.generateScripts;
  },
}));
vi.mock('./download-progress', () => ({
  createDownloadProgressEmitter: () => ({
    emitOSProgress: mocks.osProgress,
    emitOSResolveDependenciesProgress: mocks.resolveProgress,
  }),
}));

const repo: Repository = {
  id: 'main',
  name: 'Main',
  baseUrl: 'https://packages.invalid',
  enabled: true,
  gpgCheck: true,
  isOfficial: true,
};
const distribution: OSDistribution = {
  id: 'test-apt',
  name: 'Test Linux',
  version: '1',
  packageManager: 'apt',
  architectures: ['amd64'],
  defaultRepos: [repo],
  extendedRepos: [],
};
function makePackage(name: string): OSPackageInfo {
  return {
    name,
    version: '1.0',
    architecture: 'amd64',
    size: 123,
    dependencies: [],
    checksum: { type: 'sha256', value: 'abc' },
    location: `${name}.deb`,
    repository: repo,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('OS download orchestration', () => {
  const outputDir = path.resolve('test-output');
  const stagingDir = path.join(outputDir, '.depssmuggler-os-test');
  const archivePath = path.join(outputDir, 'os-packages.zip');
  const repositoryPath = path.join(outputDir, 'repository');
  const first = makePackage('curl');
  const second = makePackage('libcurl');
  const third = makePackage('openssl');
  const options = (overrides: Partial<OSDownloadStartOptions> = {}): OSDownloadStartOptions => ({
    packages: [first],
    distribution,
    architecture: 'amd64',
    outputDir,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.mkdtemp.mockResolvedValue(stagingDir);
    mocks.remove.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.resolverFactory.mockReturnValue({ resolveDependencies: mocks.resolve });
    mocks.downloaderFactory.mockReturnValue({ downloadPackage: mocks.download });
    mocks.resolve.mockResolvedValue({
      packages: [first],
      warnings: [],
      unresolved: [],
      conflicts: [],
    });
    mocks.download.mockImplementation(async (pkg: OSPackageInfo) => ({
      success: true,
      filePath: path.join(stagingDir, `${pkg.name}.deb`),
    }));
    mocks.archive.mockResolvedValue(archivePath);
    mocks.repository.mockResolvedValue(repositoryPath);
    mocks.generateScripts.mockReturnValue({ bash: 'install curl', powershell: 'Install-Curl' });
  });

  it('resolves dependencies with optional flags defaulted off and returns unresolved/conflict details', async () => {
    const unresolved = [{ name: 'missing' }];
    const conflicts = [{ package: 'curl', versions: [first, { ...first, version: '2' }] }];
    mocks.resolve.mockResolvedValue({
      packages: [first],
      unresolved,
      conflicts,
      warnings: ['warning'],
    });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(
      service.resolveDependencies({ packages: [first], distribution, architecture: 'amd64' })
    ).resolves.toEqual({
      packages: [first],
      unresolved,
      conflicts,
    });
    expect(mocks.resolverFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        includeOptional: false,
        includeRecommends: false,
        distribution,
        architecture: 'amd64',
      })
    );
    expect(mocks.resolve).toHaveBeenCalledWith([first]);
    expect(mocks.downloaderFactory).not.toHaveBeenCalled();
  });

  it('accepts an empty package list without downloading or producing final artifacts', async () => {
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(service.startDownload(options({ packages: [] }))).resolves.toMatchObject({
      success: [],
      failed: [],
      skipped: [],
      generatedOutputs: [],
      cancelled: false,
    });
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(stagingDir);
  });

  it.each(['ensureDir', 'mkdtemp'] as const)(
    'stops before downloading when %s fails with a permission error',
    async (operation) => {
      const error = new Error('EACCES: output directory');
      mocks[operation].mockRejectedValue(error);
      const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
      await expect(service.startDownload(options())).rejects.toBe(error);
      expect(mocks.downloaderFactory).not.toHaveBeenCalled();
      expect(mocks.download).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
      expect(mocks.repository).not.toHaveBeenCalled();
      if (operation === 'ensureDir') expect(mocks.mkdtemp).not.toHaveBeenCalled();
    }
  );

  it('does not download when resolution leaves unresolved dependencies, while exposing conflicts and warnings', async () => {
    const unresolved = [{ name: 'missing-lib' }];
    const conflicts = [{ package: 'curl', versions: [first, { ...first, version: '2' }] }];
    mocks.resolve.mockResolvedValue({
      packages: [first, second],
      warnings: ['repository warning'],
      unresolved,
      conflicts,
    });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(
      service.startDownload(options({ resolveDependencies: true, includeOptionalDeps: true }))
    ).resolves.toMatchObject({
      success: [],
      generatedOutputs: [],
      unresolved,
      conflicts,
      warnings: ['repository warning'],
      cancelled: false,
    });
    expect(mocks.resolverFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        includeOptional: true,
        includeRecommends: true,
        abortSignal: expect.any(AbortSignal),
      })
    );
    expect(mocks.osProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentPackage: '버전 충돌 1건 감지' })
    );
    expect(mocks.osProgress).toHaveBeenCalledWith(
      expect.objectContaining({ currentPackage: '해결되지 않은 의존성 1건' })
    );
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.downloaderFactory).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it('propagates resolution failures before creating staging files or a downloader', async () => {
    const error = new Error('corrupt repository metadata');
    mocks.resolve.mockRejectedValue(error);
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(service.startDownload(options({ resolveDependencies: true }))).rejects.toBe(error);
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
    expect(mocks.downloaderFactory).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'cancels during resolution even when the resolver later %ss',
    async (settlement) => {
      const started = deferred<void>();
      const resolution = deferred<DependencyResolutionResult>();
      mocks.resolve.mockImplementation(() => {
        started.resolve();
        return resolution.promise;
      });
      const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
      const pending = service.startDownload(options({ resolveDependencies: true }));
      await started.promise;
      await expect(service.cancelDownload()).resolves.toEqual({ success: true });
      expect(mocks.resolverFactory.mock.calls[0][0].abortSignal.aborted).toBe(true);
      if (settlement === 'resolve')
        resolution.resolve({ packages: [first], warnings: [], unresolved: [], conflicts: [] });
      else resolution.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      await expect(pending).resolves.toMatchObject({
        cancelled: true,
        success: [],
        generatedOutputs: [],
        warnings: ['의존성 해결 단계에서 취소되어 다운로드를 시작하지 않았습니다.'],
      });
      expect(mocks.mkdtemp).not.toHaveBeenCalled();
      expect(mocks.downloaderFactory).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    }
  );

  it('downloads resolved packages in order and creates both tar.gz and repository outputs with scripts', async () => {
    mocks.resolve.mockResolvedValue({
      packages: [second, first],
      warnings: ['warning'],
      unresolved: [],
      conflicts: [],
    });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    const outputOptions = {
      type: 'both' as const,
      archiveFormat: 'tar.gz' as const,
      generateScripts: true,
      scriptTypes: ['dependency-order', 'local-repo'] as const,
    };
    const result = await service.startDownload(
      options({
        resolveDependencies: true,
        concurrency: 7,
        outputOptions: { ...outputOptions, scriptTypes: [...outputOptions.scriptTypes] },
      })
    );
    expect(mocks.download.mock.calls).toEqual([[second], [first]]);
    expect(mocks.downloaderFactory).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: stagingDir, concurrency: 7 })
    );
    const downloadedFiles = new Map([
      ['libcurl-1.0', path.join(stagingDir, 'libcurl.deb')],
      ['curl-1.0', path.join(stagingDir, 'curl.deb')],
    ]);
    expect(mocks.archive).toHaveBeenCalledWith([second, first], downloadedFiles, {
      format: 'tar.gz',
      outputPath: path.join(outputDir, 'os-packages'),
      includeScripts: true,
      scriptTypes: ['dependency-order', 'local-repo'],
      packageManager: 'apt',
      repoName: 'depssmuggler-local',
    });
    expect(mocks.repository).toHaveBeenCalledWith([second, first], downloadedFiles, {
      packageManager: 'apt',
      outputPath: repositoryPath,
      repoName: 'depssmuggler-local',
      includeSetupScript: true,
    });
    expect(mocks.writeFile.mock.calls).toEqual([
      [path.join(repositoryPath, 'install.sh'), 'install curl'],
      [path.join(repositoryPath, 'install.ps1'), 'Install-Curl'],
    ]);
    expect(result).toMatchObject({
      success: [second, first],
      failed: [],
      cancelled: false,
      warnings: ['warning'],
      generatedOutputs: [
        {
          type: 'archive',
          path: path.join(outputDir, 'os-packages.tar.gz'),
          label: '압축 파일 (tar.gz)',
        },
        { type: 'repository', path: repositoryPath, label: '로컬 저장소' },
      ],
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(stagingDir);
  });

  it('packages only successful downloads and retains failure and skipped details', async () => {
    mocks.download
      .mockResolvedValueOnce({ success: true, filePath: path.join(stagingDir, 'curl.deb') })
      .mockResolvedValueOnce({ success: false, error: new Error('checksum mismatch') })
      .mockResolvedValueOnce({ success: false, skipped: true });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    const result = await service.startDownload(options({ packages: [first, second, third] }));
    expect(result).toMatchObject({
      success: [first],
      failed: [{ package: second, error: 'checksum mismatch' }],
      skipped: [third],
      generatedOutputs: [{ type: 'archive', path: archivePath, label: '압축 파일 (zip)' }],
      cancelled: false,
    });
    expect(mocks.archive).toHaveBeenCalledWith(
      [first],
      new Map([['curl-1.0', path.join(stagingDir, 'curl.deb')]]),
      expect.objectContaining({
        format: 'zip',
        includeScripts: true,
        scriptTypes: ['dependency-order'],
      })
    );
    expect(mocks.downloaderFactory).toHaveBeenCalledWith(
      expect.objectContaining({ concurrency: 3 })
    );
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(stagingDir);
  });

  it('does not package when all downloads failed, skipped, or returned no file', async () => {
    mocks.download
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false, skipped: true })
      .mockResolvedValueOnce({ success: true });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(
      service.startDownload(options({ packages: [first, second, third] }))
    ).resolves.toMatchObject({
      success: [],
      skipped: [second],
      generatedOutputs: [],
      failed: [
        { package: first, error: '다운로드 실패' },
        { package: third, error: '다운로드 실패' },
      ],
    });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(stagingDir);
  });

  it('cleans staging files if the downloader rejects unexpectedly', async () => {
    const error = new Error('disk read failed');
    mocks.download.mockRejectedValue(error);
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(service.startDownload(options({ packages: [first, second] }))).rejects.toBe(error);
    expect(mocks.download).toHaveBeenCalledOnce();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(stagingDir);
  });

  it('cancels during download, discards prior successes and skips remaining packages without packaging', async () => {
    const startedSecond = deferred<void>();
    const secondResult = deferred<{ success: boolean; filePath: string }>();
    mocks.download
      .mockResolvedValueOnce({ success: true, filePath: path.join(stagingDir, 'curl.deb') })
      .mockImplementationOnce(() => {
        startedSecond.resolve();
        return secondResult.promise;
      });
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    const pending = service.startDownload(options({ packages: [first, second, third] }));
    await startedSecond.promise;
    await service.cancelDownload();
    expect(mocks.downloaderFactory.mock.calls[0][0].abortSignal.aborted).toBe(true);
    secondResult.resolve({ success: true, filePath: path.join(stagingDir, 'libcurl.deb') });
    await expect(pending).resolves.toMatchObject({
      success: [],
      skipped: [second, third],
      cancelled: true,
      generatedOutputs: [],
      warnings: [expect.stringContaining('임시 파일 1개')],
    });
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(stagingDir);
    // A completed cancellation must not poison the next request.
    await expect(service.startDownload(options())).resolves.toMatchObject({
      success: [first],
      cancelled: false,
    });
  });

  it.each(['archive', 'repository', 'script'] as const)(
    'cleans generated outputs and staging when %s creation fails',
    async (stage) => {
      const error = new Error(`EACCES: ${stage}`);
      if (stage === 'archive') mocks.archive.mockRejectedValue(error);
      if (stage === 'repository') mocks.repository.mockRejectedValue(error);
      if (stage === 'script') mocks.writeFile.mockRejectedValue(error);
      const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
      await expect(
        service.startDownload(
          options({
            outputOptions: {
              type: 'both',
              archiveFormat: 'zip',
              generateScripts: true,
              scriptTypes: ['dependency-order'],
            },
          })
        )
      ).rejects.toBe(error);
      expect(mocks.remove.mock.calls).toEqual(
        stage === 'archive'
          ? [[archivePath], [stagingDir]]
          : [[archivePath], [repositoryPath], [stagingDir]]
      );
      if (stage === 'archive') expect(mocks.repository).not.toHaveBeenCalled();
      if (stage !== 'script') expect(mocks.writeFile).not.toHaveBeenCalled();
      else expect(mocks.writeFile).toHaveBeenCalledOnce();
    }
  );

  it('cleans a cancelled archive and suppresses subsequent repository generation', async () => {
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    mocks.archive.mockImplementation(async () => {
      await service.cancelDownload();
      return archivePath;
    });
    await expect(
      service.startDownload(
        options({
          outputOptions: {
            type: 'both',
            generateScripts: false,
            scriptTypes: [],
          },
        })
      )
    ).resolves.toMatchObject({
      success: [],
      generatedOutputs: [],
      cancelled: true,
      warnings: ['패키징 단계에서 취소되어 생성 중이던 출력물을 정리했습니다.'],
    });
    expect(mocks.remove.mock.calls).toEqual([[archivePath], [stagingDir]]);
    expect(mocks.repository).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('creates repository-only output without setup or install scripts when disabled', async () => {
    const service = createOSDownloadOrchestrator({ getMainWindow: () => null });
    await expect(
      service.startDownload(
        options({
          outputOptions: {
            type: 'repository',
            generateScripts: false,
            scriptTypes: ['local-repo', 'dependency-order'],
          },
        })
      )
    ).resolves.toMatchObject({
      generatedOutputs: [{ type: 'repository', path: repositoryPath, label: '로컬 저장소' }],
    });
    expect(mocks.repository).toHaveBeenCalledWith(
      [first],
      expect.any(Map),
      expect.objectContaining({ includeSetupScript: false })
    );
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.generateScripts).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
