import { expect, test } from '@playwright/test';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

const repository = 'https://artifacts.alfresco.com/nexus/content/repositories/public';

test('패키지 추가 화면에서 저장소를 추가·선택하고 장바구니에 보존한다', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: { mavenRepositories: ['https://unused.example.com/repo'] },
  });
  await page.goto('/');
  await page.evaluate(() => {
    const requests: unknown[] = [];
    window.electronAPI.search.packages = async (type, query, options) => {
      requests.push({ type, query, options });
      sessionStorage.setItem('maven-requests', JSON.stringify(requests));
      return { results: [{ name: 'com.ibm.db2.jcc:db2jcc4', version: '10.1' }] };
    };
    window.electronAPI.search.versions = async (type, name, options) => {
      requests.push({ type, name, options });
      sessionStorage.setItem('maven-requests', JSON.stringify(requests));
      return { versions: ['10.1'] };
    };
    if (window.electronAPI.maven) window.electronAPI.maven.isNativeArtifact = async () => false;
    window.location.hash = '/wizard?type=maven';
  });
  await page.getByLabel('추가할 Maven 저장소 URL').fill(repository + '/');
  await page.getByRole('button', { name: '추가·선택' }).click();
  await page
    .getByPlaceholder('아티팩트를 입력하세요', { exact: false })
    .fill('com.ibm.db2.jcc:db2jcc4');
  await page.getByRole('menuitem').filter({ hasText: 'com.ibm.db2.jcc:db2jcc4' }).click();
  await page.getByRole('button', { name: '장바구니에 추가' }).click();
  const state = await readMockElectronAppState(page);
  expect(state.cart.items).toMatchObject([
    { name: 'com.ibm.db2.jcc:db2jcc4', metadata: { mavenRepository: repository } },
  ]);
  expect(state.config.mavenRepositories).toEqual(['https://unused.example.com/repo', repository]);
  const requests = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('maven-requests') || '[]')
  );
  expect(requests.length).toBeGreaterThanOrEqual(2);
  for (const request of requests) expect(request.options).toEqual({ repositoryUrl: repository });
  await page.goto('/#/cart');
  await expect(page.getByRole('row').filter({ hasText: 'com.ibm.db2.jcc:db2jcc4' })).toContainText(
    repository
  );
  await page.reload();
  expect((await readMockElectronAppState(page)).cart.items[0].metadata?.mavenRepository).toBe(
    repository
  );
});

test('장바구니 POM 가져오기에 선택한 저장소를 전달하고 추가 항목에 보존한다', async ({ page }) => {
  await setupMockElectronApp(page);
  await page.goto('/#/cart');
  await page.evaluate(() => {
    if (!window.electronAPI.maven) throw new Error('Maven API missing');
    window.electronAPI.maven.parseProject = async (_content, options) => {
      sessionStorage.setItem('maven-project-options', JSON.stringify(options));
      return {
        success: true,
        packages: [{ type: 'maven', name: 'com.ibm.db2.jcc:db2jcc4', version: '10.1' }],
      };
    };
  });
  await page.getByLabel('추가할 Maven 저장소 URL').fill(repository);
  await page.getByRole('button', { name: '추가·선택' }).click();
  await page.getByRole('button', { name: /텍스트로 추가$/ }).click();
  const dialog = page.getByRole('dialog', { name: '패키지 목록 붙여넣기' });
  await dialog.getByRole('tab', { name: 'pom.xml', exact: true }).click();
  await dialog
    .getByRole('textbox')
    .fill(
      '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>app</artifactId><version>1</version></project>'
    );
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('maven-project-options') || '{}'))
  ).toEqual({ mavenVersion: '3.9.11', repositoryUrl: repository });
  expect((await readMockElectronAppState(page)).cart.items[0].metadata?.mavenRepository).toBe(
    repository
  );
});
