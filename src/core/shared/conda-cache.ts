/**
 * Conda Repodata 캐시 관리
 * HTTP 조건부 요청 (RFC 7232) 및 파일 시스템 캐시 지원
 * 디스크 캐시만 사용 (repodata.json이 350MB+ 크기이므로 메모리 캐시 제외)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios, { AxiosResponse } from 'axios';
import * as fzstd from 'fzstd';
import logger from '../../utils/logger';
import { RepoData } from './conda-types';

/** DepsSmuggler용 기본 TTL: 24시간 (폐쇄망 전달 목적이므로 길게 설정) */
const DEFAULT_MAX_AGE = 86400; // 24시간

/**
 * 캐시 메타데이터
 */
export interface RepodataCacheMeta {
  /** 원본 URL */
  url: string;
  /** HTTP ETag */
  etag?: string;
  /** HTTP Last-Modified */
  lastModified?: string;
  /** Cache-Control max-age (초) */
  maxAge: number;
  /** 캐시 저장 시간 (Unix timestamp ms) */
  cachedAt: number;
  /** 파일 크기 (바이트) */
  fileSize: number;
  /** 패키지 수 */
  packageCount: number;
  /** zstd 압축 여부 */
  compressed: boolean;
}

/**
 * 캐시 가져오기 결과
 */
export interface CacheResult {
  /** 데이터 */
  data: RepoData;
  /** 캐시에서 가져왔는지 */
  fromCache: boolean;
  /** 캐시 메타데이터 */
  meta: RepodataCacheMeta;
}

/**
 * 기본 캐시 디렉토리
 */
function getDefaultCacheDir(): string {
  return path.join(os.homedir(), '.depssmuggler', 'cache', 'conda');
}

/**
 * 채널/subdir에서 캐시 파일 경로 생성
 */
function getCachePaths(cacheDir: string, channel: string, subdir: string): {
  dataPath: string;
  metaPath: string;
} {
  const channelDir = path.join(cacheDir, channel, subdir);
  return {
    dataPath: path.join(channelDir, 'repodata.json'),
    metaPath: path.join(channelDir, 'repodata.meta.json'),
  };
}

/**
 * 캐시 메타데이터 읽기
 */
function readCacheMeta(metaPath: string): RepodataCacheMeta | null {
  try {
    if (fs.existsSync(metaPath)) {
      const content = fs.readFileSync(metaPath, 'utf-8');
      return JSON.parse(content) as RepodataCacheMeta;
    }
  } catch (error) {
    logger.warn('캐시 메타데이터 읽기 실패', { metaPath, error });
  }
  return null;
}

/**
 * 캐시 메타데이터 저장
 */
function writeCacheMeta(metaPath: string, meta: RepodataCacheMeta): void {
  try {
    const dir = path.dirname(metaPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (error) {
    logger.warn('캐시 메타데이터 저장 실패', { metaPath, error });
  }
}

/**
 * 캐시 데이터 읽기
 */
function readCacheData(dataPath: string): RepoData | null {
  try {
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf-8');
      return JSON.parse(content) as RepoData;
    }
  } catch (error) {
    logger.warn('캐시 데이터 읽기 실패', { dataPath, error });
  }
  return null;
}

/**
 * 캐시 데이터 저장
 */
function writeCacheData(dataPath: string, data: RepoData): void {
  try {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dataPath, JSON.stringify(data));
  } catch (error) {
    logger.warn('캐시 데이터 저장 실패', { dataPath, error });
  }
}

/**
 * 캐시가 유효한지 확인 (TTL 기반)
 */
function isCacheValid(meta: RepodataCacheMeta): boolean {
  const now = Date.now();
  const age = (now - meta.cachedAt) / 1000; // 초 단위
  return age < meta.maxAge;
}

/**
 * HTTP 응답에서 캐시 관련 헤더 추출
 */
function extractCacheHeaders(response: AxiosResponse): {
  etag?: string;
  lastModified?: string;
  maxAge: number;
} {
  const etag = response.headers['etag'] as string | undefined;
  const lastModified = response.headers['last-modified'] as string | undefined;

  // Cache-Control에서 max-age 추출
  // 서버가 보내는 값 대신 DepsSmuggler 기본값(24시간) 사용
  let maxAge = DEFAULT_MAX_AGE;
  const cacheControl = response.headers['cache-control'] as string | undefined;
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match) {
      const serverMaxAge = parseInt(match[1], 10);
      // 서버 max-age가 더 길면 그것을 사용, 아니면 기본값 유지
      maxAge = Math.max(serverMaxAge, DEFAULT_MAX_AGE);
    }
  }

  return { etag, lastModified, maxAge };
}

/**
 * Repodata 가져오기 옵션
 */
