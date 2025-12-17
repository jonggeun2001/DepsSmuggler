/**
 * Linux 배포판별 glibc 버전 및 메타데이터
 */

/**
 * Linux 배포판 정보 인터페이스
 */
export interface LinuxDistroInfo {
  id: string;              // 'centos7', 'rhel8', 'ubuntu22', etc.
  name: string;            // 'CentOS 7', 'RHEL 8', 'Ubuntu 22.04 LTS'
  family: 'rhel' | 'debian' | 'ubuntu' | 'other';
  glibcVersion: string;    // '2.17', '2.28', '2.34', '2.35', '2.39', etc.
  releaseDate?: string;    // '2014-06-10'
  eolDate?: string;        // '2024-06-30'
  status: 'current' | 'lts' | 'eol' | 'extended-support';
  notes?: string;          // 추가 설명
}

/**
 * 중앙 배포판 매핑
 */
export const LINUX_DISTRO_GLIBC_MAP: Record<string, LinuxDistroInfo> = {
  // RHEL 계열
  'centos7': {
    id: 'centos7',
    name: 'CentOS 7',
    family: 'rhel',
    glibcVersion: '2.17',
    releaseDate: '2014-06-10',
    eolDate: '2024-06-30',
    status: 'eol',
    notes: 'Extended support until 2024-06-30'
  },
  'rhel7': {
    id: 'rhel7',
    name: 'RHEL 7',
    family: 'rhel',
    glibcVersion: '2.17',
    releaseDate: '2014-06-10',
    eolDate: '2024-06-30',
    status: 'extended-support',
    notes: 'ELS available'
  },
  'rhel8': {
    id: 'rhel8',
    name: 'RHEL 8',
    family: 'rhel',
    glibcVersion: '2.28',
    releaseDate: '2019-05-07',
    eolDate: '2029-05-31',
    status: 'lts'
  },
  'rocky8': {
    id: 'rocky8',
    name: 'Rocky Linux 8',
    family: 'rhel',
    glibcVersion: '2.28',
    releaseDate: '2021-06-21',
    eolDate: '2029-05-31',
    status: 'lts'
  },
  'almalinux8': {
    id: 'almalinux8',
    name: 'AlmaLinux 8',
    family: 'rhel',
    glibcVersion: '2.28',
    releaseDate: '2021-03-30',
    eolDate: '2029-03-01',
    status: 'lts'
  },
  'rhel9': {
    id: 'rhel9',
    name: 'RHEL 9',
    family: 'rhel',
    glibcVersion: '2.34',
    releaseDate: '2022-05-18',
    eolDate: '2032-05-31',
    status: 'current'
  },
  'rocky9': {
    id: 'rocky9',
    name: 'Rocky Linux 9',
    family: 'rhel',
    glibcVersion: '2.34',
    releaseDate: '2022-07-14',
    eolDate: '2032-05-31',
    status: 'current'
  },
  'almalinux9': {
    id: 'almalinux9',
    name: 'AlmaLinux 9',
    family: 'rhel',
    glibcVersion: '2.34',
    releaseDate: '2022-05-26',
    eolDate: '2032-05-31',
    status: 'current'
  },

  // Ubuntu
  'ubuntu20': {
    id: 'ubuntu20',
    name: 'Ubuntu 20.04 LTS',
    family: 'ubuntu',
    glibcVersion: '2.31',
    releaseDate: '2020-04-23',
    eolDate: '2025-04-23',
    status: 'lts',
    notes: 'Extended security until 2030-04'
  },
  'ubuntu22': {
    id: 'ubuntu22',
    name: 'Ubuntu 22.04 LTS',
    family: 'ubuntu',
    glibcVersion: '2.35',
    releaseDate: '2022-04-21',
    eolDate: '2027-04-21',
    status: 'lts'
  },
  'ubuntu24': {
    id: 'ubuntu24',
    name: 'Ubuntu 24.04 LTS',
    family: 'ubuntu',
    glibcVersion: '2.39',
    releaseDate: '2024-04-25',
    eolDate: '2029-04-25',
    status: 'current'
  },

  // Debian
  'debian11': {
    id: 'debian11',
    name: 'Debian 11 Bullseye',
    family: 'debian',
    glibcVersion: '2.31',
    releaseDate: '2021-08-14',
    eolDate: '2024-06-30',
    status: 'lts',
    notes: 'LTS support until 2026-06'
  },
  'debian12': {
    id: 'debian12',
    name: 'Debian 12 Bookworm',
    family: 'debian',
    glibcVersion: '2.36',
    releaseDate: '2023-06-10',
    eolDate: '2026-06-10',
    status: 'current'
  }
};

/**
 * 배포판 family별 그룹핑
 */
export const getDistrosByFamily = (): Record<string, LinuxDistroInfo[]> => {
  const grouped: Record<string, LinuxDistroInfo[]> = {
    rhel: [],
    ubuntu: [],
    debian: [],
    other: []
  };

  Object.values(LINUX_DISTRO_GLIBC_MAP).forEach(distro => {
    grouped[distro.family].push(distro);
  });

  return grouped;
};

/**
 * glibc 버전으로 역조회
 */
export const getDistrosByGlibcVersion = (glibcVersion: string): LinuxDistroInfo[] => {
  return Object.values(LINUX_DISTRO_GLIBC_MAP).filter(
    distro => distro.glibcVersion === glibcVersion
  );
};

/**
 * EOL 체크
 */
