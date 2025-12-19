/**
 * 패키지 검색 및 의존성 해결 관련 IPC 핸들러
 */

import { ipcMain } from 'electron';
import axios from 'axios';
import { createScopedLogger } from './utils/logger';
import {
  DownloadPackage,
  resolveAllDependencies,
  sortByRelevance,
} from '../src/core/shared';
import {
  getPipDownloader,
  getMavenDownloader,
  getCondaDownloader,
  getDockerDownloader,
  getYumDownloader,
  getAptDownloader,
  getApkDownloader,
  getNpmDownloader,
  PipDownloader,
  MavenDownloader,
  CondaDownloader,
  DockerDownloader,
  YumDownloader,
  AptDownloader,
  ApkDownloader,
  NpmDownloader,
  getYumResolver,
  getAptResolver,
  getApkResolver,
} from '../src/core';
import {
  OS_DISTRIBUTIONS,
  getDistributionsByPackageManager,
  getDistributionById,
} from '../src/core/downloaders/os-shared/repositories';
import {
  getSimplifiedDistributions,
  invalidateDistributionCache,
} from '../src/core/downloaders/os-shared/distribution-fetcher';
import {
  isNativeArtifactFromApi,
  getAvailableClassifiersAsync,
} from '../src/core/shared/maven-utils';
import type {
  OSPackageManager,
  OSDistribution,
  OSArchitecture,
  MatchType,
} from '../src/core/downloaders/os-shared/types';

const log = createScopedLogger('Search');

// 다운로더 타입 매핑
const downloaderMap = {
  pip: getPipDownloader,
  conda: getCondaDownloader,
  maven: getMavenDownloader,
  docker: getDockerDownloader,
  yum: getYumDownloader,
  apt: getAptDownloader,
  apk: getApkDownloader,
  npm: getNpmDownloader,
} as const;

type SupportedPackageType = keyof typeof downloaderMap;

// PyPI 패키지 목록 캐시 (like 검색용)
let pypiPackageCache: string[] = [];
let pypiCacheLoading = false;
let pypiCacheLoaded = false;

// 검색 타임아웃 설정 (5초)
const SEARCH_TIMEOUT = 5000;

// 자동완성 결과 캐싱 (메모리 캐시)
const suggestionCache = new Map<string, { results: string[]; timestamp: number }>();
const CACHE_TTL = 60000; // 1분

// 버전 비교 함수
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.-]/);
  const partsB = b.split(/[.-]/);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || '0';
    const partB = partsB[i] || '0';
    const numA = parseInt(partA, 10);
    const numB = parseInt(partB, 10);

    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
    } else {
      const cmp = partA.localeCompare(partB);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// PyPI Simple API에서 패키지 목록 로드
async function loadPyPIPackageList(): Promise<void> {
  if (pypiCacheLoaded || pypiCacheLoading) return;

  pypiCacheLoading = true;
  log.info('Loading PyPI package list...');

  try {
    const response = await axios.get('https://pypi.org/simple/', {
      timeout: 30000,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'DepsSmuggler/1.0',
      },
    });

    const html = response.data as string;
    // Simple API 형식: <a href="/simple/package-name/">package-name</a>
    const packageRegex = /<a[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = packageRegex.exec(html)) !== null) {
      pypiPackageCache.push(match[1].toLowerCase());
    }

    pypiCacheLoaded = true;
    log.info(`PyPI package list loaded: ${pypiPackageCache.length} packages`);
  } catch (error) {
    log.error('Failed to load PyPI package list:', error);
  } finally {
    pypiCacheLoading = false;
  }
}

// PyPI 패키지 검색 (like 검색)
async function searchPyPI(query: string, indexUrl?: string) {
  const results: Array<{ name: string; version: string; description: string }> = [];
  const lowerQuery = query.toLowerCase();

  // 커스텀 인덱스 URL을 사용하는 경우 PipDownloader 직접 사용
  if (indexUrl) {
    const pipDownloader = getPipDownloader();
    const indexResults = await pipDownloader.searchPackages(query, indexUrl);
    return indexResults.map(pkg => ({
      name: pkg.name,
      version: pkg.version,
      description: pkg.metadata?.description || `커스텀 인덱스: ${new URL(indexUrl).hostname}`,
    }));
  }

  // 캐시에서 prefix 검색 (대소문자 무시, 앞부분 일치)
  if (pypiCacheLoaded && pypiPackageCache.length > 0) {
    const matchedPackages = pypiPackageCache
      .filter(pkg => pkg.startsWith(lowerQuery))
      .slice(0, 20);

    // 매칭된 패키지들의 상세 정보 조회 (병렬)
    const detailPromises = matchedPackages.map(async (pkgName) => {
      try {
        const response = await axios.get(`https://pypi.org/pypi/${pkgName}/json`, { timeout: 5000 });
        return {
          name: response.data.info.name,
          version: response.data.info.version,
          description: response.data.info.summary || '',
        };
      } catch {
        return null;
      }
    });

    const details = await Promise.all(detailPromises);
    results.push(...details.filter((d): d is NonNullable<typeof d> => d !== null));
  }

  // 캐시가 없거나 결과가 없으면 정확한 패키지명으로 직접 조회
  if (results.length === 0) {
    try {
      const exactResponse = await axios.get(`https://pypi.org/pypi/${query}/json`, { timeout: 10000 });
      const data = exactResponse.data;
      results.push({
        name: data.info.name,
        version: data.info.version,
        description: data.info.summary || '',
      });
    } catch {
      // 정확한 패키지도 없음
    }
  }

  return results;
}

