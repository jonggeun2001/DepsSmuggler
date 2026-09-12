import { expect, test, type Page } from '@playwright/test';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

async function openTextInput(page: Page, tab = 'requirements.txt') {
  // Ant Design includes the icon label in the button's accessible name.
  // Anchor the text suffix to exclude the separate "텍스트로 추가하기" button.
  await page.getByRole('button', { name: /텍스트로 추가$/ }).click();
  const dialog = page.getByRole('dialog', { name: '패키지 목록 붙여넣기' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}

test('빈 장바구니와 다운로드 화면은 입력·검색으로 돌아갈 수 있고 빈 입력은 추가하지 않는다', async ({
  page,
}) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await expect(page.getByText('장바구니가 비어있습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toHaveCount(0);
  const dialog = await openTextInput(page);
  await dialog.getByRole('textbox').fill('   \n  ');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('내용을 입력하세요')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect((await readMockElectronAppState(page)).cart.items).toEqual([]);
  await dialog.getByRole('button', { name: '취소', exact: true }).click();

  await page.goto('/#/download');
  await expect(page.getByText('다운로드할 패키지가 없습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '다운로드 시작' })).toHaveCount(0);
  await page.getByRole('button', { name: '장바구니로 이동' }).click();
  await expect(page.getByText('장바구니가 비어있습니다')).toBeVisible();
  expect((await readMockElectronAppState(page)).runtime.downloadCalls).toEqual([]);
});

test('requirements 입력은 주석과 옵션을 제외하고 중복 없이 저장하며 다시 가져와도 유지된다', async ({
  page,
}) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  const input =
    '# pinned packages\nrequests==2.32.3\n\n-r base.txt\nnumpy==2.2.0\nrequests==2.32.3';
  let dialog = await openTextInput(page);
  await dialog.getByRole('textbox').fill(input);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('2개 패키지가 추가되었습니다')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'requests', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'numpy', exact: true })).toBeVisible();
  let state = await readMockElectronAppState(page);
  expect(state.cart.items.map(({ type, name, version }) => ({ type, name, version }))).toEqual([
    { type: 'pip', name: 'requests', version: '2.32.3' },
    { type: 'pip', name: 'numpy', version: '2.2.0' },
  ]);

  await page.reload();
  await expect(page.getByRole('cell', { name: 'requests', exact: true })).toBeVisible();
  dialog = await openTextInput(page);
  await dialog.getByRole('textbox').fill(input);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('모든 패키지가 이미 장바구니에 있습니다')).toBeVisible();
  state = await readMockElectronAppState(page);
  expect(state.cart.items).toHaveLength(2);
  expect(state.runtime.downloadCalls).toEqual([]);
});

test('버전을 생략한 입력은 최신 버전을 조회하고 조회 실패 패키지는 latest로 유지한다', async ({
  page,
}) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page.evaluate(() => {
    window.electronAPI!.search.versions = async (_type, name) => {
      if (name === 'offline-package') throw new Error('mock registry unavailable');
      return { versions: ['3.1.0', '3.0.0'] };
    };
  });
  const dialog = await openTextInput(page);
  await dialog.getByRole('textbox').fill('flask\noffline-package');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('2개 패키지가 추가되었습니다')).toBeVisible();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items.map(({ name, version }) => ({ name, version }))).toEqual([
    { name: 'flask', version: '3.1.0' },
    { name: 'offline-package', version: 'latest' },
  ]);
});

for (const [label, input] of [
  ['문법 오류', '{ "dependencies": '],
  ['문자열이 아닌 버전', '{ "dependencies": { "react": 19 } }'],
]) {
  test(`package.json ${label}는 기존 장바구니를 변경하지 않는다`, async ({ page }) => {
    await setupMockElectronApp(page, {
      cartItems: [{ id: 'existing', type: 'pip', name: 'requests', version: '2.32.3', addedAt: 1 }],
    });
    await page.goto('/#/cart');
    const before = (await readMockElectronAppState(page)).cart.items;
    const dialog = await openTextInput(page, 'package.json');
    await dialog.getByRole('textbox').fill(input);
    await dialog.getByRole('button', { name: '추가', exact: true }).click();
    await expect(page.getByText('package.json 파싱 실패')).toBeVisible();
    expect((await readMockElectronAppState(page)).cart.items).toEqual(before);
    await expect(page.getByRole('cell', { name: 'requests', exact: true })).toBeVisible();
  });
}

