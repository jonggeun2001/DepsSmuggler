/**
 * Maven POM 공유 캐시
 * MavenResolver와 MavenDownloader가 공유하여 중복 API 호출 방지
 * 메모리 캐시 + 디스크 캐시 지원
 */

import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { XMLParser } from 'fast-xml-parser';
import logger from '../../utils/logger';
import { PomProject, PomCacheEntry, MavenCoordinate, coordinateToString } from './maven-types';

/** 기본 메모리 TTL: 5분 */
const DEFAULT_MEMORY_TTL = 5 * 60 * 1000;

/** 기본 디스크 TTL: 24시간 */
const DEFAULT_DISK_TTL = 24 * 60 * 60 * 1000;

/** 기본 레포지토리 URL */
const DEFAULT_REPO_URL = 'https://repo1.maven.org/maven2';

/** 기본 캐시 디렉토리 */
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.depssmuggler', 'cache', 'maven');

/** 병렬 조회 배치 크기 */
const DEFAULT_BATCH_SIZE = 5;

/**
 * 모듈 레벨 공유 메모리 캐시
 */
const memoryCache: Map<string, PomCacheEntry> = new Map();

/**
 * 진행 중인 요청 추적 (중복 요청 방지)
 */
const pendingRequests: Map<string, Promise<PomProject>> = new Map();

/**
 * XML 파서 (싱글톤)
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
});

/**
 * Axios 클라이언트 (싱글톤)
 */
let sharedClient: AxiosInstance | null = null;

function getClient(repoUrl: string = DEFAULT_REPO_URL): AxiosInstance {
  if (!sharedClient || sharedClient.defaults.baseURL !== repoUrl) {
    sharedClient = axios.create({
      baseURL: repoUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/xml',
      },
    });
  }
  return sharedClient;
}

/**
 * 캐시 옵션
 */
export interface MavenCacheOptions {
  /** 레포지토리 URL */
  repoUrl?: string;
  /** 메모리 TTL (ms) */
  memoryTtl?: number;
  /** 디스크 TTL (ms) */
  diskTtl?: number;
  /** 강제 새로고침 */
  forceRefresh?: boolean;
  /** 디스크 캐시 사용 여부 */
  useDiskCache?: boolean;
  /** 캐시 디렉토리 */
  cacheDir?: string;
}

/**
 * 캐시 결과
 */
export interface MavenCacheResult {
  pom: PomProject;
  fromCache: 'memory' | 'disk' | 'network';
}

/**
 * 디스크 캐시 메타데이터
 */
interface DiskCacheMetadata {
  fetchedAt: number;
  effectiveGroupId: string;
  effectiveVersion: string;
}

/**
 * 디스크 캐시 경로 생성
 */
function getDiskCachePath(
  coordinate: MavenCoordinate,
  cacheDir: string = DEFAULT_CACHE_DIR
): { pomPath: string; metaPath: string } {
  const { groupId, artifactId, version } = coordinate;
  const groupPath = groupId.replace(/\./g, '/');
  const basePath = path.join(cacheDir, groupPath, artifactId, version);
  return {
    pomPath: path.join(basePath, `${artifactId}-${version}.pom`),
    metaPath: path.join(basePath, 'cache-meta.json'),
  };
}

/**
 * 디스크 캐시에서 읽기
 */
async function readFromDiskCache(
  coordinate: MavenCoordinate,
  options: MavenCacheOptions = {}
): Promise<PomCacheEntry | null> {
  const { diskTtl = DEFAULT_DISK_TTL, cacheDir = DEFAULT_CACHE_DIR } = options;

  try {
    const { pomPath, metaPath } = getDiskCachePath(coordinate, cacheDir);

    if (!(await fs.pathExists(pomPath)) || !(await fs.pathExists(metaPath))) {
      return null;
    }

    const metaContent = await fs.readFile(metaPath, 'utf-8');
    const meta: DiskCacheMetadata = JSON.parse(metaContent);

    // TTL 확인
    if (Date.now() - meta.fetchedAt >= diskTtl) {
      logger.debug('Maven 디스크 캐시 만료', { coordinate: coordinateToString(coordinate) });
      return null;
    }

    const pomContent = await fs.readFile(pomPath, 'utf-8');
    const parsed = parser.parse(pomContent);
    const pom = parsed.project as PomProject;

    return {
      pom,
      fetchedAt: meta.fetchedAt,
      effectiveGroupId: meta.effectiveGroupId,
      effectiveVersion: meta.effectiveVersion,
    };
  } catch (error) {
    logger.debug('Maven 디스크 캐시 읽기 실패', {
      coordinate: coordinateToString(coordinate),
      error,
    });
    return null;
  }
}

/**
 * 디스크 캐시에 저장
 */
