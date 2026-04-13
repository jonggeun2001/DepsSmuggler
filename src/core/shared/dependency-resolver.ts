// 공통 의존성 해결 모듈
import { getPipResolver } from '../resolver/pip-resolver';
import { getMavenResolver } from '../resolver/maven-resolver';
import { getCondaResolver } from '../resolver/conda-resolver';
import { getNpmResolver } from '../resolver/npm-resolver';
import { getYumResolver } from '../resolver/yum-resolver';
import { getAptResolver } from '../resolver/apt-resolver';
import { getApkResolver } from '../resolver/apk-resolver';
import { getDistributionById } from '../downloaders/os-shared/repos/repository-utils';
import { DownloadPackage } from './types';
import { DependencyResolutionResult, PackageType } from '../../types';
import { NpmResolutionResult } from './npm-types';
import type { OSPackageInfo, OSArchitecture } from '../downloaders/os-shared/types';
import logger from '../../utils/logger';

/**
 * 의존성 해결 진행 상황 콜백
 */
export interface DependencyProgressCallback {
  (info: {
    current: number;
    total: number;
    packageName: string;
    packageType: string;
    status: 'start' | 'success' | 'error';
    dependencyCount?: number;
    error?: string;
  }): void;
}

/**
 * 고유 ID 생성 함수
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 의존성 해결 결과 인터페이스
 */
export interface ResolvedPackageList {
  /** 원본 패키지 목록 */
  originalPackages: DownloadPackage[];
  /** 의존성 포함 전체 패키지 목록 */
  allPackages: DownloadPackage[];
  /** 각 패키지의 의존성 트리 */
  dependencyTrees: DependencyResolutionResult[];
  /** 해결 실패한 패키지 목록 */
  failedPackages: { name: string; version: string; error: string }[];
}

/**
 * OS 배포판 설정 (settings에서 전달)
 */
export interface OSDistributionSetting {
  id: string;
  architecture: string;
}

/**
 * 의존성 해결 옵션
 */
export interface DependencyResolverOptions {
  /** 의존성 포함 여부 (기본값: true) */
  includeDependencies?: boolean;
  /** 최대 의존성 탐색 깊이 (기본값: 5) */
  maxDepth?: number;
  /** 선택적 의존성 포함 여부 (기본값: false) */
  includeOptional?: boolean;
  /** conda 채널 (기본값: 'conda-forge') */
  condaChannel?: string;
  /** yum 저장소 URL */
  yumRepoUrl?: string;
  /** 아키텍처 (기본값: 'x86_64') */
  architecture?: string;
  /** 타겟 OS (pip/conda 휠 필터링용, 폐쇄망 OS) */
  targetOS?: 'any' | 'windows' | 'macos' | 'linux';
  /** Python 버전 (pip 휠 필터링용, 예: '3.11', '3.12') */
  pythonVersion?: string;
  /** CUDA 버전 (conda 패키지의 __cuda 의존성 필터링용, 예: '11.8', '12.4') */
  cudaVersion?: string | null;
  /** 진행 상황 콜백 */
  onProgress?: DependencyProgressCallback;
  /** YUM 배포판 설정 (RHEL/CentOS/Rocky/AlmaLinux) */
  yumDistribution?: OSDistributionSetting;
  /** APT 배포판 설정 (Debian/Ubuntu) */
  aptDistribution?: OSDistributionSetting;
  /** APK 배포판 설정 (Alpine) */
  apkDistribution?: OSDistributionSetting;
  /** 권장 의존성 포함 여부 (APT용) */
  includeRecommends?: boolean;
}

/**
 * 패키지 타입별 리졸버 반환
 */
function getResolverByType(type: string) {
  switch (type) {
    case 'pip':
      return getPipResolver();
    case 'conda':
      return getCondaResolver();
    case 'maven':
      return getMavenResolver();
    case 'npm':
      return getNpmResolver();
    // OS 패키지 (yum, apt, apk)는 distribution 정보가 필요하므로
    // 별도 IPC 핸들러(os:resolveDependencies)에서 처리됨
    // 여기서는 null을 반환하여 패키지만 결과에 포함되고 의존성은 건너뜀
    case 'yum':
    case 'apt':
    case 'apk':
    case 'docker':
      return null;
    default:
      return null;
  }
}

/**
 * 패키지 목록의 모든 의존성을 해결합니다.
 *
 * @param packages 장바구니의 패키지 목록
 * @param options 의존성 해결 옵션
 * @returns 원본 패키지와 의존성 포함 전체 패키지 목록
 */
