import * as path from 'node:path';
import * as fs from 'fs-extra';
import * as semver from 'semver';
import * as tar from 'tar';
import type { PackageInfo } from '../../types';

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export interface NpmPackageFile {
  filePath: string;
  relativePath: string;
}

export interface NpmInstallPlanEntry {
  name: string;
  version: string;
  relativePath: string;
}

interface CandidateFile {
  filePath: string;
  relativePath: string;
}

interface TarballManifest {
  name: string;
  version: string;
}

function isRegularFileEntry(entry: { type?: string }): boolean {
  return entry.type === 'File' || entry.type === 'OldFile';
}

function normalizeRelativePath(relativePath: string): string {
  const portable = relativePath.replace(/\\/g, '/');
  if (
    portable.length === 0 ||
    portable.startsWith('/') ||
    /^[A-Za-z]:\//.test(portable)
  ) {
    throw new Error(`npm tarball 상대 경로가 유효하지 않습니다: ${relativePath}`);
  }

  const segments = portable.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`npm tarball 상대 경로가 디렉터리 밖으로 나갑니다: ${relativePath}`);
  }
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`npm tarball 상대 경로가 유효하지 않습니다: ${relativePath}`);
  }

  return segments.join('/');
}

async function collectPackageFiles(
  packageDirectory: string,
): Promise<CandidateFile[]> {
  if (!(await fs.pathExists(packageDirectory))) return [];

  const stat = await fs.stat(packageDirectory);
  if (!stat.isDirectory()) {
    throw new Error(`npm 패키지 디렉터리가 디렉터리가 아닙니다: ${packageDirectory}`);
  }

  const candidates: CandidateFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile() && entry.name.endsWith('.tgz')) {
        candidates.push({
          filePath,
          relativePath: normalizeRelativePath(path.relative(packageDirectory, filePath)),
        });
      }
    }
  };

  await visit(packageDirectory);
  return candidates;
}