async function writeToDiskCache(
  coordinate: MavenCoordinate,
  pomContent: string,
  entry: PomCacheEntry,
  cacheDir: string = DEFAULT_CACHE_DIR
): Promise<void> {
  try {
    const { pomPath, metaPath } = getDiskCachePath(coordinate, cacheDir);

    await fs.ensureDir(path.dirname(pomPath));
    await fs.writeFile(pomPath, pomContent, 'utf-8');

    const meta: DiskCacheMetadata = {
      fetchedAt: entry.fetchedAt,
      effectiveGroupId: entry.effectiveGroupId,
      effectiveVersion: entry.effectiveVersion,
    };
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    logger.debug('Maven 디스크 캐시 저장', { coordinate: coordinateToString(coordinate) });
  } catch (error) {
    logger.warn('Maven 디스크 캐시 저장 실패', {
      coordinate: coordinateToString(coordinate),
      error,
    });
  }
}

/**
 * POM 가져오기 (공유 캐시 사용)
 */
export async function fetchPom(
  coordinate: MavenCoordinate,
  options: MavenCacheOptions = {}
): Promise<PomProject> {
  const {
    repoUrl = DEFAULT_REPO_URL,
    memoryTtl = DEFAULT_MEMORY_TTL,
    diskTtl = DEFAULT_DISK_TTL,
    forceRefresh = false,
    useDiskCache = true,
    cacheDir = DEFAULT_CACHE_DIR,
  } = options;

  const cacheKey = `${repoUrl}:${coordinateToString(coordinate)}`;
  const now = Date.now();

  // 1. 메모리 캐시 확인
  if (!forceRefresh) {
    const cached = memoryCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < memoryTtl) {
      logger.debug('Maven 메모리 캐시 히트', { coordinate: coordinateToString(coordinate) });
      return cached.pom;
    }
  }

  // 2. 진행 중인 동일 요청 대기
  const pending = pendingRequests.get(cacheKey);
  if (pending) {
    logger.debug('Maven 중복 요청 대기', { coordinate: coordinateToString(coordinate) });
    return pending;
  }

  // 3. 디스크 캐시 확인
  if (!forceRefresh && useDiskCache) {
    const diskCached = await readFromDiskCache(coordinate, { diskTtl, cacheDir });
    if (diskCached) {
      logger.debug('Maven 디스크 캐시 히트', { coordinate: coordinateToString(coordinate) });
      // 메모리 캐시에도 저장
      memoryCache.set(cacheKey, diskCached);
      return diskCached.pom;
    }
  }

  // 4. API 요청
  const requestPromise = (async (): Promise<PomProject> => {
    try {
      const { groupId, artifactId, version } = coordinate;
      const groupPath = groupId.replace(/\./g, '/');
      const url = `/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`;
      const client = getClient(repoUrl);

      logger.debug('Maven API 요청', { coordinate: coordinateToString(coordinate) });

      const response = await client.get<string>(url, { responseType: 'text' });
      const pomContent = response.data;
      const parsed = parser.parse(pomContent);
      const pom = parsed.project as PomProject;

      const entry: PomCacheEntry = {
        pom,
        fetchedAt: Date.now(),
        effectiveGroupId: pom.groupId || coordinate.groupId,
        effectiveVersion: pom.version || coordinate.version,
      };

      // 메모리 캐시 저장
      memoryCache.set(cacheKey, entry);

      // 디스크 캐시 저장
      if (useDiskCache) {
        writeToDiskCache(coordinate, pomContent, entry, cacheDir).catch(() => {
          // 디스크 캐시 저장 실패는 무시
        });
      }

      logger.debug('Maven POM 조회 완료', {
        coordinate: coordinateToString(coordinate),
        dependencies: Array.isArray(pom.dependencies?.dependency)
          ? pom.dependencies.dependency.length
          : pom.dependencies?.dependency
            ? 1
            : 0,
      });

      return pom;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(`POM not found: ${coordinateToString(coordinate)}`);
      }
      throw error;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

/**
 * 캐시 결과와 함께 POM 가져오기
 */
export async function fetchPomWithCacheInfo(
  coordinate: MavenCoordinate,
  options: MavenCacheOptions = {}
): Promise<MavenCacheResult> {
  const {
    repoUrl = DEFAULT_REPO_URL,
    memoryTtl = DEFAULT_MEMORY_TTL,
    diskTtl = DEFAULT_DISK_TTL,
    forceRefresh = false,
    useDiskCache = true,
    cacheDir = DEFAULT_CACHE_DIR,
  } = options;

  const cacheKey = `${repoUrl}:${coordinateToString(coordinate)}`;
  const now = Date.now();

  // 메모리 캐시 확인
  if (!forceRefresh) {
    const cached = memoryCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < memoryTtl) {
      return { pom: cached.pom, fromCache: 'memory' };
    }
  }

  // 디스크 캐시 확인
  if (!forceRefresh && useDiskCache) {
    const diskCached = await readFromDiskCache(coordinate, { diskTtl, cacheDir });
    if (diskCached) {
      memoryCache.set(cacheKey, diskCached);
      return { pom: diskCached.pom, fromCache: 'disk' };
    }
  }

  const pom = await fetchPom(coordinate, options);
  return { pom, fromCache: 'network' };
}

/**
 * 여러 POM 병렬 조회
 */
export async function fetchPomsParallel(
  coordinates: MavenCoordinate[],
  options: MavenCacheOptions & { batchSize?: number } = {}
): Promise<Map<string, PomProject>> {
  const { batchSize = DEFAULT_BATCH_SIZE, ...cacheOptions } = options;
  const results = new Map<string, PomProject>();

  // 배치 단위로 병렬 실행
  for (let i = 0; i < coordinates.length; i += batchSize) {
    const batch = coordinates.slice(i, i + batchSize);
    const promises = batch.map(async (coord) => {
      try {
        const pom = await fetchPom(coord, cacheOptions);
        return { coord, pom };
      } catch (error) {
        logger.debug('POM 조회 실패 (병렬)', { coordinate: coordinateToString(coord), error });
        return { coord, pom: null };
      }
    });

    const batchResults = await Promise.all(promises);
    for (const { coord, pom } of batchResults) {
      if (pom) {
        results.set(coordinateToString(coord), pom);
      }
    }
  }

  return results;
}

/**
 * 여러 POM 프리페치 (백그라운드, 병렬)
 */
export function prefetchPomsParallel(
  coordinates: MavenCoordinate[],
  options: MavenCacheOptions & { batchSize?: number } = {}
): void {
  const { batchSize = DEFAULT_BATCH_SIZE, repoUrl = DEFAULT_REPO_URL } = options;

  // 이미 캐시되었거나 진행 중인 것 제외
  const toFetch = coordinates.filter((coord) => {
    const cacheKey = `${repoUrl}:${coordinateToString(coord)}`;
    return !memoryCache.has(cacheKey) && !pendingRequests.has(cacheKey);
  });

  if (toFetch.length === 0) {
    return;
  }

  logger.debug('Maven POM 병렬 프리페치 시작', { count: toFetch.length, batchSize });

  // 백그라운드에서 병렬 조회
  fetchPomsParallel(toFetch, options).catch((err) => {
    logger.debug('Maven POM 프리페치 실패', { error: err });
  });
}

/**
 * 메모리 캐시 초기화
 */
export function clearMemoryCache(): void {
  const size = memoryCache.size;
  memoryCache.clear();
  pendingRequests.clear();
  logger.info('Maven 메모리 캐시 초기화', { clearedEntries: size });
}

/**
 * 디스크 캐시 초기화
 */
export async function clearDiskCache(cacheDir: string = DEFAULT_CACHE_DIR): Promise<void> {
  try {
    if (await fs.pathExists(cacheDir)) {
      await fs.remove(cacheDir);
      logger.info('Maven 디스크 캐시 초기화', { cacheDir });
    }
  } catch (error) {
    logger.error('Maven 디스크 캐시 초기화 실패', { cacheDir, error });
    throw error;
  }
}

/**
 * 특정 패키지 캐시 무효화
 */
export function invalidatePom(
  coordinate: MavenCoordinate,
  repoUrl: string = DEFAULT_REPO_URL
): void {
  const cacheKey = `${repoUrl}:${coordinateToString(coordinate)}`;
  memoryCache.delete(cacheKey);
}

/**
 * 캐시 통계
 */
export interface MavenCacheStats {
  memoryEntries: number;
  pendingRequests: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

export function getMavenCacheStats(): MavenCacheStats {
  let oldest: number | null = null;
  let newest: number | null = null;

  memoryCache.forEach((entry) => {
    if (oldest === null || entry.fetchedAt < oldest) {
      oldest = entry.fetchedAt;
    }
    if (newest === null || entry.fetchedAt > newest) {
      newest = entry.fetchedAt;
    }
  });

  return {
    memoryEntries: memoryCache.size,
    pendingRequests: pendingRequests.size,
    oldestEntry: oldest,
    newestEntry: newest,
  };
}

/**
 * 만료된 메모리 캐시 정리
 */
export function pruneExpiredMemoryCache(ttl: number = DEFAULT_MEMORY_TTL): number {
  const now = Date.now();
  let pruned = 0;

  memoryCache.forEach((entry, key) => {
    if (now - entry.fetchedAt >= ttl) {
      memoryCache.delete(key);
      pruned++;
    }
  });

  if (pruned > 0) {
    logger.info('Maven 만료된 캐시 정리', { pruned });
  }

  return pruned;
}

/**
 * 캐시에서 직접 조회 (API 호출 없음)
 */
export function getPomFromCache(
  coordinate: MavenCoordinate,
  repoUrl: string = DEFAULT_REPO_URL
): PomProject | null {
  const cacheKey = `${repoUrl}:${coordinateToString(coordinate)}`;
  const cached = memoryCache.get(cacheKey);
  return cached?.pom ?? null;
}

/**
 * 캐시 유효성 확인
 */
export function isPomCached(
  coordinate: MavenCoordinate,
  repoUrl: string = DEFAULT_REPO_URL,
  ttl: number = DEFAULT_MEMORY_TTL
): boolean {
  const cacheKey = `${repoUrl}:${coordinateToString(coordinate)}`;
  const cached = memoryCache.get(cacheKey);
  if (!cached) return false;
  return Date.now() - cached.fetchedAt < ttl;
}
