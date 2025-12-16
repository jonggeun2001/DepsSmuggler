/**
 * OS Package Repository Presets
 * OS 배포판별 저장소 프리셋 정의
 *
 * 이 파일은 기존 repositories.ts의 기능을 유지하면서
 * 배포판별로 분리된 파일들을 통합합니다.
 */

import type { OSDistribution, UseCaseRecommendation } from '../types';

// RHEL 계열 저장소
export {
  centos7Repos,
  centos7ExtendedRepos,
  rocky8Repos,
  rocky8ExtendedRepos,
  rocky9Repos,
  rocky9ExtendedRepos,
  almalinux8Repos,
  almalinux8ExtendedRepos,
  almalinux9Repos,
  almalinux9ExtendedRepos,
} from './rhel-repos';

// Debian/Ubuntu 계열 저장소
export {
  ubuntu2004Repos,
  ubuntu2004ExtendedRepos,
  ubuntu2204Repos,
  ubuntu2204ExtendedRepos,
  ubuntu2404Repos,
  ubuntu2404ExtendedRepos,
  debian11Repos,
  debian11ExtendedRepos,
  debian12Repos,
  debian12ExtendedRepos,
} from './debian-repos';

// Alpine 계열 저장소
export {
  alpine318Repos,
  alpine318ExtendedRepos,
  alpine319Repos,
  alpine319ExtendedRepos,
  alpine320Repos,
  alpine320ExtendedRepos,
} from './alpine-repos';

// 유틸리티 함수
export {
  normalizeArchitecture,
  isArchitectureCompatible,
  resolveRepoUrl,
  createCustomRepository,
  getDistributionById,
  getDistributionsByPackageManager,
  getRecommendedDistributions,
  setDistributionsRef,
} from './repository-utils';

// 저장소 상수들을 import하여 OS_DISTRIBUTIONS 구성
import {
  centos7Repos,
  centos7ExtendedRepos,
  rocky8Repos,
  rocky8ExtendedRepos,
  rocky9Repos,
  rocky9ExtendedRepos,
  almalinux8Repos,
  almalinux8ExtendedRepos,
  almalinux9Repos,
  almalinux9ExtendedRepos,
} from './rhel-repos';

import {
  ubuntu2004Repos,
  ubuntu2004ExtendedRepos,
  ubuntu2204Repos,
  ubuntu2204ExtendedRepos,
  ubuntu2404Repos,
  ubuntu2404ExtendedRepos,
  debian11Repos,
  debian11ExtendedRepos,
  debian12Repos,
  debian12ExtendedRepos,
} from './debian-repos';

import {
  alpine318Repos,
  alpine318ExtendedRepos,
  alpine319Repos,
  alpine319ExtendedRepos,
  alpine320Repos,
  alpine320ExtendedRepos,
} from './alpine-repos';

import { setDistributionsRef } from './repository-utils';

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

// 유틸리티 함수들이 배포판 목록을 참조할 수 있도록 설정
setDistributionsRef(OS_DISTRIBUTIONS, USE_CASE_RECOMMENDATIONS);
