/**
 * OS Distribution Fetcher
 * 인터넷에서 OS 배포판의 최신 버전 정보를 가져오는 모듈
 */

import type { OSDistribution, OSPackageManager, OSArchitecture, Repository } from './types';

// 배포판 버전 정보 (간소화된 형태)
export interface DistributionVersion {
  id: string;
  name: string;
  version: string;
  codename?: string;
  status: 'current' | 'lts' | 'eol' | 'supported';
  releaseDate?: string;
  eolDate?: string;
}

// 배포판 패밀리 정보
export interface DistributionFamily {
  id: string;
  name: string;
  packageManager: OSPackageManager;
  architectures: OSArchitecture[];
  versions: DistributionVersion[];
}

// 캐시 설정
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
let distributionCache: {
  data: DistributionFamily[];
  timestamp: number;
} | null = null;

/**
 * Alpine Linux 릴리스 정보 가져오기
 * @see https://alpinelinux.org/releases/
 */
async function fetchAlpineReleases(): Promise<DistributionVersion[]> {
  try {
    // Alpine releases.json API
    const response = await fetch('https://dl-cdn.alpinelinux.org/alpine/');
    const html = await response.text();

    // HTML에서 버전 디렉토리 파싱 (v3.x 형식)
    const versionRegex = /href="v(\d+\.\d+)\/"/g;
    const versions: DistributionVersion[] = [];
    let match;

    while ((match = versionRegex.exec(html)) !== null) {
      const version = match[1];
      const majorMinor = version.split('.');
      const major = parseInt(majorMinor[0], 10);
      const minor = parseInt(majorMinor[1], 10);

      // 3.15 이상만 지원
      if (major >= 3 && minor >= 15) {
        versions.push({
          id: `alpine-${version}`,
          name: `Alpine Linux ${version}`,
          version,
          status: minor >= 18 ? 'current' : 'supported',
        });
      }
    }

    // 버전 내림차순 정렬
    return versions.sort((a, b) => {
      const [aMajor, aMinor] = a.version.split('.').map(Number);
      const [bMajor, bMinor] = b.version.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor;
    });
  } catch (error) {
    console.error('Failed to fetch Alpine releases:', error);
    // 폴백: 알려진 버전
    return [
      { id: 'alpine-3.21', name: 'Alpine Linux 3.21', version: '3.21', status: 'current' },
      { id: 'alpine-3.20', name: 'Alpine Linux 3.20', version: '3.20', status: 'current' },
      { id: 'alpine-3.19', name: 'Alpine Linux 3.19', version: '3.19', status: 'supported' },
      { id: 'alpine-3.18', name: 'Alpine Linux 3.18', version: '3.18', status: 'lts' },
    ];
  }
}

/**
 * Ubuntu 릴리스 정보 가져오기
 * @see https://ubuntu.com/about/release-cycle
 */
async function fetchUbuntuReleases(): Promise<DistributionVersion[]> {
  try {
    // Ubuntu meta-release 파일
    const response = await fetch('https://changelogs.ubuntu.com/meta-release-lts');
    const text = await response.text();

    const versions: DistributionVersion[] = [];
    const blocks = text.split('\n\n');

    for (const block of blocks) {
      const lines = block.split('\n');
      const distEntry: Record<string, string> = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          distEntry[key.trim()] = valueParts.join(':').trim();
        }
      }

      if (distEntry['Dist'] && distEntry['Version']) {
        const codename = distEntry['Dist'].toLowerCase();
        const version = distEntry['Version'];
        const supported = distEntry['Supported'] === '1';

        // 20.04 이상만 지원
        const [major] = version.split('.').map(Number);
        if (major >= 20 && supported) {
          versions.push({
            id: `ubuntu-${version}`,
            name: `Ubuntu ${version} LTS (${codename.charAt(0).toUpperCase() + codename.slice(1)})`,
            version,
            codename,
            status: 'lts',
          });
        }
      }
    }

    return versions.sort((a, b) => {
      const [aMajor, aMinor] = a.version.split('.').map(Number);
      const [bMajor, bMinor] = b.version.split('.').map(Number);
      return bMajor - aMajor || bMinor - aMinor;
    });
  } catch (error) {
    console.error('Failed to fetch Ubuntu releases:', error);
    // 폴백
    return [
      { id: 'ubuntu-24.04', name: 'Ubuntu 24.04 LTS (Noble Numbat)', version: '24.04', codename: 'noble', status: 'lts' },
      { id: 'ubuntu-22.04', name: 'Ubuntu 22.04 LTS (Jammy Jellyfish)', version: '22.04', codename: 'jammy', status: 'lts' },
      { id: 'ubuntu-20.04', name: 'Ubuntu 20.04 LTS (Focal Fossa)', version: '20.04', codename: 'focal', status: 'lts' },
    ];
  }
}

