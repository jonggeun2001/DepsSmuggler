import { expect, test, type Page } from '@playwright/test';
import { setupMockElectronApp } from './fixtures/mock-electron-app';
import type { UpdaterStatus } from '../../src/types/electron';

const releaseNotes = `<h3>v0.2.26 주요 변경</h3>
<ul>
  <li>Maven 부모 POM의 일반 의존성을 상속해 Kafka connector의 Jackson 2.15.2 등 누락되던 의존성을 반입합니다.</li>
  <li>발견된 여러 버전의 JAR·POM과 전이 의존성을 함께 다운로드합니다. 실제 반출에서 Jackson 2.15.2·2.15.3과 Kryo 2.21·2.24.0을 확인했습니다.</li>
  <li>관리 버전을 type/classifier별로 구분하고, 공유 의존성 그래프의 순환 간선을 차단하면서 필요한 파일은 보존합니다.</li>
  <li>실제 CLI 반출물과 생성 설치 스크립트, 오프라인 Maven 소비자 검증을 강화했습니다.</li>
</ul>
<p>관련 변경: <a href="https://github.com/jonggeun2001/DepsSmuggler/pull/125">#125</a> · 해결 이슈: <a href="https://github.com/jonggeun2001/DepsSmuggler/issues/124">#124</a></p>
<pre><code>depssmuggler download</code></pre>
<img src="https://attacker.invalid/pixel" onerror="window.__hostile = true">
<script>window.__hostile = true</script>
<iframe src="https://attacker.invalid"></iframe>`;

const releaseNotesArray = [
  { version: '0.2.26', note: releaseNotes },
  { version: '0.2.26', note: '<p>두 번째 항목</p>' },
];

type CapturedUpdater = {
  emit: ((status: UpdaterStatus) => void) | null;
  opened: string[];
};

async function installUpdaterHarness(page: Page, initialStatus?: UpdaterStatus) {
  await setupMockElectronApp(page);
  await page.addInitScript((snapshot) => {
    const api = window.electronAPI;
    const updater = api.updater;
    if (!updater) throw new Error('Updater API unavailable');
    const captured: CapturedUpdater = { emit: null, opened: [] };
    const originalSubscribe = updater.onStatusChange;
    updater.onStatusChange = (callback) => {
      captured.emit = callback;
      return originalSubscribe(callback);
    };
    updater.getStatus = async () =>
      snapshot ?? {
        checking: false,
        available: false,
        downloaded: false,
        downloading: false,
        error: null,
        progress: null,
        updateInfo: null,
      };
    (
      updater as typeof updater & {
        openReleaseNotesLink: (url: string) => Promise<{ success: boolean }>;
      }
    ).openReleaseNotesLink = async (url) => {
      captured.opened.push(url);
      return { success: true };
    };
    Object.defineProperty(window, '__updaterE2E__', { value: captured, configurable: true });
  }, initialStatus);
}

async function showUpdate(
  page: Page,
  notes: string | Array<{ version: string; note: string | null }> | null
) {
  await page.goto('/#/');
  await page.waitForFunction(
    () =>
      typeof (window as typeof window & { __updaterE2E__?: CapturedUpdater }).__updaterE2E__
        ?.emit === 'function'
  );
  await page.evaluate((releaseNotesValue) => {
    const harness = (window as typeof window & { __updaterE2E__: CapturedUpdater }).__updaterE2E__;
    if (!harness.emit) throw new Error('Updater listener is not subscribed');
    harness.emit({
      checking: false,
      available: true,
      downloaded: false,
      downloading: false,
      error: null,
      progress: null,
      updateInfo: {
        version: '0.2.26',
        releaseDate: '2026-09-10T00:00:00Z',
        releaseNotes: releaseNotesValue,
      },
    });
  }, notes);
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('릴리스 노트를 안전한 의미론적 HTML로 표시하고 링크를 updater bridge로 연다', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('attacker.invalid')) externalRequests.push(request.url());
  });
  await installUpdaterHarness(page);
  await showUpdate(page, releaseNotes);

  const dialog = page.getByRole('dialog');
  const notesRegion = dialog.locator('.release-notes');
  await expect(notesRegion.locator('h3')).toHaveText('v0.2.26 주요 변경');
  await expect(notesRegion.locator('ul > li')).toHaveCount(4);
  await expect(notesRegion.locator('li').nth(1)).toContainText('Jackson 2.15.2');
  await expect(notesRegion.locator('code')).toHaveText('depssmuggler download');
  await expect(notesRegion.locator('script, img, iframe')).toHaveCount(0);
  await expect(notesRegion.locator('[onerror], [onclick], [style]')).toHaveCount(0);
  await expect(notesRegion).not.toContainText('<h3>');
  await dialog.screenshot({ path: testInfo.outputPath('release-notes.png') });

  const href = 'https://github.com/jonggeun2001/DepsSmuggler/pull/125';
  const appUrl = page.url();
  const link = dialog.getByRole('link', { name: '#125' });
  await link.click();
  await link.focus();
  await page.keyboard.press('Enter');
  await link.click({ button: 'middle' });
  await expect(page).toHaveURL(appUrl);
  expect(page.context().pages()).toHaveLength(1);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, '__hostile'))).toBeUndefined();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __updaterE2E__: CapturedUpdater }).__updaterE2E__.opened
      )
    )
    .toEqual([href, href, href]);
});

