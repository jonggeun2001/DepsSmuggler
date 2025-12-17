/**
 * 버전 정보 fetcher
 * Python, Java, Node.js, CUDA 등의 버전 목록을 동적으로 가져옵니다.
 */

import logger from '../../utils/logger';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import axios from 'axios';

/**
 * Python 릴리스 정보
 */
interface PythonRelease {
  version: string;
  releaseDate: string;
  isPrerelease: boolean;
  isEol: boolean; // End of Life
}

// 메모리 캐시
let cachedVersions: string[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

// 로컬 스토리지 캐시 키
const STORAGE_KEY = 'python_versions_cache';
const STORAGE_TIMESTAMP_KEY = 'python_versions_cache_timestamp';

/**
 * Python 공식 버전 목록 가져오기
 * 데이터 소스: https://www.python.org/api/v2/downloads/release/
 * 또는 PyPI JSON API: https://pypi.org/pypi/python/json (fallback)
 */
export async function fetchPythonVersions(): Promise<string[]> {
  // 메모리 캐시 확인
  if (cachedVersions && Date.now() - cacheTimestamp < CACHE_TTL) {
    logger.debug('Python 버전 메모리 캐시 사용');
    return cachedVersions;
  }

  // 로컬 스토리지 캐시 확인
  const cachedData = loadCachedVersions();
  if (cachedData) {
    cachedVersions = cachedData;
    cacheTimestamp = Date.now();
    logger.debug('Python 버전 로컬 스토리지 캐시 사용');
    return cachedData;
  }

  try {
    // python.org API 호출
    logger.info('Python 버전 API 호출 시작');
    const response = await fetch('https://www.python.org/api/v2/downloads/release/', {
      timeout: 10000,
    } as RequestInit);

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }

    const releases = (await response.json()) as PythonRelease[];

    // 필터링: 3.9 이상, EOL 제외, 정식 릴리스만
    const versions = releases
      .filter((r) => !r.isPrerelease && !r.isEol)
      .map((r) => r.version)
      .filter((v) => {
        const match = v.match(/^(\d+)\.(\d+)/);
        if (!match) return false;
        const [, major, minor] = match;
        return Number(major) === 3 && Number(minor) >= 9;
      })
      .sort((a, b) => {
        // 버전 번호로 내림차순 정렬
        const [aMajor, aMinor] = a.split('.').map(Number);
        const [bMajor, bMinor] = b.split('.').map(Number);
        if (aMajor !== bMajor) return bMajor - aMajor;
        return bMinor - aMinor;
      });

    // 캐시 업데이트
    cachedVersions = versions;
    cacheTimestamp = Date.now();
    saveCachedVersions(versions);

    logger.info(`Python 버전 ${versions.length}개 로드 완료`);
    return versions;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Python 버전 가져오기 실패', { error: errorMsg });

    // 폴백: 로컬 스토리지에서 만료된 캐시라도 사용
    const expiredCache = loadCachedVersions(true);
    if (expiredCache && expiredCache.length > 0) {
      logger.warn('만료된 캐시 사용');
      return expiredCache;
    }

    // 최종 폴백: 하드코딩 목록
    logger.warn('하드코딩된 폴백 목록 사용');
    return ['3.13', '3.12', '3.11', '3.10', '3.9'];
  }
}

/**
 * 로컬 스토리지에서 캐시된 버전 로드
 * @param ignoreExpiry 만료 여부 무시 (true면 만료되어도 반환)
 */
function loadCachedVersions(ignoreExpiry = false): string[] | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const cached = localStorage.getItem(STORAGE_KEY);
    const timestamp = localStorage.getItem(STORAGE_TIMESTAMP_KEY);

    if (cached && timestamp) {
      const age = Date.now() - Number(timestamp);
      if (ignoreExpiry || age < CACHE_TTL) {
        return JSON.parse(cached);
      }
    }
  } catch (error) {
    logger.error('캐시 로드 실패', { error });
  }
  return null;
}

/**
 * 로컬 스토리지에 버전 캐싱
 */
function saveCachedVersions(versions: string[]): void {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
    localStorage.setItem(STORAGE_TIMESTAMP_KEY, String(Date.now()));
    logger.debug('Python 버전 로컬 스토리지에 저장 완료');
  } catch (error) {
    logger.error('캐시 저장 실패', { error });
  }
}

// ========================================
// Java 버전 관리
// ========================================

/**
 * Java 릴리스 정보
 */
export interface JavaRelease {
  version: string;
  lts: boolean;
}

/**
 * Adoptium API 응답
 */
