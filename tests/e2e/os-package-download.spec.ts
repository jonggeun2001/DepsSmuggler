import { test, expect } from '@playwright/test';

test('OS 패키지 검색부터 전용 다운로드 결과 화면까지 연결된다', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<(progress: unknown) => void>();

    const osPackage = {
      name: 'bash',
      version: '5.1.8',
      architecture: 'x86_64',
      size: 1234,
      location: 'Packages/bash-5.1.8.rpm',
      repository: {
        id: 'baseos',
        name: 'BaseOS',
        baseUrl: 'https://mirror.example.com/baseos',
        packageManager: 'yum',
        isOfficial: true,
        priority: 1,
        enabled: true,
        gpgCheck: true,
      },
      dependencies: [],
      summary: 'GNU Bourne Again shell',
      description: 'GNU Bourne Again shell',
    };

    localStorage.setItem(
      'depssmuggler-settings',
      JSON.stringify({
        state: {
          concurrentDownloads: 3,
          enableCache: true,
          cachePath: '',
          includeDependencies: true,
          defaultDownloadPath: '/tmp/depssmuggler-e2e',
          defaultOutputFormat: 'zip',
          includeInstallScripts: true,
          enableFileSplit: false,
          maxFileSize: 25,
          smtpHost: '',
          smtpPort: 587,
          smtpUser: '',
          smtpPassword: '',
          smtpFrom: '',
          languageVersions: { python: '3.11' },
          defaultTargetOS: 'linux',
          defaultArchitecture: 'x86_64',
          pipTargetPlatform: {
            os: 'linux',
            arch: 'x86_64',
            linuxDistro: 'rocky9',
            glibcVersion: '2.34',
          },
          condaChannel: 'conda-forge',
          customCondaChannels: [],
          customPipIndexUrls: [],
          cudaVersion: null,
          yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
          aptDistribution: { id: 'ubuntu-22.04', architecture: 'amd64' },
          apkDistribution: { id: 'alpine-3.18', architecture: 'x86_64' },
          dockerRegistry: 'docker.io',
          dockerCustomRegistry: '',
          dockerArchitecture: 'amd64',
          dockerLayerCompression: 'gzip',
          dockerRetryStrategy: 'layer',
          dockerIncludeLoadScript: true,
          autoUpdate: false,
          autoDownloadUpdate: false,
          downloadRenderInterval: 10,
          _initialized: true,
        },
        version: 0,
      })
    );

    const electronAPI = {
      log: () => undefined,
      openFolder: async () => undefined,
      selectFolder: async () => '/tmp/depssmuggler-e2e',
      os: {
        search: async () => ({ packages: [osPackage], totalCount: 1 }),
        getDistribution: async () => ({
          id: 'rocky-9',
          name: 'Rocky Linux 9',
          version: '9',
          packageManager: 'yum',
          architectures: ['x86_64'],
          defaultRepos: [],
        }),
        download: {
          onProgress: (callback: (progress: unknown) => void) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
          start: async (options: {
            outputDir: string;
            outputOptions: {
              type: 'archive' | 'repository' | 'both';
              archiveFormat?: 'zip' | 'tar.gz';
              generateScripts: boolean;
              scriptTypes: Array<'dependency-order' | 'local-repo'>;
            };
          }) => {
            listeners.forEach((callback) =>
              callback({
                phase: 'downloading',
                currentPackage: 'bash',
                currentIndex: 1,
                totalPackages: 1,
                bytesDownloaded: 512,
                totalBytes: 1024,
                speed: 256,
              })
            );
            listeners.forEach((callback) =>
              callback({
                phase: 'packaging',
                currentPackage: '결과 패키징',
                currentIndex: 1,
                totalPackages: 1,
                bytesDownloaded: 1024,
                totalBytes: 1024,
                speed: 0,
              })
            );

            return {
              success: [osPackage],
              failed: [],
              skipped: [],
              outputPath: options.outputDir,
              packageManager: 'yum',
              outputOptions: options.outputOptions,
              generatedOutputs: [
                { type: 'repository', path: `${options.outputDir}/repository`, label: '로컬 저장소' },
              ],
            };
          },
        },
      },
      search: {
        packages: async () => ({ results: [] }),
        suggest: async () => [],
        versions: async () => ({ versions: [] }),
      },
      download: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
        onDepsResolved: () => () => undefined,
        onAllComplete: () => () => undefined,
        start: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: async () => undefined,
        checkPath: async () => ({ exists: false, files: [], fileCount: 0, totalSize: 0 }),
        clearPath: async () => ({ success: true, deleted: true }),
      },
      dependency: {
        resolve: async () => ({
          originalPackages: [],
          allPackages: [],
          dependencyTrees: [],
          failedPackages: [],
        }),
        onProgress: () => () => undefined,
      },
      maven: {
        isNativeArtifact: async () => false,
        getAvailableClassifiers: async () => [],
      },
      versions: {
        python: async () => ['3.11'],
        cuda: async () => [],
        preload: async () => ({ success: true, status: { python: 'loaded', cuda: 'loaded' }, errors: [], duration: 1 }),
        refreshExpired: async () => undefined,
        cacheStatus: async () => ({}),
      },
      config: {
        get: async () => null,
        set: async () => ({ success: true }),
        reset: async () => ({ success: true }),
        getPath: async () => '/tmp/depssmuggler-config.json',
      },
      cache: {
        getSize: async () => 0,
        getStats: async () => ({ scope: 'all', excludes: [], totalSize: 0, entryCount: 0, details: { pip: {}, npm: {}, maven: {}, conda: {} } }),
        clear: async () => ({ success: true }),
      },
      history: {
        load: async () => [],
        save: async () => ({ success: true }),
        add: async () => ({ success: true }),
        delete: async () => ({ success: true }),
        clear: async () => ({ success: true }),
      },
      updater: {
        check: async () => ({ success: true }),
        download: async () => ({ success: true }),
        install: async () => ({ success: true }),
        getStatus: async () => ({
          checking: false,
          available: false,
          downloaded: false,
          downloading: false,
          error: null,
          progress: null,
          updateInfo: null,
        }),
        setAutoDownload: async () => ({ success: true }),
        onStatusChange: () => () => undefined,
      },
    };

    Object.defineProperty(window, 'electronAPI', {
      value: electronAPI,
      configurable: true,
    });
  });

  await page.goto('/#/wizard');

  await page.getByText('OS 패키지').click();
  await page.getByText('YUM/RPM').click();
  await page.getByPlaceholder('패키지명을 입력하세요 (예: httpd, nginx, vim)').fill('bash');
  await page.getByText('bash').click();
  await page.getByRole('button', { name: '장바구니에 추가' }).click();
  await page.getByRole('button', { name: 'OS 다운로드 진행' }).click();

  await expect(page.getByText('OS 패키지 다운로드')).toBeVisible();
  await page.getByRole('button', { name: '출력 옵션 ▼' }).click();
  await page.getByText('로컬 저장소').click();
  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await expect(page.getByText('패키징')).toBeVisible();
  await expect(page.getByText('다운로드 완료!')).toBeVisible();
  await expect(page.getByText('로컬 저장소')).toBeVisible();
});
