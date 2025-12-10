/**
 * PyPI Simple API 파싱 유틸리티
 * PEP 503 (Simple Repository API) 구현
 * https://peps.python.org/pep-0503/
 *
 * Simple API는 JSON API보다 훨씬 작은 데이터로 버전 목록을 제공합니다.
 * - JSON API: ~50KB+ (전체 메타데이터)
 * - Simple API: ~5KB (버전/파일 목록만)
 */

import axios from 'axios';
import logger from '../../utils/logger';

/**
 * Simple API에서 파싱한 릴리스 정보
 */
export interface SimpleRelease {
  /** 파일명 */
  filename: string;
  /** 다운로드 URL */
  url: string;
  /** 해시 (sha256 등) */
  hash?: string;
  /** 해시 알고리즘 */
  hashAlgorithm?: string;
  /** Python 버전 요구사항 */
  requiresPython?: string;
  /** 버전 (파일명에서 추출) */
  version: string;
  /** 패키지 타입 (wheel, sdist 등) */
  packageType: 'wheel' | 'sdist' | 'egg' | 'unknown';
}

/**
 * 파일명에서 버전 추출
 * 예: requests-2.28.0.tar.gz -> 2.28.0
 * 예: requests-2.28.0-py3-none-any.whl -> 2.28.0
 */
export function extractVersionFromFilename(filename: string, packageName: string): string | null {
  // 패키지명 정규화 (하이픈, 언더스코어, 점 -> 하이픈)
  const normalizedName = packageName.toLowerCase().replace(/[-_.]+/g, '[-_.]');

  // wheel 파일: {package}-{version}(-{build})?-{python}-{abi}-{platform}.whl
  const wheelPattern = new RegExp(
    `^${normalizedName}-([^-]+)(?:-\\d+)?-[^-]+-[^-]+-[^-]+\\.whl$`,
    'i'
  );
  const wheelMatch = filename.match(wheelPattern);
  if (wheelMatch) {
    return wheelMatch[1];
  }

  // sdist 파일: {package}-{version}.tar.gz 또는 {package}-{version}.zip
  const sdistPattern = new RegExp(
    `^${normalizedName}-([^-]+)\\.(?:tar\\.gz|zip|tar\\.bz2|tar\\.xz)$`,
    'i'
  );
  const sdistMatch = filename.match(sdistPattern);
  if (sdistMatch) {
    return sdistMatch[1];
  }

  // egg 파일: {package}-{version}-py{ver}.egg
  const eggPattern = new RegExp(
    `^${normalizedName}-([^-]+)-py[^.]+\\.egg$`,
    'i'
  );
  const eggMatch = filename.match(eggPattern);
  if (eggMatch) {
    return eggMatch[1];
  }

  return null;
}

/**
 * 파일명에서 패키지 타입 추출
 */
export function getPackageType(filename: string): SimpleRelease['packageType'] {
  if (filename.endsWith('.whl')) return 'wheel';
  if (filename.endsWith('.tar.gz') || filename.endsWith('.zip') ||
      filename.endsWith('.tar.bz2') || filename.endsWith('.tar.xz')) return 'sdist';
  if (filename.endsWith('.egg')) return 'egg';
  return 'unknown';
}

/**
 * Simple API HTML 응답 파싱
 * PEP 503 형식: <a href="url#hash">filename</a>
 */
export function parseSimpleApiHtml(html: string, packageName: string): SimpleRelease[] {
  const releases: SimpleRelease[] = [];

  // <a> 태그 파싱
  // 예: <a href="https://files.../requests-2.28.0.tar.gz#sha256=abc123" data-requires-python="&gt;=3.7">requests-2.28.0.tar.gz</a>
  const linkPattern = /<a\s+[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;

  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    const fullUrl = match[1];
    const filename = match[2].trim();

    // URL에서 해시 추출 (#sha256=... 형식)
    let url = fullUrl;
    let hash: string | undefined;
    let hashAlgorithm: string | undefined;

    const hashMatch = fullUrl.match(/^(.+)#(\w+)=(.+)$/);
    if (hashMatch) {
      url = hashMatch[1];
      hashAlgorithm = hashMatch[2];
      hash = hashMatch[3];
    }

    // data-requires-python 속성 추출
    const requiresPythonMatch = match[0].match(/data-requires-python="([^"]+)"/i);
    let requiresPython: string | undefined;
    if (requiresPythonMatch) {
      // HTML 엔티티 디코딩 (&gt; -> >, &lt; -> <, etc.)
      requiresPython = requiresPythonMatch[1]
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"');
    }

    // 버전 추출
    const version = extractVersionFromFilename(filename, packageName);
    if (!version) continue;

    releases.push({
      filename,
      url,
      hash,
      hashAlgorithm,
      requiresPython,
      version,
      packageType: getPackageType(filename),
    });
  }

  return releases;
}

