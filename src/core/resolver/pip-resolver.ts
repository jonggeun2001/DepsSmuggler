import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';
import { PyPIInfo, PyPIResponse } from '../shared/pip-types';
import { compareVersions, isVersionCompatible, flattenDependencyTree } from '../shared';
import {
  fetchPackageMetadata,
  clearMemoryCache as clearPipCache,
  PipCacheOptions,
  PyPIRelease,
  PyPIPackageInfo,
} from '../shared/pip-cache';
import type { PipTargetPlatform } from '../../types/platform/pip-target-platform';
import {
  fetchPackageFiles,
  extractVersionFromFilename,
  findLatestVersion as findLatestVersionFromSimpleApi,
  SimpleApiPackageFile,
  fetchWheelMetadata,
} from './pip-simple-api';

// 의존성 파싱 결과
interface ParsedDependency {
  name: string;
  versionSpec?: string;
  extras?: string[];
  markers?: string;
}

// 타겟 플랫폼 타입
interface TargetPlatform {
  system?: 'Linux' | 'Windows' | 'Darwin';
  machine?: 'x86_64' | 'aarch64' | 'arm64';
}

// BFS 큐 아이템
interface QueueItem {
  name: string;
  version: string;
  indexUrl?: string;
  extras?: string[];
  parentCacheKey?: string; // 부모 패키지 캐시키 (트리 구축용)
}

// 패키지 정보 조회 결과
interface FetchedPackageInfo {
  packageInfo: PackageInfo;
  requiresDist: string[];
  actualVersion: string;
}

export class PipResolver implements IResolver {
  readonly type = 'pip' as const;
  private readonly baseUrl = 'https://pypi.org/pypi';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private targetPlatform: TargetPlatform | null = null;
  private pythonVersion: string | null = null;
  private cacheOptions: PipCacheOptions = {};
  private pipTargetPlatform: PipTargetPlatform | null = null;

  /**
   * 캐시 옵션 설정
   */
  setCacheOptions(options: PipCacheOptions): void {
    this.cacheOptions = options;
  }

  /**
   * pip 타겟 플랫폼 설정
   */
  setPipTargetPlatform(platform: PipTargetPlatform | null): void {
    this.pipTargetPlatform = platform;
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    clearPipCache();
  }

