import { expect, test } from '@playwright/test';
import { setupMockElectronApp } from './fixtures/mock-electron-app';

test('수동 새로고침은 재집계를 요청하고 실패 시 이전 통계와 재시도를 표시한다', async ({
  page,
}) => {
  await setupMockElectronApp(page, { cacheStats: { totalSize: 4096, entryCount: 3 } });
  const requests: Array<{ forceRefresh?: boolean }> = [];
  await page.exposeFunction('trackCacheStats', (options: { forceRefresh?: boolean }) => {
    requests.push(options);
  });
  await page.goto('/#/');
  await page.evaluate(() => {
    const cache = window.electronAPI?.cache;
    if (!cache) throw new Error('Cache API missing');
    const original = cache.getStats;
    cache.getStats = async (options) => {
      await (
        window as unknown as {
          trackCacheStats: (options: unknown) => Promise<void>;
        }
      ).trackCacheStats(options);
      if (options?.forceRefresh) throw new Error('statistics unavailable');
      return original(options);
    };
    window.location.hash = '/settings';
  });
  const card = page.locator('.ant-card').filter({ has: page.getByText('패키지 캐시 설정') });
  await expect(card.getByText('4 KB', { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((request) => request.forceRefresh === false)).toBe(true);
  await card.getByRole('button', { name: '캐시 통계 새로고침', exact: true }).click();
  await expect(
    card.getByText('캐시 정보를 갱신하지 못했습니다. 새로고침으로 다시 시도하세요.')
  ).toBeVisible();
  await expect(card.getByText('4 KB', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.forceRefresh).toBe(true);
  await page.evaluate(() => {
    const cache = window.electronAPI?.cache;
    if (!cache) throw new Error('Cache API missing');
    cache.getStats = async () => ({
      scope: 'package-metadata',
      excludes: [],
      totalSize: 8192,
      entryCount: 9,
      details: { pip: {}, npm: {}, maven: {}, conda: {} },
    });
  });
  await card.getByRole('button', { name: '캐시 통계 새로고침', exact: true }).click();
  await expect(card.getByText('8 KB', { exact: true })).toBeVisible();
  await expect(
    card.getByText('캐시 정보를 갱신하지 못했습니다. 새로고침으로 다시 시도하세요.')
  ).toHaveCount(0);
});

test('설정 화면이 캐시 타입별 상세 통계와 삭제 후 갱신을 보여준다', async ({ page }) => {
  await setupMockElectronApp(page, {
    cacheStats: {
      scope: 'package-metadata',
      excludes: ['version caches'],
      totalSize: 15360,
      entryCount: 14,
      details: {
        pip: { memoryEntries: 2, diskEntries: 5, diskSize: 4096 },
        npm: { entries: 4, oldestEntry: 1, newestEntry: 2 },
        maven: { memoryEntries: 1, diskEntries: 3, diskSize: 8192, pendingRequests: 0 },
        conda: {
          totalSize: 3072,
          channelCount: 2,
          entries: [
            { channel: 'conda-forge', subdir: 'linux-64', meta: {}, dataSize: 1024 },
            { channel: 'defaults', subdir: 'linux-64', meta: {}, dataSize: 2048 },
          ],
        },
      },
    },
  });

  await page.goto('/#/settings');

  const cacheCard = page.locator('.ant-card').filter({ has: page.getByText('패키지 캐시 설정') });

  await expect(cacheCard.getByText('15 KB')).toBeVisible();
  await expect(cacheCard.getByText('14개')).toBeVisible();

  const pipCard = cacheCard.getByTestId('cache-detail-pip');
  const npmCard = cacheCard.getByTestId('cache-detail-npm');
  const mavenCard = cacheCard.getByTestId('cache-detail-maven');
  const condaCard = cacheCard.getByTestId('cache-detail-conda');

  await expect(pipCard.getByText('PIP')).toBeVisible();
  await expect(npmCard.getByText('NPM')).toBeVisible();
  await expect(mavenCard.getByText('MAVEN')).toBeVisible();
  await expect(condaCard.getByText('CONDA')).toBeVisible();

  await expect(pipCard.getByText(/^5개$/)).toBeVisible();
  await expect(npmCard.getByText(/^4개$/)).toBeVisible();
  await expect(mavenCard.getByText(/^3개$/)).toBeVisible();
  await expect(condaCard.getByText(/^2개$/)).toBeVisible();

  await expect(pipCard.getByText(/^4 KB$/)).toBeVisible();
  await expect(mavenCard.getByText(/^8 KB$/)).toBeVisible();
  await expect(condaCard.getByText(/^3 KB$/)).toBeVisible();

  await cacheCard.locator('button.ant-btn-dangerous').click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByText('패키지 캐시가 삭제되었습니다')).toBeVisible();

  await expect(cacheCard.getByText(/^0 B$/)).toHaveCount(4);
  await expect(cacheCard.getByText(/^0개$/)).toHaveCount(5);
});
