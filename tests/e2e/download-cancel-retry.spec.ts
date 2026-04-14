import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CartItem } from '../../src/renderer/stores/cart-store';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

const singleCartItems: CartItem[] = [
  {
    id: 'cart-pip-requests',
    type: 'pip',
    name: 'requests',
    version: '2.32.3',
    addedAt: 1713081600000,
  },
];

const retryCartItems: CartItem[] = [
  {
    id: 'cart-pip-requests',
    type: 'pip',
    name: 'requests',
    version: '2.32.3',
    addedAt: 1713081600000,
  },
  {
    id: 'cart-pip-urllib3',
    type: 'pip',
    name: 'urllib3',
    version: '2.2.1',
    addedAt: 1713081601000,
  },
];

async function openDownloadPage(page: Page, expectedNames: string[]) {
  await page.goto('/#/cart');
  for (const name of expectedNames) {
    await expect(page.getByText(name)).toBeVisible();
  }
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
    cartItems: singleCartItems,
    downloadScenario: {
      mode: 'slow',
      stepDelayMs: 150,
      completeDelayMs: 1200,
      emitLateSuccessAfterCancel: true,
    },
  });

  await openDownloadPage(page, ['requests']);

  await page.getByRole('button', { name: '다운로드 시작' }).click();
  await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  await expect(page.getByText('다운로드 중')).toBeVisible();

  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('dialog', { name: '다운로드 취소' })).toBeVisible();
  await page.getByRole('button', { name: '취소' }).last().click();

  const cancelledRow = page.locator('tr', { hasText: 'requests' });
  await expect(cancelledRow.getByText('취소됨', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(cancelledRow.getByText('취소됨', { exact: true })).toBeVisible();
  await expect(cancelledRow.getByText('완료', { exact: true })).toHaveCount(0);
  await expect(page.getByText('실제 산출물:')).toHaveCount(0);

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
    cartItems: retryCartItems,
    downloadScenario: {
      mode: 'fail-once',
      stepDelayMs: 50,
      failAttemptsByPackageId: {
        'cart-pip-requests': [1],
      },
    },
  });

  await openDownloadPage(page, ['requests', 'urllib3']);

  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await expect(page.getByText('전달 실패', { exact: true })).toBeVisible();
  const failedRow = page.locator('tr', { hasText: 'requests' });
  const completedRow = page.locator('tr', { hasText: 'urllib3' });
  await expect(failedRow.getByText('실패')).toBeVisible();
  await expect(completedRow.getByText('완료', { exact: true })).toBeVisible();
  await failedRow.getByRole('button', { name: '재시도' }).click();

  await expect(page.getByText('다운로드 완료')).toBeVisible();
  await expect(page.getByText('실제 산출물:')).toBeVisible();
  await expect(failedRow.getByText('완료', { exact: true })).toBeVisible();
  await expect(completedRow.getByText('완료', { exact: true })).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.downloadCalls).toHaveLength(2);
  expect(mockState.runtime.downloadCalls[0]?.sessionId).toBe(1);
  expect(mockState.runtime.downloadCalls[1]?.sessionId).toBe(2);
  expect(mockState.runtime.attemptsByPackageId['cart-pip-requests']).toBe(2);
  expect(mockState.runtime.attemptsByPackageId['cart-pip-urllib3']).toBe(1);
  expect(mockState.runtime.downloadCalls[0]?.packages).toHaveLength(2);
  expect(mockState.runtime.downloadCalls[1]?.packages).toEqual([
    expect.objectContaining({
      id: 'cart-pip-requests',
      name: 'requests',
    }),
  ]);
});

test('취소 직후 새 다운로드를 시작해도 이전 세션의 늦은 완료 이벤트는 섞이지 않는다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: false,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
      defaultOutputFormat: 'zip',
      downloadRenderInterval: 0,
    },
    cartItems: singleCartItems,
    checkPathDelayMs: 1500,
    downloadScenario: {
      startScenarios: [
        {
          mode: 'slow',
          stepDelayMs: 150,
          completeDelayMs: 600,
          emitLateSuccessAfterCancel: true,
        },
        {
          mode: 'fail-once',
          stepDelayMs: 50,
          failAttemptsByPackageId: {
            'cart-pip-requests': [2],
          },
        },
      ],
    },
  });

  await openDownloadPage(page, ['requests']);

  await page.getByRole('button', { name: '다운로드 시작' }).click();
  await expect(page.getByRole('button', { name: '취소' })).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('dialog', { name: '다운로드 취소' })).toBeVisible();
  await page.getByRole('button', { name: '취소' }).last().click();

  await expect(page.getByRole('button', { name: '다운로드 시작' })).toBeVisible();
  await page.getByRole('button', { name: '다운로드 시작' }).click();

  await page.waitForTimeout(900);
  const pendingState = await readMockElectronAppState(page);
  expect(pendingState.runtime.downloadCalls).toHaveLength(1);
  await expect(page.getByText('다운로드 완료', { exact: true })).toHaveCount(0);
  await expect(page.getByText('전달 실패', { exact: true })).toHaveCount(0);

  const failedRow = page.locator('tr', { hasText: 'requests' });
  await expect(page.getByText('전달 실패', { exact: true })).toBeVisible();
  await expect(failedRow.getByText('실패')).toBeVisible();

  await page.waitForTimeout(1500);
  await expect(page.getByText('전달 실패', { exact: true })).toBeVisible();
  await expect(page.getByText('다운로드 완료', { exact: true })).toHaveCount(0);
  await expect(failedRow.getByText('실패')).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime.downloadCalls).toHaveLength(2);
  expect(mockState.runtime.downloadCalls[0]?.sessionId).toBe(1);
  expect(mockState.runtime.downloadCalls[1]?.sessionId).toBe(2);
});
