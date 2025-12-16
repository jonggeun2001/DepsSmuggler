/**
 * Conda RepoData Processor
 *
 * RepoData 로딩, 캐싱, 패키지 검색 로직을 담당
 * CondaResolver에서 분리된 모듈
 */

import logger from '../../utils/logger';
import { RepoData, RepoDataPackage } from '../shared/conda-types';
import { compareCondaVersions, matchesVersionSpec } from '../shared';
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
}

/**
 * RepoData 프로세서 설정
 */
export interface RepoDataProcessorConfig {
  /** Conda 베이스 URL */
  condaUrl: string;
  /** 타겟 플랫폼 서브디렉토리 */
  targetSubdir: string;
  /** Python 버전 (빌드 필터링용) */
  pythonVersion: string | null;
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
    cacheKey?: string
  ): PackageCandidate[] {
    const candidates: Array<PackageCandidate & { isPythonMatch: boolean; timestamp: number }> = [];
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

    for (const { filename, pkg } of packageEntries) {
      // 버전 스펙 체크 (새로운 MatchSpec 파서 사용)
      if (versionSpec && !matchesVersionSpec(pkg.version, versionSpec)) {
        continue;
      }

      const isPythonMatch = this.isBuildCompatibleWithPython(pkg.build);

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
  isBuildCompatibleWithPython(build: string): boolean {
    const pythonTag = this.getPythonBuildTag();

    // pythonTag가 없으면 필터링 안함
    if (!pythonTag) return true;

    // build에 python 버전이 없으면 (네이티브 라이브러리) 호환
    const pyMatch = build.match(/py\d+/);
    if (!pyMatch) return true;

    // Python 버전이 있으면 정확히 매칭
    return build.includes(pythonTag);
  }

  /**
   * RepoData에서 최신 버전 조회
   */
  async getLatestVersionFromRepoData(
    name: string,
    channel: string,
    versionSpec?: string,
    fallbackFn?: (name: string, channel: string, versionSpec?: string) => Promise<string | null>
  ): Promise<string | null> {
    // 타겟 플랫폼 repodata 확인
    const targetCacheKey = `${channel}/${this.config.targetSubdir}`;
    const repodata = await this.getRepoData(channel, this.config.targetSubdir);
    if (repodata) {
      const candidates = this.findPackageCandidates(repodata, name, versionSpec, targetCacheKey);
      if (candidates.length > 0) {
        return candidates[0].version;
      }
    }

    // noarch 확인
    const noarchCacheKey = `${channel}/noarch`;
    const noarchRepodata = await this.getRepoData(channel, 'noarch');
    if (noarchRepodata) {
      const candidates = this.findPackageCandidates(
        noarchRepodata,
        name,
        versionSpec,
        noarchCacheKey
      );
      if (candidates.length > 0) {
        return candidates[0].version;
      }
    }

    // 폴백: 외부 함수 호출 (예: Anaconda API)
    if (fallbackFn) {
      return fallbackFn(name, channel, versionSpec);
    }

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