export interface FetchRepodataOptions {
  /** Conda 기본 URL */
  baseUrl?: string;
  /** 캐시 디렉토리 */
  cacheDir?: string;
  /** 캐시 사용 여부 (기본: true) */
  useCache?: boolean;
  /** 강제 새로고침 (기본: false) */
  forceRefresh?: boolean;
  /** 요청 타임아웃 (ms, 기본: 120000) */
  timeout?: number;
}

/**
 * Repodata 가져오기 (캐시 + HTTP 조건부 요청 지원)
 */
export async function fetchRepodata(
  channel: string,
  subdir: string,
  options: FetchRepodataOptions = {}
): Promise<CacheResult | null> {
  const {
    baseUrl = 'https://conda.anaconda.org',
    cacheDir = getDefaultCacheDir(),
    useCache = true,
    forceRefresh = false,
    timeout = 120000,
  } = options;

  const { dataPath, metaPath } = getCachePaths(cacheDir, channel, subdir);

  // 1. 파일 시스템 캐시 확인 (forceRefresh가 아닐 때)
  if (useCache && !forceRefresh) {
    const cachedMeta = readCacheMeta(metaPath);

    if (cachedMeta && isCacheValid(cachedMeta)) {
      // TTL 내 - 캐시 데이터 반환 (네트워크 요청 없음)
      const cachedData = readCacheData(dataPath);
      if (cachedData) {
        logger.info('디스크 캐시 사용 (TTL 유효)', {
          channel,
          subdir,
          age: Math.round((Date.now() - cachedMeta.cachedAt) / 1000),
          maxAge: cachedMeta.maxAge,
        });
        return {
          data: cachedData,
          fromCache: true,
          meta: cachedMeta,
        };
      }
    }
  }

  // 2. HTTP 요청 준비
  const urls = [
    { url: `${baseUrl}/${channel}/${subdir}/repodata.json.zst`, compressed: true },
    { url: `${baseUrl}/${channel}/${subdir}/current_repodata.json`, compressed: false },
    { url: `${baseUrl}/${channel}/${subdir}/repodata.json`, compressed: false },
  ];

  // 기존 캐시 메타데이터 (조건부 요청용)
  const existingMeta = useCache ? readCacheMeta(metaPath) : null;

  for (const { url, compressed } of urls) {
    try {
      // 조건부 요청 헤더 설정
      const headers: Record<string, string> = {
        'User-Agent': 'DepsSmuggler/1.0',
      };

      if (existingMeta && existingMeta.url === url && !forceRefresh) {
        if (existingMeta.etag) {
          headers['If-None-Match'] = existingMeta.etag;
        }
        if (existingMeta.lastModified) {
          headers['If-Modified-Since'] = existingMeta.lastModified;
        }
      }

      const startTime = Date.now();
      logger.info(`repodata 다운로드 시작: ${channel}/${subdir}`, {
        url,
        compressed,
        conditional: !!(headers['If-None-Match'] || headers['If-Modified-Since']),
      });

      let lastLoggedPercent = 0;
      const response = await axios.get(url, {
        responseType: compressed ? 'arraybuffer' : 'json',
        headers,
        timeout,
        validateStatus: (status) => status === 200 || status === 304,
        onDownloadProgress: (progressEvent) => {
          const { loaded, total } = progressEvent;
          if (total) {
            const percent = Math.floor((loaded / total) * 100);
            // 20% 단위로 로그 출력 (너무 많은 로그 방지)
            if (percent >= lastLoggedPercent + 20) {
              lastLoggedPercent = percent;
              const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
              const loadedMB = (loaded / 1024 / 1024).toFixed(1);
              const totalMB = (total / 1024 / 1024).toFixed(1);
              logger.info(`repodata 다운로드 중: ${channel}/${subdir} (${loadedMB}MB / ${totalMB}MB, ${percent}%, ${elapsed}초)`);
            }
          }
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`repodata 다운로드 완료: ${channel}/${subdir} (${elapsed}초)`);

      // 304 Not Modified - 캐시 유효 (디스크에서 읽기)
      if (response.status === 304) {
        const cachedData = readCacheData(dataPath);
        if (cachedData && existingMeta) {
          // 캐시 시간 갱신
          const { maxAge } = extractCacheHeaders(response);
          const updatedMeta: RepodataCacheMeta = {
            ...existingMeta,
            maxAge,
            cachedAt: Date.now(),
          };
          writeCacheMeta(metaPath, updatedMeta);

          logger.info('캐시 유효 (304 Not Modified)', {
            url,
            packages: existingMeta.packageCount,
          });

          return {
            data: cachedData,
            fromCache: true,
            meta: updatedMeta,
          };
        }
      }

      // 200 OK - 새 데이터
      let repodata: RepoData;
      let fileSize: number;

      if (compressed) {
        const compressedData = new Uint8Array(response.data);
        const decompressedData = fzstd.decompress(compressedData);
        const jsonString = new TextDecoder().decode(decompressedData);
        repodata = JSON.parse(jsonString) as RepoData;
        fileSize = compressedData.length;
      } else {
        repodata = response.data as RepoData;
        fileSize = JSON.stringify(repodata).length;
      }

      // 패키지 수 계산
      const packageCount =
        Object.keys(repodata.packages || {}).length +
        Object.keys(repodata['packages.conda'] || {}).length;

      // 캐시 헤더 추출
      const { etag, lastModified, maxAge } = extractCacheHeaders(response);

      // 메타데이터 생성
      const meta: RepodataCacheMeta = {
        url,
        etag,
        lastModified,
        maxAge,
        cachedAt: Date.now(),
        fileSize,
        packageCount,
        compressed,
      };

      // 캐시 저장 (디스크만)
      if (useCache) {
        writeCacheData(dataPath, repodata);
        writeCacheMeta(metaPath, meta);
      }

      logger.info('repodata 가져오기 성공', {
        url,
        packages: packageCount,
        compressed,
        fileSize,
        cached: useCache,
      });

      return {
        data: repodata,
        fromCache: false,
        meta,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.debug('repodata URL 없음, 다음 URL 시도', { url });
      } else {
        logger.warn('repodata 가져오기 실패, 다음 URL 시도', { url, error });
      }
      continue;
    }
  }

  logger.error('모든 repodata URL 실패', { channel, subdir });
  return null;
}

/**
 * 캐시 통계 조회
 */
export interface CacheStats {
  /** 총 캐시 크기 (바이트) */
  totalSize: number;
  /** 캐시된 채널 수 */
  channelCount: number;
  /** 캐시 항목 목록 */
  entries: Array<{
    channel: string;
    subdir: string;
    meta: RepodataCacheMeta;
    dataSize: number;
  }>;
}

export function getCacheStats(cacheDir: string = getDefaultCacheDir()): CacheStats {
  const stats: CacheStats = {
    totalSize: 0,
    channelCount: 0,
    entries: [],
  };

  try {
    if (!fs.existsSync(cacheDir)) {
      return stats;
    }

    const channels = fs.readdirSync(cacheDir);
    stats.channelCount = channels.length;

    for (const channel of channels) {
      const channelPath = path.join(cacheDir, channel);
      if (!fs.statSync(channelPath).isDirectory()) continue;

      const subdirs = fs.readdirSync(channelPath);
      for (const subdir of subdirs) {
        const { dataPath, metaPath } = getCachePaths(cacheDir, channel, subdir);
        const meta = readCacheMeta(metaPath);

        if (meta && fs.existsSync(dataPath)) {
          const dataSize = fs.statSync(dataPath).size;
          stats.totalSize += dataSize;
          stats.entries.push({
            channel,
            subdir,
            meta,
            dataSize,
          });
        }
      }
    }
  } catch (error) {
    logger.warn('캐시 통계 조회 실패', { cacheDir, error });
  }

  return stats;
}

/**
 * 캐시 삭제 (디스크 캐시)
 */
export function clearCache(
  cacheDir: string = getDefaultCacheDir(),
  channel?: string,
  subdir?: string
): void {
  try {
    if (channel && subdir) {
      // 특정 채널/subdir만 삭제
      const { dataPath, metaPath } = getCachePaths(cacheDir, channel, subdir);
      if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      logger.info('캐시 삭제', { channel, subdir });
    } else if (channel) {
      // 특정 채널 전체 삭제
      const channelPath = path.join(cacheDir, channel);
      if (fs.existsSync(channelPath)) {
        fs.rmSync(channelPath, { recursive: true });
        logger.info('채널 캐시 삭제', { channel });
      }
    } else {
      // 전체 캐시 삭제
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true });
        logger.info('전체 캐시 삭제', { cacheDir });
      }
    }
  } catch (error) {
    logger.error('캐시 삭제 실패', { cacheDir, channel, subdir, error });
  }
}

/**
 * 만료된 캐시 정리
 */
export function pruneExpiredCache(
  cacheDir: string = getDefaultCacheDir(),
  maxAgeMultiplier: number = 10 // 기본 max-age의 10배 이상 된 캐시 삭제
): number {
  let pruned = 0;
  const stats = getCacheStats(cacheDir);

  for (const entry of stats.entries) {
    const age = (Date.now() - entry.meta.cachedAt) / 1000;
    const threshold = entry.meta.maxAge * maxAgeMultiplier;

    if (age > threshold) {
      clearCache(cacheDir, entry.channel, entry.subdir);
      pruned++;
    }
  }

  if (pruned > 0) {
    logger.info('만료된 캐시 정리', { pruned });
  }

  return pruned;
}

// 메모리 캐시 관련 함수 제거됨 (디스크 캐시만 사용)
// 350MB+ repodata.json을 메모리에 저장하면 메모리 부족 발생 가능