async function readTarballManifest(filePath: string): Promise<TarballManifest> {
  let manifestPath: string | undefined;
  let manifest: TarballManifest | undefined;
  let manifestError: Error | undefined;

  try {
    await tar.t({
      file: filePath,
      onReadEntry: (entry) => {
        const entryPath = entry.path.replace(/\\/g, '/').replace(/^\.\//, '');
        const isPackageJson = /^([^/]+)\/package\.json$/.test(entryPath);

        if (!isPackageJson) {
          entry.resume();
          return;
        }

        if (!isRegularFileEntry(entry)) {
          manifestError = new Error(`npm tarball package.json이 일반 파일이 아닙니다: ${filePath}`);
          entry.resume();
          return;
        }
        if (manifestPath) {
          manifestError = new Error(`npm tarball에 package.json이 중복됩니다: ${filePath}`);
          entry.resume();
          return;
        }
        if (entry.size > MAX_MANIFEST_BYTES) {
          manifestError = new Error(`npm tarball package.json이 너무 큽니다(최대 4MiB): ${filePath}`);
          entry.resume();
          return;
        }

        manifestPath = entryPath;
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        entry.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > MAX_MANIFEST_BYTES) {
            manifestError = new Error(`npm tarball package.json이 너무 큽니다(최대 4MiB): ${filePath}`);
            return;
          }
          chunks.push(chunk);
        });
        entry.on('end', () => {
          if (manifestError) return;
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              typeof parsed !== 'object' ||
              parsed === null ||
              typeof (parsed as { name?: unknown }).name !== 'string' ||
              typeof (parsed as { version?: unknown }).version !== 'string' ||
              (parsed as { name: string }).name.length === 0 ||
              (parsed as { version: string }).version.length === 0
            ) {
              throw new Error('name/version이 없습니다');
            }
            const candidate = parsed as { name: string; version: string };
            if (!semver.valid(candidate.version)) {
              throw new Error(`유효하지 않은 semver 버전입니다: ${candidate.version}`);
            }
            manifest = { name: candidate.name, version: candidate.version };
          } catch (error) {
            manifestError = new Error(
              `npm tarball package.json을 읽을 수 없습니다: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
            );
          }
        });
      },
    });
  } catch (error) {
    throw new Error(
      `npm tarball을 읽을 수 없습니다: ${filePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  if (manifestError) throw manifestError;
  if (!manifest) {
    throw new Error(`npm tarball에 package/package.json이 없습니다: ${filePath}`);
  }
  return manifest;
}

export async function createNpmInstallPlan(
  packages: PackageInfo[],
  scriptPath: string,
  packageDir: string,
  packageFiles?: NpmPackageFile[],
  npmRootPackages?: PackageInfo[],
): Promise<NpmInstallPlanEntry[]> {
  const npmNames = new Set(
    packages
      .filter((pkg) => pkg.type === 'npm')
      .map((pkg) => pkg.name),
  );
  if (npmNames.size === 0) return [];

  const packageDirectory = path.isAbsolute(packageDir)
    ? path.resolve(packageDir)
    : path.resolve(path.dirname(path.resolve(scriptPath)), packageDir);
  const candidates = packageFiles
    ? packageFiles.map((file) => ({
        filePath: path.resolve(file.filePath),
        relativePath: normalizeRelativePath(file.relativePath),
      }))
    : await collectPackageFiles(packageDirectory);

  const uniqueCandidates = new Map<string, CandidateFile>();
  for (const candidate of candidates) {
    const key = JSON.stringify([candidate.filePath, candidate.relativePath]);
    uniqueCandidates.set(key, candidate);
  }

  const entries: NpmInstallPlanEntry[] = [];
  const byPackageVersion = new Map<string, NpmInstallPlanEntry>();
  for (const candidate of uniqueCandidates.values()) {
    const manifest = await readTarballManifest(candidate.filePath);
    if (!npmNames.has(manifest.name)) continue;

    const key = `${manifest.name}@${manifest.version}`;
    const previous = byPackageVersion.get(key);
    if (previous) {
      throw new Error(
        `동일한 npm 패키지 버전의 tarball이 중복됩니다: ${key} (${previous.relativePath}, ${candidate.relativePath})`,
      );
    }

    const entry = {
      name: manifest.name,
      version: manifest.version,
      relativePath: candidate.relativePath,
    };
    byPackageVersion.set(key, entry);
    entries.push(entry);
  }

  const preferredVersions = new Map<string, string>();
  for (const root of npmRootPackages ?? []) {
    if (root.type !== 'npm') continue;
    const candidatesForName = entries.filter((entry) => entry.name === root.name);
    if (candidatesForName.length === 0) {
      throw new Error(`직접 npm 패키지 tarball을 찾을 수 없습니다: ${root.name}@${root.version}`);
    }

    const requestedVersion = root.version;
    const exactVersion = semver.valid(requestedVersion);
    let preferredVersion: string | null = exactVersion;
    if (!preferredVersion) {
      const range = semver.validRange(requestedVersion);
      if (range) {
        preferredVersion = semver.maxSatisfying(
          candidatesForName.map((entry) => entry.version),
          range,
        );
      } else if (candidatesForName.length === 1) {
        preferredVersion = candidatesForName[0].version;
      } else {
        throw new Error(
          `직접 npm 패키지 버전을 tarball만으로 결정할 수 없습니다: ${root.name}@${requestedVersion}`,
        );
      }
    }

    if (!preferredVersion || !candidatesForName.some((entry) => entry.version === preferredVersion)) {
      throw new Error(`직접 npm 패키지 tarball 버전을 찾을 수 없습니다: ${root.name}@${requestedVersion}`);
    }

    const previous = preferredVersions.get(root.name);
    if (previous && previous !== preferredVersion) {
      throw new Error(
        `동일한 npm 패키지의 서로 다른 직접 버전은 함께 설치할 수 없습니다: ${root.name}@${previous}, ${root.name}@${preferredVersion}`,
      );
    }
    preferredVersions.set(root.name, preferredVersion);
  }

  entries.sort((a, b) =>
    a.name.localeCompare(b.name) ||
    (preferredVersions.get(a.name) === a.version ? -1 : 0) -
      (preferredVersions.get(b.name) === b.version ? -1 : 0) ||
    semver.rcompare(a.version, b.version) ||
    a.relativePath.localeCompare(b.relativePath),
  );
  return entries;
}
