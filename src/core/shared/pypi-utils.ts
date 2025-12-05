// PyPI 관련 유틸리티 함수 (PEP 425 기반 태그 우선순위 구현)
import * as https from 'https';
import type { DownloadUrlResult } from './types';

/**
 * Wheel 태그 파싱 결과
 * 형식: {distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl
 */
interface WheelTags {
  pythonTags: string[];  // 예: ['cp311', 'cp3', 'py3', 'py311']
  abiTags: string[];     // 예: ['cp311', 'abi3', 'none']
  platformTags: string[]; // 예: ['manylinux_2_17_x86_64', 'linux_x86_64', 'any']
}

/**
 * wheel 파일명에서 태그 파싱
 * 예: package-1.0.0-cp311-cp311-manylinux_2_17_x86_64.whl
 */
function parseWheelTags(filename: string): WheelTags | null {
  // .whl 확장자 제거
  const name = filename.replace(/\.whl$/i, '');
  const parts = name.split('-');

  // 최소 5개 부분: name-version-python-abi-platform
  // 또는 6개 부분: name-version-build-python-abi-platform
  if (parts.length < 5) {
    return null;
  }

  // 뒤에서부터 파싱 (platform-abi-python)
  const platformTag = parts[parts.length - 1];
  const abiTag = parts[parts.length - 2];
  const pythonTag = parts[parts.length - 3];

  return {
    pythonTags: pythonTag.split('.'),
    abiTags: abiTag.split('.'),
    platformTags: platformTag.split('.'),
  };
}

/**
 * PEP 425 기반 지원 태그 목록 생성 (우선순위 순)
 * pip의 packaging.tags.sys_tags() 로직 참고
 */
function generateSupportedTags(
  pythonVersion: string,
  targetOS: string,
  architecture: string
): Array<{ python: string; abi: string; platform: string }> {
  const tags: Array<{ python: string; abi: string; platform: string }> = [];

  // Python 버전 파싱 (예: "3.11" -> major=3, minor=11)
  const [majorStr, minorStr] = pythonVersion.split('.');
  const major = parseInt(majorStr, 10) || 3;
  const minor = parseInt(minorStr, 10) || 11;

  // CPython 태그: cp311, cp310, ... (현재 버전부터 하위 버전까지)
  const cpTag = `cp${major}${minor}`;

  // 플랫폼 태그 목록 생성
  const platformTags = generatePlatformTags(targetOS, architecture);

  // 1. CPython 구현체 특화 태그 (가장 높은 우선순위)
  // cp311-cp311-{platform}
  for (const platform of platformTags) {
    tags.push({ python: cpTag, abi: cpTag, platform });
  }

  // 2. 안정 ABI (abi3) - Python 3.2+
  // cp311-abi3-{platform}, cp310-abi3-{platform}, ...
  for (let m = minor; m >= 2; m--) {
    const pyTag = `cp${major}${m}`;
    for (const platform of platformTags) {
      tags.push({ python: pyTag, abi: 'abi3', platform });
    }
  }

  // 3. CPython none ABI
  // cp311-none-{platform}
  for (const platform of platformTags) {
    tags.push({ python: cpTag, abi: 'none', platform });
  }

  // 4. 제네릭 Python 3 태그
  // py311-none-{platform}
  for (const platform of platformTags) {
    tags.push({ python: `py${major}${minor}`, abi: 'none', platform });
  }

  // py3-none-{platform}
  for (const platform of platformTags) {
    tags.push({ python: `py${major}`, abi: 'none', platform });
  }

  // 5. any 플랫폼 태그 (pure Python)
  // cp311-none-any
  tags.push({ python: cpTag, abi: 'none', platform: 'any' });

  // cp3-none-any
  tags.push({ python: `cp${major}`, abi: 'none', platform: 'any' });

  // py311-none-any
  tags.push({ python: `py${major}${minor}`, abi: 'none', platform: 'any' });

  // py3-none-any
  tags.push({ python: `py${major}`, abi: 'none', platform: 'any' });

  // 6. 하위 Python 버전 (py310, py39, ...)
  for (let m = minor - 1; m >= 0; m--) {
    tags.push({ python: `py${major}${m}`, abi: 'none', platform: 'any' });
  }

  return tags;
}

/**
 * 플랫폼 태그 목록 생성 (우선순위 순)
 */
function generatePlatformTags(targetOS: string, architecture: string): string[] {
  const platforms: string[] = [];
  const os = targetOS?.toLowerCase() || 'any';
  const arch = architecture?.toLowerCase() || 'x86_64';

  // 아키텍처 정규화
  const archMap: Record<string, string> = {
    x86_64: 'x86_64',
    amd64: 'x86_64',
    arm64: 'aarch64',
    aarch64: 'aarch64',
  };
  const normalizedArch = archMap[arch] || arch;

  if (os === 'linux' || os === 'any') {
    // manylinux 태그 (최신부터)
    // 최신 glibc 버전 기반 manylinux 태그
    platforms.push(`manylinux_2_35_${normalizedArch}`);
    platforms.push(`manylinux_2_34_${normalizedArch}`);
    platforms.push(`manylinux_2_31_${normalizedArch}`);
    platforms.push(`manylinux_2_28_${normalizedArch}`);
    platforms.push(`manylinux_2_27_${normalizedArch}`);
    platforms.push(`manylinux_2_17_${normalizedArch}`);
    platforms.push(`manylinux2014_${normalizedArch}`);
    platforms.push(`manylinux_2_12_${normalizedArch}`);
    platforms.push(`manylinux2010_${normalizedArch}`);
    platforms.push(`manylinux_2_5_${normalizedArch}`);
    platforms.push(`manylinux1_${normalizedArch}`);
    // musllinux 태그
    platforms.push(`musllinux_1_2_${normalizedArch}`);
    platforms.push(`musllinux_1_1_${normalizedArch}`);
    platforms.push(`linux_${normalizedArch}`);
  }

  if (os === 'windows' || os === 'any') {
    if (normalizedArch === 'x86_64') {
      platforms.push('win_amd64');
    } else if (normalizedArch === 'aarch64') {
      platforms.push('win_arm64');
    } else {
      platforms.push('win32');
    }
  }

  if (os === 'macos' || os === 'any') {
    // macOS 버전별 태그 (최신부터)
    const macVersions = ['14_0', '13_0', '12_0', '11_0', '10_15', '10_14', '10_13', '10_12', '10_11', '10_10', '10_9'];
    for (const ver of macVersions) {
      if (normalizedArch === 'aarch64') {
        platforms.push(`macosx_${ver}_arm64`);
        platforms.push(`macosx_${ver}_universal2`);
      } else {
        platforms.push(`macosx_${ver}_x86_64`);
        platforms.push(`macosx_${ver}_universal2`);
        platforms.push(`macosx_${ver}_intel`);
      }
    }
  }

  // any 플랫폼은 별도로 처리
  return platforms;
}

