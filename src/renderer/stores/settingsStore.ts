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

// 설정 상태
interface SettingsState {
  // 다운로드 설정
  concurrentDownloads: number;
  enableCache: boolean;
  cachePath: string;
  includeDependencies: boolean; // 의존성 자동 포함 다운로드

  // 출력 설정
  defaultOutputFormat: 'zip' | 'tar.gz' | 'mirror';
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

  // 액션
  updateSettings: (updates: Partial<SettingsState>) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  concurrentDownloads: 3,
  enableCache: true,
  cachePath: '',
  includeDependencies: true, // 기본값: 의존성 포함

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
