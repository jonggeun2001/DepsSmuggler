export interface PipTargetPlatform {
  os: 'linux' | 'macos' | 'windows';
  arch: 'x86_64' | 'aarch64' | 'arm64' | 'i386' | 'amd64' | 'arm/v7' | '386';
  pythonVersion?: string;
  linuxDistro?: string;
  glibcVersion?: string;
  macosVersion?: string;
}
