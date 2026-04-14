import { describe, expect, it } from 'vitest';
import {
  buildDownloadStartOptions,
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

  it('히스토리 재다운로드 시 전역 설정에는 수신자를 복원하지 않아야 함', () => {
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
    });
    expect(updates).not.toHaveProperty('smtpTo');
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

  it('이메일 전달 옵션은 smtp, email, fileSplit을 함께 조립해야 함', () => {
    expect(
      buildDownloadStartOptions({
        outputDir: '/tmp/downloads',
        outputFormat: 'zip',
        includeScripts: true,
        targetOS: 'linux',
        architecture: 'x86_64',
        includeDependencies: true,
        pythonVersion: '3.11',
        concurrency: 3,
        deliveryMethod: 'email',
        smtpTo: 'airgap@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'sender@example.com',
        smtpPassword: 'secret',
        smtpFrom: '',
        fileSplitEnabled: true,
        maxFileSizeMB: 25,
      })
    ).toEqual({
      outputDir: '/tmp/downloads',
      outputFormat: 'zip',
      includeScripts: true,
      targetOS: 'linux',
      architecture: 'x86_64',
      includeDependencies: true,
      pythonVersion: '3.11',
      concurrency: 3,
      deliveryMethod: 'email',
      email: {
        to: 'airgap@example.com',
        from: 'sender@example.com',
      },
      fileSplit: {
        enabled: true,
        maxSizeMB: 25,
      },
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        user: 'sender@example.com',
        password: 'secret',
        from: 'sender@example.com',
      },
    });
  });

  it('로컬 전달 옵션은 email/smtp 없이도 조립되어야 함', () => {
    expect(
      buildDownloadStartOptions({
        outputDir: '/tmp/downloads',
        outputFormat: 'tar.gz',
        includeScripts: false,
        targetOS: 'windows',
        architecture: 'arm64',
        includeDependencies: false,
        pythonVersion: '3.12',
        concurrency: 1,
        deliveryMethod: 'local',
        smtpTo: '',
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        smtpFrom: '',
        fileSplitEnabled: false,
        maxFileSizeMB: 10,
      })
    ).toEqual({
      outputDir: '/tmp/downloads',
      outputFormat: 'tar.gz',
      includeScripts: false,
      targetOS: 'windows',
      architecture: 'arm64',
      includeDependencies: false,
      pythonVersion: '3.12',
      concurrency: 1,
      deliveryMethod: 'local',
      email: undefined,
      fileSplit: {
        enabled: false,
        maxSizeMB: 10,
      },
      smtp: undefined,
    });
  });
});
