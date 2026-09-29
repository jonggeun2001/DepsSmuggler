import { expect, test, type Page } from '@playwright/test';
import type { DownloadHistory } from '../../src/types';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

async function trackCartWrites(page: Page) {
  await page.evaluate(() => {
    const probe = window as typeof window & { cartWrites: number };
    probe.cartWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'depssmuggler-cart') probe.cartWrites++;
      return original.call(this, key, value);
    };
  });
}
const cartWrites = (page: Page) =>
  page.evaluate(() => (window as typeof window & { cartWrites: number }).cartWrites);

test('파일의 40개 패키지를 한 번 저장하고 같은 파일 재입력은 저장하지 않는다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await expect(page.getByText('장바구니가 비어있습니다')).toBeVisible();
  await trackCartWrites(page);
  const names = Array.from({ length: 40 }, (_, i) => `bulk-${i}`);
  const file = {
    name: 'requirements.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(names.map((name) => `${name}==1.0`).join('\n')),
  };
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByText('40개 패키지가 추가되었습니다')).toBeVisible();
  expect(await cartWrites(page)).toBe(1);
  const original = (await readMockElectronAppState(page)).cart.items;
  expect(original.map(({ name }) => name)).toEqual(names);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByText('모든 패키지가 이미 장바구니에 있습니다')).toBeVisible();
  expect(await cartWrites(page)).toBe(1);
  expect((await readMockElectronAppState(page)).cart.items).toEqual(original);
});

test('여러 파일 중 파싱 실패가 있어도 성공 파일만 한 번 저장하고 입력 잠금을 해제한다', async ({
  page,
}) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await expect(page.getByText('장바구니가 비어있습니다')).toBeVisible();
  await trackCartWrites(page);
  await page.evaluate(() => {
    window.electronAPI!.maven!.parseProject = async (content) =>
      content.includes('bad')
        ? { success: false, packages: [], error: 'fixture parse failure' }
        : { success: true, packages: [{ type: 'maven', name: 'demo:good', version: '1' }] };
  });
  const input = page.locator('input[type="file"][multiple]');
  await input.setInputFiles(
    ['good', 'bad'].map((name) => ({
      name: `${name}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(`<project><artifactId>${name}</artifactId></project>`),
    }))
  );
  await expect(page.getByText('fixture parse failure')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'demo:good', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '파일 가져오기' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /텍스트로 추가$/ })).toBeEnabled();
  expect(await cartWrites(page)).toBe(1);
  expect((await readMockElectronAppState(page)).cart.items).toHaveLength(1);
});

test('이력 복원은 기존 항목을 보존하고 실제 신규 수만 알리며 한 번 저장한다', async ({ page }) => {
  const packages = Array.from({ length: 40 }, (_, i) => ({
    type: 'npm' as const,
    name: `history-${i}`,
    version: '1.0',
    arch: 'arm64' as const,
    languageVersion: '22',
    metadata: { source: 'history' },
  }));
  const existing = { ...packages[0], id: 'existing', addedAt: 1, metadata: { source: 'existing' } };
  const history: DownloadHistory = {
    id: 'bulk-history',
    timestamp: '2026-09-28T00:00:00Z',
    packages: [...packages, packages[1]],
    settings: {
      outputFormat: 'zip',
      includeScripts: true,
      includeDependencies: false,
      deliveryMethod: 'local',
    },
    outputPath: '/tmp/bulk.zip',
    totalSize: 1024,
    status: 'success',
    downloadedCount: 41,
    failedCount: 0,
  };
  await setupMockElectronApp(page, { cartItems: [existing], histories: [history] });
  await page.goto('/#/history');
  const row = page.locator('tr', { hasText: 'history-0@1.0' });
  await expect(row).toBeVisible();
  // 실제 config IPC는 renderer의 cart 저장소를 쓰지 않는다.
  // 공통 fixture의 persistStores가 cart까지 다시 쓰는 계측 간섭만 제외한다.
  await page.evaluate(() => {
    window.electronAPI!.config.set = async () => ({ success: true });
  });
  await trackCartWrites(page);
  await row.locator('button').nth(2).click();
  await page
    .getByRole('dialog', { name: '재다운로드' })
    .getByRole('button', { name: '확인' })
    .click();
  await expect(page).toHaveURL(/#\/download$/);
  await expect(page.getByText('39개 패키지가 장바구니에 추가되었습니다.')).toBeVisible();
  expect(await cartWrites(page)).toBe(1);
  const items = (await readMockElectronAppState(page)).cart.items;
  expect(items[0]).toEqual(existing);
  expect(items.map(({ name }) => name)).toEqual(packages.map(({ name }) => name));
  expect(items[39]).toMatchObject(packages[39]);
});
