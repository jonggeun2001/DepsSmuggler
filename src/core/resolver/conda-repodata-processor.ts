/**
 * Conda RepoData Processor
 *
 * RepoData 로딩, 캐싱, 패키지 검색 로직을 담당
 * CondaResolver에서 분리된 모듈
 */

import logger from '../../utils/logger';
import { RepoData, RepoDataPackage } from '../shared/conda-types';
import {
  compareCondaVersions,
  matchesBuildSpec,
  matchesVersionSpec,
  parseMatchSpec,
} from '../shared';
import { fetchRepodata } from '../shared/conda-cache';

/**
 * 패키지 후보 정보
 */
export interface PackageCandidate {
  filename: string;
  name: string;
  version: string;
  build: string;
  buildNumber: number;
  depends: string[];
  subdir: string;
  size: number;
  isPythonMatch: boolean;
}

/**
 * RepoData 프로세서 설정
 */
export interface RepoDataProcessorConfig {
  /** Conda 베이스 URL */
  condaUrl: string;
  /** 타겟 플랫폼 서브디렉토리 */
  targetSubdir: string;
  /** 타겟 아키텍처 (__archspec 가상 패키지 필터링용) */
  targetArchitecture: string | null;
  /** Python 버전 (빌드 필터링용) */
  pythonVersion: string | null;
  /** CUDA 버전 (null = CPU only, CUDA 의존성 있는 패키지 제외) */
  cudaVersion: string | null;
}

/**
 * Conda RepoData 프로세서
 *
 * RepoData 로드, 캐싱, 패키지 검색 최적화 담당
 */
export class CondaRepoDataProcessor {
  /** repodata 캐시 (channel/subdir -> RepoData) */
  private repodataCache: Map<string, RepoData> = new Map();

  /** 패키지 이름별 인덱스 캐시 */
  private packageIndex: Map<
    string,
    Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>
  > = new Map();

  constructor(private config: RepoDataProcessorConfig) {}

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<RepoDataProcessorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 타겟 서브디렉토리 반환
   */
  get targetSubdir(): string {
    return this.config.targetSubdir;
  }

  /**
   * RepoData 가져오기 (캐시 포함)
   */
  async getRepoData(channel: string, subdir: string): Promise<RepoData | null> {
    const cacheKey = `${channel}/${subdir}`;

    // 메모리 캐시 확인 (세션 내 재사용)
    if (this.repodataCache.has(cacheKey)) {
      logger.debug(`repodata 메모리 캐시 사용: ${channel}/${subdir}`);
      return this.repodataCache.get(cacheKey)!;
    }

    logger.info(`repodata 로드 시작: ${channel}/${subdir} (처음 로드 시 시간이 걸릴 수 있습니다)`);

    // 파일 시스템 캐시 + HTTP 조건부 요청 사용
    const result = await fetchRepodata(channel, subdir, {
      baseUrl: this.config.condaUrl,
      useCache: true,
    });

    if (result) {
      // 메모리 캐시에도 저장 (세션 내 빠른 접근)
      this.repodataCache.set(cacheKey, result.data);

      // 패키지 이름별 인덱스 생성 (검색 최적화)
      const index = this.buildPackageIndex(cacheKey, result.data);
      this.packageIndex.set(cacheKey, index);

      logger.info(`repodata 로드 완료: ${channel}/${subdir}`, {
        fromCache: result.fromCache ? '디스크 캐시' : '네트워크',
        packages: result.meta.packageCount,
      });

      return result.data;
    }

    logger.error(`repodata 가져오기 실패: ${channel}/${subdir}`);
    return null;
  }

