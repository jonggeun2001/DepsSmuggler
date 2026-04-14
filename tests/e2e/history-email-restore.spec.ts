import { expect, test } from '@playwright/test';
import type { DownloadHistory } from '../../src/types';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

const emailHistory: DownloadHistory = {
  id: 'history-email-1',
  timestamp: '2026-04-14T00:00:00.000Z',
  packages: [
    {
      type: 'npm',
      name: 'left-pad',
      version: '1.3.0',
    },
  ],
  settings: {
    outputFormat: 'zip',
    includeScripts: true,
    includeDependencies: false,
    deliveryMethod: 'email',
    smtpTo: 'history@example.com',
    fileSplitEnabled: true,
    maxFileSizeMB: 10,
  },
  outputPath: '/tmp/depssmuggler-history/left-pad-1.3.0.zip',
  artifactPaths: ['/tmp/depssmuggler-history/left-pad-1.3.0.zip'],
  deliveryMethod: 'email',
  deliveryResult: {
    emailSent: true,
    emailsSent: 1,
  },
  totalSize: 1024,
  status: 'success',
  downloadedCount: 1,
  failedCount: 0,
};

test('이메일 히스토리 재다운로드는 저장된 수신자를 복원하지만 전역 SMTP 수신자는 유지한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: false,
      smtpHost: 'smtp.global.example.com',
      smtpPort: 587,
      smtpFrom: 'global@example.com',
      smtpUser: 'global@example.com',
      smtpTo: 'global@example.com',
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
    },
    histories: [emailHistory],
  });

  await page.goto('/#/history');

  const historyRow = page.locator('tr', { hasText: 'left-pad@1.3.0' });
  await expect(historyRow).toBeVisible();
  await historyRow.locator('button').nth(2).click();

  const confirmDialog = page.getByRole('dialog', { name: '재다운로드' });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole('button', { name: '확인' }).click();

  await expect(page).toHaveURL(/#\/download$/);
  await expect(page.getByText('현재 수신자: history@example.com')).toBeVisible();
  await expect(page.getByText('파일 분할: 활성')).toBeVisible();
  await expect(page.getByText('10MB 초과 시 자동 분할하여 첨부 제한에 맞춰 전달합니다.')).toBeVisible();
  await expect(page.getByText('left-pad')).toBeVisible();

  await page.getByRole('button', { name: '다운로드 시작' }).click();
  await expect
    .poll(async () => {
      const currentState = await readMockElectronAppState(page);
      return currentState.runtime.downloadCalls.length;
    })
    .toBe(1);

  const mockState = await readMockElectronAppState(page);
  expect(mockState.config).toMatchObject({
    smtpTo: 'global@example.com',
    includeDependencies: false,
    enableFileSplit: true,
    maxFileSize: 10,
    defaultOutputFormat: 'zip',
  });
  expect(mockState.runtime.downloadCalls).toHaveLength(1);
  expect(mockState.runtime.downloadCalls[0]).toMatchObject({
    options: {
      deliveryMethod: 'email',
      email: {
        to: 'history@example.com',
      },
    },
  });
});
