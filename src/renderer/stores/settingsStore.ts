import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 설정 상태
interface SettingsState {
  // 다운로드 설정
  concurrentDownloads: number;
  enableCache: boolean;
  cachePath: string;

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

  // 액션
  updateSettings: (updates: Partial<SettingsState>) => void;
  resetSettings: () => void;
}

const defaultSettings = {
  concurrentDownloads: 3,
  enableCache: true,
  cachePath: '',

  defaultOutputFormat: 'zip' as const,
  includeInstallScripts: true,

  enableFileSplit: false,
  maxFileSize: 25, // 25MB (일반적인 이메일 첨부 제한)

  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
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
