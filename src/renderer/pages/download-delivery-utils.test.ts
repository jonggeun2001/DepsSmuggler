import { describe, expect, it } from 'vitest';
import {
  buildHistoryRestoreSettings,
  buildHistorySettings,
  getEmailDeliveryValidationError,
} from './download-delivery-utils';

describe('download-delivery-utils', () => {
  it('이메일 전달 히스토리에 수신자를 저장해야 함', () => {
    const historySettings = buildHistorySettings({
      outputFormat: 'tar.gz',
      includeScripts: true,
      includeDependencies: true,
      deliveryMethod: 'email',
      fileSplitEnabled: true,
      maxFileSizeMB: 25,
      smtpTo: 'airgap@example.com',
    });

    expect(historySettings).toMatchObject({
      deliveryMethod: 'email',
      smtpTo: 'airgap@example.com',
      fileSplitEnabled: true,
      maxFileSizeMB: 25,
    });
  });

  it('히스토리 재다운로드 시 저장된 수신자를 설정으로 복원해야 함', () => {
    const updates = buildHistoryRestoreSettings({
      outputFormat: 'zip',
      includeScripts: false,
      includeDependencies: false,
      deliveryMethod: 'email',
      fileSplitEnabled: true,
      maxFileSizeMB: 10,
      smtpTo: 'restore@example.com',
    });

    expect(updates).toMatchObject({
      defaultOutputFormat: 'zip',
      includeInstallScripts: false,
      includeDependencies: false,
      enableFileSplit: true,
      maxFileSize: 10,
      smtpTo: 'restore@example.com',
    });
  });

  it('이메일 전달은 시작 전에 SMTP 수신자 누락을 차단해야 함', () => {
    expect(getEmailDeliveryValidationError({
      deliveryMethod: 'email',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTo: '',
      smtpFrom: 'sender@example.com',
      smtpUser: '',
    })).toBe('이메일 전달을 사용하려면 설정에서 SMTP 서버, 수신자, 발신자 또는 로그인 사용자를 입력하세요');
  });

  it('로컬 전달은 SMTP 설정 없이도 통과해야 함', () => {
    expect(getEmailDeliveryValidationError({
      deliveryMethod: 'local',
      smtpHost: '',
      smtpPort: 587,
      smtpTo: '',
      smtpFrom: '',
      smtpUser: '',
    })).toBeNull();
  });
});
