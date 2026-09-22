import { expect, test } from '@playwright/test';
import type { CartItem } from '../../src/renderer/stores/cart-store';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

const cartItems: CartItem[] = [
  {
    id: 'cart-pip-requests',
    type: 'pip',
    name: 'requests',
    version: '2.32.3',
    addedAt: 1713081600000,
  },
];

test('장바구니에서 일반 다운로드 완료 화면까지 도달한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: false,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
      defaultOutputFormat: 'tar.gz',
      downloadRenderInterval: 0,
    },
    cartItems,
    downloadDelayMs: 25,
  });

  await page.goto('/#/cart');

  await expect(page.getByText('requests')).toBeVisible();
  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await expect(page.getByRole('heading', { name: '다운로드' })).toBeVisible();
  await expect(page.locator('input[placeholder="다운로드 폴더 경로"]')).toHaveValue('/tmp/depssmuggler-e2e');
  await expect(page.getByText('TAR.GZ')).toBeVisible();
  await expect(page.getByText('1개 패키지')).toBeVisible();
  await expect(page.getByText('requests')).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toBeVisible();
  await expect(page.getByText(/^현재 수신자:/)).toHaveCount(0);
  await expect(page.getByText(/^파일 분할:/)).toHaveCount(0);

  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await expect(page.locator('.ant-result-title', { hasText: '다운로드 완료' })).toBeVisible();
  await expect(page.getByText('로컬 저장')).toBeVisible();
  await expect(page.getByText('실제 산출물:')).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.downloadCalls).toHaveLength(1);
  expect(mockState.runtime.downloadCalls[0]).toMatchObject({
    options: {
      outputDir: '/tmp/depssmuggler-e2e',
      outputFormat: 'tar.gz',
      includeDependencies: false,
      deliveryMethod: 'local',
    },
  });
  expect(mockState.runtime.downloadCalls[0].packages).toHaveLength(1);
  expect(mockState.runtime.downloadCalls[0].packages[0]).toMatchObject({
    name: 'requests',
    version: '2.32.3',
  });
});


test('다운로드 후 스크립트 생성과 압축 진행 상태를 완료 전까지 표시한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: { includeDependencies: false, defaultDownloadPath: '/tmp/depssmuggler-e2e', defaultOutputFormat: 'zip', downloadRenderInterval: 0 },
    cartItems,
    downloadScenario: { completeDelayMs: 25, packagingDelayMs: 6000 },
  });
  await page.goto('/#/download');
  await page.getByRole('button', { name: '다운로드 시작' }).click();
  const packaging = page.getByRole('region', { name: '파일 생성 진행' });
  await expect(packaging.getByRole('status')).toHaveText('설치 스크립트 생성 중...');
  await expect(packaging.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '일시정지' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /완료/ })).toHaveCount(0);
  await expect(packaging.getByRole('status')).toHaveText('ZIP 압축 중...');
  await expect(packaging.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(packaging).toContainText('1 / 2개 파일 처리');
  await expect(packaging).toContainText('512 B 기록');
  await page.screenshot({ path: 'test-results/packaging-progress.png', fullPage: true });
  await expect(page.locator('.ant-result-title')).toHaveText('다운로드 완료', { timeout: 10000 });
  await expect(packaging).toHaveCount(0);
});
