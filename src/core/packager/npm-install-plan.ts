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

export interface NpmOverridePlanRule {
  /** Index of the parent rule, or null for a directly requested package. */
  parent: number | null;
  name: string;
  packageKey: string;
}

export interface NpmInstallPlan {
  packages: NpmInstallPlanEntry[];
  roots: string[];
  rules: NpmOverridePlanRule[];
}

interface CandidateFile {
  filePath: string;
  relativePath: string;
}

interface TarballManifest {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  optionalPeers: Set<string>;
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
            const candidate = parsed as {
              name: string;
              version: string;
              dependencies?: unknown;
              optionalDependencies?: unknown;
              peerDependencies?: unknown;
              peerDependenciesMeta?: unknown;
            };
            if (!semver.valid(candidate.version)) {
              throw new Error(`유효하지 않은 semver 버전입니다: ${candidate.version}`);
            }
            const readDependencyMap = (value: unknown): Record<string, string> => {
              if (value === undefined) return {};
              if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                throw new Error('의존성 목록 형식이 유효하지 않습니다');
              }
              const result: Record<string, string> = Object.create(null);
              for (const [name, spec] of Object.entries(value)) {
                if (typeof spec !== 'string' || name.length === 0) {
                  throw new Error(`의존성 명세가 유효하지 않습니다: ${name}`);
                }
                result[name] = spec;
              }
              return result;
            };
            const optionalPeers = new Set<string>();
            if (candidate.peerDependenciesMeta !== undefined) {
              if (
                typeof candidate.peerDependenciesMeta !== 'object' ||
                candidate.peerDependenciesMeta === null ||
                Array.isArray(candidate.peerDependenciesMeta)
              ) {
                throw new Error('peerDependenciesMeta 형식이 유효하지 않습니다');
              }
              for (const [name, meta] of Object.entries(candidate.peerDependenciesMeta)) {
                if (
                  typeof meta === 'object' &&
                  meta !== null &&
                  (meta as { optional?: unknown }).optional === true
                ) {
                  optionalPeers.add(name);
                }
              }
            }
            manifest = {
              name: candidate.name,
              version: candidate.version,
              dependencies: readDependencyMap(candidate.dependencies),
              optionalDependencies: readDependencyMap(candidate.optionalDependencies),
              peerDependencies: readDependencyMap(candidate.peerDependencies),
              optionalPeers,
            };
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

const MAX_PLAN_DEPTH = 128;
const MAX_PLAN_RULES = 100_000;

interface CandidateRecord {
  entry: NpmInstallPlanEntry;
  manifest: TarballManifest;
  key: string;
}

interface PlanFrame {
  ruleIndex: number;
  record: CandidateRecord;
  scope: Map<string, CandidateRecord>;
  ancestors: Set<string>;
  depth: number;
}

function packageKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function chooseCandidate(
  name: string,
  requestedSpec: string,
  scope: Map<string, CandidateRecord>,
  candidatesByName: Map<string, CandidateRecord[]>,
): CandidateRecord | undefined {
  const candidates = candidatesByName.get(name) ?? [];
  if (candidates.length === 0) return undefined;

  const exact = semver.valid(requestedSpec);
  const range = exact ? `=${exact}` : semver.validRange(requestedSpec);
  const matches = range
    ? candidates.filter((candidate) => semver.satisfies(candidate.entry.version, range))
    : candidates;
  if (matches.length === 0) return undefined;

  const scoped = scope.get(name);
  if (scoped && matches.some((candidate) => candidate.key === scoped.key)) {
    return scoped;
  }
  if (!range && matches.length !== 1) {
    throw new Error(
      `npm 의존성 버전을 tarball만으로 결정할 수 없습니다: ${name}@${requestedSpec}`,
    );
  }
  return matches[0];
}

function dependencySpecs(record: TarballManifest): {
  name: string;
  spec: string;
  optional: boolean;
}[] {
  const dependencies = new Map<string, { spec: string; optional: boolean }>();
  for (const [name, spec] of Object.entries(record.dependencies)) {
    dependencies.set(name, { spec, optional: false });
  }
  for (const [name, spec] of Object.entries(record.optionalDependencies)) {
    dependencies.set(name, { spec, optional: true });
  }
  for (const [name, spec] of Object.entries(record.peerDependencies)) {
    if (!dependencies.has(name)) {
      dependencies.set(name, { spec, optional: record.optionalPeers.has(name) });
    }
  }
  return [...dependencies.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, dependency]) => ({ name, ...dependency }));
}