/**
 * Debian 릴리스 정보 가져오기
 * @see https://www.debian.org/releases/
 */
async function fetchDebianReleases(): Promise<DistributionVersion[]> {
  try {
    // Debian distro-info-data API (비공식, releases.json 대안)
    const response = await fetch('https://deb.debian.org/debian/dists/');
    const html = await response.text();

    // 알려진 Debian 코드명과 버전 매핑
    const knownReleases: Record<string, { version: string; status: DistributionVersion['status'] }> = {
      'trixie': { version: '13', status: 'current' },
      'bookworm': { version: '12', status: 'lts' },
      'bullseye': { version: '11', status: 'supported' },
      'buster': { version: '10', status: 'eol' },
    };

    const versions: DistributionVersion[] = [];

    for (const [codename, info] of Object.entries(knownReleases)) {
      if (html.includes(`href="${codename}/"`)) {
        if (info.status !== 'eol') {
          versions.push({
            id: `debian-${info.version}`,
            name: `Debian ${info.version} (${codename.charAt(0).toUpperCase() + codename.slice(1)})`,
            version: info.version,
            codename,
            status: info.status,
          });
        }
      }
    }

    return versions.sort((a, b) => parseInt(b.version, 10) - parseInt(a.version, 10));
  } catch (error) {
    console.error('Failed to fetch Debian releases:', error);
    // 폴백
    return [
      { id: 'debian-13', name: 'Debian 13 (Trixie)', version: '13', codename: 'trixie', status: 'current' },
      { id: 'debian-12', name: 'Debian 12 (Bookworm)', version: '12', codename: 'bookworm', status: 'lts' },
      { id: 'debian-11', name: 'Debian 11 (Bullseye)', version: '11', codename: 'bullseye', status: 'supported' },
    ];
  }
}

/**
 * Rocky Linux 릴리스 정보 가져오기
 * @see https://rockylinux.org/download
 */
async function fetchRockyReleases(): Promise<DistributionVersion[]> {
  try {
    const response = await fetch('https://dl.rockylinux.org/pub/rocky/');
    const html = await response.text();

    const versionRegex = /href="(\d+)\/"/g;
    const versions: DistributionVersion[] = [];
    let match;

    while ((match = versionRegex.exec(html)) !== null) {
      const version = match[1];
      const versionNum = parseInt(version, 10);

      // 8, 9 버전만 지원
      if (versionNum >= 8 && versionNum <= 10) {
        versions.push({
          id: `rocky-${version}`,
          name: `Rocky Linux ${version}`,
          version,
          status: versionNum === 9 ? 'current' : 'lts',
        });
      }
    }

    return versions.sort((a, b) => parseInt(b.version, 10) - parseInt(a.version, 10));
  } catch (error) {
    console.error('Failed to fetch Rocky Linux releases:', error);
    // 폴백
    return [
      { id: 'rocky-9', name: 'Rocky Linux 9', version: '9', status: 'current' },
      { id: 'rocky-8', name: 'Rocky Linux 8', version: '8', status: 'lts' },
    ];
  }
}

/**
 * AlmaLinux 릴리스 정보 가져오기
 * @see https://almalinux.org/
 */
async function fetchAlmaLinuxReleases(): Promise<DistributionVersion[]> {
  try {
    const response = await fetch('https://repo.almalinux.org/almalinux/');
    const html = await response.text();

    const versionRegex = /href="(\d+)\/"/g;
    const versions: DistributionVersion[] = [];
    let match;

    while ((match = versionRegex.exec(html)) !== null) {
      const version = match[1];
      const versionNum = parseInt(version, 10);

      // 8, 9 버전만 지원
      if (versionNum >= 8 && versionNum <= 10) {
        versions.push({
          id: `almalinux-${version}`,
          name: `AlmaLinux ${version}`,
          version,
          status: versionNum === 9 ? 'current' : 'lts',
        });
      }
    }

    return versions.sort((a, b) => parseInt(b.version, 10) - parseInt(a.version, 10));
  } catch (error) {
    console.error('Failed to fetch AlmaLinux releases:', error);
    // 폴백
    return [
      { id: 'almalinux-9', name: 'AlmaLinux 9', version: '9', status: 'current' },
      { id: 'almalinux-8', name: 'AlmaLinux 8', version: '8', status: 'lts' },
    ];
  }
}