  /**
   * 패키지 인덱스 생성
   */
  private buildPackageIndex(
    cacheKey: string,
    repodata: RepoData
  ): Map<string, Array<{ filename: string; pkg: RepoDataPackage }>> {
    const startTime = Date.now();
    const index = new Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>();

    // packages와 packages.conda 모두 인덱싱
    const allPackages = {
      ...repodata.packages,
      ...(repodata['packages.conda'] || {}),
    };

    for (const [filename, pkg] of Object.entries(allPackages)) {
      const normalizedName = pkg.name.toLowerCase();
      if (!index.has(normalizedName)) {
        index.set(normalizedName, []);
      }
      index.get(normalizedName)!.push({ filename, pkg });
    }

    const elapsed = Date.now() - startTime;
    logger.info(
      `패키지 인덱스 생성 완료: ${cacheKey} (${index.size}개 패키지명, ${elapsed}ms)`
    );

    return index;
  }

  /**
   * 패키지 후보 검색
   */
  findPackageCandidates(
    repodata: RepoData,
    packageName: string,
    versionSpec?: string,
    cacheKey?: string,
    buildSpec?: string,
  ): PackageCandidate[] {
    const candidates: Array<PackageCandidate & { timestamp: number }> = [];
    const normalizedName = packageName.toLowerCase();

    // 인덱스가 있으면 O(1) 조회 사용
    let packageEntries: Array<{ filename: string; pkg: RepoDataPackage }> | undefined;
    if (cacheKey && this.packageIndex.has(cacheKey)) {
      packageEntries = this.packageIndex.get(cacheKey)?.get(normalizedName);
    }

    // 인덱스가 없으면 폴백: 전체 순회 (첫 로드 시)
    if (!packageEntries) {
      const allPackages = {
        ...repodata.packages,
        ...(repodata['packages.conda'] || {}),
      };
      packageEntries = [];
      for (const [filename, pkg] of Object.entries(allPackages)) {
        if (pkg.name.toLowerCase() === normalizedName) {
          packageEntries.push({ filename, pkg });
        }
      }
    }

    // 디버그: Python 버전 설정 확인
    const pythonTag = this.getPythonBuildTag();
    logger.info(`[DEBUG] findPackageCandidates: ${packageName}, pythonTag=${pythonTag}, entries=${packageEntries.length}`);

    for (const { filename, pkg } of packageEntries) {
      // 버전 스펙 체크 (새로운 MatchSpec 파서 사용)
      if (versionSpec && !matchesVersionSpec(pkg.version, versionSpec)) {
        continue;
      }
      if (buildSpec && !matchesBuildSpec(pkg.build, buildSpec)) {
        continue;
      }

      // 플랫폼 호환성 체크 (depends에 플랫폼 마커가 있으면 해당 플랫폼 전용)
      if (!this.isBuildCompatibleWithPlatform(pkg.depends || [])) {
        continue;
      }

      // CUDA 호환성 체크 (depends에 __cuda 마커가 있으면 해당 CUDA 버전 필요)
      if (!this.isBuildCompatibleWithCuda(pkg.depends || [])) {
        continue;
      }

      const isPythonMatch = this.isBuildCompatibleWithPython(
        pkg.build,
        pkg.depends || [],
      );

      candidates.push({
        filename,
        name: pkg.name,
        version: pkg.version,
        build: pkg.build,
        buildNumber: pkg.build_number,
        depends: pkg.depends || [],
        subdir: pkg.subdir || repodata.info?.subdir || 'noarch',
        size: pkg.size || 0,
        isPythonMatch,
        timestamp: pkg.timestamp || 0,
      });
    }

    // 정렬 우선순위 (Conda SAT solver 최적화 순서 참고):
    // 1. Python 버전 매칭
    // 2. 버전 (내림차순 - 최신 우선)
    // 3. 빌드 번호 (내림차순)
    // 4. 타임스탬프 (내림차순 - 최신 우선)
    candidates.sort((a, b) => {
      // Python 매칭이 있는 것 우선
      if (a.isPythonMatch !== b.isPythonMatch) {
        return a.isPythonMatch ? -1 : 1;
      }

      // 버전 비교 (Conda 스타일)
      const versionCmp = compareCondaVersions(b.version, a.version);
      if (versionCmp !== 0) return versionCmp;

      // 빌드 번호
      const buildCmp = b.buildNumber - a.buildNumber;
      if (buildCmp !== 0) return buildCmp;

      // 타임스탬프
      return b.timestamp - a.timestamp;
    });

    // 디버그: 상위 5개 후보 출력
    if (candidates.length > 0) {
      const top5 = candidates.slice(0, 5).map(c => `${c.build}(match=${c.isPythonMatch})`).join(', ');
      logger.info(`[DEBUG] ${packageName} top5: ${top5}`);
    }

    return candidates;
  }