interface AdoptiumResponse {
  available_releases: number[];
  available_lts_releases: number[];
  most_recent_feature_release: number;
  most_recent_lts: number;
}

// 메모리 캐시
let cachedJavaVersions: JavaRelease[] | null = null;
let javaCacheTimestamp: number = 0;
const JAVA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

/**
 * Adoptium API에서 Java 버전 목록 가져오기
 * @deprecated Java 버전은 더 이상 설정에서 사용되지 않음 (Maven JAR 파일은 JVM 버전과 무관하게 동일 파일 다운로드)
 */
export async function fetchJavaVersions(): Promise<JavaRelease[]> {
  // 메모리 캐시 확인
  if (cachedJavaVersions && Date.now() - javaCacheTimestamp < JAVA_CACHE_TTL) {
    logger.debug('Java 버전 메모리 캐시 사용');
    return cachedJavaVersions;
  }

  // 파일 캐시 확인
  const cached = await loadCachedJavaVersions();
  if (cached) {
    cachedJavaVersions = cached;
    javaCacheTimestamp = Date.now();
    logger.debug('Java 버전 파일 캐시 사용');
    return cached;
  }

  try {
    logger.info('Java 버전 API 호출 시작');
    const response = await fetch('https://api.adoptium.net/v3/info/available_releases', {
      timeout: 10000,
    } as RequestInit);

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }

    const data = (await response.json()) as AdoptiumResponse;
    const { available_releases, available_lts_releases } = data;

    // 모든 버전을 JavaRelease 객체로 변환
    const allVersions: JavaRelease[] = available_releases
      .map((version) => ({
        version: String(version),
        lts: available_lts_releases.includes(version),
      }))
      .sort((a, b) => Number(b.version) - Number(a.version)); // 내림차순 정렬

    // LTS 버전 우선 + 최근 3개 non-LTS 포함
    const ltsVersions = allVersions.filter((v) => v.lts);
    const nonLtsVersions = allVersions.filter((v) => !v.lts).slice(0, 3); // 최근 3개만

    const filteredVersions = [...ltsVersions, ...nonLtsVersions].sort(
      (a, b) => Number(b.version) - Number(a.version)
    );

    // 캐시 저장
    cachedJavaVersions = filteredVersions;
    javaCacheTimestamp = Date.now();
    await saveCachedJavaVersions(filteredVersions);

    logger.info(`Java 버전 ${filteredVersions.length}개 로드 완료`);
    return filteredVersions;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Java 버전 가져오기 실패', { error: errorMsg });

    // 폴백: 파일 캐시에서 만료된 캐시라도 사용
    const expiredCache = await loadCachedJavaVersions(true);
    if (expiredCache && expiredCache.length > 0) {
      logger.warn('만료된 캐시 사용');
      return expiredCache;
    }

    // 최종 폴백: 하드코딩된 LTS 버전
    logger.warn('하드코딩된 폴백 목록 사용');
    return [
      { version: '21', lts: true },
      { version: '17', lts: true },
      { version: '11', lts: true },
      { version: '8', lts: true },
    ];
  }
}

/**
 * 캐시 디렉토리 경로 가져오기
 */
function getCacheDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.depssmuggler', 'cache');
}

/**
 * 파일에서 캐시된 Java 버전 로드
 */
async function loadCachedJavaVersions(ignoreExpiry = false): Promise<JavaRelease[] | null> {
  try {
    const cachePath = path.join(getCacheDir(), 'java-versions.json');
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const data = await fs.promises.readFile(cachePath, 'utf-8');
    const { versions, timestamp } = JSON.parse(data);

    // TTL 확인
    if (!ignoreExpiry && Date.now() - timestamp > JAVA_CACHE_TTL) {
      return null;
    }

    return versions;
  } catch (error) {
    logger.error('Java 버전 캐시 로드 실패', { error });
    return null;
  }
}

/**
 * 파일에 Java 버전 캐시 저장
 */
async function saveCachedJavaVersions(versions: JavaRelease[]): Promise<void> {
  try {
    const cachePath = path.join(getCacheDir(), 'java-versions.json');
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    }

    await fs.promises.writeFile(
      cachePath,
      JSON.stringify({ versions, timestamp: Date.now() }, null, 2)
    );
    logger.debug('Java 버전 파일에 저장 완료');
  } catch (error) {
    logger.error('Java 버전 캐시 저장 실패', { error });
  }
}

// ========================================
// Node.js 버전 관리
// ========================================

/**
 * Node.js 릴리스 정보
 */
export interface NodeRelease {
  version: string; // "v20.11.0"
  lts: string | false; // "Iron" or false
}

/**
 * Node.js API 응답
 */