test('문자열과 배열 릴리스 노트를 다운로드·설치 상태에서도 유지한다', async ({ page }) => {
  await installUpdaterHarness(page);
  await showUpdate(page, releaseNotesArray);
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('h3')).toHaveText('v0.2.26 주요 변경');
  await expect(dialog).toContainText('두 번째 항목');

  await page.evaluate(() => {
    const harness = (window as typeof window & { __updaterE2E__: CapturedUpdater }).__updaterE2E__;
    if (!harness.emit) throw new Error('Updater listener is not subscribed');
    harness.emit({
      checking: false,
      available: true,
      downloaded: false,
      downloading: true,
      error: null,
      progress: { percent: 42, bytesPerSecond: 1, total: 10, transferred: 4 },
      updateInfo: {
        version: '0.2.26',
        releaseDate: '2026-09-10T00:00:00Z',
        releaseNotes: '<p>진행 중에도 유지</p>',
      },
    });
  });
  await expect(dialog).toContainText('진행 중에도 유지');

  await page.evaluate(() => {
    const harness = (window as typeof window & { __updaterE2E__: CapturedUpdater }).__updaterE2E__;
    if (!harness.emit) throw new Error('Updater listener is not subscribed');
    harness.emit({
      checking: false,
      available: true,
      downloaded: true,
      downloading: false,
      error: null,
      progress: null,
      updateInfo: {
        version: '0.2.26',
        releaseDate: '2026-09-10T00:00:00Z',
        releaseNotes: '<p>설치 준비 완료</p>',
      },
    });
  });
  await expect(dialog).toContainText('설치 준비 완료');
  await expect(dialog.getByRole('button', { name: '지금 재시작' })).toBeVisible();
});

test('일반 텍스트의 줄바꿈과 비교 기호를 유지한다', async ({ page }) => {
  await installUpdaterHarness(page);
  const text = '첫 번째 줄\n값 < 3 & 다음 줄';
  await showUpdate(page, text);
  const notes = page.getByRole('dialog').locator('.release-notes__body--plain');
  await expect(notes).toHaveText(text);
  await expect(notes).toHaveCSS('white-space', 'pre-wrap');
});

test('빈 노트는 안내와 릴리스 링크를 표시하고 다운로드 버튼을 유지한다', async ({ page }, testInfo) => {
  await installUpdaterHarness(page);
  await showUpdate(page, [{ version: '0.2.26', note: null }]);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('이 버전의 변경 사항이 제공되지 않았습니다.');
  await dialog.screenshot({ path: testInfo.outputPath('empty-release-notes.png') });
  const appUrl = page.url();
  await dialog.getByRole('link', { name: 'GitHub 릴리스 보기' }).click();
  expect(
    await page.evaluate(
      () => (window as typeof window & { __updaterE2E__: CapturedUpdater }).__updaterE2E__.opened
    )
  ).toEqual(['https://github.com/jonggeun2001/DepsSmuggler/releases/tag/v0.2.26']);
  await expect(page).toHaveURL(appUrl);
  await expect(dialog.getByRole('button', { name: /다운로드$/ })).toBeVisible();
});

test('구독 전 완료된 업데이트를 초기 상태만으로 열어 릴리스 이력을 표시한다', async ({ page }) => {
  await installUpdaterHarness(page, {
    checking: false,
    available: true,
    downloaded: true,
    downloading: false,
    error: null,
    progress: null,
    updateInfo: {
      version: '0.2.30',
      releaseDate: '2026-09-22T00:00:00Z',
      releaseNotes: '<p>검색 오류 안내 개선</p>',
    },
  });
  await page.goto('/#/');
  const dialog = page.getByRole('dialog', { name: '업데이트 준비 완료' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('릴리스 이력');
  await expect(dialog).toContainText('검색 오류 안내 개선');
  await expect(dialog.getByRole('button', { name: '지금 재시작' })).toBeVisible();
});
