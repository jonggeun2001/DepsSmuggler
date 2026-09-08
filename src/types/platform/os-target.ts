export type TargetOS = 'windows' | 'macos' | 'linux' | 'any';
export type OsTarget = TargetOS;

/** OS 패키지의 대상 배포판과 아키텍처 */
export interface OSDistributionSetting {
  /** 배포판 ID (예: rocky-9, ubuntu-22.04, alpine-3.18) */
  id: string;
  /** 배포판에서 지원하는 아키텍처 (예: x86_64, amd64, aarch64, arm64) */
  architecture: string;
}