interface NodeApiResponse {
  version: string;
  date: string;
  lts: string | false;
  security: boolean;
}

// 메모리 캐시
let cachedNodeVersions: NodeRelease[] | null = null;
let nodeCacheTimestamp: number = 0;
const NODE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간

/**
 * Node.js 버전 목록 가져오기
 * LTS 버전 + 현재 버전(Current)만 반환
 * @deprecated Node.js 버전은 더 이상 설정에서 사용되지 않음 (npm tarball은 Node.js 버전과 무관하게 동일 파일 다운로드)
 */
export async function fetchNodeVersions(): Promise<NodeRelease[]> {
  // 메모리 캐시 확인
  if (cachedNodeVersions && Date.now() - nodeCacheTimestamp < NODE_CACHE_TTL) {
    logger.debug('Node.js 버전 메모리 캐시 사용');
    return cachedNodeVersions;
  }

  // 파일 캐시 확인
  const cached = await loadCachedNodeVersions();
  if (cached) {
    cachedNodeVersions = cached;
    nodeCacheTimestamp = Date.now();
    logger.debug('Node.js 버전 파일 캐시 사용');
    return cached;
  }

  try {
    logger.info('Node.js 버전 API 호출 시작');
    const response = await fetch('https://nodejs.org/dist/index.json', {
      timeout: 10000,
    } as RequestInit);

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }

    const releases = (await response.json()) as NodeApiResponse[];

    // 현재 버전 (첫 번째 = 최신)
    const currentVersion = releases[0];

    // LTS 버전 필터링
    const ltsVersions = releases.filter((r) => r.lts !== false);

    // 중복 제거 및 major 버전만 추출
    const versionMap = new Map<string, NodeRelease>();

    // 현재 버전 추가
    if (currentVersion) {
      const major = currentVersion.version.replace(/^v(\d+)\..*/, '$1');
      versionMap.set(major, {
        version: major,
        lts: currentVersion.lts,
      });
    }

    // LTS 버전 추가 (major 버전 중복 제거)
    ltsVersions.forEach((r) => {
      const major = r.version.replace(/^v(\d+)\..*/, '$1');
      if (!versionMap.has(major)) {
        versionMap.set(major, {
          version: major,
          lts: r.lts,
        });
      }
    });

    const result = Array.from(versionMap.values()).sort(
      (a, b) => Number(b.version) - Number(a.version)
    );

    // 캐시 저장
    cachedNodeVersions = result;
    nodeCacheTimestamp = Date.now();
    await saveCachedNodeVersions(result);

    logger.info(`Node.js 버전 ${result.length}개 로드 완료`);
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Node.js 버전 가져오기 실패', { error: errorMsg });

    // 폴백: 파일 캐시에서 만료된 캐시라도 사용
    const expiredCache = await loadCachedNodeVersions(true);
    if (expiredCache && expiredCache.length > 0) {
      logger.warn('만료된 캐시 사용');
      return expiredCache;
    }

    // 최종 폴백: 하드코딩된 버전
    logger.warn('하드코딩된 폴백 목록 사용');
    return [
      { version: '22', lts: false },
      { version: '20', lts: 'Iron' },
      { version: '18', lts: 'Hydrogen' },
    ];
  }
}

/**
 * 파일에서 캐시된 Node.js 버전 로드
 */
async function loadCachedNodeVersions(ignoreExpiry = false): Promise<NodeRelease[] | null> {
  try {
    const cachePath = path.join(getCacheDir(), 'node-versions.json');
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const data = await fs.promises.readFile(cachePath, 'utf-8');
    const { versions, timestamp } = JSON.parse(data);

    // TTL 확인
    if (!ignoreExpiry && Date.now() - timestamp > NODE_CACHE_TTL) {
      return null;
    }

    return versions;
  } catch (error) {
    logger.error('Node.js 버전 캐시 로드 실패', { error });
    return null;
  }
}

/**
 * 파일에 Node.js 버전 캐시 저장
 */
async function saveCachedNodeVersions(versions: NodeRelease[]): Promise<void> {
  try {
    const cachePath = path.join(getCacheDir(), 'node-versions.json');
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    }

    await fs.promises.writeFile(
      cachePath,
      JSON.stringify({ versions, timestamp: Date.now() }, null, 2)
    );
    logger.debug('Node.js 버전 파일에 저장 완료');
  } catch (error) {
    logger.error('Node.js 버전 캐시 저장 실패', { error });
  }
}

// ========================================
// CUDA 버전 관리
// ========================================

