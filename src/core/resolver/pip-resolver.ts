import {
  IResolver,
  PackageInfo,
  PackageMetadata,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';
import { PyPIInfo, PyPIResponse } from '../shared/pip-types';
import {
  comparePep440Versions,
  getPackageArtifactKey,
  isPrereleaseVersion,
  isVersionCompatible,
  flattenDependencyTree,
} from '../shared';
import {
  fetchPackageMetadata,
  clearMemoryCache as clearPipCache,
  PipCacheOptions,
  PyPIRelease,
  PyPIPackageInfo,
} from '../shared/pip-cache';
import type { PipTargetPlatform } from '../../types/platform/pip-target-platform';
import { getPackageType as getSimplePackageType } from '../shared/pip-simple-api';
import {
  fetchPackageFiles,
  extractVersionFromFilename,
  SimpleApiPackageFile,
  fetchWheelMetadata,
} from './pip-simple-api';
import { evaluatePep508Marker } from '../shared/pep508-marker';

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

type PipArtifactChecksum = NonNullable<
  PackageMetadata['checksum']
> &
  Record<string, string | undefined>;
type PipCompatibilityCandidate = Pick<
  PyPIRelease,
  'filename' | 'packagetype' | 'requires_python'
>;
type PipResolverTargetPlatform = Omit<PipTargetPlatform, 'os'> & {
  os: PipTargetPlatform['os'] | 'any';
};

function explicitlyRequestsPrerelease(versionSpec?: string): boolean {
  if (!versionSpec) {
    return false;
  }

  const prereleasePattern =
    /\d(?:[._-]?\d)*(?:[._-]?(?:a|b|c|rc|alpha|beta|pre|preview|dev)\d*)/i;

  return versionSpec.split(/[|,]/).some((rawClause) => {
    const clause = rawClause.trim();
    const match =
      /^(===|==|!=|~=|<=|>=|<|>)?\s*(.*)$/.exec(clause);
    if (!match || match[1] === '!=') {
      return false;
    }
    return prereleasePattern.test(match[2]);
  });
}

function comparePipVersionsDescending(
  leftVersion: string,
  rightVersion: string,
  versionSpec?: string,
): number {
  if (!explicitlyRequestsPrerelease(versionSpec)) {
    const leftPrerelease = isPrereleaseVersion(leftVersion);
    const rightPrerelease = isPrereleaseVersion(rightVersion);
    if (leftPrerelease !== rightPrerelease) {
      return leftPrerelease ? 1 : -1;
    }
  }

  return comparePep440Versions(rightVersion, leftVersion);
}

function getSimpleApiChecksum(
  file: SimpleApiPackageFile | null,
): PipArtifactChecksum | undefined {
  const hash = file?.hash;
  if (!hash) {
    return undefined;
  }

  const algorithm = hash.algorithm.toLowerCase();
  return {
    [algorithm]: hash.digest,
  } as PipArtifactChecksum;
}

function hasMatchingPypiArtifactChecksum(
  file: SimpleApiPackageFile,
  releases: PyPIRelease[],
): boolean {
  const hash = file.hash;
  if (!hash) {
    return false;
  }

  const algorithm = hash.algorithm.toLowerCase();
  const expectedDigest = hash.digest.toLowerCase();
  return releases.some((release) => {
    const digests = release.digests as Record<
      string,
      string | undefined
    >;
    const releaseDigest =
      digests?.[algorithm];
    return releaseDigest?.toLowerCase() === expectedDigest;
  });
}

export class PipResolver implements IResolver {
  readonly type = 'pip' as const;
  private readonly baseUrl = 'https://pypi.org/pypi';
  private visited: Map<string, DependencyNode> = new Map();
  private conflicts: DependencyConflict[] = [];
  private targetPlatform: TargetPlatform | null = null;
  private pythonVersion: string | null = null;
  private cacheOptions: PipCacheOptions = {};
  private pipTargetPlatform: PipResolverTargetPlatform | null = null;

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
    this.pipTargetPlatform = null;

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
        os: this.targetPlatform?.system
          ? osMap[this.targetPlatform.system]
          : 'any',
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
      // 동일 패키지에 대해 이미 평가한 기본/extra 컨텍스트 집합
      const resolvedExtras: Map<string, Set<string>> = new Map();
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
          if (!parentCacheKey) {
            throw error;
          }
          const reason =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `필수 pip 의존성 아티팩트를 해결할 수 없습니다: ${name}@${ver} (${reason})`,
          );
        }

        if (!fetchResult) continue;

        const { packageInfo, requiresDist } = fetchResult;
        const cacheKey = getPackageArtifactKey(packageInfo);

        // extra 패키지도 기본 의존성과 선택한 extra 의존성을 함께 가진다.
        const incomingExtras = Array.from(
          new Set(['', ...(ext ?? [])]),
        );

        // 이미 해결된 패키지는 새 extra가 있을 때만 의존성을 다시 평가
        if (resolvedNodes.has(cacheKey)) {
          if (parentCacheKey) {
            const children = parentChildMap.get(parentCacheKey) || [];
            if (!children.includes(cacheKey)) {
              children.push(cacheKey);
              parentChildMap.set(parentCacheKey, children);
            }
          }

          const processedExtras =
            resolvedExtras.get(cacheKey) ?? new Set<string>();
          const newExtras = incomingExtras.filter(
            (extra) => !processedExtras.has(extra),
          );
          if (newExtras.length === 0) {
            continue;
          }
          for (const extra of newExtras) {
            processedExtras.add(extra);
          }
          resolvedExtras.set(cacheKey, processedExtras);
        } else {
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
          resolvedExtras.set(cacheKey, new Set(incomingExtras));

          // 부모-자식 관계 저장
          if (parentCacheKey) {
            const children = parentChildMap.get(parentCacheKey) || [];
            children.push(cacheKey);
            parentChildMap.set(parentCacheKey, children);
          }
        }

        if (depth >= maxDepth) {
          continue;
        }

        // 의존성 파싱 및 큐에 추가
        if (requiresDist.length > 0) {
          const parsedDeps = requiresDist
            .map((dep) => this.parseDependencyString(dep))
            .filter(
              (dep) =>
                dep !== null &&
                this.evaluateMarker(
                  dep.markers,
                  Array.from(resolvedExtras.get(cacheKey) ?? []),
                ),
            );

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

              if (!depVersion) {
                throw new Error('호환되는 버전을 찾을 수 없습니다.');
              }

              // 저장소/URL/파일/체크섬은 실제 패키지 정보를 조회한 뒤에야
              // 확정된다. name@version만으로 미리 중복 제거하면 서로 다른
              // 인덱스의 같은 버전 아티팩트가 합쳐지므로 최종 아티팩트 키는
              // dequeue 후 packageInfo에서 계산한다.
              queue.push({
                name: dep.name,
                version: depVersion,
                indexUrl: usedIndexUrl,
                extras: dep.extras,
                parentCacheKey: cacheKey,
                depth: depth + 1,
              });
            } catch (error) {
              const reason =
                error instanceof Error ? error.message : String(error);
              throw new Error(
                `필수 pip 의존성 버전을 해결할 수 없습니다: ${name} -> ${dep.name} (${reason})`,
              );
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

      const targetFiles = files.filter((file) => {
        try {
          return extractVersionFromFilename(file.filename) === actualVersion;
        } catch {
          return false;
        }
      });

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
      if (this.pipTargetPlatform && !selectedFile) {
        throw new Error(
          `대상 환경과 호환되는 pip 아티팩트를 찾을 수 없습니다: ${name}@${actualVersion}`,
        );
      }

      // PEP 658 메타데이터에서 의존성 정보 조회. 빈 배열은
      // "조회 성공 + 의존성 없음"이고 null은 조회 불가다.
      let customMetadataAvailable = false;
      if (selectedFile?.metadataHash) {
        const metadataRequiresDist =
          await fetchWheelMetadata(selectedFile);
        if (metadataRequiresDist !== null) {
          requiresDist = metadataRequiresDist;
          customMetadataAvailable = true;
        }
      }

      // PEP 658을 사용할 수 없을 때는 선택한 커스텀 아티팩트와
      // PyPI 아티팩트의 체크섬이 같을 때만 공개 메타데이터를 사용한다.
      if (!customMetadataAvailable && selectedFile) {
        try {
          const baseVersion = actualVersion.split('+')[0];
          const pypiResult = await fetchPackageMetadata(name, baseVersion, this.cacheOptions);
          if (
            pypiResult &&
            hasMatchingPypiArtifactChecksum(
              selectedFile,
              pypiResult.data.urls ?? [],
            )
          ) {
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
          downloadUrl: selectedFile?.url,
          checksum: getSimpleApiChecksum(selectedFile),
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
      let packageDownloadUrl: string | undefined;
      let packageChecksum: PipArtifactChecksum | undefined;
      if (urls && urls.length > 0) {
        const releaseCandidates = urls.map((release) => ({
          ...release,
          requires_python:
            release.requires_python ?? info.requires_python,
        }));
        const selectedFile = this.selectBestWheel(releaseCandidates);
        if (this.pipTargetPlatform && !selectedFile) {
          throw new Error(
            `대상 환경과 호환되는 pip 아티팩트를 찾을 수 없습니다: ${name}@${actualVersion}`,
          );
        }
        if (selectedFile) {
          packageSize = selectedFile.size || 0;
          packageFilename = selectedFile.filename;
          packageDownloadUrl = selectedFile.url;
          packageChecksum = {
            ...(selectedFile.digests.md5
              ? { md5: selectedFile.digests.md5 }
              : {}),
            sha256: selectedFile.digests.sha256,
          };
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
          downloadUrl: packageDownloadUrl,
          checksum: packageChecksum,
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
   * 알려진 대상 환경 값으로 PEP 508 마커를 평가
   * 알 수 없거나 해석할 수 없는 조건은 의존성 누락을 막기 위해 포함
   */
  private evaluateMarker(marker?: string, extras?: string[]): boolean {
    // 마커가 없으면 항상 포함
    if (!marker) return true;

    const system = this.targetPlatform?.system;
    const rawPythonVersion = this.pythonVersion ?? undefined;
    const pythonVersionParts = rawPythonVersion?.split('.') ?? [];
    const pythonVersion =
      pythonVersionParts.length >= 2
        ? pythonVersionParts.slice(0, 2).join('.')
        : rawPythonVersion;
    const pythonFullVersion = rawPythonVersion;
    const incompleteFullVersion =
      pythonVersionParts.length === 2
        ? pythonVersion
        : undefined;
    const environment = {
      python_version: pythonVersion,
      python_full_version: pythonFullVersion,
      sys_platform:
        system === 'Windows'
          ? 'win32'
          : system === 'Darwin'
            ? 'darwin'
            : system === 'Linux'
              ? 'linux'
              : undefined,
      platform_system: system,
      platform_machine: this.targetPlatform?.machine,
      os_name: system ? (system === 'Windows' ? 'nt' : 'posix') : undefined,
      implementation_name: this.pythonVersion ? 'cpython' : undefined,
      implementation_version: pythonFullVersion,
      platform_python_implementation: this.pythonVersion
        ? 'CPython'
        : undefined,
    };

    const selectedExtras = extras?.length ? extras : [''];
    return selectedExtras.some((extra) =>
      evaluatePep508Marker(
        marker,
        { ...environment, extra },
        {
          incompleteVersions: incompleteFullVersion
            ? {
                python_full_version: incompleteFullVersion,
                implementation_version: incompleteFullVersion,
              }
            : undefined,
          unknownResult: true,
        },
      ),
    );
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

        const filesByVersion = new Map<
          string,
          SimpleApiPackageFile[]
        >();
        for (const file of files) {
          try {
            const version = extractVersionFromFilename(file.filename);
            if (
              !file.yanked &&
              getSimplePackageType(file.filename) !== 'unknown'
            ) {
              const versionFiles = filesByVersion.get(version) ?? [];
              versionFiles.push(file);
              filesByVersion.set(version, versionFiles);
            }
          } catch {
            // 버전 추출 실패 시 무시
          }
        }

        const compatibleVersions = Array.from(
          filesByVersion.entries(),
        ).filter(
          ([candidateVersion, versionFiles]) =>
            (!versionSpec ||
              isVersionCompatible(candidateVersion, versionSpec)) &&
            this.selectBestWheelFromSimpleApi(versionFiles) !== null,
        );

        if (compatibleVersions.length === 0) {
          return null;
        }

        return compatibleVersions
          .map(([candidateVersion]) => candidateVersion)
          .sort((a, b) =>
            comparePipVersionsDescending(a, b, versionSpec),
          )[0];
      } else {
        // PyPI JSON API 사용 (기존 로직)
        // 캐시에서 패키지 메타데이터 조회 (버전 없이 조회해야 releases 포함)
        const cacheResult = await fetchPackageMetadata(name, undefined, this.cacheOptions);
        if (!cacheResult) return null;

        const { data } = cacheResult;
        if (!data.releases) return null;

        const compatibleVersions = Object.entries(data.releases)
          .filter(
            ([candidateVersion, releases]) =>
              releases.length > 0 &&
              (!versionSpec ||
                isVersionCompatible(candidateVersion, versionSpec)),
          )
          .sort(([leftVersion], [rightVersion]) =>
            comparePipVersionsDescending(
              leftVersion,
              rightVersion,
              versionSpec,
            ),
          );

        for (const [candidateVersion, releases] of compatibleVersions) {
          const candidates = releases.filter(
            (release) =>
              !(release as PyPIRelease & { yanked?: boolean }).yanked,
          );
          const selectedFile = this.selectBestWheel(candidates);
          if (!selectedFile) {
            continue;
          }

          if (
            !this.pythonVersion ||
            Boolean(selectedFile.requires_python)
          ) {
            return candidateVersion;
          }

          if (candidateVersion === data.info.version) {
            const latestCandidates = candidates.map((release) => ({
              ...release,
              requires_python:
                release.requires_python ??
                data.info.requires_python,
            }));
            if (this.selectBestWheel(latestCandidates)) {
              return candidateVersion;
            }
            continue;
          }

          // 전역 info는 최신 릴리스 정보이므로 과거 릴리스에 재사용하지 않는다.
          const exactResult = await fetchPackageMetadata(
            name,
            candidateVersion,
            this.cacheOptions,
          );
          if (!exactResult) {
            continue;
          }
          const exactFiles =
            exactResult.data.urls?.length
              ? exactResult.data.urls
              : candidates;
          const exactCandidates = exactFiles
            .filter(
              (release) =>
                !(release as PyPIRelease & { yanked?: boolean })
                  .yanked,
            )
            .map((release) => ({
              ...release,
              requires_python:
                release.requires_python ??
                exactResult.data.info.requires_python,
            }));
          if (this.selectBestWheel(exactCandidates)) {
            return candidateVersion;
          }
        }

        return null;
      }
    } catch (error) {
      logger.warn('pip 버전 조회 실패', {
        name,
        versionSpec,
        indexUrl,
        error,
      });
      throw error;
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
   * wheel 파일명 오른쪽의 Python/ABI/플랫폼 태그 추출
   */
  private extractWheelTags(filename: string): {
    pythonTag: string;
    abiTag: string;
    platformTags: string[];
  } | null {
    if (!filename.endsWith('.whl')) return null;

    // wheel 형식: {distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl
    // build tag가 있어도 마지막 세 필드는 항상 Python/ABI/플랫폼 태그다.
    const parts = filename.slice(0, -'.whl'.length).split('-');
    if (parts.length < 5) return null;

    const [pythonTag, abiTag, platformTag] = parts.slice(-3);
    return {
      pythonTag,
      abiTag,
      platformTags: platformTag.split('.'),
    };
  }

  /**
   * wheel 파일명에서 플랫폼 태그 추출
   * 예: numpy-1.24.0-cp311-cp311-manylinux_2_17_x86_64.whl -> ['manylinux_2_17_x86_64']
   */
  private extractPlatformTags(filename: string): string[] {
    return this.extractWheelTags(filename)?.platformTags ?? [];
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
  private isWheelCompatible(release: PipCompatibilityCandidate): boolean {
    if (!this.pipTargetPlatform) {
      // 타겟 플랫폼이 설정되지 않으면 기본 동작 (wheel 우선)
      return true;
    }

    if (!this.isRequiresPythonCompatible(release.requires_python)) {
      return false;
    }

    if (release.packagetype !== 'bdist_wheel') {
      // sdist는 플랫폼 태그가 없으므로 Python 요구 조건만 확인
      return true;
    }

    // Python 버전 호환성 체크
    const wheelTags = this.extractWheelTags(release.filename);
    if (!wheelTags) {
      return false;
    }
    if (this.pipTargetPlatform.pythonVersion || this.pythonVersion) {
      if (
        !this.isPythonTagCompatible(
          wheelTags.pythonTag,
          wheelTags.abiTag,
        )
      ) {
        return false;
      }
    } else if (!this.isPythonAgnosticWheel(
      wheelTags.pythonTag,
      wheelTags.abiTag,
    )) {
      return false;
    }

    const platformTags = this.extractPlatformTags(release.filename);
    if (platformTags.length === 0) return false;

    const { os, arch, glibcVersion, macosVersion } = this.pipTargetPlatform;

    // 플랫폼 무관 wheel (pure Python)
    if (platformTags.some(tag => tag === 'any')) {
      return true;
    }

    // 대상 OS가 지정되지 않으면 특정 OS wheel을 임의로 선택하지 않는다.
    if (os === 'any') {
      return false;
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
          const isUniversal2Compatible =
            wheelArch === 'universal2' &&
            (targetArch === 'aarch64' || targetArch === 'x86_64');

          // 아키텍처 체크
          if (
            wheelArch !== targetArch &&
            !isUniversal2Compatible
          ) {
            continue;
          }

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

  private isRequiresPythonCompatible(
    requiresPython: string | undefined,
  ): boolean {
    const targetPythonVersion =
      this.pipTargetPlatform?.pythonVersion ?? this.pythonVersion ?? undefined;

    if (!targetPythonVersion || !requiresPython) {
      return true;
    }

    return isVersionCompatible(targetPythonVersion, requiresPython);
  }

  private isPythonTagCompatible(
    pythonTag: string,
    abiTag: string,
  ): boolean {
    const targetPythonVersion =
      this.pipTargetPlatform?.pythonVersion ?? this.pythonVersion ?? undefined;

    if (!targetPythonVersion) {
      return true;
    }

    const [targetMajor, targetMinor] = targetPythonVersion
      .split('.')
      .map(Number);
    if (!Number.isInteger(targetMajor) || !Number.isInteger(targetMinor)) {
      return false;
    }

    const targetTag = `${targetMajor}${targetMinor}`;
    const pythonTags = pythonTag.toLowerCase().split('.');
    const abiTags = abiTag.toLowerCase().split('.');

    // 일반 CPython 대상은 동일 CPython ABI, stable ABI, ABI 비의존 wheel만 허용한다.
    if (
      pythonTags.includes(`cp${targetTag}`) &&
      (
        abiTags.includes(`cp${targetTag}`) ||
        abiTags.includes('abi3') ||
        abiTags.includes('none')
      )
    ) {
      return true;
    }

    // 범용 Python 태그는 ABI 비의존 wheel이어야 한다.
    if (
      (
        pythonTags.includes(`py${targetTag}`) ||
        pythonTags.includes(`py${targetMajor}`)
      ) &&
      abiTags.includes('none')
    ) {
      return true;
    }

    if (!abiTags.includes('abi3')) {
      return false;
    }

    return pythonTags.some((tag) => {
      const match = /^cp(\d)(\d+)$/.exec(tag);
      if (!match) {
        return false;
      }

      const minimumMajor = Number(match[1]);
      const minimumMinor = Number(match[2]);
      return (
        minimumMajor === targetMajor &&
        minimumMinor <= targetMinor
      );
    });
  }

  private isPythonAgnosticWheel(
    pythonTag: string,
    abiTag: string,
  ): boolean {
    const pythonTags = pythonTag.toLowerCase().split('.');
    const abiTags = abiTag.toLowerCase().split('.');
    return (
      abiTags.every((tag) => tag === 'none') &&
      pythonTags.every((tag) => /^py[23]$/.test(tag))
    );
  }

  /**
   * 호환되는 wheel 중 최적의 wheel 선택
   * 우선순위: 1) wheel (호환되는 것 중 가장 높은 버전), 2) sdist
   */
  private selectBestWheel(urls: PyPIRelease[]): PyPIRelease | null {
    if (!urls || urls.length === 0) return null;

    // wheel과 sdist 분리
    const wheels = urls.filter(u => u.packagetype === 'bdist_wheel');
    const sdist = urls.find(
      (url) =>
        url.packagetype === 'sdist' &&
        this.isWheelCompatible(url),
    );

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
      // 플랫폼 정보가 없으면 wheel 우선, 없으면 소스 배포본 사용
      return (
        files.find((f) => f.filename.endsWith('.whl')) ||
        files.find((f) => f.filename.endsWith('.tar.gz')) ||
        files[0] ||
        null
      );
    }

    const compatibleWheel = files
      .filter((file) => file.filename.endsWith('.whl'))
      .find((file) =>
        this.isWheelCompatible({
          filename: file.filename,
          packagetype: 'bdist_wheel',
          requires_python: file.requiresPython,
        }),
      );
    if (compatibleWheel) {
      return compatibleWheel;
    }

    // 호환되지 않는 다른 아키텍처 wheel 대신 source dist만 폴백으로 사용
    return (
      files.find(
        (file) =>
          getSimplePackageType(file.filename) === 'sdist' &&
          this.isRequiresPythonCompatible(file.requiresPython),
      ) || null
    );
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
