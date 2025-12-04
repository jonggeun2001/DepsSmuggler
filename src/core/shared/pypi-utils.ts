// PyPI 관련 유틸리티 함수
import * as https from 'https';
import type { DownloadUrlResult } from './types';

// 아키텍처 매핑
const ARCH_MAP: Record<string, string[]> = {
  x86_64: ['x86_64', 'amd64', 'win_amd64', 'manylinux', 'any'],
  amd64: ['amd64', 'x86_64', 'win_amd64', 'manylinux', 'any'],
  arm64: ['arm64', 'aarch64', 'any'],
  aarch64: ['aarch64', 'arm64', 'any'],
  noarch: ['any', 'none'],
};

interface PyPIRelease {
  packagetype: string;
  python_version: string;
  url: string;
  filename: string;
  size: number;
}

/**
 * PyPI에서 패키지 다운로드 URL 조회
 */
export async function getPyPIDownloadUrl(
  packageName: string,
  version: string,
  architecture?: string
): Promise<DownloadUrlResult | null> {
  return new Promise((resolve) => {
    const url = `https://pypi.org/pypi/${packageName}/${version}/json`;

    https.get(url, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const releases = json.urls as PyPIRelease[];

          if (!releases || releases.length === 0) {
            resolve(null);
            return;
          }

          const result = selectBestRelease(releases, architecture);
          resolve(result);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * 가장 적합한 릴리스 선택
 */
function selectBestRelease(
  releases: PyPIRelease[],
  architecture?: string
): DownloadUrlResult {
  const archPatterns = architecture
    ? ARCH_MAP[architecture.toLowerCase()] || ['any']
    : ['any'];

  // wheel 파일 중 아키텍처에 맞는 것 선택
  for (const pattern of archPatterns) {
    const wheel = releases.find(
      (r) =>
        r.packagetype === 'bdist_wheel' &&
        (r.filename.toLowerCase().includes(pattern) || pattern === 'any')
    );
    if (wheel) {
      return { url: wheel.url, filename: wheel.filename, size: wheel.size };
    }
  }

  // wheel이 없으면 sdist(소스 배포판) 선택
  const sdist = releases.find((r) => r.packagetype === 'sdist');
  if (sdist) {
    return { url: sdist.url, filename: sdist.filename, size: sdist.size };
  }

  // 아무거나 선택
  return {
    url: releases[0].url,
    filename: releases[0].filename,
    size: releases[0].size,
  };
}