test('package.json 입력은 일반·개발 의존성과 scoped 이름을 장바구니에 담는다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  const dialog = await openTextInput(page, 'package.json');
  await dialog.getByRole('textbox').fill(
    JSON.stringify({
      name: 'application',
      dependencies: { react: '^19.0.0', '@example/cli': '~1.3.0' },
      devDependencies: { typescript: '5.9.3' },
    })
  );
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('3개 패키지가 추가되었습니다')).toBeVisible();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items.map(({ type, name, version }) => ({ type, name, version }))).toEqual([
    { type: 'npm', name: 'react', version: '19.0.0' },
    { type: 'npm', name: '@example/cli', version: '1.3.0' },
    { type: 'npm', name: 'typescript', version: '5.9.3' },
  ]);
  await expect(page.getByRole('cell', { name: '@example/cli', exact: true })).toBeVisible();
});

test('requirements 파일 업로드는 파일 내용을 읽어 패키지를 추가한다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'requirements.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('requests==2.32.3\n# upload comment\nflask==3.1.0\n'),
    });
  await expect(page.getByText('2개 패키지가 추가되었습니다')).toBeVisible();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items.map(({ name, version }) => ({ name, version }))).toEqual([
    { name: 'requests', version: '2.32.3' },
    { name: 'flask', version: '3.1.0' },
  ]);
  await expect(page.getByText('장바구니가 비어있습니다')).toHaveCount(0);
});

test('pom.xml 입력은 같은 좌표의 JAR와 POM 아티팩트를 구분해 보존한다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  const dialog = await openTextInput(page, 'pom.xml');
  await dialog.getByRole('textbox').fill(`<dependencies>
    <dependency><groupId>org.example</groupId><artifactId>platform</artifactId><version>1.0</version><type>pom</type></dependency>
    <dependency><groupId>org.example</groupId><artifactId>platform</artifactId><version>1.0</version></dependency>
  </dependencies>`);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('2개 패키지가 추가되었습니다')).toBeVisible();
  const items = (await readMockElectronAppState(page)).cart.items;
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    type: 'maven',
    name: 'org.example:platform',
    version: '1.0',
    metadata: { type: 'pom' },
  });
  expect(items[1]).toMatchObject({ type: 'maven', name: 'org.example:platform', version: '1.0' });
  expect(items[1].metadata?.type).toBeUndefined();
});

test('전체 Maven POM은 입력한 기준 버전을 IPC에 전달하고 build plugin 패키지를 추가한다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page.evaluate(() => {
    const api = window.electronAPI!.maven! as typeof window.electronAPI.maven & {
      parseProject: (content: string, options?: { mavenVersion?: string }) => Promise<unknown>;
    };
    (window as typeof window & { mavenCalls?: unknown[] }).mavenCalls = [];
    api.parseProject = async (content, options) => {
      (window as typeof window & { mavenCalls: unknown[] }).mavenCalls.push({ content, options });
      return {
        success: true,
        packages: [{ name: 'org.apache.maven.plugins:maven-compiler-plugin', version: '3.13.0', metadata: { type: 'maven-plugin' } }],
      };
    };
  });
  await page.getByLabel('Maven 기준 버전').fill('3.8.6');
  const dialog = await openTextInput(page, 'pom.xml');
  await dialog.getByRole('textbox').fill(
    '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>app</artifactId><version>1</version><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build></project>',
  );
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('1개 패키지가 추가되었습니다')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'org.apache.maven.plugins:maven-compiler-plugin', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { mavenCalls: Array<{ options: unknown }> }).mavenCalls)).toEqual([
    expect.objectContaining({ options: { mavenVersion: '3.8.6' } }),
  ]);
});

test('전체 Maven POM IPC 오류는 입력과 장바구니를 보존하고 fragment는 기존 parser를 사용한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    cartItems: [{ id: 'existing', type: 'pip', name: 'requests', version: '2.32.3', addedAt: 1 }],
  });
  await page.goto('/#/cart');
  await page.evaluate(() => {
    window.electronAPI!.maven!.parseProject = async () => ({ success: false, packages: [], error: 'POM service unavailable' });
  });
  const dialog = await openTextInput(page, 'pom.xml');
  const fullPom = '<project><groupId>demo</groupId><artifactId>app</artifactId><version>1</version></project>';
  await dialog.getByRole('textbox').fill(fullPom);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('POM service unavailable')).toBeVisible();
  await expect(dialog).toBeVisible();
  expect((await readMockElectronAppState(page)).cart.items).toHaveLength(1);

  await dialog.getByRole('textbox').fill('<dependencies><dependency><groupId>org.example</groupId><artifactId>fragment</artifactId><version>1</version></dependency></dependencies>');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('1개 패키지가 추가되었습니다')).toBeVisible();
  expect((await readMockElectronAppState(page)).cart.items.some((item) => item.name === 'org.example:fragment')).toBe(true);
});

