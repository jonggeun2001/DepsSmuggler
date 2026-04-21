/**
 * PEP 503 Simple Repository API 파서
 *
 * PyTorch 등 커스텀 인덱스에서 사용하는 Simple API (HTML 형식)를 파싱합니다.
 * PyPI JSON API와 달리 HTML <a> 태그에서 패키지 파일 정보를 추출합니다.
 *
 * 참고: https://peps.python.org/pep-0503/
 */

import axios from 'axios';
import * as path from 'path';
import logger from '../../utils/logger';
import { createDiskCache, CacheStore } from '../shared/cache/cache-store';
import { getConfigManager } from '../config';

/**
 * Simple API에서 반환되는 패키지 파일 정보
 */
export interface SimpleApiPackageFile {
  filename: string;
  url: string;
  requiresPython?: string;
  yanked?: boolean;
  hash?: {
    algorithm: string;
    digest: string;
  };
  /** PEP 658: 메타데이터 해시 (존재 시 .metadata 파일 접근 가능) */
  metadataHash?: {
    algorithm: string;
    digest: string;
  };
}

/**
 * 휠 파일명 파싱 결과
 */
export interface WheelInfo {
  name: string;
  version: string;
  pythonTag: string;
  abiTag: string;
  platformTag: string;
}

// ============================================================================
// 캐시 관리자
// ============================================================================

let simpleApiCache: CacheStore<SimpleApiPackageFile[]> | null = null;

/**
 * Simple API 캐시 초기화
 */
function getSimpleApiCache(): CacheStore<SimpleApiPackageFile[]> {
  if (!simpleApiCache) {
    const configManager = getConfigManager();
    const cachePath = path.join(configManager.getCacheDir(), 'pip-simple');

    simpleApiCache = createDiskCache<SimpleApiPackageFile[]>(
      'pip-simple-api',
      5 * 60 * 1000, // 메모리 캐시 TTL: 5분
      cachePath,
      {
        diskTtlMs: 60 * 60 * 1000, // 디스크 캐시 TTL: 1시간
        maxSize: 100, // 최대 100개 패키지 캐시
      }
    );

    logger.debug('Simple API 캐시 초기화', { cachePath });
  }
  return simpleApiCache;
}

/**
 * PEP 503 Simple API에서 패키지 파일 목록 조회
 *
 * @param indexUrl 인덱스 베이스 URL (예: https://download.pytorch.org/whl/cu121)
 * @param packageName 패키지명 (예: torch)
 * @returns 패키지 파일 정보 배열
 */
export async function fetchPackageFiles(
  indexUrl: string,
  packageName: string
): Promise<SimpleApiPackageFile[]> {
  const cache = getSimpleApiCache();
  const normalizedPackageName = packageName.toLowerCase().replace(/_/g, '-');

  // 캐시 키: indexUrl + packageName 조합
  const cacheKey = `${indexUrl}:${normalizedPackageName}`;

  // 캐시에서 가져오거나 네트워크 요청
  const result = await cache.getOrFetch(cacheKey, async () => {
    try {
      // Simple API 엔드포인트: {indexUrl}/{package}/
      const url = `${indexUrl.replace(/\/$/, '')}/${normalizedPackageName}/`;

      logger.debug('Fetching Simple API', { url });

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'DepsSmuggler/1.0',
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: 30000,
      });

      const html = response.data as string;
      return parseSimpleApiHtml(html, indexUrl);
    } catch (error) {
      logger.error('Simple API 조회 실패', { indexUrl, packageName, error });
      throw new Error(`패키지를 찾을 수 없습니다: ${packageName} (인덱스: ${indexUrl})`);
    }
  });

  logger.debug('Simple API 조회 결과', {
    packageName,
    indexUrl,
    fromCache: result.fromCache,
    cacheType: result.cacheType,
    fileCount: result.data.length,
  });

  return result.data;
}

/**
 * Simple API HTML 파싱
 *
 * HTML에서 <a> 태그를 추출하고 data-* 속성을 파싱합니다.
 *
 * 예시 HTML:
 * <a href="torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl#sha256=abc123"
 *    data-requires-python="&gt;=3.8"
 *    data-yanked="">torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl</a>
 */