  /**
   * 의존성 해결 (BFS 큐 기반 - call stack 문제 해결)
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: ResolverOptions & { pythonVersion?: string; indexUrl?: string; extras?: string[] }
  ): Promise<DependencyResolutionResult> {
    // 상태 초기화
    this.visited.clear();
    this.conflicts = [];
    this.targetPlatform = options?.targetPlatform ?? null;
    this.pythonVersion = options?.pythonVersion ?? null;

    // pipTargetPlatform 설정 (wheel 호환성 체크용)
    if (this.targetPlatform || this.pythonVersion) {
      const osMap: Record<string, 'linux' | 'macos' | 'windows'> = {
        'Linux': 'linux',
        'Darwin': 'macos',
        'Windows': 'windows',
      };
      const archMap: Record<string, 'x86_64' | 'aarch64' | 'arm64'> = {
        'x86_64': 'x86_64',
        'amd64': 'x86_64',
        'aarch64': 'aarch64',
        'arm64': 'arm64',
      };

      this.pipTargetPlatform = {
        os: osMap[this.targetPlatform?.system || ''] || 'linux',
        arch: archMap[this.targetPlatform?.machine || ''] || 'x86_64',
        pythonVersion: this.pythonVersion ?? undefined,
      };
    }

    const maxDepth = options?.maxDepth ?? 10;
    const indexUrl = options?.indexUrl;
    const extras = options?.extras;

    try {
      // BFS 큐 초기화
      const queue: Array<QueueItem & { depth: number }> = [{
        name: packageName,
        version,
        indexUrl,
        extras,
        parentCacheKey: undefined,
        depth: 0,
      }];

      // 해결된 패키지 저장 (캐시키 → 노드)
      const resolvedNodes: Map<string, DependencyNode> = new Map();
      // 부모-자식 관계 저장 (부모캐시키 → 자식캐시키[])
      const parentChildMap: Map<string, string[]> = new Map();
      // 루트 캐시키
      let rootCacheKey: string | undefined;

      // BFS 반복
      while (queue.length > 0) {
        const current = queue.shift()!;
        const { name, version: ver, indexUrl: idx, extras: ext, parentCacheKey, depth } = current;

        // 최대 깊이 체크
        if (depth > maxDepth) {
          continue;
        }

        // 패키지 정보 조회
        let fetchResult: FetchedPackageInfo | null = null;
        try {
          fetchResult = await this.fetchPackageInfo(name, ver, idx);
        } catch (error) {
          logger.warn('패키지 정보 조회 실패', { name, version: ver, error });
          continue;
        }

        if (!fetchResult) continue;

        const { packageInfo, requiresDist, actualVersion } = fetchResult;
        const cacheKey = `${name.toLowerCase()}@${actualVersion}`;

        // 이미 해결된 패키지면 스킵 (부모-자식 관계만 추가)
        if (resolvedNodes.has(cacheKey)) {
          if (parentCacheKey) {
            const children = parentChildMap.get(parentCacheKey) || [];
            if (!children.includes(cacheKey)) {
              children.push(cacheKey);
              parentChildMap.set(parentCacheKey, children);
            }
          }
          continue;
        }

        // 루트 캐시키 저장
        if (!rootCacheKey) {
          rootCacheKey = cacheKey;
        }

        // 노드 생성 및 저장
        const node: DependencyNode = {
          package: packageInfo,
          dependencies: [], // 나중에 트리 빌드 시 채움
        };
        resolvedNodes.set(cacheKey, node);
        this.visited.set(cacheKey, node);

        // 부모-자식 관계 저장
        if (parentCacheKey) {
          const children = parentChildMap.get(parentCacheKey) || [];
          children.push(cacheKey);
          parentChildMap.set(parentCacheKey, children);
        }

        // 의존성 파싱 및 큐에 추가
        if (requiresDist.length > 0) {
          const parsedDeps = requiresDist
            .map((dep) => this.parseDependencyString(dep))
            .filter((dep) => dep !== null && this.evaluateMarker(dep.markers, ext));

          for (const dep of parsedDeps) {
            if (!dep) continue;

            try {
              // 의존성 버전 조회
              let depVersion: string | null = null;
              let usedIndexUrl: string | undefined = idx;

              if (idx) {
                // 커스텀 인덱스에서 시도
                depVersion = await this.getLatestVersion(dep.name, dep.versionSpec, idx);
                if (!depVersion) {
                  // PyPI fallback
                  depVersion = await this.getLatestVersion(dep.name, dep.versionSpec, undefined);
                  usedIndexUrl = undefined;
                }
              } else {
                // PyPI 사용
                depVersion = await this.getLatestVersion(dep.name, dep.versionSpec, undefined);
              }

              if (depVersion) {
                const depCacheKey = `${dep.name.toLowerCase()}@${depVersion}`;
                // 아직 해결되지 않은 패키지만 큐에 추가
                if (!resolvedNodes.has(depCacheKey)) {
                  queue.push({
                    name: dep.name,
                    version: depVersion,
                    indexUrl: usedIndexUrl,
                    extras: dep.extras,
                    parentCacheKey: cacheKey,
                    depth: depth + 1,
                  });
                } else {
                  // 이미 해결된 경우 부모-자식 관계만 추가
                  const children = parentChildMap.get(cacheKey) || [];
                  if (!children.includes(depCacheKey)) {
                    children.push(depCacheKey);
                    parentChildMap.set(cacheKey, children);
                  }
                }
              }
            } catch (error) {
              logger.warn('의존성 버전 조회 실패', { parent: name, dependency: dep.name, error });
            }
          }
        }
      }

      // 의존성 트리 빌드
      if (!rootCacheKey || !resolvedNodes.has(rootCacheKey)) {
        throw new Error(`패키지를 찾을 수 없음: ${packageName}@${version}`);
      }

      // 부모-자식 관계를 기반으로 트리 구축
      for (const [parentKey, childKeys] of parentChildMap) {
        const parentNode = resolvedNodes.get(parentKey);
        if (parentNode) {
          for (const childKey of childKeys) {
            const childNode = resolvedNodes.get(childKey);
            if (childNode) {
              parentNode.dependencies.push(childNode);
            }
          }
        }
      }

      const root = resolvedNodes.get(rootCacheKey)!;
      const flatList = flattenDependencyTree(root);

      logger.info('✅ BFS 의존성 해결 완료', {
        rootPackage: packageName,
        totalResolved: resolvedNodes.size,
        flatListSize: flatList.length,
      });

      return {
        root,
        flatList,
        conflicts: this.conflicts,
        totalSize: flatList.reduce(
          (sum, pkg) => sum + (pkg.metadata?.size || 0),
          0
        ),
      };
    } catch (error) {
      logger.error('의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * 단일 패키지 정보 조회 (비재귀 - BFS에서 사용)
   */
  private async fetchPackageInfo(
    name: string,
    version: string,
    indexUrl?: string
  ): Promise<FetchedPackageInfo | null> {
    logger.debug('📦 패키지 정보 조회', {
      name,
      version,
      indexUrl: indexUrl ? indexUrl.substring(0, 50) + '...' : 'PyPI',
    });

    // "latest" 버전인 경우 실제 최신 버전 조회
    let actualVersion = version;
    if (version === 'latest' || !version) {
      const latestVersion = await this.getLatestVersion(name, undefined, indexUrl);
      if (!latestVersion) {
        throw new Error(`패키지를 찾을 수 없음: ${name}@${version}`);
      }
      actualVersion = latestVersion;
      logger.debug('"latest" 버전을 실제 버전으로 변환', { name, version, actualVersion });
    }

    let packageInfo: PackageInfo;
    let requiresDist: string[] = [];

    if (indexUrl) {
      // Simple API 사용 (커스텀 인덱스)
      const files = await fetchPackageFiles(indexUrl, name);

      const targetFiles = files.filter(
        (f) => extractVersionFromFilename(f.filename) === actualVersion
      );

      if (targetFiles.length === 0) {
        // 커스텀 인덱스에서 찾지 못하면 PyPI로 fallback
        logger.debug('커스텀 인덱스에서 패키지를 찾지 못함 - PyPI로 fallback', {
          name,
          version: actualVersion,
        });
        return await this.fetchPackageInfo(name, actualVersion, undefined);
      }

      // 최적의 wheel 선택
      const selectedFile = this.selectBestWheelFromSimpleApi(targetFiles);

      // PEP 658 메타데이터에서 의존성 정보 조회
      if (selectedFile?.metadataHash) {
        requiresDist = await fetchWheelMetadata(selectedFile);
      }

      // PEP 658 실패 시 PyPI 폴백
      if (requiresDist.length === 0) {
        try {
          const baseVersion = actualVersion.split('+')[0];
          const pypiResult = await fetchPackageMetadata(name, baseVersion, this.cacheOptions);
          if (pypiResult) {
            requiresDist = pypiResult.data.info.requires_dist || [];
          }
        } catch {
          // 커스텀 전용 패키지일 수 있음
        }
      }

      packageInfo = {
        type: 'pip',
        name,
        version: actualVersion,
        metadata: {
          description: '',
          size: 0,
          filename: selectedFile?.filename,
          indexUrl,
        },
      };
    } else {
      // PyPI JSON API 사용
      const cacheResult = await fetchPackageMetadata(name, actualVersion, this.cacheOptions);
      if (!cacheResult) {
        throw new Error(`패키지를 찾을 수 없음: ${name}@${actualVersion}`);
      }

      const { info, urls } = cacheResult.data;

      let packageSize = 0;
      let packageFilename: string | undefined;
      if (urls && urls.length > 0) {
        const selectedFile = this.selectBestWheel(urls);
        if (selectedFile) {
          packageSize = selectedFile.size || 0;
          packageFilename = selectedFile.filename;
        }
      }

      packageInfo = {
        type: 'pip',
        name: info.name,
        version: info.version,
        metadata: {
          description: '',
          size: packageSize,
          filename: packageFilename,
        },
      };

      requiresDist = info.requires_dist || [];
    }

    return {
      packageInfo,
      requiresDist,
      actualVersion,
    };
  }

