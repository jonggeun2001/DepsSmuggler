import { expect, test } from '@playwright/test';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

test('설정 저장값이 SMTP 테스트와 새로고침 뒤에도 유지된다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      smtpHost: '',
      smtpPort: 587,
      smtpFrom: '',
      smtpUser: '',
      smtpPassword: '',
      smtpTo: '',
    },
  });

  await page.goto('/#/settings');

  await page.locator('#smtpHost').fill('smtp.example.com');
  await page.locator('#smtpPort').fill('2525');
  await page.locator('#smtpFrom').fill('sender@example.com');
  await page.locator('#smtpUser').fill('sender@example.com');
  await page.locator('#smtpPassword').fill('app-password');
  await page.locator('#smtpTo').fill('offline@example.com');

  await page.getByRole('button', { name: '연결 테스트' }).click();
  await expect(page.getByText('SMTP 연결 테스트 성공')).toBeVisible();

  let mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.smtpTestCalls).toHaveLength(1);
  expect(mockState.runtime.smtpTestCalls[0]).toMatchObject({
    host: 'smtp.example.com',
    port: 2525,
    from: 'sender@example.com',
    user: 'sender@example.com',
  });

  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('설정이 저장되었습니다')).toBeVisible();

  await page.reload();

  await expect(page.locator('#smtpHost')).toHaveValue('smtp.example.com');
  await expect(page.locator('#smtpPort')).toHaveValue('2525');
  await expect(page.locator('#smtpFrom')).toHaveValue('sender@example.com');
  await expect(page.locator('#smtpUser')).toHaveValue('sender@example.com');
  await expect(page.locator('#smtpTo')).toHaveValue('offline@example.com');

  mockState = await readMockElectronAppState(page);
  expect(mockState.config).toMatchObject({
    smtpHost: 'smtp.example.com',
    smtpPort: 2525,
    smtpFrom: 'sender@example.com',
    smtpUser: 'sender@example.com',
    smtpTo: 'offline@example.com',
  });
});
