/**
 * OS Package Repository Presets
 * OS 배포판별 저장소 프리셋 정의
 */

import type {
  OSDistribution,
  Repository,
  UseCaseRecommendation,
  OSPackageManager,
  OSArchitecture,
} from './types';

// ============================================================================
// RHEL/CentOS 계열 저장소
// ============================================================================

const centos7Repos: Repository[] = [
  {
    id: 'centos-7-base',
    name: 'CentOS 7 - Base',
    baseUrl: 'http://mirror.centos.org/centos/7/os/$basearch/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://www.centos.org/keys/RPM-GPG-KEY-CentOS-7',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'centos-7-updates',
    name: 'CentOS 7 - Updates',
    baseUrl: 'http://mirror.centos.org/centos/7/updates/$basearch/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://www.centos.org/keys/RPM-GPG-KEY-CentOS-7',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'centos-7-extras',
    name: 'CentOS 7 - Extras',
    baseUrl: 'http://mirror.centos.org/centos/7/extras/$basearch/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://www.centos.org/keys/RPM-GPG-KEY-CentOS-7',
    priority: 2,
    isOfficial: true,
  },
];

const centos7ExtendedRepos: Repository[] = [
  {
    id: 'epel-7',
    name: 'EPEL 7',
    baseUrl: 'https://dl.fedoraproject.org/pub/epel/7/$basearch/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-7',
    priority: 10,
    isOfficial: false,
  },
];

const rocky8Repos: Repository[] = [
  {
    id: 'rocky-8-baseos',
    name: 'Rocky Linux 8 - BaseOS',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/BaseOS/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-8',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'rocky-8-appstream',
    name: 'Rocky Linux 8 - AppStream',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/AppStream/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-8',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'rocky-8-extras',
    name: 'Rocky Linux 8 - Extras',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/extras/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-8',
    priority: 2,
    isOfficial: true,
  },
];

const rocky8ExtendedRepos: Repository[] = [
  {
    id: 'epel-8',
    name: 'EPEL 8',
    baseUrl: 'https://dl.fedoraproject.org/pub/epel/8/Everything/$basearch/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-8',
    priority: 10,
    isOfficial: false,
  },
  {
    id: 'rocky-8-powertools',
    name: 'Rocky Linux 8 - PowerTools',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/8/PowerTools/$basearch/os/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-8',
    priority: 5,
    isOfficial: true,
  },
];

const rocky9Repos: Repository[] = [
  {
    id: 'rocky-9-baseos',
    name: 'Rocky Linux 9 - BaseOS',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/BaseOS/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-9',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'rocky-9-appstream',
    name: 'Rocky Linux 9 - AppStream',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/AppStream/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-9',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'rocky-9-extras',
    name: 'Rocky Linux 9 - Extras',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/extras/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-9',
    priority: 2,
    isOfficial: true,
  },
];

const rocky9ExtendedRepos: Repository[] = [
  {
    id: 'epel-9',
    name: 'EPEL 9',
    baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/$basearch/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-9',
    priority: 10,
    isOfficial: false,
  },
  {
    id: 'rocky-9-crb',
    name: 'Rocky Linux 9 - CRB',
    baseUrl: 'https://dl.rockylinux.org/pub/rocky/9/CRB/$basearch/os/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.rockylinux.org/pub/rocky/RPM-GPG-KEY-Rocky-9',
    priority: 5,
    isOfficial: true,
  },
];

const almalinux8Repos: Repository[] = [
  {
    id: 'almalinux-8-baseos',
    name: 'AlmaLinux 8 - BaseOS',
    baseUrl: 'https://repo.almalinux.org/almalinux/8/BaseOS/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://repo.almalinux.org/almalinux/RPM-GPG-KEY-AlmaLinux',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'almalinux-8-appstream',
    name: 'AlmaLinux 8 - AppStream',
    baseUrl: 'https://repo.almalinux.org/almalinux/8/AppStream/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://repo.almalinux.org/almalinux/RPM-GPG-KEY-AlmaLinux',
    priority: 1,
    isOfficial: true,
  },
];

const almalinux8ExtendedRepos: Repository[] = [
  {
    id: 'epel-8',
    name: 'EPEL 8',
    baseUrl: 'https://dl.fedoraproject.org/pub/epel/8/Everything/$basearch/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-8',
    priority: 10,
    isOfficial: false,
  },
];