/**
 * wheel 태그가 지원 태그 목록과 호환되는지 확인하고 우선순위 반환
 * 낮은 숫자가 더 높은 우선순위
 */
function getTagPriority(
  wheelTags: WheelTags,
  supportedTags: Array<{ python: string; abi: string; platform: string }>
): number {
  for (let i = 0; i < supportedTags.length; i++) {
    const supported = supportedTags[i];

    const pythonMatch = wheelTags.pythonTags.some(
      (t) => t.toLowerCase() === supported.python.toLowerCase()
    );
    const abiMatch = wheelTags.abiTags.some(
      (t) => t.toLowerCase() === supported.abi.toLowerCase()
    );
    const platformMatch = wheelTags.platformTags.some(
      (t) => t.toLowerCase() === supported.platform.toLowerCase() ||
             t.toLowerCase().includes(supported.platform.toLowerCase()) ||
             supported.platform === 'any'
    );

    if (pythonMatch && abiMatch && platformMatch) {
      return i;
    }
  }

  return Infinity; // 호환되지 않음
}

/**
 * wheel 파일명에서 플랫폼 호환성 확인 (간단한 버전)
 */
function isCompatiblePlatform(filename: string, targetOS?: string, architecture?: string): boolean {
  const lower = filename.toLowerCase();
  const os = targetOS?.toLowerCase() || 'any';
  const arch = architecture?.toLowerCase() || 'x86_64';

  // any 플랫폼은 모두 호환
  if (lower.includes('-any.whl') || lower.includes('-none-any')) {
    return true;
  }

  // OS 체크
  if (os !== 'any') {
    if (os === 'linux' && !lower.includes('linux') && !lower.includes('manylinux') && !lower.includes('musllinux')) {
      return false;
    }
    if (os === 'windows' && !lower.includes('win')) {
      return false;
    }
    if (os === 'macos' && !lower.includes('macos') && !lower.includes('darwin')) {
      return false;
    }
  }

  // 아키텍처 체크
  if (arch === 'x86_64' || arch === 'amd64') {
    if (lower.includes('arm64') || lower.includes('aarch64')) {
      return false;
    }
  }
  if (arch === 'arm64' || arch === 'aarch64') {
    if (lower.includes('x86_64') || lower.includes('amd64') || lower.includes('win32') || lower.includes('i686')) {
      return false;
    }
  }

  return true;
}

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
  architecture?: string,
  targetOS?: string,
  pythonVersion?: string
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

          const result = selectBestRelease(releases, architecture, targetOS, pythonVersion);
          resolve(result);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * PEP 425 기반 가장 적합한 릴리스 선택
 */
function selectBestRelease(
  releases: PyPIRelease[],
  architecture?: string,
  targetOS?: string,
  pythonVersion?: string
): DownloadUrlResult {
  const pyVer = pythonVersion || '3.11';
  const os = targetOS || 'any';
  const arch = architecture || 'x86_64';

  // 지원 태그 목록 생성
  const supportedTags = generateSupportedTags(pyVer, os, arch);

  // wheel 파일들을 우선순위와 함께 수집
  const wheelCandidates: Array<{
    release: PyPIRelease;
    priority: number;
  }> = [];

  for (const release of releases) {
    if (release.packagetype !== 'bdist_wheel') {
      continue;
    }

    // 플랫폼 호환성 먼저 체크
    if (!isCompatiblePlatform(release.filename, os, arch)) {
      continue;
    }

    const tags = parseWheelTags(release.filename);
    if (!tags) {
      continue;
    }

    const priority = getTagPriority(tags, supportedTags);
    if (priority !== Infinity) {
      wheelCandidates.push({ release, priority });
    }
  }

  // 우선순위로 정렬 (낮은 숫자가 더 높은 우선순위)
  wheelCandidates.sort((a, b) => a.priority - b.priority);

  // 가장 우선순위 높은 wheel 반환
  if (wheelCandidates.length > 0) {
    const best = wheelCandidates[0].release;
    return { url: best.url, filename: best.filename, size: best.size };
  }

  // wheel이 없으면 sdist 선택
  const sdist = releases.find((r) => r.packagetype === 'sdist');
  if (sdist) {
    return { url: sdist.url, filename: sdist.filename, size: sdist.size };
  }

  // 마지막 폴백
  return {
    url: releases[0].url,
    filename: releases[0].filename,
    size: releases[0].size,
  };
}
