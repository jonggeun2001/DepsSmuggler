/**
 * OS Package Repository Presets
 * OS 배포판별 저장소 프리셋 정의
 *
 * 이 파일은 기존 호환성을 위해 유지됩니다.
 * 실제 구현은 ./repos/ 디렉토리에 분리되어 있습니다.
 */

// 모든 내보내기를 repos/index.ts에서 re-export
export {
  // RHEL 계열 저장소
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
  // Debian/Ubuntu 계열 저장소
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
  // Alpine 계열 저장소
  alpine318Repos,
  alpine318ExtendedRepos,
  alpine319Repos,
  alpine319ExtendedRepos,
  alpine320Repos,
  alpine320ExtendedRepos,
  // 배포판 정의
  OS_DISTRIBUTIONS,
  USE_CASE_RECOMMENDATIONS,
  // 유틸리티 함수
  getDistributionById,
  getDistributionsByPackageManager,
  getRecommendedDistributions,
  normalizeArchitecture,
  isArchitectureCompatible,
  resolveRepoUrl,
  createCustomRepository,
} from './repos';
