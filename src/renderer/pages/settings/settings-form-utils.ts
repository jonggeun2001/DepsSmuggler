import type {
  CondaChannel,
  CudaVersion,
  DefaultArchitecture,
  DockerArchitecture,
  DockerLayerCompression,
  LanguageVersions,
  OSDistributionSetting,
  PipTargetPlatform,
  TargetOS,
} from '../../stores/settings-store';

export const SETTINGS_CARD_MARGIN = 12;
export const SETTINGS_CARD_BODY_PADDING = '12px 16px';

export interface SettingsStoreSnapshot {
  concurrentDownloads: number;
  enableCache: boolean;
  cachePath: string;
  includeDependencies: boolean;
  defaultDownloadPath: string;
  defaultOutputFormat: 'zip' | 'tar.gz';
  includeInstallScripts: boolean;
  enableFileSplit: boolean;
  maxFileSize: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpTo: string;
  languageVersions: LanguageVersions;
  defaultTargetOS: TargetOS;
  defaultArchitecture: DefaultArchitecture;
  pipTargetPlatform: PipTargetPlatform;
  condaChannel: CondaChannel;
  cudaVersion: CudaVersion;
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
  dockerArchitecture: DockerArchitecture;
  dockerLayerCompression: DockerLayerCompression;
  dockerIncludeLoadScript: boolean;
  autoUpdate: boolean;
  autoDownloadUpdate: boolean;
  downloadRenderInterval: number;
}

export interface SettingsFormValues {
  concurrentDownloads: number;
  enableCache: boolean;
  cachePath: string;
  includeDependencies: boolean;
  defaultDownloadPath: string;
  defaultOutputFormat: 'zip' | 'tar.gz';
  includeInstallScripts: boolean;
  enableFileSplit: boolean;
  maxFileSize: number;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  smtpTo: string;
  languageVersions: LanguageVersions;
  defaultTargetOS: TargetOS;
  defaultArchitecture: DefaultArchitecture;
  pipTargetPlatform: PipTargetPlatform;
  condaChannel: CondaChannel;
  cudaVersion: CudaVersion;
  yumDistributionId: string;
  yumArchitecture: string;
  aptDistributionId: string;
  aptArchitecture: string;
  apkDistributionId: string;
  apkArchitecture: string;
  dockerArchitecture: DockerArchitecture;
  dockerLayerCompression: DockerLayerCompression;
  dockerIncludeLoadScript: boolean;
  autoUpdate: boolean;
  autoDownloadUpdate: boolean;
  downloadRenderInterval: number;
}

export type SettingsFormSubmission = Record<string, unknown> & Partial<SettingsFormValues>;

export interface SettingsFormValueWriter {
  getFieldsValue?: (all?: boolean) => SettingsFormSubmission;
  resetFields?: () => void;
  setFieldsValue: (values: SettingsFormSubmission) => void;
}

export interface ApplySynchronizedSettingsFormStateOptions {
  form: SettingsFormValueWriter;
  resetBeforeApply?: boolean;
  synchronizedValues: SettingsFormSubmission;
  synchronizedValuesKey: string;
  setInitialValues: (values: SettingsFormSubmission) => void;
  setIsDirty: (isDirty: boolean) => void;
  setSmtpTestResult?: (result: 'success' | 'failed' | null) => void;
  synchronizationKeyRef: { current: string };
}

export interface SmtpTester {
  testSmtpConnection?: (config: {
    host: string;
    port: number;
    user?: string;
    password?: string;
    from?: string;
  }) => Promise<boolean | { success?: boolean; error?: string }>;
}

export type SmtpTestMode = 'ipc' | 'browser-simulated' | 'missing-ipc';

export const SMTP_TEST_MODE_MESSAGES: Record<SmtpTestMode, string> = {
  ipc: '현재 Electron 빌드의 SMTP 연결 테스트를 실행합니다.',
  'browser-simulated': '브라우저 개발 환경에서는 SMTP 연결 테스트가 시뮬레이션됩니다.',
  'missing-ipc': '현재 Electron 빌드에는 SMTP 연결 테스트 IPC가 연결되어 있지 않습니다.',
};