export async function createNpmInstallPlan(
  packages: PackageInfo[],
  scriptPath: string,
  packageDir: string,
  packageFiles?: NpmPackageFile[],
  npmRootPackages?: PackageInfo[],
): Promise<NpmInstallPlan> {
  const npmNames = new Set(
    packages
      .filter((pkg) => pkg.type === 'npm')
      .map((pkg) => pkg.name),
  );
  if (npmNames.size === 0) return { packages: [], roots: [], rules: [] };

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

  const candidateRecords = new Map<string, CandidateRecord>();
  for (const candidate of uniqueCandidates.values()) {
    const manifest = await readTarballManifest(candidate.filePath);
    if (!npmNames.has(manifest.name)) continue;

    const key = packageKey(manifest.name, manifest.version);
    const previous = candidateRecords.get(key);
    if (previous) {
      throw new Error(
        `동일한 npm 패키지 버전의 tarball이 중복됩니다: ${key} (${previous.entry.relativePath}, ${candidate.relativePath})`,
      );
    }
    const entry: NpmInstallPlanEntry = {
      name: manifest.name,
      version: manifest.version,
      relativePath: candidate.relativePath,
    };
    candidateRecords.set(key, { entry, manifest, key });
  }

  const candidatesByName = new Map<string, CandidateRecord[]>();
  for (const record of candidateRecords.values()) {
    const records = candidatesByName.get(record.entry.name) ?? [];
    records.push(record);
    candidatesByName.set(record.entry.name, records);
  }
  for (const records of candidatesByName.values()) {
    records.sort((left, right) =>
      semver.rcompare(left.entry.version, right.entry.version) ||
      left.entry.relativePath.localeCompare(right.entry.relativePath),
    );
  }

  const rootsByName = new Map<string, CandidateRecord>();
  if (npmRootPackages !== undefined) {
    for (const root of npmRootPackages) {
      if (root.type !== 'npm') continue;
      const selected = chooseCandidate(root.name, root.version, new Map(), candidatesByName);
      if (!selected) {
        throw new Error(`직접 npm 패키지 tarball을 찾을 수 없습니다: ${root.name}@${root.version}`);
      }
      const previous = rootsByName.get(root.name);
      if (previous && previous.key !== selected.key) {
        throw new Error(
          `동일한 npm 패키지의 서로 다른 직접 버전은 함께 설치할 수 없습니다: ${previous.key}, ${selected.key}`,
        );
      }
      rootsByName.set(root.name, selected);
    }
  } else {
    for (const [name, records] of candidatesByName) {
      if (records[0]) rootsByName.set(name, records[0]);
    }
  }
  if (rootsByName.size === 0) {
    throw new Error('직접 설치할 npm 패키지가 없습니다.');
  }

  const roots = [...rootsByName.values()].sort((left, right) => left.key.localeCompare(right.key));
  const rules: NpmOverridePlanRule[] = roots.map((root) => ({
    parent: null,
    name: root.entry.name,
    packageKey: root.key,
  }));
  if (rules.length > MAX_PLAN_RULES) {
    throw new Error(`npm 설치 계획이 너무 큽니다(최대 ${MAX_PLAN_RULES}개 규칙).`);
  }

  const rootScope = new Map<string, CandidateRecord>();
  for (const root of roots) rootScope.set(root.entry.name, root);
  const frames: PlanFrame[] = roots.map((root, ruleIndex) => ({
    ruleIndex,
    record: root,
    scope: rootScope,
    ancestors: new Set([root.key]),
    depth: 0,
  }));

  while (frames.length > 0) {
    const frame = frames.pop();
    if (!frame) break;
    if (frame.depth > MAX_PLAN_DEPTH) {
      throw new Error(`npm 의존성 트리가 너무 깊습니다(최대 ${MAX_PLAN_DEPTH}단계).`);
    }

    const selectedChildren: { name: string; record: CandidateRecord; cycle: boolean }[] = [];
    for (const dependency of dependencySpecs(frame.record.manifest)) {
      const selected = chooseCandidate(
        dependency.name,
        dependency.spec,
        frame.scope,
        candidatesByName,
      );
      if (!selected) {
        if (dependency.optional) continue;
        // Leave required missing edges for npm to reject in offline mode.
        continue;
      }
      selectedChildren.push({
        name: dependency.name,
        record: selected,
        cycle: frame.ancestors.has(selected.key),
      });
    }

    const childScope = new Map(frame.scope);
    for (const child of selectedChildren) childScope.set(child.name, child.record);
    for (const child of selectedChildren) {
      if (rules.length >= MAX_PLAN_RULES) {
        throw new Error(`npm 설치 계획이 너무 큽니다(최대 ${MAX_PLAN_RULES}개 규칙).`);
      }
      const childRuleIndex = rules.length;
      rules.push({
        parent: frame.ruleIndex,
        name: child.name,
        packageKey: child.record.key,
      });
      if (child.cycle) continue;
      const ancestors = new Set(frame.ancestors);
      ancestors.add(child.record.key);
      frames.push({
        ruleIndex: childRuleIndex,
        record: child.record,
        scope: childScope,
        ancestors,
        depth: frame.depth + 1,
      });
    }
  }

  const entries = [...candidateRecords.values()]
    .map((record) => record.entry)
    .sort((left, right) =>
      left.name.localeCompare(right.name) ||
      semver.rcompare(left.version, right.version) ||
      left.relativePath.localeCompare(right.relativePath),
    );
  return {
    packages: entries,
    roots: roots.map((root) => root.key),
    rules,
  };
}