// PyPI 버전 목록 조회
async function getPyPIVersions(packageName: string, indexUrl?: string): Promise<string[]> {
  // 커스텀 인덱스 URL을 사용하는 경우 PipDownloader 직접 사용
  if (indexUrl) {
    const pipDownloader = getPipDownloader();
    return await pipDownloader.getVersions(packageName, indexUrl);
  }

  // 기본 PyPI JSON API 사용
  const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`, { timeout: 10000 });
  const versions = Object.keys(response.data.releases);
  return versions.sort((a, b) => compareVersions(b, a));
}

// Maven 패키지 검색 (MavenDownloader 사용, 재시도 로직 및 fallback API 포함)
async function searchMaven(query: string) {
  try {
    // MavenDownloader 인스턴스 사용 (재시도 로직 및 Sonatype API fallback 포함)
    const mavenDownloader = getMavenDownloader();
    const results = await mavenDownloader.searchPackages(query);

    return results.map((pkg) => {
      // pkg.name은 "groupId:artifactId" 형식
      const parts = pkg.name.split(':');
      const groupId = parts[0] || '';
      const artifactId = parts[1] || pkg.name;

      return {
        name: pkg.name,
        version: pkg.version,
        description: `Maven artifact: ${pkg.name}`,
        popularityCount: pkg.metadata?.popularityCount,
        groupId,
        artifactId,
      };
    });
  } catch (error) {
    log.error('Maven search failed:', error);

    // 에러 메시지 사용자에게 전달
    throw new Error(
      error instanceof Error
        ? error.message
        : 'Maven 검색 중 알 수 없는 오류가 발생했습니다.'
    );
  }
}

// maven-metadata.xml에서 버전 목록 조회 (정확한 버전 순서)
async function getMavenVersionsFromMetadata(groupId: string, artifactId: string): Promise<string[]> {
  const groupPath = groupId.replace(/\./g, '/');
  const metadataUrl = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/maven-metadata.xml`;

  const response = await axios.get(metadataUrl, {
    responseType: 'text',
    timeout: 10000,
  });

  const versionRegex = /<version>([^<]+)<\/version>/g;
  const versions: string[] = [];
  let match;

  while ((match = versionRegex.exec(response.data)) !== null) {
    versions.push(match[1]);
  }

  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

// Search API에서 버전 목록 조회 (폴백용)
async function getMavenVersionsFromSearchApi(groupId: string, artifactId: string): Promise<string[]> {
  const response = await axios.get('https://search.maven.org/solrsearch/select', {
    params: {
      q: `g:"${groupId}" AND a:"${artifactId}"`,
      core: 'gav',
      rows: 100,
      wt: 'json',
    },
    timeout: 10000,
  });
  const versions = response.data.response.docs.map((doc: { v: string }) => doc.v);
  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

// Maven 버전 목록 조회 (하이브리드 접근)
async function getMavenVersions(packageName: string): Promise<string[]> {
  const [groupId, artifactId] = packageName.split(':');

  try {
    // 1차: maven-metadata.xml에서 정확한 버전 목록 조회
    return await getMavenVersionsFromMetadata(groupId, artifactId);
  } catch (metadataError) {
    log.warn('maven-metadata.xml 조회 실패, 폴백 API 사용:', metadataError);

    try {
      // 2차: 기존 Search API 폴백
      return await getMavenVersionsFromSearchApi(groupId, artifactId);
    } catch (error) {
      log.error('Maven 버전 목록 조회 실패:', error);
      throw error;
    }
  }
}

/**
 * 검색 관련 IPC 핸들러 등록
 */
export function registerSearchHandlers(): void {
  // 앱 시작 시 백그라운드로 PyPI 패키지 목록 로드
  loadPyPIPackageList();

  // 패키지 검색 핸들러 (실제 API 호출)
  ipcMain.handle('search:packages', async (_, type: string, query: string, options?: { channel?: string; registry?: string; indexUrl?: string }) => {
    log.debug(`Searching ${type} packages: ${query}`, options);

    try {
      let results: Array<{ name: string; version: string; description: string; registry?: string }> = [];

      switch (type) {
        case 'pip':
          results = await searchPyPI(query, options?.indexUrl);
          results = sortByRelevance(results, query, 'pip');
          break;
        case 'conda':
          // conda는 실제 Anaconda API 사용
          const condaDownloader = getCondaDownloader();
          const channel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
          const condaResults = await condaDownloader.searchPackages(query, channel);
          results = condaResults.map(pkg => ({
            name: pkg.name,
            version: pkg.version,
            description: pkg.metadata?.description || '',
          }));
          results = sortByRelevance(results, query, 'conda');
          break;
        case 'maven':
          results = await searchMaven(query);
          results = sortByRelevance(results, query, 'maven');
          break;
        case 'npm':
          const npmDownloader = getNpmDownloader();
          const npmResults = await npmDownloader.searchPackages(query);
          results = npmResults.map(pkg => ({
            name: pkg.name,
            version: pkg.version,
            description: pkg.metadata?.description || '',
          }));
          results = sortByRelevance(results, query, 'npm');
          break;
        case 'docker':
          const dockerDownloader = getDockerDownloader();
          const dockerRegistry = options?.registry || 'docker.io';
          const dockerResults = await dockerDownloader.searchPackages(query, dockerRegistry);
          results = dockerResults.map(pkg => ({
            name: pkg.name,
            version: pkg.version || 'latest',
            description: pkg.metadata?.description || '',
            registry: dockerRegistry,
          }));
          break;
        default:
          // 미구현 타입은 빈 배열 반환
          results = [];
      }

      return { results };
    } catch (error) {
      log.error(`Search error for ${type}:`, error);
      return { results: [] };
    }
  });

  // 패키지 버전 목록 조회 핸들러
  ipcMain.handle('search:versions', async (_, type: string, packageName: string, options?: { channel?: string; registry?: string; indexUrl?: string }) => {
    log.debug(`Getting versions for ${type} package: ${packageName}`, options);

    try {
      let versions: string[] = [];

      switch (type) {
        case 'pip':
          versions = await getPyPIVersions(packageName, options?.indexUrl);
          break;
        case 'conda':
          // conda는 실제 Anaconda API 사용
          const condaDownloaderForVersions = getCondaDownloader();
          const channel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
          versions = await condaDownloaderForVersions.getVersions(packageName, channel);
          break;
        case 'maven':
          versions = await getMavenVersions(packageName);
          break;
        case 'npm':
          const npmDownloaderForVersions = getNpmDownloader();
          versions = await npmDownloaderForVersions.getVersions(packageName);
          break;
        case 'docker':
          const dockerDownloaderForVersions = getDockerDownloader();
          const dockerRegistryForVersions = options?.registry || 'docker.io';
          versions = await dockerDownloaderForVersions.getVersions(packageName, dockerRegistryForVersions);
          break;
        default:
          versions = [];
      }

      return { versions };
    } catch (error) {
      log.error(`Version fetch error for ${type}/${packageName}:`, error);
      return { versions: [] };
    }
  });

  // 패키지 자동완성 제안
  ipcMain.handle('search:suggest', async (_, type: string, query: string, options?: { channel?: string }) => {
    // 빈 쿼리면 빈 배열 반환 (2자 미만)
    if (!query || query.trim().length < 2) {
      return [];
    }

    // 캐시 키 생성 (conda의 경우 채널도 포함)
    const channelKey = type === 'conda' ? `:${options?.channel || 'conda-forge'}` : '';
    const cacheKey = `${type}${channelKey}:${query.toLowerCase()}`;

    // 캐시 확인
    const cached = suggestionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results;
    }

    try {
      const packageType = type as SupportedPackageType;

      // 지원하지 않는 패키지 타입 처리
      if (!downloaderMap[packageType]) {
        log.warn(`Unsupported package type for suggestion: ${type}`);
        return [];
      }

      const getDownloader = downloaderMap[packageType];
      const downloader = getDownloader();

      // 패키지 타입별 검색 Promise 생성
      let searchPromise: Promise<{ name: string }[]>;

      switch (packageType) {
        case 'pip':
          searchPromise = (downloader as PipDownloader).searchPackages(query);
          break;
        case 'conda':
          const condaChannel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
          searchPromise = (downloader as CondaDownloader).searchPackages(query, condaChannel);
          break;
        case 'maven':
          searchPromise = (downloader as MavenDownloader).searchPackages(query);
          break;
        case 'docker':
          searchPromise = (downloader as DockerDownloader).searchPackages(query);
          break;
        case 'npm':
          searchPromise = (downloader as NpmDownloader).searchPackages(query);
          break;
        case 'yum':
        case 'apt':
        case 'apk':
          // OS 패키지는 os:search 핸들러를 사용해야 함
          log.warn(`OS package type ${packageType} does not support suggest`);
          return [];
        default:
          return [];
      }

      // 타임아웃 Promise 생성
      const timeoutPromise = new Promise<{ name: string }[]>((_, reject) => {
        setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT);
      });

      // Promise.race로 검색과 타임아웃 경쟁
      const results = await Promise.race([searchPromise, timeoutPromise]);

      // 패키지명만 추출하여 자동완성 제안 목록 반환
      const suggestions = results
        .map((pkg) => pkg.name)
        .filter((name, index, arr) => arr.indexOf(name) === index) // 중복 제거
        .slice(0, 10); // 최대 10개

      // 결과 캐싱
      suggestionCache.set(cacheKey, { results: suggestions, timestamp: Date.now() });

      return suggestions;
    } catch (error) {
      // 타임아웃 에러 처리
      if (error instanceof Error && error.message === 'Search timeout') {
        log.warn(`Search timeout for ${type}: ${query}`);
        return [];
      }
      log.error(`Package suggestion failed for ${type}:`, error);
      // 에러 발생 시 빈 배열 반환 (UI에서 graceful 처리)
      return [];
    }
  });

  // 의존성 해결 핸들러 (장바구니에서 의존성 트리 미리보기용, 다운로드 페이지 의존성 확인용)
  ipcMain.handle('dependency:resolve', async (event, data: {
    packages: DownloadPackage[];
    options?: {
      targetOS?: string;
      architecture?: string;
      pythonVersion?: string;
      cudaVersion?: string | null;
      // OS 패키지 배포판 설정
      yumDistribution?: { id: string; architecture: string };
      aptDistribution?: { id: string; architecture: string };
      apkDistribution?: { id: string; architecture: string };
      includeRecommends?: boolean;
    };
  }) => {
    const { packages, options } = data;
    log.info(`Resolving dependencies for ${packages.length} packages (targetOS: ${options?.targetOS || 'any'}, python: ${options?.pythonVersion || 'any'}, cuda: ${options?.cudaVersion || 'none'})`);

    // 디버그: OS 패키지 배포판 설정 로그
    const osPackages = packages.filter(p => ['yum', 'apt', 'apk'].includes(p.type));
    if (osPackages.length > 0) {
      log.info('[DEBUG] OS packages distribution settings:', {
        yum: options?.yumDistribution,
        apt: options?.aptDistribution,
        apk: options?.apkDistribution,
      });
    }

    // 디버그: Maven 패키지의 classifier 확인
    const mavenPackages = packages.filter(p => p.type === 'maven');
    if (mavenPackages.length > 0) {
      log.info('[DEBUG] Maven packages with classifiers:', mavenPackages.map(p => ({
        name: p.name,
        version: p.version,
        classifier: p.classifier,
      })));
    }

    try {
      const resolved = await resolveAllDependencies(packages, {
        targetOS: options?.targetOS as 'any' | 'windows' | 'macos' | 'linux' | undefined,
        architecture: options?.architecture,
        pythonVersion: options?.pythonVersion,
        cudaVersion: options?.cudaVersion,
        // OS 패키지 배포판 설정
        yumDistribution: options?.yumDistribution,
        aptDistribution: options?.aptDistribution,
        apkDistribution: options?.apkDistribution,
        includeRecommends: options?.includeRecommends,
        // 진행 상황을 렌더러로 전송
        onProgress: (progress) => {
          event.sender.send('dependency:progress', progress);
        },
      });
      log.info(`Dependencies resolved: ${packages.length} → ${resolved.allPackages.length} packages`);

      return {
        originalPackages: packages,
        allPackages: resolved.allPackages,
        dependencyTrees: resolved.dependencyTrees,
        failedPackages: resolved.failedPackages,
      };
    } catch (error) {
      log.error('Failed to resolve dependencies:', error);
      throw error;
    }
  });

  // OS 패키지 배포판 목록 조회
  ipcMain.handle(
    'os:getDistributions',
    async (_event, osType: OSPackageManager): Promise<OSDistribution[]> => {
      return getDistributionsByPackageManager(osType);
    }
  );

  // 전체 배포판 목록 (인터넷에서 가져오기)
  ipcMain.handle(
    'os:getAllDistributions',
    async (
      _event,
      options?: { source?: 'internet' | 'local'; refresh?: boolean }
    ): Promise<{
      id: string;
      name: string;
      version: string;
      osType: string;
      packageManager: string;
      architectures: string[];
    }[]> => {
      const source = options?.source || 'internet';
      const refresh = options?.refresh || false;

      if (source === 'internet') {
        try {
          if (refresh) {
            invalidateDistributionCache();
          }
          return await getSimplifiedDistributions();
        } catch (error) {
          log.error('Failed to fetch distributions from internet, falling back to local:', error);
          // 폴백: 로컬 데이터
          return OS_DISTRIBUTIONS.map(d => ({
            id: d.id,
            name: d.name,
            version: d.version,
            osType: 'linux',
            packageManager: d.packageManager,
            architectures: d.architectures as string[],
          }));
        }
      } else {
        // 로컬 하드코딩된 목록
        return OS_DISTRIBUTIONS.map(d => ({
          id: d.id,
          name: d.name,
          version: d.version,
          osType: 'linux',
          packageManager: d.packageManager,
          architectures: d.architectures as string[],
        }));
      }
    }
  );

  // 특정 배포판 조회
  ipcMain.handle(
    'os:getDistribution',
    async (_event, distributionId: string): Promise<OSDistribution | undefined> => {
      return getDistributionById(distributionId);
    }
  );

  // OS 패키지 검색
  ipcMain.handle(
    'os:search',
    async (
      _event,
      options: {
        query: string;
        distribution: OSDistribution | { id: string; packageManager: string };
        architecture: OSArchitecture;
        matchType?: MatchType;
        limit?: number;
      }
    ) => {
      const { query, architecture, matchType, limit } = options;

      // distribution.id로 완전한 distribution 정보 가져오기
      const fullDistribution = getDistributionById(options.distribution.id);
      if (!fullDistribution) {
        throw new Error(`Unknown distribution: ${options.distribution.id}`);
      }

      log.info(`OS package search: ${query} on ${fullDistribution.id} (${architecture})`);

      // packageManager에 따라 적절한 resolver 선택
      let searchResults;
      switch (fullDistribution.packageManager) {
        case 'yum':
          const yumResolver = getYumResolver({
            repositories: fullDistribution.defaultRepos,
            architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          });
          searchResults = await yumResolver.searchPackages(query, matchType === 'exact' ? 'exact' : 'partial');
          break;

        case 'apt':
          const aptResolver = getAptResolver({
            repositories: fullDistribution.defaultRepos,
            architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          });
          searchResults = await aptResolver.searchPackages(query, matchType === 'exact' ? 'exact' : 'partial');
          break;

        case 'apk':
          const apkResolver = getApkResolver({
            repositories: fullDistribution.defaultRepos,
            architecture,
            distribution: fullDistribution,
            includeOptional: false,
            includeRecommends: false,
          });
          searchResults = await apkResolver.searchPackages(query, matchType === 'exact' ? 'exact' : 'partial');
          break;

        default:
          throw new Error(`Unsupported package manager: ${fullDistribution.packageManager}`);
      }

      // OSPackageSearchResult[]를 OSPackageInfo[]로 변환 (latest 버전만 사용)
      const packages = searchResults.map(result => result.latest);

      // limit 적용
      const limitedPackages = limit ? packages.slice(0, limit) : packages;

      return {
        packages: limitedPackages,
        totalCount: packages.length,
      };
    }
  );

  // Maven: 네이티브 아티팩트 여부 확인 (Maven Central API 사용)
  ipcMain.handle(
    'maven:isNativeArtifact',
    async (_event, groupId: string, artifactId: string, version?: string): Promise<boolean> => {
      log.info(`Checking if ${groupId}:${artifactId}${version ? '@' + version : ''} is a native artifact via API`);
      return isNativeArtifactFromApi(groupId, artifactId, version);
    }
  );

  // Maven: 사용 가능한 classifier 목록 조회 (Maven Central API 사용)
  ipcMain.handle(
    'maven:getAvailableClassifiers',
    async (_event, groupId: string, artifactId: string, version?: string): Promise<string[]> => {
      log.info(`Getting available classifiers for ${groupId}:${artifactId}${version ? '@' + version : ''} via API`);
      return getAvailableClassifiersAsync(groupId, artifactId, version);
    }
  );

  log.info('검색 핸들러 등록 완료');
}