test('전체 Maven POM을 처리하는 동안 Escape와 후속 IPC 오류에도 모달 입력을 보존한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    cartItems: [{ id: 'existing', type: 'pip', name: 'requests', version: '2.32.3', addedAt: 1 }],
  });
  await page.goto('/#/cart');
  await page.evaluate(() => {
    let resolveParse!: (result: { success: false; packages: []; error: string }) => void;
    (window as typeof window & {
      parseStarted?: boolean;
      resolveParse?: typeof resolveParse;
    }).parseStarted = false;
    window.electronAPI!.maven!.parseProject = async () => {
      (window as typeof window & { parseStarted: boolean }).parseStarted = true;
      return new Promise((resolve) => {
        resolveParse = resolve as typeof resolveParse;
        (window as typeof window & { resolveParse: typeof resolveParse }).resolveParse = resolveParse;
      });
    };
  });
  const dialog = await openTextInput(page, 'pom.xml');
  const fullPom = '<project><groupId>demo</groupId><artifactId>app</artifactId><version>1</version></project>';
  await dialog.getByRole('textbox').fill(fullPom);
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await page.waitForFunction(() => (window as typeof window & { parseStarted?: boolean }).parseStarted === true);
  await expect(dialog.getByRole('textbox')).toBeDisabled();
  await expect(dialog.getByRole('tab', { name: 'package.json', exact: true })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue(fullPom);

  await page.evaluate(() => {
    (window as typeof window & { resolveParse: (result: { success: false; packages: []; error: string }) => void }).resolveParse({
      success: false,
      packages: [],
      error: 'POM service unavailable',
    });
  });
  await expect(page.getByText('POM service unavailable')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue(fullPom);
  expect((await readMockElectronAppState(page)).cart.items).toHaveLength(1);
});

test('여러 파일의 Maven parse가 모두 끝날 때까지 업로드와 텍스트 입력을 잠근다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page.evaluate(() => {
    (window as typeof window & {
      pendingParses?: Array<(result: { success: true; packages: Array<{ name: string; version: string }> }) => void>;
      parseContents?: string[];
    }).pendingParses = [];
    (window as typeof window & { parseContents?: string[] }).parseContents = [];
    window.electronAPI!.maven!.parseProject = async (content) => {
      const state = window as typeof window & {
        pendingParses: Array<(result: { success: true; packages: Array<{ name: string; version: string }> }) => void>;
        parseContents: string[];
      };
      state.parseContents.push(content);
      return new Promise((resolve) => {
        state.pendingParses.push(resolve as typeof state.pendingParses[number]);
      });
    };
  });

  const uploadInput = page.locator('input[type="file"][multiple]');
  await uploadInput.setInputFiles([
    { name: 'first.xml', mimeType: 'application/xml', buffer: Buffer.from('<project><groupId>demo</groupId><artifactId>first</artifactId><version>1</version></project>') },
    { name: 'second.xml', mimeType: 'application/xml', buffer: Buffer.from('<project><groupId>demo</groupId><artifactId>second</artifactId><version>1</version></project>') },
  ]);
  await page.waitForFunction(() => (window as typeof window & { pendingParses?: unknown[] }).pendingParses?.length === 2);
  await expect(page.getByRole('button', { name: '텍스트로 추가하기' })).toBeDisabled();
  await expect(uploadInput).toBeDisabled();

  await page.evaluate(() => {
    const state = window as typeof window & { pendingParses: Array<(result: { success: true; packages: Array<{ name: string; version: string }> }) => void> };
    state.pendingParses.shift()!({ success: true, packages: [{ name: 'demo:first', version: '1' }] });
  });
  await expect(page.getByRole('cell', { name: 'demo:first', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /텍스트로 추가$/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '파일 가져오기' })).toBeDisabled();

  await page.evaluate(() => {
    const state = window as typeof window & { pendingParses: Array<(result: { success: true; packages: Array<{ name: string; version: string }> }) => void> };
    state.pendingParses.shift()!({ success: true, packages: [{ name: 'demo:second', version: '1' }] });
  });
  await expect(page.getByRole('button', { name: /텍스트로 추가$/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: '파일 가져오기' })).toBeEnabled();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items.map(({ name }) => name)).toEqual(['demo:first', 'demo:second']);
});

test('Maven 파일 읽기 오류 뒤에는 입력 잠금이 해제된다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      File.prototype.text = originalText;
      return Promise.reject(new Error('fixture read failure'));
    };
  });

  const uploadInput = page.locator('input[type="file"][multiple]');
  await uploadInput.setInputFiles({
    name: 'unreadable.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<project />'),
  });
  await expect(page.getByText('파일을 읽을 수 없습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '텍스트로 추가하기' })).toBeEnabled();
  await expect(uploadInput).toBeEnabled();
});