export async function resolveAllDependencies(
  packages: DownloadPackage[],
  options?: DependencyResolverOptions
): Promise<ResolvedPackageList> {
  const resolvedSet = new Map<string, DownloadPackage>();
  const dependencyTrees: DependencyResolutionResult[] = [];
  const failedPackages: { name: string; version: string; error: string }[] = [];

  const includeDependencies = options?.includeDependencies ?? true;
  const maxDepth = options?.maxDepth ?? 5;
  const includeOptional = options?.includeOptional ?? false;
  const condaChannel = options?.condaChannel ?? 'conda-forge';
  const architecture = options?.architecture ?? 'x86_64';
  const targetOS = options?.targetOS ?? 'any';

  if (!includeDependencies) {
    return {
      originalPackages: packages,
      allPackages: [...packages],
      dependencyTrees,
      failedPackages,
    };
  }

  // targetOS를 targetPlatform으로 변환 (pip/conda 환경 마커 평가용)
  const targetPlatformMap: Record<string, { system?: 'Linux' | 'Windows' | 'Darwin' }> = {
    any: {},
    windows: { system: 'Windows' },
    macos: { system: 'Darwin' },
    linux: { system: 'Linux' },
  };
  const targetPlatform = targetPlatformMap[targetOS] || {};

  const totalPackages = packages.length;
  let currentIndex = 0;

  for (const pkg of packages) {
    currentIndex++;

    // 원본 패키지 추가
    const key = `${pkg.type}:${pkg.name}@${pkg.version}`;
    resolvedSet.set(key, pkg);

    // 타입별 리졸버 선택
    const resolver = getResolverByType(pkg.type);
    if (!resolver) {
      // OS 패키지(yum, apt, apk) 처리 - osPackageInfo가 있으면 의존성 해결
      const osTypes = ['yum', 'apt', 'apk'];
      const osPackageInfo = pkg.metadata?.osPackageInfo as OSPackageInfo | undefined;

      if (osTypes.includes(pkg.type) && osPackageInfo) {
        // osPackageInfo가 있는 OS 패키지 - 의존성 해결 수행
        logger.info(`[${currentIndex}/${totalPackages}] OS 패키지 의존성 해결 시작: ${pkg.type}/${pkg.name}@${pkg.version}`);
        options?.onProgress?.({
          current: currentIndex,
          total: totalPackages,
          packageName: pkg.name,
          packageType: pkg.type,
          status: 'start',
        });

        try {
          // 배포판 설정 가져오기
          const distSettingMap: Record<string, OSDistributionSetting | undefined> = {
            yum: options?.yumDistribution,
            apt: options?.aptDistribution,
            apk: options?.apkDistribution,
          };
          const distSetting = distSettingMap[pkg.type];

          if (!distSetting) {
            throw new Error(`${pkg.type} 배포판 설정이 없습니다`);
          }

          // 전체 배포판 정보 가져오기
          const fullDistribution = getDistributionById(distSetting.id);
          if (!fullDistribution) {
            throw new Error(`배포판을 찾을 수 없습니다: ${distSetting.id}`);
          }

          // OS 리졸버 생성
          const osResolverOptions = {
            distribution: fullDistribution,
            repositories: fullDistribution.defaultRepos,
            architecture: distSetting.architecture as OSArchitecture,
            includeOptional: includeOptional,
            includeRecommends: options?.includeRecommends ?? false,
          };

          let osResolver;
          switch (pkg.type) {
            case 'yum':
              osResolver = getYumResolver(osResolverOptions);
              break;
            case 'apt':
              osResolver = getAptResolver(osResolverOptions);
              break;
            case 'apk':
              osResolver = getApkResolver(osResolverOptions);
              break;
          }

          if (osResolver) {
            // 의존성 해결
            const result = await osResolver.resolveDependencies([osPackageInfo]);

            // 결과를 DownloadPackage로 변환하여 추가
            for (const resolvedPkg of result.packages) {
              const depKey = `${pkg.type}:${resolvedPkg.name}@${resolvedPkg.version}`;
              if (!resolvedSet.has(depKey)) {
                // location에서 파일명 추출
                let filename = '';
                if (resolvedPkg.location) {
                  const parts = resolvedPkg.location.split('/');
                  filename = parts[parts.length - 1];
                }
                if (!filename) {
                  // fallback: 패키지명-버전.아키텍처.확장자
                  const ext = pkg.type === 'apt' ? 'deb' : pkg.type === 'apk' ? 'apk' : 'rpm';
                  filename = `${resolvedPkg.name}-${resolvedPkg.version}.${resolvedPkg.architecture}.${ext}`;
                }

                resolvedSet.set(depKey, {
                  id: generateId(),
                  type: pkg.type,
                  name: resolvedPkg.name,
                  version: resolvedPkg.version,
                  architecture: resolvedPkg.architecture,
                  size: resolvedPkg.size,
                  downloadUrl: `${resolvedPkg.repository.baseUrl}/${resolvedPkg.location}`,
                  repository: { baseUrl: resolvedPkg.repository.baseUrl, name: resolvedPkg.repository.name },
                  location: resolvedPkg.location,
                  filename, // 파일명 추가
                  metadata: { osPackageInfo: resolvedPkg },
                });
              }
            }

            // OS 패키지 의존성 트리를 dependencyTrees에 추가 (UI 표시용)
            // 원본 패키지를 root로, 나머지를 dependencies로 변환
            const rootPkg = result.packages.find(p => p.name === pkg.name) || result.packages[0];
            const depPackages = result.packages.filter(p => p !== rootPkg);
            const pkgTypeAsPackageType = pkg.type as PackageType;

            // OS 패키지에서 파일명 추출 헬퍼
            const getOsPackageFilename = (osPkg: typeof rootPkg): string => {
              // location에서 파일명 추출 (마지막 경로 부분)
              if (osPkg.location) {
                const parts = osPkg.location.split('/');
                return parts[parts.length - 1];
              }
              // fallback: 패키지명-버전.아키텍처.확장자
              const ext = pkg.type === 'apt' ? 'deb' : pkg.type === 'apk' ? 'apk' : 'rpm';
              return `${osPkg.name}-${osPkg.version}.${osPkg.architecture}.${ext}`;
            };

            // OS 패키지에서 다운로드 URL 생성 헬퍼
            const getOsPackageDownloadUrl = (osPkg: typeof rootPkg): string => {
              if (osPkg.repository?.baseUrl && osPkg.location) {
                return `${osPkg.repository.baseUrl}/${osPkg.location}`;
              }
              return '';
            };

            const osConvertedResult: DependencyResolutionResult = {
              root: {
                package: {
                  type: pkgTypeAsPackageType,
                  name: rootPkg.name,
                  version: rootPkg.version,
                  metadata: {
                    size: rootPkg.size,
                    filename: getOsPackageFilename(rootPkg),
                    downloadUrl: getOsPackageDownloadUrl(rootPkg),
                  },
                },
                dependencies: depPackages.map(depPkg => ({
                  package: {
                    type: pkgTypeAsPackageType,
                    name: depPkg.name,
                    version: depPkg.version,
                    metadata: {
                      size: depPkg.size,
                      filename: getOsPackageFilename(depPkg),
                      downloadUrl: getOsPackageDownloadUrl(depPkg),
                    },
                  },
                  dependencies: [],
                })),
              },
              flatList: result.packages.map(p => ({
                type: pkgTypeAsPackageType,
                name: p.name,
                version: p.version,
                metadata: {
                  size: p.size,
                  filename: getOsPackageFilename(p),
                  downloadUrl: getOsPackageDownloadUrl(p),
                },
              })),
              conflicts: (result.conflicts || []).map(c => ({
                type: 'version' as const,
                packageName: c.package,
                versions: c.versions.map(v => typeof v === 'string' ? v : v.version),
              })),
              totalSize: result.packages.reduce((sum, p) => sum + (p.size || 0), 0),
            };
            dependencyTrees.push(osConvertedResult);

            // 해결 실패한 의존성 기록
            if (result.unresolved && result.unresolved.length > 0) {
              logger.warn(`미해결 의존성: ${result.unresolved.join(', ')}`);
            }

            logger.info(`[${currentIndex}/${totalPackages}] ${pkg.type}/${pkg.name}: ${result.packages.length}개 패키지 해결됨`);
            options?.onProgress?.({
              current: currentIndex,
              total: totalPackages,
              packageName: pkg.name,
              packageType: pkg.type,
              status: 'success',
              dependencyCount: result.packages.length - 1, // 원본 제외
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : '';
          logger.error(`OS 패키지 의존성 해결 실패: ${pkg.name}`, { error: errorMessage, stack: errorStack });
          failedPackages.push({ name: pkg.name, version: pkg.version, error: errorMessage });
          options?.onProgress?.({
            current: currentIndex,
            total: totalPackages,
            packageName: pkg.name,
            packageType: pkg.type,
            status: 'error',
            error: errorMessage,
          });
        }
        continue;
      } else if (osTypes.includes(pkg.type) || pkg.type === 'docker') {
        // osPackageInfo가 없는 OS 패키지 또는 Docker - 원본만 포함
        logger.info(`[${currentIndex}/${totalPackages}] ${pkg.type}/${pkg.name}@${pkg.version}: 패키지 정보 없음, 원본만 포함`);
        options?.onProgress?.({
          current: currentIndex,
          total: totalPackages,
          packageName: pkg.name,
          packageType: pkg.type,
          status: 'success',
          dependencyCount: 0,
        });
        continue;
      } else {
        logger.warn(`지원하지 않는 패키지 타입: ${pkg.type}`, { package: pkg.name });
        options?.onProgress?.({
          current: currentIndex,
          total: totalPackages,
          packageName: pkg.name,
          packageType: pkg.type,
          status: 'error',
          error: `지원하지 않는 패키지 타입: ${pkg.type}`,
        });
        continue;
      }
    }

    // 시작 로그 및 콜백
    logger.info(`[${currentIndex}/${totalPackages}] 의존성 해결 시작: ${pkg.type}/${pkg.name}@${pkg.version}`);
    options?.onProgress?.({
      current: currentIndex,
      total: totalPackages,
      packageName: pkg.name,
      packageType: pkg.type,
      status: 'start',
    });

    try {
      // 패키지 타입별 의존성 해결 옵션 설정
      let resolverOptions: Record<string, unknown> = {
        maxDepth,
        includeOptionalDependencies: includeOptional,
      };

      if (pkg.type === 'pip') {
        // pip: 환경 마커 평가를 위한 타겟 플랫폼 및 Python 버전 전달
        resolverOptions = {
          ...resolverOptions,
          targetPlatform: {
            ...targetPlatform,
            machine: architecture,
          },
          pythonVersion: options?.pythonVersion,
          indexUrl: pkg.indexUrl, // 커스텀 인덱스 URL 전파
          extras: pkg.extras, // extras 전달
        };
      } else if (pkg.type === 'conda') {
        // conda: 채널, 타겟 플랫폼, Python 버전 및 CUDA 버전 전달
        resolverOptions = {
          ...resolverOptions,
          channel: condaChannel,
          targetPlatform: {
            ...targetPlatform,
            machine: architecture,
          },
          pythonVersion: options?.pythonVersion,
          cudaVersion: options?.cudaVersion,
        };
      } else if (pkg.type === 'yum') {
        resolverOptions = {
          ...resolverOptions,
          repoUrl: options?.yumRepoUrl,
          architecture,
        };
      } else if (pkg.type === 'maven') {
        // maven: 사용자 선택 classifier 또는 targetOS/targetArchitecture 전달
        resolverOptions = {
          ...resolverOptions,
          targetOS: options?.targetOS !== 'any' ? options?.targetOS : undefined,
          targetArchitecture: architecture,
          // 사용자가 UI에서 선택한 classifier 전달
          classifier: pkg.classifier,
        };
      }

      // npm은 반환 타입이 다르므로 별도 처리
      if (pkg.type === 'npm') {
        const npmResult = await resolver.resolveDependencies(
          pkg.name,
          pkg.version,
          resolverOptions
        ) as NpmResolutionResult;

        // npm hoisted 구조를 트리 구조로 변환
        // hoistedPath가 "node_modules/xxx"인 패키지들이 1단계 의존성
        const directDeps = npmResult.flatList
          .filter(p => {
            // hoistedPath가 "node_modules/{name}" 형태인 것이 직접 의존성
            const path = p.hoistedPath || '';
            const parts = path.split('/').filter(Boolean);
            return parts.length === 2 && parts[0] === 'node_modules';
          })
          .map(p => ({
            package: {
              type: 'npm' as const,
              name: p.name,
              version: p.version,
              metadata: { size: p.size },
            },
            dependencies: [], // 재귀적 트리 구성은 하지 않음 (flatList 사용)
          }));

        // npm 결과를 공통 형식으로 변환하여 저장
        const convertedResult: DependencyResolutionResult = {
          root: {
            package: {
              type: 'npm',
              name: npmResult.root.name,
              version: npmResult.root.version,
            },
            dependencies: directDeps,
          },
          flatList: npmResult.flatList.map(p => ({
            type: 'npm' as const,
            name: p.name,
            version: p.version,
            metadata: { size: p.size },
          })),
          conflicts: npmResult.conflicts.map(c => ({
            type: 'version' as const,
            packageName: c.packageName,
            versions: c.requestedVersions,
          })),
          totalSize: npmResult.totalSize,
        };
        dependencyTrees.push(convertedResult);

        // npm 의존성 목록 추가
        for (const depPkg of npmResult.flatList) {
          const depKey = `npm:${depPkg.name}@${depPkg.version}`;
          if (!resolvedSet.has(depKey)) {
            resolvedSet.set(depKey, {
              id: generateId(),
              type: 'npm',
              name: depPkg.name,
              version: depPkg.version,
              architecture: pkg.architecture,
              size: depPkg.size,
              filename: depPkg.filename,
            });
          }
        }

        // 성공 로그 및 콜백 (npm)
        const npmDepCount = npmResult.flatList.length;
        logger.info(`[${currentIndex}/${totalPackages}] 의존성 해결 완료: ${pkg.type}/${pkg.name}@${pkg.version} (${npmDepCount}개 의존성)`);
        options?.onProgress?.({
          current: currentIndex,
          total: totalPackages,
          packageName: pkg.name,
          packageType: pkg.type,
          status: 'success',
          dependencyCount: npmDepCount,
        });
      } else {
        const result = await resolver.resolveDependencies(
          pkg.name,
          pkg.version,
          resolverOptions
        ) as DependencyResolutionResult;

        dependencyTrees.push(result);

        // 평탄화된 의존성 목록 추가
        for (const depPkg of result.flatList) {
          const depKey = `${depPkg.type}:${depPkg.name}@${depPkg.version}`;
          if (!resolvedSet.has(depKey)) {
            const downloadPkg: DownloadPackage = {
              id: generateId(),
              type: depPkg.type,
              name: depPkg.name,
              version: depPkg.version,
              architecture: depPkg.arch || pkg.architecture,
              size: depPkg.metadata?.size as number | undefined,
            };

            // downloadUrl 전달 (conda, yum, apt, apk 등)
            if (depPkg.metadata?.downloadUrl) {
              downloadPkg.downloadUrl = depPkg.metadata.downloadUrl as string;
            }

            // indexUrl 전달 (pip 커스텀 인덱스)
            if (depPkg.type === 'pip') {
              // 부모 패키지의 indexUrl 또는 의존성 메타데이터의 indexUrl 사용
              downloadPkg.indexUrl = pkg.indexUrl || (depPkg.metadata?.indexUrl as string | undefined);
            }

            // metadata 전달 (conda의 subdir, filename 등)
            if (depPkg.metadata) {
              downloadPkg.metadata = depPkg.metadata as Record<string, unknown>;

              // filename을 최상위 필드로 추출 (conda, pip 등에서 사용)
              if (depPkg.metadata.filename) {
                downloadPkg.filename = depPkg.metadata.filename as string;
              }
            }

            resolvedSet.set(depKey, downloadPkg);
          }
        }

        // 성공 로그 및 콜백 (기타 타입)
        const depCount = result.flatList.length;
        logger.info(`[${currentIndex}/${totalPackages}] 의존성 해결 완료: ${pkg.type}/${pkg.name}@${pkg.version} (${depCount}개 의존성)`);
        options?.onProgress?.({
          current: currentIndex,
          total: totalPackages,
          packageName: pkg.name,
          packageType: pkg.type,
          status: 'success',
          dependencyCount: depCount,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${currentIndex}/${totalPackages}] 의존성 해결 실패: ${pkg.type}/${pkg.name}@${pkg.version}`, { error: errorMessage });
      options?.onProgress?.({
        current: currentIndex,
        total: totalPackages,
        packageName: pkg.name,
        packageType: pkg.type,
        status: 'error',
        error: errorMessage,
      });
      failedPackages.push({
        name: pkg.name,
        version: pkg.version,
        error: errorMessage,
      });
      // 실패해도 원본 패키지는 이미 추가되어 있으므로 계속 진행
    }
  }

  return {
    originalPackages: packages,
    allPackages: Array.from(resolvedSet.values()),
    dependencyTrees,
    failedPackages,
  };
}

/**
 * 단일 패키지의 의존성을 해결합니다.
 */
export async function resolveSinglePackageDependencies(
  pkg: DownloadPackage,
  options?: DependencyResolverOptions
): Promise<ResolvedPackageList> {
  return resolveAllDependencies([pkg], options);
}