  /**
   * 의존성 문자열 파싱
   * 예: "requests>=2.20.0", "urllib3[socks]>=1.21.1,<1.27"
   */
  private parseDependencyString(depString: string): ParsedDependency | null {
    try {
      // 환경 마커 분리 (;로 구분)
      const [mainPart, markers] = depString.split(';').map((s) => s.trim());

      // extras 추출 ([...] 부분)
      const extrasMatch = mainPart.match(/\[([^\]]+)\]/);
      const extras = extrasMatch ? extrasMatch[1].split(',').map((e) => e.trim()) : undefined;

      // extras 제거 후 이름과 버전 분리
      const withoutExtras = mainPart.replace(/\[[^\]]+\]/, '');

      // 버전 지정자 패턴
      const versionPattern = /(>=|<=|==|!=|~=|>|<|===)/;
      const match = withoutExtras.match(versionPattern);

      let name: string;
      let versionSpec: string | undefined;

      if (match) {
        const index = withoutExtras.indexOf(match[0]);
        name = withoutExtras.substring(0, index).trim();
        versionSpec = withoutExtras.substring(index).trim();
      } else {
        name = withoutExtras.trim();
      }

      // 패키지명 정규화 (소문자, 하이픈을 언더스코어로)
      name = name.toLowerCase().replace(/-/g, '_');

