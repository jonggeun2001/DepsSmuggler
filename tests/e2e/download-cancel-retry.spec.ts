import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

async function openDownloadPage(page: Page) {
  await page.goto('/#/cart');
  await expect(page.getByText('requests')).toBeVisible();
  await page.getByRole('button', { name: '다운로드 시작' }).click();
  await expect(page.getByRole('heading', { name: '다운로드' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toBeVisible();
}

test('느린 다운로드는 취소 후 취소됨 상태로 고정된다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: false,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
      defaultOutputFormat: 'zip',
      downloadRenderInterval: 0,
    },
    cartItems,
    downloadScenario: {
      mode: 'slow',
      stepDelayMs: 150,
      completeDelayMs: 3000,
    },
  });

  await openDownloadPage(page);

  await page.getByRole('button', { name: '다운로드 시작' }).click();
  await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  await expect(page.getByText('다운로드 중')).toBeVisible();

  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('dialog', { name: '다운로드 취소' })).toBeVisible();
  await page.getByRole('button', { name: '취소' }).last().click();

  const cancelledRow = page.locator('tr', { hasText: 'requests' });
  await expect(cancelledRow.getByText('취소됨', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.downloadCalls).toHaveLength(1);
  expect(mockState.runtime.cancelCount).toBe(1);
});

test('1회 실패한 다운로드는 개별 재시도로 성공까지 복구할 수 있다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: false,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
      defaultOutputFormat: 'zip',
      downloadRenderInterval: 0,
    },
    cartItems,
    downloadScenario: {
      mode: 'fail-once',
      stepDelayMs: 50,
    },
  });

  await openDownloadPage(page);

  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await expect(page.getByText('다운로드 실패')).toBeVisible();
  const failedRow = page.locator('tr', { hasText: 'requests' });
  await expect(failedRow.getByText('실패')).toBeVisible();
  await failedRow.getByRole('button', { name: '재시도' }).click();

  await expect(page.getByText('다운로드 완료')).toBeVisible();
  await expect(page.getByText('실제 산출물:')).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.downloadCalls).toHaveLength(2);
  expect(mockState.runtime.attemptsByPackageId['cart-pip-requests']).toBe(2);
});
