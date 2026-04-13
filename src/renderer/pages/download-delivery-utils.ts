import type { OSPackageOutputOptions } from '../../core/downloaders/os-shared/types';
import type { DeliveryMethod, HistorySettings } from '../../types';

export const EMAIL_DELIVERY_VALIDATION_MESSAGE =
  '이메일 전달을 사용하려면 설정에서 SMTP 서버, 수신자, 발신자 또는 로그인 사용자를 입력하세요';

interface BuildHistorySettingsInput {
  outputFormat: HistorySettings['outputFormat'];
  includeScripts: boolean;
  includeDependencies: boolean;
  deliveryMethod: DeliveryMethod;
  smtpTo?: string;
  fileSplitEnabled?: boolean;
  maxFileSizeMB?: number;
  osOutputOptions?: OSPackageOutputOptions;
}

export interface HistoryRestoreSettings {
  defaultOutputFormat: HistorySettings['outputFormat'];
  includeInstallScripts: boolean;
  includeDependencies: boolean;
  enableFileSplit?: boolean;
  maxFileSize?: number;
  smtpTo?: string;
}

interface EmailDeliveryValidationInput {
  deliveryMethod: DeliveryMethod;
  smtpHost: string;
  smtpPort: number;
  smtpTo: string;
  smtpFrom: string;
  smtpUser: string;
}

export function buildHistorySettings(input: BuildHistorySettingsInput): HistorySettings {
  return {
    outputFormat: input.outputFormat,
    includeScripts: input.includeScripts,
    includeDependencies: input.includeDependencies,
    deliveryMethod: input.deliveryMethod,
    ...(input.deliveryMethod === 'email' && input.smtpTo ? { smtpTo: input.smtpTo } : {}),
    ...(typeof input.fileSplitEnabled === 'boolean'
      ? { fileSplitEnabled: input.fileSplitEnabled }
      : {}),
    ...(typeof input.maxFileSizeMB === 'number'
      ? { maxFileSizeMB: input.maxFileSizeMB }
      : {}),
    ...(input.osOutputOptions ? { osOutputOptions: input.osOutputOptions } : {}),
  };
}

export function buildHistoryRestoreSettings(settings: HistorySettings): HistoryRestoreSettings {
  return {
    defaultOutputFormat: settings.outputFormat,
    includeInstallScripts: settings.includeScripts,
    includeDependencies: settings.includeDependencies,
    ...(typeof settings.fileSplitEnabled === 'boolean'
      ? { enableFileSplit: settings.fileSplitEnabled }
      : {}),
    ...(typeof settings.maxFileSizeMB === 'number'
      ? { maxFileSize: settings.maxFileSizeMB }
      : {}),
    ...(settings.deliveryMethod === 'email' && settings.smtpTo ? { smtpTo: settings.smtpTo } : {}),
  };
}

export function getEmailDeliveryValidationError(
  input: EmailDeliveryValidationInput
): string | null {
  if (input.deliveryMethod !== 'email') {
    return null;
  }

  if (!input.smtpHost || !input.smtpPort || !input.smtpTo || !(input.smtpFrom || input.smtpUser)) {
    return EMAIL_DELIVERY_VALIDATION_MESSAGE;
  }

  return null;
}