/**
 * CentOS Stream 릴리스 정보 (레거시용)
 */
function getCentOSReleases(): DistributionVersion[] {
  return [
    { id: 'centos-stream-9', name: 'CentOS Stream 9', version: 'stream-9', status: 'current' },
    { id: 'centos-7', name: 'CentOS 7', version: '7', status: 'eol' },
  ];
}

/**
 * 모든 배포판 정보 가져오기
 */
export async function fetchAllDistributions(): Promise<DistributionFamily[]> {
  // 캐시 확인
  if (distributionCache && Date.now() - distributionCache.timestamp < CACHE_TTL) {
    return distributionCache.data;
  }

  // 병렬로 모든 배포판 정보 가져오기
  const [alpine, ubuntu, debian, rocky, almalinux] = await Promise.all([
    fetchAlpineReleases(),
    fetchUbuntuReleases(),
    fetchDebianReleases(),
    fetchRockyReleases(),
    fetchAlmaLinuxReleases(),
  ]);

  const families: DistributionFamily[] = [
    {
      id: 'rocky',
      name: 'Rocky Linux',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      versions: rocky,
    },
    {
      id: 'almalinux',
      name: 'AlmaLinux',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      versions: almalinux,
    },
    {
      id: 'centos',
      name: 'CentOS',
      packageManager: 'yum',
      architectures: ['x86_64', 'aarch64'],
      versions: getCentOSReleases().filter(v => v.status !== 'eol'),
    },
    {
      id: 'ubuntu',
      name: 'Ubuntu',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64', 'armhf'],
      versions: ubuntu,
    },
    {
      id: 'debian',
      name: 'Debian',
      packageManager: 'apt',
      architectures: ['amd64', 'arm64', 'i386', 'armhf'],
      versions: debian,
    },
    {
      id: 'alpine',
      name: 'Alpine Linux',
      packageManager: 'apk',
      architectures: ['x86_64', 'aarch64', 'x86', 'armv7'],
      versions: alpine,
    },
  ];

  // 캐시 저장
  distributionCache = {
    data: families,
    timestamp: Date.now(),
  };

  return families;
}

/**
 * 배포판 패밀리를 OSDistribution 형식으로 변환
 */
export function convertToOSDistributions(families: DistributionFamily[]): Omit<OSDistribution, 'defaultRepos' | 'extendedRepos'>[] {
  const distributions: Omit<OSDistribution, 'defaultRepos' | 'extendedRepos'>[] = [];

  for (const family of families) {
    for (const version of family.versions) {
      distributions.push({
        id: version.id,
        name: version.name,
        version: version.version,
        codename: version.codename,
        packageManager: family.packageManager,
        architectures: family.architectures,
      });
    }
  }

  return distributions;
}

/**
 * 간소화된 배포판 목록 가져오기 (설정 페이지용)
 */
export async function getSimplifiedDistributions(): Promise<{
  id: string;
  name: string;
  version: string;
  osType: 'linux';
  packageManager: OSPackageManager;
  architectures: string[];
}[]> {
  const families = await fetchAllDistributions();
  const result: {
    id: string;
    name: string;
    version: string;
    osType: 'linux';
    packageManager: OSPackageManager;
    architectures: string[];
  }[] = [];

  for (const family of families) {
    for (const version of family.versions) {
      result.push({
        id: version.id,
        name: version.name,
        version: version.version,
        osType: 'linux',
        packageManager: family.packageManager,
        architectures: family.architectures as string[],
      });
    }
  }

  return result;
}

/**
 * 캐시 무효화
 */
export function invalidateDistributionCache(): void {
  distributionCache = null;
}

/**
 * 특정 패키지 관리자의 배포판만 가져오기
 */
export async function getDistributionsByPackageManager(
  packageManager: OSPackageManager
): Promise<DistributionFamily[]> {
  const families = await fetchAllDistributions();
  return families.filter(f => f.packageManager === packageManager);
}
