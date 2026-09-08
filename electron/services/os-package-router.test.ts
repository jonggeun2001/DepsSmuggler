import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OSDistribution, OSPackageInfo } from '../../src/core/downloaders/os-shared/types';
import {
  buildOSDownloadStartResult,
  cleanupGeneratedOutputs,
  createOSDownloadErrorHandler,
  createOSDownloaderForDistribution,
  createOSResolverForDistribution,
  DEFAULT_OS_OUTPUT_OPTIONS,
  writeRepositoryScripts,
} from './os-package-router';

const mocks = vi.hoisted(() => ({
  yumDownloader: vi.fn(),
  aptDownloader: vi.fn(),
  apkDownloader: vi.fn(),
  yumResolver: vi.fn(),
  aptResolver: vi.fn(),
  apkResolver: vi.fn(),
  dialog: vi.fn(),
  writeFile: vi.fn(),
  remove: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.dialog } }));
vi.mock('fs-extra', () => ({ writeFile: mocks.writeFile, remove: mocks.remove }));
vi.mock('../../src/core', () => ({
  getYumDownloader: mocks.yumDownloader,
  getAptDownloader: mocks.aptDownloader,
  getApkDownloader: mocks.apkDownloader,
  getYumResolver: mocks.yumResolver,
  getAptResolver: mocks.aptResolver,
  getApkResolver: mocks.apkResolver,
}));
vi.mock('../../src/core/downloaders/os-shared/script-generator', () => ({
  OSScriptGenerator: class {
    generateDependencyOrderScript = mocks.generate;
  },
}));

const distribution: OSDistribution = {
  id: 'test',
  name: 'Test Linux',
  version: '1',
  packageManager: 'apt',
  architectures: ['amd64'],
  defaultRepos: [],
  extendedRepos: [],
};
const pkg = { name: 'curl', version: '8' } as OSPackageInfo;
function progressEmitter() {
  return {
    emitDownloadStatus: vi.fn(),
    emitPackageProgress: vi.fn(),
    clearPackageProgress: vi.fn(),
    clearAllPackageProgress: vi.fn(),
    emitAllComplete: vi.fn(),
    emitOSProgress: vi.fn(),
    emitOSResolveDependenciesProgress: vi.fn(),
  };
}

