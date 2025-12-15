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
  getNpmDownloader,
  PipDownloader,
  MavenDownloader,
  CondaDownloader,
  DockerDownloader,
  YumDownloader,
  NpmDownloader,
} from '../src/core';

const log = createScopedLogger('Search');

// 다운로더 타입 매핑
const downloaderMap = {
  pip: getPipDownloader,
  conda: getCondaDownloader,
  maven: getMavenDownloader,
  docker: getDockerDownloader,
  yum: getYumDownloader,
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
async function searchPyPI(query: string) {
  const results: Array<{ name: string; version: string; description: string }> = [];
  const lowerQuery = query.toLowerCase();

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
async function getPyPIVersions(packageName: string): Promise<string[]> {
  const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`, { timeout: 10000 });
  const versions = Object.keys(response.data.releases);
  return versions.sort((a, b) => compareVersions(b, a));
}

// Maven 패키지 검색
async function searchMaven(query: string) {
  try {
    const response = await axios.get('https://search.maven.org/solrsearch/select', {
      params: { q: query, rows: 20, wt: 'json' },
      timeout: 10000,
    });
    return response.data.response.docs.map((doc: { g: string; a: string; latestVersion: string }) => ({
      name: `${doc.g}:${doc.a}`,
      version: doc.latestVersion,
      description: `Maven artifact: ${doc.g}:${doc.a}`,
    }));
  } catch {
    return [];
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
  ipcMain.handle('search:packages', async (_, type: string, query: string, options?: { channel?: string; registry?: string }) => {
    log.debug(`Searching ${type} packages: ${query}`, options);

    try {
      let results: Array<{ name: string; version: string; description: string; registry?: string }> = [];

      switch (type) {
        case 'pip':
          results = await searchPyPI(query);
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
  ipcMain.handle('search:versions', async (_, type: string, packageName: string, options?: { channel?: string; registry?: string }) => {
    log.debug(`Getting versions for ${type} package: ${packageName}`, options);

    try {
      let versions: string[] = [];

      switch (type) {
        case 'pip':
          versions = await getPyPIVersions(packageName);
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
          searchPromise = (downloader as YumDownloader).searchPackages(query);
          break;
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
    };
  }) => {
    const { packages, options } = data;
    log.info(`Resolving dependencies for ${packages.length} packages (targetOS: ${options?.targetOS || 'any'}, python: ${options?.pythonVersion || 'any'})`);

    try {
      const resolved = await resolveAllDependencies(packages, {
        targetOS: options?.targetOS as 'any' | 'windows' | 'macos' | 'linux' | undefined,
        architecture: options?.architecture,
        pythonVersion: options?.pythonVersion,
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

  log.info('검색 핸들러 등록 완료');
}
