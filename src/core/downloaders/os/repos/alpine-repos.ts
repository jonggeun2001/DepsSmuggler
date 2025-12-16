/**
 * Alpine Linux 계열 저장소 정의
 * Alpine 3.18/3.19/3.20
 */

import type { Repository } from '../types';

// Alpine 3.18
export const alpine318Repos: Repository[] = [
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

export const alpine318ExtendedRepos: Repository[] = [
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

// Alpine 3.19
export const alpine319Repos: Repository[] = [
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

export const alpine319ExtendedRepos: Repository[] = [
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

// Alpine 3.20
export const alpine320Repos: Repository[] = [
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

export const alpine320ExtendedRepos: Repository[] = [
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