function parseSimpleApiHtml(html: string, baseUrl: string): SimpleApiPackageFile[] {
  const files: SimpleApiPackageFile[] = [];

  // <a> 태그 정규식 매칭
  const linkRegex = /<a\s+([^>]*?)>(.*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const attributes = match[1];
    const rawFilename = match[2].trim();

    // URL 디코딩 적용 (예: torch-2.9.1%2Bcu130 → torch-2.9.1+cu130)
    let filename = rawFilename;
    try {
      filename = decodeURIComponent(rawFilename);
      if (filename !== rawFilename) {
        logger.debug('파일명 URL 디코딩 적용', { before: rawFilename, after: filename });
      }
    } catch (error) {
      // 디코딩 실패 시 원본 사용
      logger.debug('URL 디코딩 실패, 원본 파일명 사용', { rawFilename, error });
    }

    // href 추출
    const hrefMatch = /href=["']([^"']+)["']/i.exec(attributes);
    if (!hrefMatch) continue;

    let url = hrefMatch[1];

    // SHA256 해시 추출 (URL fragment)
    let hash: { algorithm: string; digest: string } | undefined;
    const hashMatch = url.match(/#sha256=([a-fA-F0-9]+)/);
    if (hashMatch) {
      hash = {
        algorithm: 'sha256',
        digest: hashMatch[1],
      };
      url = url.replace(/#.*$/, ''); // fragment 제거
    }

    // 상대 URL → 절대 URL 변환
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = new URL(url, baseUrl).href;
    }

    // data-requires-python 추출
    let requiresPython: string | undefined;
    const requiresPythonMatch = /data-requires-python=["']([^"']+)["']/i.exec(attributes);
    if (requiresPythonMatch) {
      // HTML 엔티티 디코딩 (&gt; → >, &lt; → <)
      requiresPython = requiresPythonMatch[1]
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
    }

    // data-yanked 추출
    const yanked = /data-yanked(?:=["'][^"']*["'])?/i.test(attributes);

    // PEP 658: data-dist-info-metadata 추출 (메타데이터 파일 접근 가능 여부)
    let metadataHash: { algorithm: string; digest: string } | undefined;
    const metadataHashMatch = /data-dist-info-metadata=["']sha256=([a-fA-F0-9]+)["']/i.exec(attributes);
    if (metadataHashMatch) {
      metadataHash = {
        algorithm: 'sha256',
        digest: metadataHashMatch[1],
      };
    }

    files.push({
      filename,
      url,
      requiresPython,
      yanked,
      hash,
      metadataHash,
    });
  }

  logger.debug('Simple API 파싱 완료', { fileCount: files.length });
  return files;
}

/**
 * 휠 파일명에서 버전 추출
 *
 * 예시: torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl → 2.1.0+cu121
 */
export function extractVersionFromFilename(filename: string): string {
  // 휠 파일명 형식: {name}-{version}[-{build}]-{python}-{abi}-{platform}.whl
  const wheelMatch = /^([a-zA-Z0-9._-]+)-([a-zA-Z0-9._+]+?)(?:-\d+)?-([a-z0-9]+)-([a-z0-9_]+)-([a-z0-9_]+)\.whl$/i.exec(
    filename
  );

  if (wheelMatch) {
    return wheelMatch[2]; // version
  }

  // tar.gz / zip 형식: {name}-{version}.{ext}
  const sourceMatch = /^([a-zA-Z0-9._-]+)-([a-zA-Z0-9._+]+)\.(tar\.gz|zip)$/i.exec(filename);
  if (sourceMatch) {
    return sourceMatch[2];
  }

  throw new Error(`파일명에서 버전을 추출할 수 없습니다: ${filename}`);
}

/**
 * 휠 파일명 파싱 (PEP 427)
 *
 * 형식: {distribution}-{version}(-{build tag})?-{python tag}-{abi tag}-{platform tag}.whl
 *
 * 예시: torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl
 */
export function parseWheelFilename(filename: string): WheelInfo {
  const wheelMatch =
    /^([a-zA-Z0-9._-]+)-([a-zA-Z0-9._+]+?)(?:-\d+)?-([a-z0-9]+)-([a-z0-9_]+)-([a-z0-9_.]+)\.whl$/i.exec(
      filename
    );

  if (!wheelMatch) {
    throw new Error(`유효하지 않은 휠 파일명: ${filename}`);
  }

  return {
    name: wheelMatch[1],
    version: wheelMatch[2],
    pythonTag: wheelMatch[3],
    abiTag: wheelMatch[4],
    platformTag: wheelMatch[5],
  };
}

/**
 * 파일명이 휠 파일인지 확인
 */
export function isWheelFile(filename: string): boolean {
  return filename.endsWith('.whl');
}

/**
 * 파일명이 소스 배포판인지 확인
 */
export function isSourceDistribution(filename: string): boolean {
  return filename.endsWith('.tar.gz') || filename.endsWith('.zip');
}

/**
 * PEP 658: 휠 메타데이터 파일에서 의존성 정보 가져오기
 *
 * @param file Simple API 파일 정보 (metadataHash가 있어야 함)
 * @returns Requires-Dist 목록
 */
export async function fetchWheelMetadata(file: SimpleApiPackageFile): Promise<string[]> {
  if (!file.metadataHash) {
    logger.debug('메타데이터 해시 없음, PEP 658 미지원', { filename: file.filename });
    return [];
  }

  try {
    // 메타데이터 URL: {wheel_url}.metadata
    const metadataUrl = `${file.url}.metadata`;
    logger.debug('PEP 658 메타데이터 조회', { metadataUrl });

    const response = await axios.get(metadataUrl, {
      headers: {
        'User-Agent': 'DepsSmuggler/1.0',
        Accept: 'text/plain',
      },
      timeout: 30000,
      responseType: 'text',
    });

    const metadata = response.data as string;
    return parseRequiresDist(metadata);
  } catch (error) {
    logger.warn('PEP 658 메타데이터 조회 실패', {
      filename: file.filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * METADATA 파일에서 Requires-Dist 파싱
 *
 * METADATA 형식 (RFC 822 스타일):
 * Requires-Dist: filelock
 * Requires-Dist: typing-extensions>=4.10.0
 * Requires-Dist: nvidia-cuda-nvrtc==13.0.48; platform_system == "Linux"
 */
function parseRequiresDist(metadata: string): string[] {
  const requiresDist: string[] = [];
  const lines = metadata.split('\n');

  for (const line of lines) {
    // Requires-Dist: 로 시작하는 라인 추출
    const match = /^Requires-Dist:\s*(.+)$/i.exec(line.trim());
    if (match) {
      requiresDist.push(match[1].trim());
    }
  }

  logger.debug('Requires-Dist 파싱 완료', { count: requiresDist.length });
  return requiresDist;
}

/**
 * Simple API에서 최신 버전 찾기
 *
 * @param files 패키지 파일 목록
 * @returns 최신 버전 문자열
 */
export function findLatestVersion(files: SimpleApiPackageFile[]): string | null {
  const versions = new Set<string>();

  for (const file of files) {
    try {
      const version = extractVersionFromFilename(file.filename);
      // yanked된 버전은 제외
      if (!file.yanked) {
        versions.add(version);
      }
    } catch {
      // 버전 추출 실패 시 무시
    }
  }

  if (versions.size === 0) {
    return null;
  }

  // 버전 정렬 (간단한 버전 비교)
  const sortedVersions = Array.from(versions).sort((a, b) => {
    // + 로컬 버전 식별자 제거 후 비교
    const aBase = a.split('+')[0];
    const bBase = b.split('+')[0];

    const aParts = aBase.split('.').map(Number);
    const bParts = bBase.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aNum = aParts[i] || 0;
      const bNum = bParts[i] || 0;
      if (aNum !== bNum) {
        return bNum - aNum; // 내림차순
      }
    }

    // 로컬 버전이 있으면 더 나중 버전으로 간주
    if (a.includes('+') && !b.includes('+')) return -1;
    if (!a.includes('+') && b.includes('+')) return 1;

    return 0;
  });

  return sortedVersions[0];
}

/**
 * Simple API 캐시 전체 삭제
 */
export function clearSimpleApiCache(): void {
  if (simpleApiCache) {
    simpleApiCache.clear();
    logger.info('Simple API 캐시 초기화 완료');
  }
}

/**
 * Simple API 캐시 통계 조회
 */
export function getSimpleApiCacheStats() {
  if (simpleApiCache) {
    return simpleApiCache.getStats();
  }
  return null;
}