// 메모리 캐시
let cachedCudaVersions: string[] | null = null;
let cudaCacheTimestamp: number = 0;
const CUDA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일 (CUDA 릴리스 빈도 낮음)

/**
 * conda-forge repodata에서 __cuda 패키지 버전 추출
 */
async function fetchCudaVersionsFromConda(): Promise<string[]> {
  try {
    logger.debug('conda-forge에서 CUDA 버전 가져오기 시도');
    const response = await axios.get(
      'https://conda.anaconda.org/conda-forge/linux-64/repodata.json',
      { timeout: 30000 }
    );

    const packages = response.data.packages || {};
    const condaPackages = response.data['packages.conda'] || {};
    const allPackages = { ...packages, ...condaPackages };

    // __cuda 패키지 찾기
    const cudaVersions = new Set<string>();

    for (const [, pkg] of Object.entries<{ name?: string; version?: string }>(allPackages)) {
      if (pkg.name === '__cuda' && pkg.version) {
        // "11.8.0" -> "11.8", "12.1.0" -> "12.1"
        const match = pkg.version.match(/^(\d+\.\d+)/);
        if (match) {
          cudaVersions.add(match[1]);
        }
      }
    }

    // 버전 정렬 (내림차순)
    const sorted = Array.from(cudaVersions).sort((a, b) => {
      const [aMajor, aMinor] = a.split('.').map(Number);
      const [bMajor, bMinor] = b.split('.').map(Number);
      if (aMajor !== bMajor) return bMajor - aMajor;
      return bMinor - aMinor;
    });

    logger.info(`conda-forge에서 CUDA 버전 ${sorted.length}개 추출 완료`);
    return sorted;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('conda-forge에서 CUDA 버전 가져오기 실패', { error: errorMsg });
    throw error;
  }
}

/**
 * CUDA 버전 목록 가져오기
 */
export async function fetchCudaVersions(): Promise<string[]> {
  // 메모리 캐시 확인
  if (cachedCudaVersions && Date.now() - cudaCacheTimestamp < CUDA_CACHE_TTL) {
    logger.debug('CUDA 버전 메모리 캐시 사용');
    return cachedCudaVersions;
  }

  // 파일 캐시 확인
  const cached = await loadCachedCudaVersions();
  if (cached) {
    cachedCudaVersions = cached;
    cudaCacheTimestamp = Date.now();
    logger.debug('CUDA 버전 파일 캐시 사용');
    return cached;
  }

  try {
    logger.info('CUDA 버전 API 호출 시작');
    const versions = await fetchCudaVersionsFromConda();

    // 캐시 저장
    cachedCudaVersions = versions;
    cudaCacheTimestamp = Date.now();
    await saveCachedCudaVersions(versions);

    logger.info(`CUDA 버전 ${versions.length}개 로드 완료`);
    return versions;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('CUDA 버전 가져오기 실패', { error: errorMsg });

    // 폴백: 파일 캐시에서 만료된 캐시라도 사용
    const expiredCache = await loadCachedCudaVersions(true);
    if (expiredCache && expiredCache.length > 0) {
      logger.warn('만료된 캐시 사용');
      return expiredCache;
    }

    // 최종 폴백: 하드코딩된 버전
    logger.warn('하드코딩된 폴백 목록 사용');
    return ['12.6', '12.5', '12.4', '12.1', '12.0', '11.8'];
  }
}

/**
 * 파일에서 캐시된 CUDA 버전 로드
 */
async function loadCachedCudaVersions(ignoreExpiry = false): Promise<string[] | null> {
  try {
    const cachePath = path.join(getCacheDir(), 'cuda-versions.json');
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const data = await fs.promises.readFile(cachePath, 'utf-8');
    const { versions, timestamp } = JSON.parse(data);

    // TTL 확인
    if (!ignoreExpiry && Date.now() - timestamp > CUDA_CACHE_TTL) {
      return null;
    }

    return versions;
  } catch (error) {
    logger.error('CUDA 버전 캐시 로드 실패', { error });
    return null;
  }
}

/**
 * 파일에 CUDA 버전 캐시 저장
 */
async function saveCachedCudaVersions(versions: string[]): Promise<void> {
  try {
    const cachePath = path.join(getCacheDir(), 'cuda-versions.json');
    const cacheDir = path.dirname(cachePath);

    if (!fs.existsSync(cacheDir)) {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    }

    await fs.promises.writeFile(
      cachePath,
      JSON.stringify({ versions, timestamp: Date.now() }, null, 2)
    );
    logger.debug('CUDA 버전 파일에 저장 완료');
  } catch (error) {
    logger.error('CUDA 버전 캐시 저장 실패', { error });
  }
}
