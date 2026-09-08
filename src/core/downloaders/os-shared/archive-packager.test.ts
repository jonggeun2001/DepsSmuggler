import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OSArchivePackager, type ArchiveOptions } from './archive-packager';
import { getDownloadedFileKey } from './package-file-utils';
import type { OSPackageInfo } from './types';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(),
  archiver: vi.fn(),
  dependencyScript: vi.fn(),
  repoScript: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  createWriteStream: mocks.createWriteStream,
}));
vi.mock('archiver', () => ({ default: mocks.archiver }));
vi.mock('./script-generator', () => ({
  OSScriptGenerator: class {
    generateDependencyOrderScript = mocks.dependencyScript;
    generateLocalRepoScript = mocks.repoScript;
  },
}));

function pkg(overrides: Partial<OSPackageInfo> = {}): OSPackageInfo {
  return {
    name: 'httpd',
    version: '2.4.57',
    release: '3.el9',
    architecture: 'x86_64',
    size: 2048,
    location: 'Packages/httpd-2.4.57-3.el9.x86_64.rpm',
    checksum: { type: 'sha256', value: 'hash' },
    repository: {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
    dependencies: [],
    ...overrides,
  };
}

describe('OSArchivePackager', () => {
  let packager: OSArchivePackager;
  let output: EventEmitter;
  let archive: EventEmitter & {
    pipe: ReturnType<typeof vi.fn>;
    file: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
  };
  let options: ArchiveOptions;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    output = new EventEmitter();
    archive = Object.assign(new EventEmitter(), {
      pipe: vi.fn(),
      file: vi.fn(),
      append: vi.fn(),
      finalize: vi.fn(() => {
        queueMicrotask(() => output.emit('close'));
      }),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.createWriteStream.mockReturnValue(output);
    mocks.archiver.mockReturnValue(archive);
    mocks.dependencyScript.mockReturnValue({
      bash: '# dependency bash',
      powershell: '# dependency powershell',
    });
    mocks.repoScript.mockReturnValue({
      bash: '# repository bash',
      powershell: '# repository powershell',
    });
    packager = new OSArchivePackager();
    options = {
      format: 'zip',
      outputPath: path.join('output', 'bundle'),
      includeScripts: false,
      scriptTypes: [],
      packageManager: 'yum',
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function appended(name: string): string {
    const call = archive.append.mock.calls.find(([, opts]) => opts.name === name);
    expect(call, `expected ${name} in the archive`).toBeDefined();
    return call![0] as string;
  }

  it('creates a ZIP with real RPM filenames, deterministic metadata, and Korean installation instructions', async () => {
    const packageInfo = pkg();
    const downloadedPath = path.join('downloads', 'httpd-2.4.57-3.el9.x86_64.rpm');
    await expect(
      packager.createArchive(
        [packageInfo],
        new Map([[getDownloadedFileKey(packageInfo), downloadedPath]]),
        options
      )
    ).resolves.toBe(path.join('output', 'bundle.zip'));

    expect(mocks.archiver).toHaveBeenCalledExactlyOnceWith('zip', { zlib: { level: 9 } });
    expect(archive.pipe).toHaveBeenCalledExactlyOnceWith(output);
    expect(archive.file).toHaveBeenCalledExactlyOnceWith(downloadedPath, {
      name: 'packages/httpd-2.4.57-3.el9.x86_64.rpm',
    });
    expect(JSON.parse(appended('metadata.json'))).toEqual({
      createdAt: '2026-01-01T00:00:00.000Z',
      packageManager: 'yum',
      totalPackages: 1,
      totalSize: 2048,
      packages: [
        {
          name: 'httpd',
          version: '2.4.57',
          architecture: 'x86_64',
          size: 2048,
          filename: 'httpd-2.4.57-3.el9.x86_64.rpm',
        },
      ],
    });
    expect(appended('README.txt')).toContain('YUM/RPM');
    expect(appended('README.txt')).toContain('총 크기: 2.00 KB');
    expect(appended('README.txt')).toContain('yum install <패키지명>');
    expect(appended('README.txt')).toContain('- httpd 2.4.57 (x86_64)');
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.dependencyScript).not.toHaveBeenCalled();
  });

  it.each(['zip', 'tar.gz'] as const)(
    'preserves the supplied .%s extension and creates missing output directories',
    async (format) => {
      options = { ...options, format, outputPath: path.join('output', `bundle.${format}`) };
      mocks.existsSync.mockReturnValue(false);
      await expect(packager.createArchive([], new Map(), options)).resolves.toBe(
        options.outputPath
      );
      expect(mocks.mkdirSync).toHaveBeenCalledExactlyOnceWith(path.dirname(options.outputPath), {
        recursive: true,
      });
      expect(mocks.createWriteStream).toHaveBeenCalledExactlyOnceWith(options.outputPath);
      expect(mocks.archiver).toHaveBeenCalledWith(
        format === 'zip' ? 'zip' : 'tar',
        format === 'zip' ? { zlib: { level: 9 } } : { gzip: true, gzipOptions: { level: 9 } }
      );
      expect(JSON.parse(appended('metadata.json'))).toMatchObject({
        totalPackages: 0,
        totalSize: 0,
        packages: [],
      });
      expect(appended('README.txt')).toContain('총 크기: 0.00 B');
    }
  );

  it('appends .tar.gz and omits all optional entries when disabled', async () => {
    await expect(
      packager.createArchive([], new Map(), {
        ...options,
        format: 'tar.gz',
        includeMetadata: false,
        includeReadme: false,
      })
    ).resolves.toBe(path.join('output', 'bundle.tar.gz'));
    expect(archive.append).not.toHaveBeenCalled();
    expect(archive.file).not.toHaveBeenCalled();
    expect(archive.finalize).toHaveBeenCalledOnce();
  });

  it('skips packages without a download mapping or whose file no longer exists', async () => {
    const packages = [pkg(), pkg({ name: 'missing-file' }), pkg({ name: 'unmapped' })];
    const present = path.join('downloads', 'actual.rpm');
    const missing = path.join('downloads', 'deleted.rpm');
    mocks.existsSync.mockImplementation((filePath) => filePath !== missing);
    await packager.createArchive(
      packages,
      new Map([
        [getDownloadedFileKey(packages[0]), present],
        [getDownloadedFileKey(packages[1]), missing],
      ]),
      options
    );

    expect(archive.file).toHaveBeenCalledExactlyOnceWith(present, { name: 'packages/actual.rpm' });
  });

  it('includes both selected script types with executable Bash modes and a custom repository name', async () => {
    const packages = [pkg()];
    await packager.createArchive(packages, new Map(), {
      ...options,
      includeScripts: true,
      scriptTypes: ['dependency-order', 'local-repo'],
      repoName: 'offline-repo',
    });
    expect(mocks.dependencyScript).toHaveBeenCalledExactlyOnceWith(packages, 'yum', {
      repoName: 'offline-repo',
      packageDir: './packages',
    });
    expect(mocks.repoScript).toHaveBeenCalledExactlyOnceWith(packages, 'yum', {
      repoName: 'offline-repo',
      packageDir: './packages',
    });
    expect(archive.append.mock.calls.slice(0, 4)).toEqual([
      ['# dependency bash', { name: 'install.sh', mode: 0o755 }],
      ['# dependency powershell', { name: 'install.ps1' }],
      ['# repository bash', { name: 'setup-repo.sh', mode: 0o755 }],
      ['# repository powershell', { name: 'setup-repo.ps1' }],
    ]);
  });

  it.each(['dependency-order', 'local-repo'] as const)(
    'generates only the selected %s script with the default repository name',
    async (scriptType) => {
      await packager.createArchive([], new Map(), {
        ...options,
        includeScripts: true,
        scriptTypes: [scriptType],
      });
      const selected =
        scriptType === 'dependency-order' ? mocks.dependencyScript : mocks.repoScript;
      const other = scriptType === 'dependency-order' ? mocks.repoScript : mocks.dependencyScript;
      expect(selected).toHaveBeenCalledExactlyOnceWith([], 'yum', {
        repoName: 'depssmuggler-local',
        packageDir: './packages',
      });
      expect(other).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      manager: 'apt',
      label: 'APT/DEB',
      command: 'apt-get install',
      size: 1024 ** 2,
      sizeLabel: '1.00 MB',
    },
    {
      manager: 'apk',
      label: 'APK (Alpine Linux)',
      command: 'apk add',
      size: 1024 ** 3,
      sizeLabel: '1.00 GB',
    },
  ] as const)(
    'creates the $manager README and size units',
    async ({ manager, label, command, size, sizeLabel }) => {
      await packager.createArchive([pkg({ size })], new Map(), {
        ...options,
        packageManager: manager,
      });
      expect(appended('README.txt')).toContain(label);
      expect(appended('README.txt')).toContain(command);
      expect(appended('README.txt')).toContain(sizeLabel);
    }
  );

  it('propagates output directory permission failure before starting compression', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mocks.existsSync.mockReturnValue(false);
    mocks.mkdirSync.mockImplementation(() => {
      throw denied;
    });
    await expect(packager.createArchive([], new Map(), options)).rejects.toBe(denied);
    expect(mocks.createWriteStream).not.toHaveBeenCalled();
    expect(mocks.archiver).not.toHaveBeenCalled();
  });

  it('rejects an archiver error without waiting for an output close event', async () => {
    const failure = new Error('compression failed');
    archive.finalize.mockImplementation(() => {
      queueMicrotask(() => archive.emit('error', failure));
    });
    await expect(packager.createArchive([], new Map(), options)).rejects.toBe(failure);
  });
});