describe('OS package router boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.generate.mockReturnValue({ bash: '#!/bin/bash\ninstall', powershell: 'Install-Package' });
  });

  it.each([
    { response: 0, action: 'retry', cancelled: false },
    { response: 1, action: 'skip', cancelled: false },
    { response: 2, action: 'skip', cancelled: true },
    { response: -1, action: 'skip', cancelled: true },
  ])(
    'maps dialog response $response to $action and cancellation=$cancelled',
    async ({ response, action, cancelled }) => {
      mocks.dialog.mockResolvedValue({ response });
      const onCancel = vi.fn();
      await expect(
        createOSDownloadErrorHandler(null, onCancel)({ package: pkg, message: 'checksum mismatch' })
      ).resolves.toBe(action);
      expect(mocks.dialog).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          message: expect.stringContaining('curl: checksum mismatch'),
          buttons: ['재시도', '건너뛰기', '취소'],
          defaultId: 0,
          cancelId: 2,
        })
      );
      expect(onCancel).toHaveBeenCalledTimes(cancelled ? 1 : 0);
    }
  );

  it('uses a fallback package label and propagates dialog rejection without cancellation', async () => {
    const error = new Error('window closed');
    mocks.dialog.mockRejectedValue(error);
    const onCancel = vi.fn();
    await expect(
      createOSDownloadErrorHandler(null, onCancel)({ message: 'network error' })
    ).rejects.toBe(error);
    expect(mocks.dialog).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        message: expect.stringContaining('알 수 없는 패키지: network error'),
      })
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(['yum', 'apt', 'apk'] as const)(
    'routes %s resolution with cancellation, dependency options and both progress channels',
    (manager) => {
      const resolver = { resolveDependencies: vi.fn() };
      const factory = mocks[`${manager}Resolver`];
      factory.mockReturnValue(resolver);
      const emitter = progressEmitter();
      const abortSignal = new AbortController().signal;
      const selectedDistribution = { ...distribution, packageManager: manager };
      expect(
        createOSResolverForDistribution({
          distribution: selectedDistribution,
          architecture: 'arm64',
          includeOptional: true,
          includeRecommends: false,
          progressEmitter: emitter,
          abortSignal,
        })
      ).toBe(resolver);
      expect(factory).toHaveBeenCalledWith({
        distribution: selectedDistribution,
        repositories: selectedDistribution.defaultRepos,
        architecture: 'arm64',
        includeOptional: true,
        includeRecommends: false,
        abortSignal,
        onProgress: expect.any(Function),
      });
      factory.mock.calls[0][0].onProgress('resolving curl', 2, 5);
      expect(emitter.emitOSProgress).toHaveBeenCalledWith({
        currentPackage: 'resolving curl',
        currentIndex: 2,
        totalPackages: 5,
        bytesDownloaded: 0,
        totalBytes: 0,
        speed: 0,
        phase: 'resolving',
      });
      expect(emitter.emitOSResolveDependenciesProgress).toHaveBeenCalledWith({
        message: 'resolving curl',
        current: 2,
        total: 5,
      });
      for (const other of ['yum', 'apt', 'apk'] as const) {
        if (other !== manager) expect(mocks[`${other}Resolver`]).not.toHaveBeenCalled();
      }
    }
  );

  it.each(['yum', 'apt', 'apk'] as const)(
    'routes %s downloads with repository and progress/error callbacks',
    async (manager) => {
      const downloader = { downloadPackage: vi.fn() };
      const factory = mocks[`${manager}Downloader`];
      factory.mockReturnValue(downloader);
      const emitter = progressEmitter();
      const abortSignal = new AbortController().signal;
      const onCancel = vi.fn();
      const selectedDistribution = { ...distribution, packageManager: manager };
      expect(
        createOSDownloaderForDistribution({
          distribution: selectedDistribution,
          architecture: 'arm64',
          outputDir: 'output',
          concurrency: 5,
          progressEmitter: emitter,
          abortSignal,
          onCancel,
          mainWindow: null,
        })
      ).toBe(downloader);
      expect(factory).toHaveBeenCalledWith({
        distribution: selectedDistribution,
        repositories: selectedDistribution.defaultRepos,
        architecture: 'arm64',
        outputDir: 'output',
        concurrency: 5,
        abortSignal,
        onProgress: expect.any(Function),
        onError: expect.any(Function),
      });
      const progress = { currentPackage: 'curl', phase: 'verifying' };
      factory.mock.calls[0][0].onProgress(progress);
      expect(emitter.emitOSProgress).toHaveBeenCalledWith(progress);
      mocks.dialog.mockResolvedValue({ response: 2 });
      await expect(factory.mock.calls[0][0].onError({ message: 'failure' })).resolves.toBe('skip');
      expect(onCancel).toHaveBeenCalledOnce();
      for (const other of ['yum', 'apt', 'apk'] as const) {
        if (other !== manager) expect(mocks[`${other}Downloader`]).not.toHaveBeenCalled();
      }
    }
  );

  it('rejects unsupported managers before calling any concrete factory', () => {
    const options = {
      distribution: { ...distribution, packageManager: 'pacman' } as unknown as OSDistribution,
      architecture: 'amd64' as const,
      includeOptional: false,
      includeRecommends: false,
      progressEmitter: progressEmitter(),
      outputDir: 'out',
      concurrency: 1,
      onCancel: vi.fn(),
      mainWindow: null,
    };
    expect(() => createOSResolverForDistribution(options)).toThrow(
      'Unsupported package manager: pacman'
    );
    expect(() => createOSDownloaderForDistribution(options)).toThrow(
      'Unsupported package manager: pacman'
    );
    for (const manager of ['yum', 'apt', 'apk'] as const) {
      expect(mocks[`${manager}Resolver`]).not.toHaveBeenCalled();
      expect(mocks[`${manager}Downloader`]).not.toHaveBeenCalled();
    }
    expect(mocks.dialog).not.toHaveBeenCalled();
  });

  it('builds an empty download result with explicit defaults', () => {
    expect(
      buildOSDownloadStartResult({
        outputDir: 'out',
        distribution,
        outputOptions: DEFAULT_OS_OUTPUT_OPTIONS,
      })
    ).toEqual({
      success: [],
      failed: [],
      skipped: [],
      outputPath: 'out',
      packageManager: 'apt',
      outputOptions: DEFAULT_OS_OUTPUT_OPTIONS,
      generatedOutputs: [],
      warnings: [],
      unresolved: [],
      conflicts: [],
      cancelled: false,
    });
  });

  it.each(['yum', 'apt', 'apk'] as const)(
    'writes Bash and PowerShell dependency scripts for %s using its package directory',
    async (manager) => {
      await writeRepositoryScripts('repository', [pkg], manager, [
        'dependency-order',
        'local-repo',
      ]);
      expect(mocks.generate).toHaveBeenCalledWith([pkg], manager, {
        packageDir: manager === 'yum' ? './Packages' : '.',
      });
      expect(mocks.writeFile.mock.calls).toEqual([
        [path.join('repository', 'install.sh'), '#!/bin/bash\ninstall'],
        [path.join('repository', 'install.ps1'), 'Install-Package'],
      ]);
    }
  );

  it('does not generate dependency scripts when only local-repo scripts are requested', async () => {
    await writeRepositoryScripts('repository', [], 'apt', ['local-repo']);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('propagates script permission errors without starting the second script write', async () => {
    const error = new Error('EACCES');
    mocks.writeFile.mockRejectedValueOnce(error);
    await expect(
      writeRepositoryScripts('repository', [pkg], 'apt', ['dependency-order'])
    ).rejects.toBe(error);
    expect(mocks.writeFile).toHaveBeenCalledOnce();
  });

  it('cleans each generated output and propagates removal errors', async () => {
    const error = new Error('EACCES');
    mocks.remove.mockRejectedValueOnce(error);
    await expect(
      cleanupGeneratedOutputs([
        { type: 'archive', path: 'archive.zip', label: 'archive' },
        { type: 'repository', path: 'repository', label: 'repo' },
      ])
    ).rejects.toBe(error);
    expect(mocks.remove.mock.calls).toEqual([['archive.zip'], ['repository']]);
  });

  it('accepts cleanup with no generated output', async () => {
    await expect(cleanupGeneratedOutputs([])).resolves.toBeUndefined();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