  /**
   * Python 빌드 태그 생성
   */
  getPythonBuildTag(): string | null {
    if (!this.config.pythonVersion) return null;

    const match = this.config.pythonVersion.match(/^(\d+)\.(\d+)/);
    if (!match) return null;

    return `py${match[1]}${match[2]}`;
  }

  /**
   * 빌드 문자열이 Python 버전과 호환되는지 확인
   */
  isBuildCompatibleWithPython(
    build: string,
    depends: string[] = [],
  ): boolean {
    const pythonTag = this.getPythonBuildTag();

    // pythonTag가 없으면 필터링 안함
    if (!pythonTag) return true;

    // 빌드 문자열에 버전 태그가 있으면 대상 Python과 정확히 일치해야 한다.
    const pyMatch = build.match(/(py|cp)\d+/);
    const pythonNumber = pythonTag.slice(2); // 'py313' -> '313'
    if (
      pyMatch &&
      !build.includes(`py${pythonNumber}`) &&
      !build.includes(`cp${pythonNumber}`)
    ) {
      return false;
    }

    // pyhd... 같은 noarch 빌드는 실제 Python 범위를 depends에 보관한다.
    const configuredVersion = this.config.pythonVersion;
    if (!configuredVersion) {
      return true;
    }
    const targetVersion = /^\d+\.\d+$/.test(configuredVersion)
      ? `${configuredVersion}.0`
      : configuredVersion;

    return depends.every((dependency) => {
      const matchSpec = parseMatchSpec(dependency);
      const dependencyName = matchSpec.name.toLowerCase();
      if (dependencyName !== 'python' && dependencyName !== 'python_abi') {
        return true;
      }

      if (
        matchSpec.version &&
        !matchesVersionSpec(targetVersion, matchSpec.version)
      ) {
        return false;
      }

      if (
        dependencyName === 'python_abi' &&
        matchSpec.build &&
        !matchesBuildSpec(`0_cp${pythonNumber}`, matchSpec.build)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * 빌드가 타겟 플랫폼과 호환되는지 확인
   * depends에 플랫폼 마커(__win, __unix, __linux, __osx)가 있으면 해당 플랫폼 전용
   */
  isBuildCompatibleWithPlatform(depends: string[]): boolean {
    const targetSubdir = this.config.targetSubdir;
    const isLinux = targetSubdir.startsWith('linux-');
    const isWindows = targetSubdir.startsWith('win-');
    const isMacOS = targetSubdir.startsWith('osx-');
    const targetArchitectures = this.getTargetArchitectureBuilds(
      this.config.targetArchitecture,
    );
    const archSpecs = depends
      .map((dependency) => parseMatchSpec(dependency))
      .filter(
        (matchSpec) =>
          matchSpec.name.toLowerCase() === '__archspec',
      );

    if (archSpecs.length > 0) {
      if (targetArchitectures.length === 0) {
        return false;
      }

      for (const archSpec of archSpecs) {
        if (
          archSpec.version &&
          !matchesVersionSpec('1', archSpec.version)
        ) {
          return false;
        }
        const archspecBuild = archSpec.build;
        if (
          archspecBuild &&
          !targetArchitectures.some((targetArchitecture) =>
            matchesBuildSpec(targetArchitecture, archspecBuild),
          )
        ) {
          return false;
        }
      }
    }

    // 플랫폼 마커 확인 (버전 스펙 포함 가능: "__glibc >=2.17,<3.0.a0")
    const hasWin = depends.some(d => d === '__win' || d.startsWith('__win '));
    const hasUnix = depends.some(d => d === '__unix' || d.startsWith('__unix '));
    const hasLinux = depends.some(d => d === '__linux' || d.startsWith('__linux '));
    const hasOSX = depends.some(d => d === '__osx' || d.startsWith('__osx ') || d === '__macos' || d.startsWith('__macos '));
    const hasGlibc = depends.some(d => d === '__glibc' || d.startsWith('__glibc '));

    // 플랫폼 마커가 없으면 모든 플랫폼과 호환 (__glibc는 Linux 전용이므로 Linux에서 호환)
    if (!hasWin && !hasUnix && !hasLinux && !hasOSX && !hasGlibc) {
      return true;
    }

    // __glibc가 있으면 Linux 전용
    if (hasGlibc && !isLinux) {
      return false;
    }

    // 타겟 플랫폼에 따른 호환성 확인
    if (isLinux) {
      // Linux: __win이나 __osx 전용 빌드는 제외
      if (hasWin || hasOSX) return false;
      // __unix나 __linux 전용은 호환
      return true;
    }

    if (isWindows) {
      // Windows: __unix, __linux, __osx 전용 빌드는 제외
      if (hasUnix || hasLinux || hasOSX) return false;
      // __win 전용은 호환
      return true;
    }

    if (isMacOS) {
      // macOS: __win이나 __linux 전용 빌드는 제외 (__unix는 macOS도 포함)
      if (hasWin || hasLinux) return false;
      // __unix나 __osx 전용은 호환
      return true;
    }

    // 대상 OS를 모르면 OS 가상 의존성이 있는 noarch 빌드는
    // 공통 아티팩트로 간주할 수 없다.
    return false;
  }

  private getTargetArchitectureBuilds(
    architecture: string | null,
  ): string[] {
    switch (architecture?.trim().toLowerCase()) {
      case 'x86_64':
      case 'amd64':
        return ['x86_64'];
      case 'aarch64':
      case 'arm64':
        // CEP 30은 *-aarch64와 *-arm64 모두 aarch64를 canonical
        // build string으로 규정한다. 기존 Conda가 보고한 arm64도
        // 호환성을 위해 함께 허용한다.
        return ['aarch64', 'arm64'];
      case 'x86':
      case 'i386':
      case 'i686':
        return ['x86'];
      default:
        return [];
    }
  }


  /**
   * 빌드가 타겟 CUDA 버전과 호환되는지 확인
   * depends에 __cuda 마커가 있으면 해당 CUDA 버전 요구
   * @param depends 패키지의 의존성 목록
   * @returns CUDA 호환 여부
   */
  isBuildCompatibleWithCuda(depends: string[]): boolean {
    // __cuda 의존성 찾기 (예: "__cuda", "__cuda >=11.8", "__cuda >=12.0,<13")
    const cudaDeps = depends.filter(d => d === '__cuda' || d.startsWith('__cuda '));

    // CUDA 의존성이 없으면 모든 환경과 호환 (CPU 패키지)
    if (cudaDeps.length === 0) {
      return true;
    }

    // 타겟 CUDA 버전이 없으면 (CPU only) CUDA 의존성 있는 패키지 제외
    if (!this.config.cudaVersion) {
      return false;
    }

    // CUDA 버전 파싱 (예: "11.8" -> [11, 8])
    const parseVersion = (v: string): number[] => {
      return v.split('.').map(n => parseInt(n, 10));
    };

    const targetVersion = parseVersion(this.config.cudaVersion);

    // 모든 __cuda 의존성에 대해 버전 제약 확인
    for (const dep of cudaDeps) {
      // "__cuda" (버전 제약 없음) → 모든 CUDA 버전과 호환
      if (dep === '__cuda') continue;

      // "__cuda >=11.8" 형태 파싱
      const versionSpec = dep.replace('__cuda ', '').trim();

      // 버전 제약 파싱 (>=, <, ==, != 등)
      const constraints = versionSpec.split(',').map(c => c.trim());

      for (const constraint of constraints) {
        let operator = '';
        let versionStr = '';

        if (constraint.startsWith('>=')) {
          operator = '>=';
          versionStr = constraint.slice(2).trim();
        } else if (constraint.startsWith('<=')) {
          operator = '<=';
          versionStr = constraint.slice(2).trim();
        } else if (constraint.startsWith('==')) {
          operator = '==';
          versionStr = constraint.slice(2).trim();
        } else if (constraint.startsWith('!=')) {
          operator = '!=';
          versionStr = constraint.slice(2).trim();
        } else if (constraint.startsWith('>')) {
          operator = '>';
          versionStr = constraint.slice(1).trim();
        } else if (constraint.startsWith('<')) {
          operator = '<';
          versionStr = constraint.slice(1).trim();
        } else {
          // 알 수 없는 제약, 무시
          continue;
        }

        // 버전 문자열에서 추가 태그 제거 (예: "12.0.a0" -> "12.0")
        const cleanVersion = versionStr.replace(/\.[a-z]+\d*$/, '');
        const constraintVersion = parseVersion(cleanVersion);

        // 버전 비교
        const compare = (a: number[], b: number[]): number => {
          const len = Math.max(a.length, b.length);
          for (let i = 0; i < len; i++) {
            const av = a[i] || 0;
            const bv = b[i] || 0;
            if (av < bv) return -1;
            if (av > bv) return 1;
          }
          return 0;
        };

        const cmp = compare(targetVersion, constraintVersion);

        let satisfied = false;
        switch (operator) {
          case '>=': satisfied = cmp >= 0; break;
          case '<=': satisfied = cmp <= 0; break;
          case '==': satisfied = cmp === 0; break;
          case '!=': satisfied = cmp !== 0; break;
          case '>': satisfied = cmp > 0; break;
          case '<': satisfied = cmp < 0; break;
        }

        if (!satisfied) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * RepoData에서 최신 버전 조회
   */
  async getLatestVersionFromRepoData(
    name: string,
    channel: string,
    versionSpec?: string,
    fallbackFn?: (name: string, channel: string, versionSpec?: string) => Promise<string | null>,
    buildSpec?: string,
  ): Promise<string | null> {
    // 타겟 플랫폼 repodata 확인
    const targetCacheKey = `${channel}/${this.config.targetSubdir}`;
    const repodata = await this.getRepoData(channel, this.config.targetSubdir);
    let targetCandidate: { version: string; isPythonMatch: boolean } | null = null;

    if (repodata) {
      const candidates = this.findPackageCandidates(
        repodata,
        name,
        versionSpec,
        targetCacheKey,
        buildSpec,
      );
      if (candidates.length > 0) {
        // 첫 번째 후보가 Python 버전과 호환되는지 확인
        const firstCandidate = candidates[0];
        targetCandidate = {
          version: firstCandidate.version,
          isPythonMatch: firstCandidate.isPythonMatch,
        };
      }
    }

    // noarch 확인: 후보가 없거나 Python 버전이 맞지 않는 경우
    if (
      this.config.targetSubdir !== 'noarch' &&
      (!targetCandidate || !targetCandidate.isPythonMatch)
    ) {
      const noarchCacheKey = `${channel}/noarch`;
      const noarchRepodata = await this.getRepoData(channel, 'noarch');
      if (noarchRepodata) {
        const candidates = this.findPackageCandidates(
          noarchRepodata,
          name,
          versionSpec,
          noarchCacheKey,
          buildSpec,
        );
        if (candidates.length > 0 && candidates[0].isPythonMatch) {
          return candidates[0].version;
        }
      }
    }

    // Python 버전이 일치하는 후보만 반환 (strict mode)
    if (targetCandidate && targetCandidate.isPythonMatch) {
      return targetCandidate.version;
    }

    // Python 버전 불일치 시 null 반환 (다운로드하지 않음)
    if (targetCandidate && !targetCandidate.isPythonMatch) {
      logger.warn(`Python 버전 불일치로 스킵: ${name} (${versionSpec || 'latest'})`);
      return null;
    }

    // repodata에서 찾지 못함 (API fallback 제거 - 플랫폼 불일치 방지)
    return null;
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    this.repodataCache.clear();
    this.packageIndex.clear();
    logger.info('Conda repodata 캐시 초기화됨');
  }
}
