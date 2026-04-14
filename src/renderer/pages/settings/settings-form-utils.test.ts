import { describe, expect, it, vi } from 'vitest';
import {
  applySynchronizedSettingsFormState,
  buildSettingsFormValues,
  getSmtpTestMode,
  normalizeSettingsFormValues,
} from './settings-form-utils';

describe('settings-form-utils', () => {
  it('스토어 설정을 SettingsPage 폼 필드로 펼쳐야 함', () => {
    expect(buildSettingsFormValues({
      concurrentDownloads: 4,
      enableCache: true,
      cachePath: '/tmp/cache',
      includeDependencies: true,
      defaultDownloadPath: '/tmp/output',
      defaultOutputFormat: 'tar.gz',
      includeInstallScripts: true,
      enableFileSplit: true,
      maxFileSize: 50,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpUser: 'mailer',
      smtpPassword: 'secret',
      smtpFrom: 'sender@example.com',
      smtpTo: 'offline@example.com',
      languageVersions: { python: '3.12' },
      defaultTargetOS: 'linux',
      defaultArchitecture: 'x86_64',
      pipTargetPlatform: {
        os: 'linux',
        arch: 'x86_64',
        linuxDistro: 'rocky9',
        glibcVersion: '2.34',
      },
      condaChannel: 'conda-forge',
      cudaVersion: '12.4',
      yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
      aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
      apkDistribution: { id: 'alpine-3.19', architecture: 'aarch64' },
      dockerArchitecture: 'arm64',
      dockerLayerCompression: 'gzip',
      dockerIncludeLoadScript: true,
      autoUpdate: true,
      autoDownloadUpdate: false,
      downloadRenderInterval: 500,
    })).toEqual({
      concurrentDownloads: 4,
      enableCache: true,
      cachePath: '/tmp/cache',
      includeDependencies: true,
      defaultDownloadPath: '/tmp/output',
      defaultOutputFormat: 'tar.gz',
      includeInstallScripts: true,
      enableFileSplit: true,
      maxFileSize: 50,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpUser: 'mailer',
      smtpPassword: 'secret',
      smtpFrom: 'sender@example.com',
      smtpTo: 'offline@example.com',
      languageVersions: { python: '3.12' },
      defaultTargetOS: 'linux',
      defaultArchitecture: 'x86_64',
      pipTargetPlatform: {
        os: 'linux',
        arch: 'x86_64',
        linuxDistro: 'rocky9',
        glibcVersion: '2.34',
      },
      condaChannel: 'conda-forge',
      cudaVersion: '12.4',
      yumDistributionId: 'rocky-9',
      yumArchitecture: 'x86_64',
      aptDistributionId: 'ubuntu-24.04',
      aptArchitecture: 'amd64',
      apkDistributionId: 'alpine-3.19',
      apkArchitecture: 'aarch64',
      dockerArchitecture: 'arm64',
      dockerLayerCompression: 'gzip',
      dockerIncludeLoadScript: true,
      autoUpdate: true,
      autoDownloadUpdate: false,
      downloadRenderInterval: 500,
    });
  });

  it('폼 값을 기존 저장 계약대로 스토어 업데이트 값으로 정규화해야 함', () => {
    expect(normalizeSettingsFormValues({
      concurrentDownloads: 5,
      defaultDownloadPath: '/tmp/downloads',
      yumDistributionId: 'rocky-10',
      yumArchitecture: 'x86_64',
      aptDistributionId: 'debian-12',
      aptArchitecture: 'arm64',
      apkDistributionId: 'alpine-3.20',
      apkArchitecture: 'aarch64',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
    })).toEqual({
      concurrentDownloads: 5,
      defaultDownloadPath: '/tmp/downloads',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      yumDistribution: {
        id: 'rocky-10',
        architecture: 'x86_64',
      },
      aptDistribution: {
        id: 'debian-12',
        architecture: 'arm64',
      },
      apkDistribution: {
        id: 'alpine-3.20',
        architecture: 'aarch64',
      },
    });
  });

  it('SMTP 테스트는 사용 가능한 경로를 명시적으로 분류해야 함', () => {
    expect(getSmtpTestMode(undefined)).toBe('browser-simulated');
    expect(getSmtpTestMode({})).toBe('missing-ipc');
    expect(getSmtpTestMode({ testSmtpConnection: async () => ({ success: true }) })).toBe('ipc');
  });

  it('초기화 경로는 동기화 키가 같아도 폼 값을 즉시 다시 써야 함', () => {
    const synchronizedValues = buildSettingsFormValues({
      concurrentDownloads: 3,
      enableCache: true,
      cachePath: '/tmp/cache',
      includeDependencies: true,
      defaultDownloadPath: '/tmp/output',
      defaultOutputFormat: 'zip',
      includeInstallScripts: true,
      enableFileSplit: false,
      maxFileSize: 25,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPassword: '',
      smtpFrom: '',
      smtpTo: '',
      languageVersions: { python: '3.12' },
      defaultTargetOS: 'linux',
      defaultArchitecture: 'x86_64',
      pipTargetPlatform: {
        os: 'linux',
        arch: 'x86_64',
        linuxDistro: 'rocky9',
        glibcVersion: '2.34',
      },
      condaChannel: 'defaults',
      cudaVersion: '12.0',
      yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
      aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
      apkDistribution: { id: 'alpine-3.19', architecture: 'x86_64' },
      dockerArchitecture: 'amd64',
      dockerLayerCompression: 'gzip',
      dockerIncludeLoadScript: true,
      autoUpdate: false,
      autoDownloadUpdate: false,
      downloadRenderInterval: 100,
    });
    const synchronizedValuesKey = JSON.stringify(synchronizedValues);
    const form = { setFieldsValue: vi.fn() };
    const setInitialValues = vi.fn();
    const setIsDirty = vi.fn();
    const setSmtpTestResult = vi.fn();
    const synchronizationKeyRef = { current: synchronizedValuesKey };

    applySynchronizedSettingsFormState({
      form,
      synchronizedValues,
      synchronizedValuesKey,
      setInitialValues,
      setIsDirty,
      setSmtpTestResult,
      synchronizationKeyRef,
    });

    expect(form.setFieldsValue).toHaveBeenCalledWith(synchronizedValues);
    expect(setInitialValues).toHaveBeenCalledWith(synchronizedValues);
    expect(setIsDirty).toHaveBeenCalledWith(false);
    expect(setSmtpTestResult).toHaveBeenCalledWith(null);
    expect(synchronizationKeyRef.current).toBe(synchronizedValuesKey);
  });

  it('초기화 동기화는 숨겨진 조건부 필드를 먼저 비워야 함', () => {
    const synchronizedValues = buildSettingsFormValues({
      concurrentDownloads: 3,
      enableCache: true,
      cachePath: '/tmp/cache',
      includeDependencies: true,
      defaultDownloadPath: '/tmp/output',
      defaultOutputFormat: 'zip',
      includeInstallScripts: true,
      enableFileSplit: false,
      maxFileSize: 25,
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPassword: '',
      smtpFrom: '',
      smtpTo: '',
      languageVersions: { python: '3.12' },
      defaultTargetOS: 'linux',
      defaultArchitecture: 'x86_64',
      pipTargetPlatform: {
        os: 'linux',
        arch: 'x86_64',
        linuxDistro: 'rocky9',
        glibcVersion: '2.34',
      },
      condaChannel: 'defaults',
      cudaVersion: '12.0',
      yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
      aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
      apkDistribution: { id: 'alpine-3.19', architecture: 'x86_64' },
      dockerArchitecture: 'amd64',
      dockerLayerCompression: 'gzip',
      dockerIncludeLoadScript: true,
      autoUpdate: false,
      autoDownloadUpdate: false,
      downloadRenderInterval: 100,
    });
    const formState = {
      pipTargetPlatform: {
        os: 'darwin',
        arch: 'arm64',
        macosVersion: '14.0',
      },
    };
    const form = {
      resetFields: vi.fn(() => {
        formState.pipTargetPlatform = {};
      }),
      setFieldsValue: vi.fn((nextValues: typeof synchronizedValues) => {
        formState.pipTargetPlatform = {
          ...formState.pipTargetPlatform,
          ...nextValues.pipTargetPlatform,
        };
      }),
      getFieldsValue: vi.fn(() => formState),
    };
    const setInitialValues = vi.fn();
    const setIsDirty = vi.fn();
    const synchronizationKeyRef = { current: 'stale-key' };

    applySynchronizedSettingsFormState({
      form,
      synchronizedValues,
      synchronizedValuesKey: JSON.stringify(synchronizedValues),
      setInitialValues,
      setIsDirty,
      synchronizationKeyRef,
      resetBeforeApply: true,
    });

    expect(form.resetFields).toHaveBeenCalledTimes(1);
    expect(formState.pipTargetPlatform).toEqual({
      os: 'linux',
      arch: 'x86_64',
      linuxDistro: 'rocky9',
      glibcVersion: '2.34',
    });
    expect(setInitialValues).toHaveBeenCalledWith(formState);
    expect(synchronizationKeyRef.current).toBe(JSON.stringify(formState));
  });
});