      return {
        name,
        versionSpec,
        extras,
        markers: markers || undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * 환경 마커 평가
   * targetPlatform이 설정된 경우 해당 플랫폼에 맞는 마커만 통과
   * targetPlatform이 없으면 마커가 없는 의존성만 통과 (기존 동작)
   */
  private evaluateMarker(marker?: string, extras?: string[]): boolean {
    // 마커가 없으면 항상 포함
    if (!marker) return true;

    // 타겟 플랫폼이 설정되지 않으면 마커가 있는 의존성 제외 (기존 동작)
    if (!this.targetPlatform) return false;

    const { system, machine } = this.targetPlatform;

    // extra 마커 평가 (예: extra == "cuda")
    const extraMatch = marker.match(/extra\s*==\s*["'](\w+)["']/);
    if (extraMatch) {
      const requiredExtra = extraMatch[1];
      return extras?.includes(requiredExtra) ?? false;
    }

    // platform_system 평가
    const systemMatch = marker.match(/platform_system\s*==\s*["'](\w+)["']/);
    if (systemMatch) {
      const requiredSystem = systemMatch[1];
      if (system && system !== requiredSystem) return false;
      if (!system) return false; // 시스템이 지정되지 않으면 제외
    }

    // platform_machine 평가
    const machineMatch = marker.match(/platform_machine\s*==\s*["'](\w+)["']/);
    if (machineMatch) {
      const requiredMachine = machineMatch[1];
      if (machine) {
        // x86_64와 amd64는 동일하게 처리
        const normalizedRequired = requiredMachine.toLowerCase();
        const normalizedTarget = machine.toLowerCase();
        const isX64 = (m: string) => m === 'x86_64' || m === 'amd64';

        if (isX64(normalizedRequired) && isX64(normalizedTarget)) {
          // 둘 다 x64 계열이면 통과
        } else if (normalizedRequired !== normalizedTarget) {
          return false;
        }
      } else {
        return false; // 머신이 지정되지 않으면 제외
      }
    }

    // python_version 마커는 무시 (모든 버전 포함)
    // sys_platform 평가
    const sysPlatformMatch = marker.match(/sys_platform\s*==\s*["'](\w+)["']/);
    if (sysPlatformMatch) {
      const requiredPlatform = sysPlatformMatch[1];
      const platformMap: Record<string, string> = {
        'Linux': 'linux',
        'Windows': 'win32',
        'Darwin': 'darwin',
      };
      if (system && platformMap[system] !== requiredPlatform) return false;
      if (!system) return false;
    }

    // 모든 조건을 통과하면 포함
    return true;
  }

  /**
   * 버전 스펙에 맞는 최신 버전 조회 (캐시 사용)
   */
  private async getLatestVersion(
    name: string,
    versionSpec?: string,
    indexUrl?: string
  ): Promise<string | null> {
    try {
      if (indexUrl) {
        // Simple API 사용
        const files = await fetchPackageFiles(indexUrl, name);
        if (files.length === 0) return null;

        // versionSpec이 없으면 최신 버전 반환
        if (!versionSpec) {
          return findLatestVersionFromSimpleApi(files);
        }

        // versionSpec과 호환되는 버전 필터링
        const versions = new Set<string>();
        for (const file of files) {
          try {
            const version = extractVersionFromFilename(file.filename);
            if (!file.yanked) {
              versions.add(version);
            }
          } catch {
            // 버전 추출 실패 시 무시
          }
        }

        const compatibleVersions = Array.from(versions).filter((v) =>
          isVersionCompatible(v, versionSpec)
        );

        if (compatibleVersions.length === 0) {
          // 호환 버전이 없으면 최신 버전 사용 (충돌 기록)
          const latestVersion = findLatestVersionFromSimpleApi(files);
          if (latestVersion) {
            this.conflicts.push({
              type: 'version',
              packageName: name,
              versions: [versionSpec, latestVersion],
              resolvedVersion: latestVersion,
            });
            return latestVersion;
          }
          return null;
        }

        // 최신 호환 버전 반환
        return compatibleVersions.sort((a, b) => compareVersions(b, a))[0];
      } else {
        // PyPI JSON API 사용 (기존 로직)
        // 캐시에서 패키지 메타데이터 조회 (버전 없이 조회해야 releases 포함)
        const cacheResult = await fetchPackageMetadata(name, undefined, this.cacheOptions);
        if (!cacheResult) return null;

        const { data } = cacheResult;
        if (!data.releases) return null;

        const versions = Object.keys(data.releases).filter(
          (v) => data.releases![v].length > 0 // 실제 릴리스가 있는 버전만
        );

        if (versions.length === 0) return null;

        // 버전 스펙이 없으면 최신 버전
        if (!versionSpec) {
          return data.info.version;
        }

        // 버전 스펙 파싱 및 필터링
        const compatibleVersions = versions.filter((v) =>
          isVersionCompatible(v, versionSpec)
        );

        if (compatibleVersions.length === 0) {
          // 호환 버전이 없으면 최신 버전 사용 (충돌 기록)
          this.conflicts.push({
            type: 'version',
            packageName: name,
            versions: [versionSpec, data.info.version],
            resolvedVersion: data.info.version,
          });
          return data.info.version;
        }

        // 최신 호환 버전 반환
        return compatibleVersions.sort((a, b) =>
          compareVersions(b, a)
        )[0];
      }
    } catch {
      return null;
    }
  }

  /**
   * requirements.txt 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    const lines = content.split('\n');
    const packages: PackageInfo[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // 빈 줄, 주석, 옵션(-r, -e, --) 무시
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('-r') ||
        trimmed.startsWith('-e') ||
        trimmed.startsWith('--')
      ) {
        continue;
      }

      const parsed = this.parseDependencyString(trimmed);
      if (parsed) {
        // 버전 추출 또는 최신 버전 조회
        let version = 'latest';

        if (parsed.versionSpec) {
          // ==로 고정된 버전 추출
          const exactMatch = parsed.versionSpec.match(/^==(.+)$/);
          if (exactMatch) {
            version = exactMatch[1];
          } else {
            // 다른 버전 스펙이면 호환 버전 조회
            const compatVersion = await this.getLatestVersion(
              parsed.name,
              parsed.versionSpec
            );
            if (compatVersion) {
              version = compatVersion;
            }
          }
        } else {
          // 버전 지정 없으면 최신 버전 조회
          const latestVersion = await this.getLatestVersion(parsed.name);
          if (latestVersion) {
            version = latestVersion;
          }
        }

        packages.push({
          type: 'pip',
          name: parsed.name,
          version,
        });
      }
    }

    return packages;
  }

  /**
   * wheel 파일명에서 플랫폼 태그 추출
   * 예: numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl -> ['manylinux_2_17_x86_64']
   */
  private extractPlatformTags(filename: string): string[] {
    // wheel 파일명 형식: {distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl
    const parts = filename.replace('.whl', '').split('-');
    if (parts.length < 5) return [];

    // 마지막 부분이 플랫폼 태그 (여러 개일 수 있음, . 으로 구분)
    const platformPart = parts[parts.length - 1];
    return platformPart.split('.');
  }

  /**
   * glibc 버전 비교 (버전 문자열을 숫자 배열로 변환하여 비교)
   * @returns wheelGlibc가 targetGlibc보다 작거나 같으면 true (호환)
   */
  private compareGlibcVersions(wheelGlibc: string, targetGlibc: string): boolean {
    const parseVersion = (v: string): number[] => {
      return v.split('.').map(n => parseInt(n, 10));
    };

    const wheel = parseVersion(wheelGlibc);
    const target = parseVersion(targetGlibc);

    for (let i = 0; i < Math.max(wheel.length, target.length); i++) {
      const w = wheel[i] || 0;
      const t = target[i] || 0;
      if (w < t) return true;  // wheel이 더 낮은 버전 -> 호환
      if (w > t) return false; // wheel이 더 높은 버전 -> 비호환
    }
    return true; // 같은 버전 -> 호환
  }

  /**
   * macOS 버전 비교
   * @returns wheelMacOS가 targetMacOS보다 작거나 같으면 true (호환)
   */
  private compareMacOSVersions(wheelMacOS: string, targetMacOS: string): boolean {
    const parseVersion = (v: string): number[] => {
      return v.split('_').map(n => parseInt(n, 10));
    };

    const wheel = parseVersion(wheelMacOS);
    const target = parseVersion(targetMacOS);

    for (let i = 0; i < Math.max(wheel.length, target.length); i++) {
      const w = wheel[i] || 0;
      const t = target[i] || 0;
      if (w < t) return true;
      if (w > t) return false;
    }
    return true;
  }

  /**
   * wheel이 타겟 플랫폼과 호환되는지 확인
   */
  private isWheelCompatible(release: PyPIRelease): boolean {
    if (!this.pipTargetPlatform) {
      // 타겟 플랫폼이 설정되지 않으면 기본 동작 (wheel 우선)
      return true;
    }

    if (release.packagetype !== 'bdist_wheel') {
      // wheel이 아니면 호환성 체크 불필요 (sdist는 항상 호환)
      return true;
    }

    // Python 버전 호환성 체크
    if (this.pipTargetPlatform.pythonVersion || this.pythonVersion) {
      const wheelMatch = /^[^-]+-[^-]+-([^-]+)-([^-]+)-(.+)\.whl$/.exec(release.filename);
      if (wheelMatch) {
        const pythonTag = wheelMatch[1];
        const abiTag = wheelMatch[2];
        const targetPyVersion = (this.pipTargetPlatform.pythonVersion || this.pythonVersion || '').replace('.', '');

        if (targetPyVersion) {
          // 정확한 버전(cp312), abi3, py3, py2.py3 호환
          const isCompatiblePython =
            pythonTag.includes(`cp${targetPyVersion}`) ||
            pythonTag.includes(`py${targetPyVersion}`) ||
            pythonTag.includes('py3') ||
            pythonTag.includes('py2.py3') ||
            abiTag === 'abi3';

          if (!isCompatiblePython) {
            return false;
          }
        }
      }
    }

    const platformTags = this.extractPlatformTags(release.filename);
    if (platformTags.length === 0) return false;

    const { os, arch, glibcVersion, macosVersion } = this.pipTargetPlatform;

    // 플랫폼 무관 wheel (pure Python)
    if (platformTags.some(tag => tag === 'any')) {
      return true;
    }

    // 아키텍처 정규화
    const normalizeArch = (a: string): string => {
      if (a === 'x86_64' || a === 'amd64') return 'x86_64';
      if (a === 'aarch64' || a === 'arm64') return 'aarch64';
      return a;
    };

    const targetArch = normalizeArch(arch);

    for (const tag of platformTags) {
      // Linux manylinux 태그
      if (os === 'linux') {
        // manylinux_X_Y_arch 형식 파싱
        const manylinuxMatch = tag.match(/^manylinux[_\d]*_(\d+)_(\d+)_(.+)$/);
        if (manylinuxMatch) {
          const wheelGlibc = `${manylinuxMatch[1]}.${manylinuxMatch[2]}`;
          const wheelArch = normalizeArch(manylinuxMatch[3]);

          // 아키텍처 체크
          if (wheelArch !== targetArch) continue;

          // glibc 버전 체크
          if (glibcVersion && !this.compareGlibcVersions(wheelGlibc, glibcVersion)) {
            continue;
          }

          return true;
        }

        // manylinux2014 (glibc 2.17), manylinux2010 (glibc 2.12), manylinux1 (glibc 2.5) 등
        const legacyMatch = tag.match(/^(manylinux\d+)_(.+)$/);
        if (legacyMatch) {
          const wheelArch = normalizeArch(legacyMatch[2]);
          if (wheelArch !== targetArch) continue;

          // manylinux2014 = glibc 2.17
          const legacyGlibcMap: Record<string, string> = {
            'manylinux1': '2.5',
            'manylinux2010': '2.12',
            'manylinux2014': '2.17',
          };

          const wheelGlibc = legacyGlibcMap[legacyMatch[1]];
          if (wheelGlibc && glibcVersion && !this.compareGlibcVersions(wheelGlibc, glibcVersion)) {
            continue;
          }

          return true;
        }

        // linux_arch 형식 (일반 리눅스)
        const linuxMatch = tag.match(/^linux_(.+)$/);
        if (linuxMatch) {
          const wheelArch = normalizeArch(linuxMatch[1]);
          return wheelArch === targetArch;
        }
      }

      // macOS 태그
      if (os === 'macos') {
        // macosx_X_Y_arch 형식
        const macosMatch = tag.match(/^macosx_(\d+)_(\d+)_(.+)$/);
        if (macosMatch) {
          const wheelMacOS = `${macosMatch[1]}_${macosMatch[2]}`;
          const wheelArch = normalizeArch(macosMatch[3]);

          // 아키텍처 체크
          if (wheelArch !== targetArch) continue;

          // macOS 버전 체크
          if (macosVersion && !this.compareMacOSVersions(wheelMacOS, macosVersion.replace('.', '_'))) {
            continue;
          }

          return true;
        }
      }

      // Windows 태그
      if (os === 'windows') {
        if (tag === 'win_amd64' && (arch === 'x86_64' || arch === 'amd64')) return true;
        if (tag === 'win32' && arch === 'i386') return true;
        if (tag === 'win_arm64' && (arch === 'arm64' || arch === 'aarch64')) return true;
      }
    }

    return false;
  }

  /**
   * 호환되는 wheel 중 최적의 wheel 선택
   * 우선순위: 1) wheel (호환되는 것 중 가장 높은 버전), 2) sdist
   */
  private selectBestWheel(urls: PyPIRelease[]): PyPIRelease | null {
    if (!urls || urls.length === 0) return null;

    // wheel과 sdist 분리
    const wheels = urls.filter(u => u.packagetype === 'bdist_wheel');
    const sdist = urls.find(u => u.packagetype === 'sdist');

    if (!this.pipTargetPlatform) {
      // 타겟 플랫폼 미설정 시 기본 동작: 첫 번째 wheel 또는 sdist
      return wheels[0] || sdist || urls[0];
    }

    // 호환되는 wheel 필터링
    const compatibleWheels = wheels.filter(w => this.isWheelCompatible(w));

    if (compatibleWheels.length === 0) {
      // 호환되는 wheel이 없으면 sdist 선택
      return sdist || null;
    }

    // 호환되는 wheel 중 우선순위 선택
    // 우선순위: 1) 정확히 일치하는 glibc/macOS 버전, 2) 가장 높은 호환 버전, 3) pure Python (any)
    const { os, glibcVersion, macosVersion } = this.pipTargetPlatform;

    // 정확히 일치하는 버전 찾기
    if (os === 'linux' && glibcVersion) {
      const exactMatch = compatibleWheels.find(w => {
        const tags = this.extractPlatformTags(w.filename);
        return tags.some(tag => {
          const match = tag.match(/^manylinux[_\d]*_(\d+)_(\d+)_/);
          if (match) {
            return `${match[1]}.${match[2]}` === glibcVersion;
          }
          return false;
        });
      });
      if (exactMatch) return exactMatch;
    }

    if (os === 'macos' && macosVersion) {
      const exactMatch = compatibleWheels.find(w => {
        const tags = this.extractPlatformTags(w.filename);
        return tags.some(tag => {
          const match = tag.match(/^macosx_(\d+)_(\d+)_/);
          if (match) {
            return `${match[1]}.${match[2]}` === macosVersion.replace('.', '_');
          }
          return false;
        });
      });
      if (exactMatch) return exactMatch;
    }

    // 호환되는 wheel 중 첫 번째 (PyPI는 보통 최신/가장 일반적인 것을 먼저 반환)
    return compatibleWheels[0];
  }

  /**
   * Simple API 파일 목록에서 최적의 wheel 선택
   * PyPI JSON API의 selectBestWheel과 유사하지만 SimpleApiPackageFile 타입 사용
   */
  private selectBestWheelFromSimpleApi(
    files: SimpleApiPackageFile[]
  ): SimpleApiPackageFile | null {
    if (!this.pipTargetPlatform) {
      // 플랫폼 정보가 없으면 첫 번째 wheel 반환
      return files.find((f) => f.filename.endsWith('.whl')) || null;
    }

    // wheel 파일만 필터링
    const wheels = files.filter((f) => f.filename.endsWith('.whl'));

    for (const wheel of wheels) {
      try {
        // parseWheelFilename을 직접 구현 대신 import에서 가져오기
        const wheelInfo = this.parseWheelFilenameSimple(wheel.filename);
        
        // Python 버전 호환성 체크
        if (this.pythonVersion) {
          const pyVersion = this.pythonVersion.replace('.', '');
          if (!wheelInfo.pythonTag.includes(pyVersion) && !wheelInfo.pythonTag.includes('py3') && !wheelInfo.pythonTag.includes('py2.py3')) {
            continue;
          }
        }

        // 플랫폼 호환성 체크
        const platformTag = wheelInfo.platformTag.toLowerCase();
        const targetOs = this.pipTargetPlatform.os.toLowerCase();
        const targetArch = this.pipTargetPlatform.arch.toLowerCase();

        // 플랫폼 매칭 로직
        if (platformTag === 'any') {
          return wheel;
        }

        // Linux
        if (targetOs === 'linux') {
          if (platformTag.includes('manylinux') || platformTag.includes('linux')) {
            if (targetArch === 'x86_64' && platformTag.includes('x86_64')) {
              return wheel;
            }
            if (targetArch === 'aarch64' && platformTag.includes('aarch64')) {
              return wheel;
            }
          }
        }

        // Windows
        if (targetOs === 'windows') {
          if (platformTag.includes('win')) {
            if (targetArch === 'x86_64' && (platformTag.includes('amd64') || platformTag.includes('win_amd64'))) {
              return wheel;
            }
            if (targetArch === 'arm64' && platformTag.includes('arm64')) {
              return wheel;
            }
          }
        }

        // macOS
        if (targetOs === 'macos') {
          if (platformTag.includes('macosx')) {
            if (targetArch === 'x86_64' && platformTag.includes('x86_64')) {
              return wheel;
            }
            if (targetArch === 'arm64' && platformTag.includes('arm64')) {
              return wheel;
            }
          }
        }
      } catch {
        // 파싱 실패 시 다음 wheel 확인
        continue;
      }
    }

    // 호환되는 wheel이 없으면 첫 번째 wheel 또는 source dist 반환
    return wheels[0] || files.find((f) => f.filename.endsWith('.tar.gz')) || files[0];
  }

  /**
   * wheel 파일명 간단 파싱 (Simple API용)
   */
  private parseWheelFilenameSimple(filename: string): {
    pythonTag: string;
    abiTag: string;
    platformTag: string;
  } {
    const match = /^[^-]+-[^-]+-([^-]+)-([^-]+)-(.+)\.whl$/.exec(filename);
    if (!match) {
      throw new Error(`Invalid wheel filename: ${filename}`);
    }
    return {
      pythonTag: match[1],
      abiTag: match[2],
      platformTag: match[3],
    };
  }
}

// 싱글톤 인스턴스
let pipResolverInstance: PipResolver | null = null;

export function getPipResolver(): PipResolver {
  if (!pipResolverInstance) {
    pipResolverInstance = new PipResolver();
  }
  return pipResolverInstance;
}