/**
 * Simple API에서 유니크 버전 목록 추출
 */
export function extractVersionsFromReleases(releases: SimpleRelease[]): string[] {
  const versions = new Set<string>();
  for (const release of releases) {
    versions.add(release.version);
  }
  return Array.from(versions);
}

/**
 * Simple API 캐시 옵션
 */
export interface SimpleApiOptions {
  /** PyPI Simple API 기본 URL */
  baseUrl?: string;
  /** 요청 타임아웃 (ms) */
  timeout?: number;
  /** Accept 헤더 (JSON 응답 요청 가능) */
  acceptJson?: boolean;
}

/**
 * Simple API로 패키지 버전 목록 조회
 */
export async function fetchVersionsFromSimpleApi(
  packageName: string,
  options: SimpleApiOptions = {}
): Promise<string[] | null> {
  const {
    baseUrl = 'https://pypi.org/simple',
    timeout = 15000,
    acceptJson = false,
  } = options;

  // 패키지명 정규화 (PEP 503: 소문자, 연속된 특수문자 -> 하이픈)
  const normalizedName = packageName.toLowerCase().replace(/[-_.]+/g, '-');
  const url = `${baseUrl}/${normalizedName}/`;

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'DepsSmuggler/1.0',
    };

    // PEP 691: JSON 응답 요청 (pypi.org 지원)
    if (acceptJson) {
      headers['Accept'] = 'application/vnd.pypi.simple.v1+json';
    }

    logger.debug('Simple API 요청', { packageName, url });

    const response = await axios.get<string>(url, {
      timeout,
      headers,
      responseType: acceptJson ? 'json' : 'text',
    });

    // JSON 응답 처리 (PEP 691)
    if (acceptJson && typeof response.data === 'object') {
      const jsonData = response.data as { files?: Array<{ filename: string }> };
      if (jsonData.files) {
        const versions = new Set<string>();
        for (const file of jsonData.files) {
          const version = extractVersionFromFilename(file.filename, packageName);
          if (version) versions.add(version);
        }
        return Array.from(versions);
      }
    }

    // HTML 응답 파싱
    const releases = parseSimpleApiHtml(response.data as string, packageName);
    const versions = extractVersionsFromReleases(releases);

    logger.debug('Simple API 버전 목록 조회 완료', {
      packageName,
      versionCount: versions.length,
    });

    return versions;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      logger.debug('Simple API 패키지 없음', { packageName });
      return null;
    }
    logger.warn('Simple API 요청 실패', { packageName, error });
    return null;
  }
}

/**
 * Simple API로 릴리스 정보 조회 (해시 포함)
 */
export async function fetchReleasesFromSimpleApi(
  packageName: string,
  options: SimpleApiOptions = {}
): Promise<SimpleRelease[] | null> {
  const {
    baseUrl = 'https://pypi.org/simple',
    timeout = 15000,
  } = options;

  const normalizedName = packageName.toLowerCase().replace(/[-_.]+/g, '-');
  const url = `${baseUrl}/${normalizedName}/`;

  try {
    const response = await axios.get<string>(url, {
      timeout,
      headers: {
        'User-Agent': 'DepsSmuggler/1.0',
      },
      responseType: 'text',
    });

    const releases = parseSimpleApiHtml(response.data, packageName);

    logger.debug('Simple API 릴리스 목록 조회 완료', {
      packageName,
      releaseCount: releases.length,
    });

    return releases;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    logger.warn('Simple API 릴리스 조회 실패', { packageName, error });
    return null;
  }
}