const almalinux9Repos: Repository[] = [
  {
    id: 'almalinux-9-baseos',
    name: 'AlmaLinux 9 - BaseOS',
    baseUrl: 'https://repo.almalinux.org/almalinux/9/BaseOS/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://repo.almalinux.org/almalinux/RPM-GPG-KEY-AlmaLinux-9',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'almalinux-9-appstream',
    name: 'AlmaLinux 9 - AppStream',
    baseUrl: 'https://repo.almalinux.org/almalinux/9/AppStream/$basearch/os/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://repo.almalinux.org/almalinux/RPM-GPG-KEY-AlmaLinux-9',
    priority: 1,
    isOfficial: true,
  },
];

const almalinux9ExtendedRepos: Repository[] = [
  {
    id: 'epel-9',
    name: 'EPEL 9',
    baseUrl: 'https://dl.fedoraproject.org/pub/epel/9/Everything/$basearch/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-9',
    priority: 10,
    isOfficial: false,
  },
];

// ============================================================================
// Debian/Ubuntu 계열 저장소
// ============================================================================

const ubuntu2004Repos: Repository[] = [
  {
    id: 'ubuntu-2004-main',
    name: 'Ubuntu 20.04 - Main',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2004-restricted',
    name: 'Ubuntu 20.04 - Restricted',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/restricted/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2004-updates',
    name: 'Ubuntu 20.04 - Updates',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal-updates/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2004-security',
    name: 'Ubuntu 20.04 - Security',
    baseUrl: 'http://security.ubuntu.com/ubuntu/dists/focal-security/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
];

const ubuntu2004ExtendedRepos: Repository[] = [
  {
    id: 'ubuntu-2004-universe',
    name: 'Ubuntu 20.04 - Universe',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/universe/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 5,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2004-multiverse',
    name: 'Ubuntu 20.04 - Multiverse',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/focal/multiverse/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 10,
    isOfficial: true,
  },
];

const ubuntu2204Repos: Repository[] = [
  {
    id: 'ubuntu-2204-main',
    name: 'Ubuntu 22.04 - Main',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2204-restricted',
    name: 'Ubuntu 22.04 - Restricted',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/restricted/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2204-updates',
    name: 'Ubuntu 22.04 - Updates',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy-updates/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2204-security',
    name: 'Ubuntu 22.04 - Security',
    baseUrl: 'http://security.ubuntu.com/ubuntu/dists/jammy-security/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
];

const ubuntu2204ExtendedRepos: Repository[] = [
  {
    id: 'ubuntu-2204-universe',
    name: 'Ubuntu 22.04 - Universe',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/universe/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 5,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2204-multiverse',
    name: 'Ubuntu 22.04 - Multiverse',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/jammy/multiverse/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 10,
    isOfficial: true,
  },
];

const ubuntu2404Repos: Repository[] = [
  {
    id: 'ubuntu-2404-main',
    name: 'Ubuntu 24.04 - Main',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2404-restricted',
    name: 'Ubuntu 24.04 - Restricted',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble/restricted/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2404-updates',
    name: 'Ubuntu 24.04 - Updates',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble-updates/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2404-security',
    name: 'Ubuntu 24.04 - Security',
    baseUrl: 'http://security.ubuntu.com/ubuntu/dists/noble-security/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 1,
    isOfficial: true,
  },
];

const ubuntu2404ExtendedRepos: Repository[] = [
  {
    id: 'ubuntu-2404-universe',
    name: 'Ubuntu 24.04 - Universe',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble/universe/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 5,
    isOfficial: true,
  },
  {
    id: 'ubuntu-2404-multiverse',
    name: 'Ubuntu 24.04 - Multiverse',
    baseUrl: 'http://archive.ubuntu.com/ubuntu/dists/noble/multiverse/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x871920D1991BC93C',
    priority: 10,
    isOfficial: true,
  },
];

const debian11Repos: Repository[] = [
  {
    id: 'debian-11-main',
    name: 'Debian 11 - Main',
    baseUrl: 'http://deb.debian.org/debian/dists/bullseye/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-11.asc',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'debian-11-updates',
    name: 'Debian 11 - Updates',
    baseUrl: 'http://deb.debian.org/debian/dists/bullseye-updates/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-11.asc',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'debian-11-security',
    name: 'Debian 11 - Security',
    baseUrl: 'http://security.debian.org/debian-security/dists/bullseye-security/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-11-security.asc',
    priority: 1,
    isOfficial: true,
  },
];

const debian11ExtendedRepos: Repository[] = [
  {
    id: 'debian-11-contrib',
    name: 'Debian 11 - Contrib',
    baseUrl: 'http://deb.debian.org/debian/dists/bullseye/contrib/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-11.asc',
    priority: 5,
    isOfficial: true,
  },
  {
    id: 'debian-11-non-free',
    name: 'Debian 11 - Non-Free',
    baseUrl: 'http://deb.debian.org/debian/dists/bullseye/non-free/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-11.asc',
    priority: 10,
    isOfficial: true,
  },
];

const debian12Repos: Repository[] = [
  {
    id: 'debian-12-main',
    name: 'Debian 12 - Main',
    baseUrl: 'http://deb.debian.org/debian/dists/bookworm/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12.asc',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'debian-12-updates',
    name: 'Debian 12 - Updates',
    baseUrl: 'http://deb.debian.org/debian/dists/bookworm-updates/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12.asc',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'debian-12-security',
    name: 'Debian 12 - Security',
    baseUrl: 'http://security.debian.org/debian-security/dists/bookworm-security/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12-security.asc',
    priority: 1,
    isOfficial: true,
  },
];

const debian12ExtendedRepos: Repository[] = [
  {
    id: 'debian-12-contrib',
    name: 'Debian 12 - Contrib',
    baseUrl: 'http://deb.debian.org/debian/dists/bookworm/contrib/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12.asc',
    priority: 5,
    isOfficial: true,
  },
  {
    id: 'debian-12-non-free',
    name: 'Debian 12 - Non-Free',
    baseUrl: 'http://deb.debian.org/debian/dists/bookworm/non-free/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12.asc',
    priority: 10,
    isOfficial: true,
  },
  {
    id: 'debian-12-non-free-firmware',
    name: 'Debian 12 - Non-Free Firmware',
    baseUrl: 'http://deb.debian.org/debian/dists/bookworm/non-free-firmware/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://ftp-master.debian.org/keys/archive-key-12.asc',
    priority: 10,
    isOfficial: true,
  },
];

// ============================================================================
// Alpine 계열 저장소
// ============================================================================

const alpine318Repos: Repository[] = [
  {
    id: 'alpine-318-main',
    name: 'Alpine 3.18 - Main',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.18/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'alpine-318-community',
    name: 'Alpine 3.18 - Community',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.18/community/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 2,
    isOfficial: true,
  },
];

const alpine318ExtendedRepos: Repository[] = [
  {
    id: 'alpine-318-testing',
    name: 'Alpine 3.18 - Testing',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/edge/testing/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 10,
    isOfficial: true,
  },
];

const alpine319Repos: Repository[] = [
  {
    id: 'alpine-319-main',
    name: 'Alpine 3.19 - Main',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'alpine-319-community',
    name: 'Alpine 3.19 - Community',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.19/community/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 2,
    isOfficial: true,
  },
];

const alpine319ExtendedRepos: Repository[] = [
  {
    id: 'alpine-319-testing',
    name: 'Alpine 3.19 - Testing',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/edge/testing/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 10,
    isOfficial: true,
  },
];

const alpine320Repos: Repository[] = [
  {
    id: 'alpine-320-main',
    name: 'Alpine 3.20 - Main',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.20/main/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 1,
    isOfficial: true,
  },
  {
    id: 'alpine-320-community',
    name: 'Alpine 3.20 - Community',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.20/community/',
    enabled: true,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 2,
    isOfficial: true,
  },
];

const alpine320ExtendedRepos: Repository[] = [
  {
    id: 'alpine-320-testing',
    name: 'Alpine 3.20 - Testing',
    baseUrl: 'https://dl-cdn.alpinelinux.org/alpine/edge/testing/',
    enabled: false,
    gpgCheck: true,
    gpgKeyUrl: 'https://alpinelinux.org/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub',
    priority: 10,
    isOfficial: true,
  },
];

// ============================================================================
// 배포판 정의
// ============================================================================

/**
 * 모든 지원 배포판 목록
 */
export const OS_DISTRIBUTIONS: OSDistribution[] = [
  // RHEL 계열
  {
    id: 'centos-7',
    name: 'CentOS 7',
    version: '7',
    packageManager: 'yum',
    architectures: ['x86_64', 'aarch64', 'i686'],
    defaultRepos: centos7Repos,
    extendedRepos: centos7ExtendedRepos,
  },
  {
    id: 'rocky-8',
    name: 'Rocky Linux 8',
    version: '8',
    packageManager: 'yum',
    architectures: ['x86_64', 'aarch64'],
    defaultRepos: rocky8Repos,
    extendedRepos: rocky8ExtendedRepos,
  },
  {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64', 'aarch64'],
    defaultRepos: rocky9Repos,
    extendedRepos: rocky9ExtendedRepos,
  },
  {
    id: 'almalinux-8',
    name: 'AlmaLinux 8',
    version: '8',
    packageManager: 'yum',
    architectures: ['x86_64', 'aarch64'],
    defaultRepos: almalinux8Repos,
    extendedRepos: almalinux8ExtendedRepos,
  },
  {
    id: 'almalinux-9',
    name: 'AlmaLinux 9',
    version: '9',
    packageManager: 'yum',
    architectures: ['x86_64', 'aarch64'],
    defaultRepos: almalinux9Repos,
    extendedRepos: almalinux9ExtendedRepos,
  },

  // Debian 계열
  {
    id: 'ubuntu-20.04',
    name: 'Ubuntu 20.04 LTS (Focal Fossa)',
    version: '20.04',
    codename: 'focal',
    packageManager: 'apt',
    architectures: ['amd64', 'arm64', 'i386', 'armhf'],
    defaultRepos: ubuntu2004Repos,
    extendedRepos: ubuntu2004ExtendedRepos,
  },
  {
    id: 'ubuntu-22.04',
    name: 'Ubuntu 22.04 LTS (Jammy Jellyfish)',
    version: '22.04',
    codename: 'jammy',
    packageManager: 'apt',
    architectures: ['amd64', 'arm64', 'armhf'],
    defaultRepos: ubuntu2204Repos,
    extendedRepos: ubuntu2204ExtendedRepos,
  },
  {
    id: 'ubuntu-24.04',
    name: 'Ubuntu 24.04 LTS (Noble Numbat)',
    version: '24.04',
    codename: 'noble',
    packageManager: 'apt',
    architectures: ['amd64', 'arm64', 'armhf'],
    defaultRepos: ubuntu2404Repos,
    extendedRepos: ubuntu2404ExtendedRepos,
  },
  {
    id: 'debian-11',
    name: 'Debian 11 (Bullseye)',
    version: '11',
    codename: 'bullseye',
    packageManager: 'apt',
    architectures: ['amd64', 'arm64', 'i386', 'armhf'],
    defaultRepos: debian11Repos,
    extendedRepos: debian11ExtendedRepos,
  },
  {
    id: 'debian-12',
    name: 'Debian 12 (Bookworm)',
    version: '12',
    codename: 'bookworm',
    packageManager: 'apt',
    architectures: ['amd64', 'arm64', 'i386', 'armhf'],
    defaultRepos: debian12Repos,
    extendedRepos: debian12ExtendedRepos,
  },

  // Alpine
  {
    id: 'alpine-3.18',
    name: 'Alpine Linux 3.18',
    version: '3.18',
    packageManager: 'apk',
    architectures: ['x86_64', 'aarch64', 'x86', 'armv7'],
    defaultRepos: alpine318Repos,
    extendedRepos: alpine318ExtendedRepos,
  },
  {
    id: 'alpine-3.19',
    name: 'Alpine Linux 3.19',
    version: '3.19',
    packageManager: 'apk',
    architectures: ['x86_64', 'aarch64', 'x86', 'armv7'],
    defaultRepos: alpine319Repos,
    extendedRepos: alpine319ExtendedRepos,
  },
  {
    id: 'alpine-3.20',
    name: 'Alpine Linux 3.20',
    version: '3.20',
    packageManager: 'apk',
    architectures: ['x86_64', 'aarch64', 'x86', 'armv7'],
    defaultRepos: alpine320Repos,
    extendedRepos: alpine320ExtendedRepos,
  },
];

// ============================================================================
// 용도별 추천
// ============================================================================

/**
 * 용도별 배포판 추천
 */
export const USE_CASE_RECOMMENDATIONS: UseCaseRecommendation[] = [
  {
    id: 'enterprise',
    name: '엔터프라이즈',
    description: '안정성과 장기 지원이 중요한 기업 환경',
    distributions: ['rocky-9', 'almalinux-9', 'ubuntu-22.04', 'debian-12'],
  },
  {
    id: 'legacy',
    name: '레거시',
    description: '기존 시스템 호환성이 필요한 환경',
    distributions: ['centos-7', 'ubuntu-20.04', 'debian-11'],
  },
  {
    id: 'container',
    name: '컨테이너',
    description: '컨테이너 및 마이크로서비스 환경',
    distributions: ['alpine-3.20', 'alpine-3.19', 'debian-12'],
  },
  {
    id: 'development',
    name: '개발',
    description: '최신 패키지와 도구가 필요한 개발 환경',
    distributions: ['ubuntu-24.04', 'debian-12', 'rocky-9', 'alpine-3.20'],
  },
];

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 배포판 ID로 배포판 정보 가져오기
 */
export function getDistributionById(id: string): OSDistribution | undefined {
  return OS_DISTRIBUTIONS.find((dist) => dist.id === id);
}

/**
 * 패키지 관리자별 배포판 목록 가져오기
 */
export function getDistributionsByPackageManager(
  packageManager: OSPackageManager
): OSDistribution[] {
  return OS_DISTRIBUTIONS.filter((dist) => dist.packageManager === packageManager);
}

/**
 * 용도별 추천 배포판 가져오기
 */
export function getRecommendedDistributions(
  useCase: UseCaseRecommendation['id']
): OSDistribution[] {
  const recommendation = USE_CASE_RECOMMENDATIONS.find((r) => r.id === useCase);
  if (!recommendation) return [];
  return recommendation.distributions
    .map((id) => getDistributionById(id))
    .filter((dist): dist is OSDistribution => dist !== undefined);
}

/**
 * 아키텍처 정규화 (다른 표기법을 통일)
 */
export function normalizeArchitecture(arch: string): OSArchitecture {
  const archMap: Record<string, OSArchitecture> = {
    // 64비트 x86
    x86_64: 'x86_64',
    amd64: 'amd64',
    x64: 'x86_64',
    // 64비트 ARM
    aarch64: 'aarch64',
    arm64: 'arm64',
    // 32비트 x86
    i686: 'i686',
    i386: 'i386',
    i586: 'i686',
    x86: 'i686',
    // 32비트 ARM
    armv7l: 'armv7l',
    armhf: 'armhf',
    armv7: 'armv7l',
    arm: 'armhf',
    // 아키텍처 무관
    noarch: 'noarch',
    all: 'all',
    any: 'noarch',
  };

  return archMap[arch.toLowerCase()] || (arch as OSArchitecture);
}

/**
 * 아키텍처 호환성 확인 (noarch/all은 모든 아키텍처와 호환)
 */
export function isArchitectureCompatible(
  packageArch: OSArchitecture,
  targetArch: OSArchitecture
): boolean {
  // 아키텍처 무관 패키지는 모든 아키텍처에서 사용 가능
  if (packageArch === 'noarch' || packageArch === 'all') {
    return true;
  }

  // 동일 아키텍처
  if (packageArch === targetArch) {
    return true;
  }

  // 동일 계열 아키텍처 (x86_64 <-> amd64, aarch64 <-> arm64 등)
  const equivalentArchs: OSArchitecture[][] = [
    ['x86_64', 'amd64'],
    ['aarch64', 'arm64'],
    ['i686', 'i386'],
    ['armv7l', 'armhf'],
  ];

  for (const group of equivalentArchs) {
    if (group.includes(packageArch) && group.includes(targetArch)) {
      return true;
    }
  }

  return false;
}

/**
 * 저장소 URL에서 변수 치환 ($basearch, $releasever 등)
 */
export function resolveRepoUrl(
  baseUrl: string,
  arch: OSArchitecture,
  distribution: OSDistribution
): string {
  // 아키텍처 이름 정규화 (yum/rpm은 x86_64, apt/deb은 amd64 사용)
  let resolvedArch = arch;
  if (distribution.packageManager === 'yum' && arch === 'amd64') {
    resolvedArch = 'x86_64';
  } else if (distribution.packageManager === 'apt' && arch === 'x86_64') {
    resolvedArch = 'amd64';
  }

  return baseUrl
    .replace(/\$basearch/g, resolvedArch)
    .replace(/\$releasever/g, distribution.version)
    .replace(/\$arch/g, resolvedArch);
}

/**
 * 사용자 정의 저장소 생성
 */
export function createCustomRepository(
  id: string,
  name: string,
  baseUrl: string,
  options: Partial<Omit<Repository, 'id' | 'name' | 'baseUrl'>> = {}
): Repository {
  return {
    id,
    name,
    baseUrl,
    enabled: options.enabled ?? true,
    gpgCheck: options.gpgCheck ?? false,
    gpgKeyUrl: options.gpgKeyUrl,
    priority: options.priority ?? 99,
    isOfficial: false,
  };
}
