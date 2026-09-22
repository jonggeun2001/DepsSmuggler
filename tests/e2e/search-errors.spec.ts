import { expect, test } from '@playwright/test';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

test('자동 Maven 검색: 인증서 오류 안내, 재시도, 버전 실패와 복구', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/');
  await page.clock.install();
  await page.evaluate(() => {
    let searches = 0;
    let versionLookups = 0;
    window.electronAPI.search.packages = async () => {
      searches++;
      return searches <= 2
        ? { results: [], error: { code: 'TLS_CERTIFICATE', message: 'raw untrusted error' } }
        : {
            results: [
              {
                name: 'com.amazon.deequ:deequ',
                version: '3.0.3-spark3.5',
                description: 'Data quality',
              },
            ],
          };
    };
    window.electronAPI.search.versions = async () => {
      versionLookups++;
      return versionLookups === 1
        ? { versions: [], error: { code: 'TIMEOUT', message: 'timeout' } }
        : { versions: ['3.0.3-spark3.5', '2.0.0'] };
    };
    window.location.hash = '/wizard?type=maven';
  });
  const input = page.getByPlaceholder('아티팩트를 입력하세요', { exact: false });
  await input.fill('deequ');
  const searchFailure = page.getByRole('alert').filter({ hasText: '패키지 검색에 실패했습니다' });
  await expect(searchFailure).toBeVisible();
  await expect(searchFailure).toContainText('서버 인증서를 신뢰할 수 없습니다');
  await expect(searchFailure.getByRole('link', { name: 'CA 설정 열기' })).toHaveAttribute(
    'href',
    '#/settings'
  );
  await expect(page.getByText('raw untrusted error')).toHaveCount(0);
  await input.fill('deequ2');
  await expect(searchFailure).toHaveCount(1);
  await expect(searchFailure).toBeVisible();
  await searchFailure.getByRole('button', { name: '다시 시도' }).click();
  const candidate = page.getByRole('menuitem').filter({ hasText: 'com.amazon.deequ:deequ' });
  await expect(candidate).toBeVisible();
  // A fast retry must remain visible after the input's old 200ms blur deadline.
  await page.clock.runFor(250);
  await expect(candidate).toBeVisible();
  await candidate.click();
  const versionFailure = page
    .getByRole('alert')
    .filter({ hasText: '버전 목록을 불러오지 못했습니다' });
  await expect(versionFailure).toBeVisible();
  await expect(versionFailure).toContainText('검색 결과에 포함된 버전을 표시합니다');
  await expect(page.getByText('3.0.3-spark3.5', { exact: true })).toBeVisible();
  await expect(page.getByText('3.0.3-spark3.5 (최신)', { exact: true })).toHaveCount(0);
  await versionFailure.getByRole('button', { name: '다시 시도' }).click();
  await expect(versionFailure).toHaveCount(0);
  await expect(page.getByText('3.0.3-spark3.5 (최신)', { exact: true })).toBeVisible();
});

test('브라우저 자동 검색: HTTP 오류, 응답 파싱 오류, 정상 0건을 구분한다', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/maven/search?*', async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else if (requests === 2)
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>gateway</html>' });
    else await route.fulfill({ json: { results: [] } });
  });
  await page.goto('/#/wizard?type=maven');
  await page.getByPlaceholder('아티팩트를 입력하세요', { exact: false }).fill('deequ');
  const failure = page.getByRole('alert').filter({ hasText: '패키지 검색에 실패했습니다' });
  await expect(failure).toContainText('HTTP 503');
  await failure.getByRole('button', { name: '다시 시도' }).click();
  await expect(failure).toContainText('응답을 읽을 수 없습니다');
  await failure.getByRole('button', { name: '다시 시도' }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('검색 결과가 없습니다');
  expect(requests).toBe(3);
});

test('Maven 버전 조회가 실패해도 네이티브 classifier를 선택해 장바구니에 보존한다', async ({
  page,
}) => {
  await setupMockElectronApp(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.electronAPI.search.packages = async () => ({
      results: [{ name: 'org.lwjgl:lwjgl', version: '3.3.6', description: 'native fixture' }],
    });
    window.electronAPI.search.versions = async () => ({
      versions: [],
      error: { code: 'HTTP', status: 503, message: '' },
    });
    if (!window.electronAPI.maven) throw new Error('Maven fixture missing');
    window.electronAPI.maven.isNativeArtifact = async () => true;
    window.electronAPI.maven.getAvailableClassifiers = async () => ['natives-linux'];
    window.location.hash = '/wizard?type=maven';
  });
  await page.getByPlaceholder('아티팩트를 입력하세요', { exact: false }).fill('lwjgl');
  await page.getByRole('menuitem').filter({ hasText: 'org.lwjgl:lwjgl' }).click();
  await expect(page.getByText('버전 목록을 불러오지 못했습니다', { exact: true })).toBeVisible();
  await expect(page.getByText('Classifier 선택', { exact: true })).toBeVisible();
  await page
    .locator('.ant-select')
    .filter({ hasText: 'classifier 선택' })
    .getByRole('combobox')
    .click();
  await page.locator('.ant-select-item-option').filter({ hasText: 'natives-linux' }).click();
  await page.getByRole('button', { name: /장바구니에 추가/ }).click();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items).toEqual([
    expect.objectContaining({
      name: 'org.lwjgl:lwjgl',
      version: '3.3.6',
      classifier: 'natives-linux',
    }),
  ]);
});