export const isDistroEOL = (distroId: string): boolean => {
  const distro = LINUX_DISTRO_GLIBC_MAP[distroId];
  if (!distro || !distro.eolDate) return false;

  const now = new Date();
  const eol = new Date(distro.eolDate);
  return now > eol;
};

/**
 * EOL 임박 체크 (6개월 이내)
 */
export const isDistroEOLSoon = (distroId: string, months: number = 6): boolean => {
  const distro = LINUX_DISTRO_GLIBC_MAP[distroId];
  if (!distro || !distro.eolDate) return false;

  const now = new Date();
  const eol = new Date(distro.eolDate);
  const thresholdDate = new Date(now);
  thresholdDate.setMonth(thresholdDate.getMonth() + months);

  return eol <= thresholdDate && eol > now;
};

/**
 * glibc 버전 간단 매핑 (기존 SettingsPage.tsx 호환)
 */
export const GLIBC_VERSION_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(LINUX_DISTRO_GLIBC_MAP).map(([id, info]) => [id, info.glibcVersion])
);

/**
 * macOS 버전별 메타데이터
 */
export interface MacOSVersionInfo {
  version: string;         // "10.9", "11.0", "12.0", "13.0", "14.0", "15.0"
  name: string;            // "Mavericks", "Big Sur", "Monterey", "Ventura", "Sonoma", "Sequoia"
  minArch: 'intel' | 'apple_silicon' | 'both';  // 최소 아키텍처 요구사항
  releaseYear: number;     // 2013, 2020, 2021, 2022, 2023, 2024
  releaseDate?: string;    // "2013-10-22", "2020-11-12", etc.
  eolDate?: string;        // End of Life 날짜 (알려진 경우)
  isLTS?: boolean;         // macOS는 LTS 개념이 없지만 향후 확장 가능
}

/**
 * macOS 버전 매핑 (10.9 Mavericks ~ 15.0 Sequoia)
 *
 * pip wheel의 macosx 태그와 매칭하기 위한 버전 목록
 * wheel 파일명 예시: numpy-1.24.0-cp311-cp311-macosx_10_9_x86_64.whl
 *                   torch-2.0.0-cp311-none-macosx_11_0_arm64.whl
 */
export const MACOS_VERSIONS: Record<string, MacOSVersionInfo> = {
  '10.9': {
    version: '10.9',
    name: 'Mavericks',
    minArch: 'intel',
    releaseYear: 2013,
    releaseDate: '2013-10-22',
  },
  '10.10': {
    version: '10.10',
    name: 'Yosemite',
    minArch: 'intel',
    releaseYear: 2014,
    releaseDate: '2014-10-16',
  },
  '10.11': {
    version: '10.11',
    name: 'El Capitan',
    minArch: 'intel',
    releaseYear: 2015,
    releaseDate: '2015-09-30',
  },
  '10.12': {
    version: '10.12',
    name: 'Sierra',
    minArch: 'intel',
    releaseYear: 2016,
    releaseDate: '2016-09-20',
  },
  '10.13': {
    version: '10.13',
    name: 'High Sierra',
    minArch: 'intel',
    releaseYear: 2017,
    releaseDate: '2017-09-25',
  },
  '10.14': {
    version: '10.14',
    name: 'Mojave',
    minArch: 'intel',
    releaseYear: 2018,
    releaseDate: '2018-09-24',
  },
  '10.15': {
    version: '10.15',
    name: 'Catalina',
    minArch: 'intel',
    releaseYear: 2019,
    releaseDate: '2019-10-07',
  },
  '11.0': {
    version: '11.0',
    name: 'Big Sur',
    minArch: 'both',  // Intel과 Apple Silicon 모두 지원
    releaseYear: 2020,
    releaseDate: '2020-11-12',
  },
  '12.0': {
    version: '12.0',
    name: 'Monterey',
    minArch: 'both',
    releaseYear: 2021,
    releaseDate: '2021-10-25',
  },
  '13.0': {
    version: '13.0',
    name: 'Ventura',
    minArch: 'both',
    releaseYear: 2022,
    releaseDate: '2022-10-24',
  },
  '14.0': {
    version: '14.0',
    name: 'Sonoma',
    minArch: 'both',
    releaseYear: 2023,
    releaseDate: '2023-09-26',
  },
  '15.0': {
    version: '15.0',
    name: 'Sequoia',
    minArch: 'both',
    releaseYear: 2024,
    releaseDate: '2024-09-16',
  },
};

/**
 * macOS 버전 목록을 릴리스 연도 순으로 정렬하여 반환
 */
export function getMacOSVersionsSorted(): MacOSVersionInfo[] {
  return Object.values(MACOS_VERSIONS).sort((a, b) => a.releaseYear - b.releaseYear);
}

/**
 * macOS 버전 문자열로 메타데이터 조회
 */
export function getMacOSVersionInfo(version: string): MacOSVersionInfo | undefined {
  return MACOS_VERSIONS[version];
}

/**
 * 아키텍처 호환성 체크
 */
export function isMacOSVersionCompatibleWithArch(
  version: string,
  arch: 'x86_64' | 'arm64'
): boolean {
  const versionInfo = getMacOSVersionInfo(version);
  if (!versionInfo) return false;

  if (versionInfo.minArch === 'both') return true;
  if (versionInfo.minArch === 'intel') return arch === 'x86_64';
  if (versionInfo.minArch === 'apple_silicon') return arch === 'arm64';

  return false;
}
