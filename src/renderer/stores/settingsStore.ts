import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 언어 버전 타입 정의
export interface LanguageVersions {
  python: string;  // 예: '3.11', '3.10', '3.9'
  java: string;    // 예: '21', '17', '11', '8'
  node: string;    // 예: '20', '18', '16'
}

// 대상 OS 타입 정의 (라이브러리 패키지용)
export type TargetOS = 'windows' | 'macos' | 'linux';

// 기본 아키텍처 타입 정의
export type DefaultArchitecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'noarch';

// Conda 채널 타입 정의
export type CondaChannel = 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch';

// Docker 레지스트리 타입 정의
export type DockerRegistry = 'docker.io' | 'ghcr.io' | 'ecr' | 'quay.io' | 'custom';

// Docker 레이어 압축 방식
export type DockerLayerCompression = 'gzip' | 'tar';

// Docker 재시도 전략
export type DockerRetryStrategy = 'layer' | 'full';

// Docker 아키텍처 타입 정의
export type DockerArchitecture = 'amd64' | 'arm64' | 'arm/v7' | '386';

// OS 배포판 설정 타입 정의
// id: 배포판 식별자 (예: 'rocky-9', 'almalinux-8', 'ubuntu-22.04', 'debian-12', 'alpine-3.18')
// architecture: 대상 CPU 아키텍처 (YUM/APK: 'x86_64', 'aarch64' / APT: 'amd64', 'arm64', 'i386')
export interface OSDistributionSetting {
  id: string;           // 배포판 ID - API에서 동적으로 로드된 목록과 매칭
  architecture: string; // 아키텍처 - 배포판별 지원 아키텍처 중 선택
}

// 설정 상태
interface SettingsState {
  // 다운로드 설정
  concurrentDownloads: number;
  enableCache: boolean;
  cachePath: string;
  includeDependencies: boolean; // 의존성 자동 포함 다운로드
  defaultDownloadPath: string;  // 기본 다운로드 경로

  // 출력 설정
  defaultOutputFormat: 'zip' | 'tar.gz';
  includeInstallScripts: boolean;

  // 파일 분할 설정
  enableFileSplit: boolean;
  maxFileSize: number; // MB 단위

  // SMTP 설정
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;

  // 언어 버전 설정
  languageVersions: LanguageVersions;

  // 기본 OS/아키텍처 설정 (라이브러리 패키지용)
  defaultTargetOS: TargetOS;
  defaultArchitecture: DefaultArchitecture;

  // Conda 채널 설정
  condaChannel: CondaChannel;

  // OS 패키지 배포판 설정
  yumDistribution: OSDistributionSetting;  // YUM (RHEL 계열)
  aptDistribution: OSDistributionSetting;  // APT (Debian/Ubuntu 계열)
  apkDistribution: OSDistributionSetting;  // APK (Alpine)

  // Docker 설정
  dockerRegistry: DockerRegistry;           // 기본 레지스트리
  dockerCustomRegistry: string;             // 커스텀 레지스트리 URL
  dockerArchitecture: DockerArchitecture;   // Docker 이미지 아키텍처
  dockerLayerCompression: DockerLayerCompression;  // 레이어 압축 방식
  dockerRetryStrategy: DockerRetryStrategy; // 재시도 전략
  dockerIncludeLoadScript: boolean;         // docker load 스크립트 포함

  // 액션
  updateSettings: (updates: Partial<SettingsState>) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  concurrentDownloads: 3,
  enableCache: true,
  cachePath: '',
  includeDependencies: true, // 기본값: 의존성 포함
  defaultDownloadPath: '',   // 기본 다운로드 경로 (빈 값이면 시스템 기본 다운로드 폴더 사용)

  defaultOutputFormat: 'zip' as const,
  includeInstallScripts: true,

  enableFileSplit: false,
  maxFileSize: 25, // 25MB (일반적인 이메일 첨부 제한)

  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',

  languageVersions: {
    python: '3.11',
    java: '17',
    node: '20',
  },

  defaultTargetOS: 'linux' as const,
  defaultArchitecture: 'x86_64' as const,

  condaChannel: 'conda-forge' as const,

  // OS 패키지 배포판 기본값 (LTS 안정 버전)
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-22.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.18', architecture: 'x86_64' },

  // Docker 설정 기본값
  dockerRegistry: 'docker.io' as const,
  dockerCustomRegistry: '',
  dockerArchitecture: 'amd64' as const,
  dockerLayerCompression: 'gzip' as const,
  dockerRetryStrategy: 'layer' as const,
  dockerIncludeLoadScript: true,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      updateSettings: (updates) => set((state) => ({ ...state, ...updates })),

      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'depssmuggler-settings',
    }
  )
);
