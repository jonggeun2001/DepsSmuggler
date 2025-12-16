/**
 * Debian/Ubuntu 계열 저장소 정의
 * Ubuntu 20.04/22.04/24.04, Debian 11/12
 */

import type { Repository } from '../types';

// Ubuntu 20.04
export const ubuntu2004Repos: Repository[] = [
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

export const ubuntu2004ExtendedRepos: Repository[] = [
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

// Ubuntu 22.04
export const ubuntu2204Repos: Repository[] = [
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

export const ubuntu2204ExtendedRepos: Repository[] = [
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

// Ubuntu 24.04
export const ubuntu2404Repos: Repository[] = [
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

export const ubuntu2404ExtendedRepos: Repository[] = [
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

// Debian 11
export const debian11Repos: Repository[] = [
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

export const debian11ExtendedRepos: Repository[] = [
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

// Debian 12
export const debian12Repos: Repository[] = [
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

export const debian12ExtendedRepos: Repository[] = [
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
