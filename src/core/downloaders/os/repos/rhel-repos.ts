/**
 * RHEL/CentOS 계열 저장소 정의
 * CentOS 7, Rocky Linux 8/9, AlmaLinux 8/9
 */

import type { Repository } from '../types';

// CentOS 7
export const centos7Repos: Repository[] = [
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

export const centos7ExtendedRepos: Repository[] = [
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

// Rocky Linux 8
export const rocky8Repos: Repository[] = [
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

export const rocky8ExtendedRepos: Repository[] = [
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

// Rocky Linux 9
export const rocky9Repos: Repository[] = [
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

export const rocky9ExtendedRepos: Repository[] = [
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

// AlmaLinux 8
export const almalinux8Repos: Repository[] = [
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

export const almalinux8ExtendedRepos: Repository[] = [
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

// AlmaLinux 9
export const almalinux9Repos: Repository[] = [
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

export const almalinux9ExtendedRepos: Repository[] = [
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
