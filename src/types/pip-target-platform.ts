// pip 타겟 플랫폼 타입 정의
export interface PipTargetPlatform {
  os: 'linux' | 'macos' | 'windows';
  arch: 'x86_64' | 'aarch64' | 'arm64' | 'i386' | 'amd64' | 'arm/v7' | '386';
  // Python 버전 (예: '3.11', '3.12')
  pythonVersion?: string;
  // Linux 전용
  linuxDistro?: string;  // 'centos7', 'rhel8', 'rocky9', 'ubuntu20', 'ubuntu22', 'debian11'
  glibcVersion?: string; // '2.17', '2.28', '2.31', '2.34'
  // macOS 전용 - platform-mappings.ts의 MACOS_VERSIONS 키 참조
  macosVersion?: string; // '10.9' ~ '15.0' (Mavericks ~ Sequoia)
}