export function applySynchronizedSettingsFormState({
  form,
  resetBeforeApply = false,
  synchronizedValues,
  synchronizedValuesKey,
  setInitialValues,
  setIsDirty,
  setSmtpTestResult,
  synchronizationKeyRef,
}: ApplySynchronizedSettingsFormStateOptions): void {
  if (resetBeforeApply) {
    form.resetFields?.();
  }

  form.setFieldsValue(synchronizedValues);
  const appliedValues =
    resetBeforeApply && form.getFieldsValue
      ? form.getFieldsValue(true)
      : synchronizedValues;
  setInitialValues(appliedValues);
  setIsDirty(false);
  setSmtpTestResult?.(null);
  synchronizationKeyRef.current = resetBeforeApply
    ? JSON.stringify(appliedValues)
    : synchronizedValuesKey;
}

export function buildSettingsFormValues(settings: SettingsStoreSnapshot): SettingsFormValues {
  return {
    concurrentDownloads: settings.concurrentDownloads,
    enableCache: settings.enableCache,
    cachePath: settings.cachePath,
    includeDependencies: settings.includeDependencies,
    defaultDownloadPath: settings.defaultDownloadPath,
    defaultOutputFormat: settings.defaultOutputFormat,
    includeInstallScripts: settings.includeInstallScripts,
    enableFileSplit: settings.enableFileSplit,
    maxFileSize: settings.maxFileSize,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpPassword: settings.smtpPassword,
    smtpFrom: settings.smtpFrom,
    smtpTo: settings.smtpTo,
    languageVersions: settings.languageVersions,
    defaultTargetOS: settings.defaultTargetOS,
    defaultArchitecture: settings.defaultArchitecture,
    pipTargetPlatform: settings.pipTargetPlatform,
    condaChannel: settings.condaChannel,
    cudaVersion: settings.cudaVersion,
    yumDistributionId: settings.yumDistribution.id,
    yumArchitecture: settings.yumDistribution.architecture,
    aptDistributionId: settings.aptDistribution.id,
    aptArchitecture: settings.aptDistribution.architecture,
    apkDistributionId: settings.apkDistribution.id,
    apkArchitecture: settings.apkDistribution.architecture,
    dockerArchitecture: settings.dockerArchitecture,
    dockerLayerCompression: settings.dockerLayerCompression,
    dockerIncludeLoadScript: settings.dockerIncludeLoadScript,
    autoUpdate: settings.autoUpdate,
    autoDownloadUpdate: settings.autoDownloadUpdate,
    downloadRenderInterval: settings.downloadRenderInterval,
  };
}

export function normalizeSettingsFormValues(
  values: SettingsFormSubmission
): Record<string, unknown> {
  const normalizedValues = { ...values };

  if (values.yumDistributionId && values.yumArchitecture) {
    normalizedValues.yumDistribution = {
      id: values.yumDistributionId,
      architecture: values.yumArchitecture,
    };
  }

  if (values.aptDistributionId && values.aptArchitecture) {
    normalizedValues.aptDistribution = {
      id: values.aptDistributionId,
      architecture: values.aptArchitecture,
    };
  }

  if (values.apkDistributionId && values.apkArchitecture) {
    normalizedValues.apkDistribution = {
      id: values.apkDistributionId,
      architecture: values.apkArchitecture,
    };
  }

  delete normalizedValues.yumDistributionId;
  delete normalizedValues.yumArchitecture;
  delete normalizedValues.aptDistributionId;
  delete normalizedValues.aptArchitecture;
  delete normalizedValues.apkDistributionId;
  delete normalizedValues.apkArchitecture;

  return normalizedValues;
}

export function getSmtpTestMode(electronAPI?: SmtpTester): SmtpTestMode {
  if (!electronAPI) {
    return 'browser-simulated';
  }

  return typeof electronAPI.testSmtpConnection === 'function' ? 'ipc' : 'missing-ipc';
}
