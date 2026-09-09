import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CartItem } from '../../src/renderer/stores/cart-store';
import { setupMockElectronApp } from './fixtures/mock-electron-app';

function createResolutionFixture() {
  const version = '1.20.5';
  const artifact = (artifactId: string, artifactType: 'jar' | 'pom') => {
    const filename = `${artifactId}-${version}.${artifactType}`;
    return {
      id: randomUUID(),
      type: 'maven' as const,
      name: `org.apache.flink:${artifactId}`,
      version,
      filename,
      size: 1024,
      metadata: { groupId: 'org.apache.flink', artifactId, type: artifactType, filename, size: 1024 },
    };
  };
  const original = artifact('flink-streaming-java', 'jar');
  const libraries = Array.from({ length: 35 }, (_, index) => artifact(`flink-library-${index}`, 'jar'));
  const poms = [
    artifact('flink-metrics', 'pom'),
    ...Array.from({ length: 34 }, (_, index) => artifact(`flink-parent-${index}`, 'pom')),
  ];
  const allPackages = [original, ...poms, ...libraries];
  const packageInfo = ({ type, name, version: resolvedVersion, metadata }: typeof original) => ({
    type, name, version: resolvedVersion, metadata,
  });
  return {
    cartItems: [{ ...original, addedAt: 1713081600000 }] satisfies CartItem[],
    payload: {
      originalPackages: [original],
      allPackages,
      dependencyTrees: [{
        root: {
          package: packageInfo(original),
          dependencies: libraries.map((item) => ({ package: packageInfo(item), dependencies: [] })),
        },
        // Required parent/BOM models are output artifacts, outside the runtime tree.
        flatList: allPackages.map(packageInfo),
        conflicts: [],
        totalSize: allPackages.length * 1024,
      }],
      failedPackages: [],
    },
  };
}

test('Flink 의존성 확인 화면에 부모 POM을 포함한 71개 항목을 표시한다', async ({ page }, testInfo) => {
  const fixture = createResolutionFixture();
  await setupMockElectronApp(page, {
    config: {
      includeDependencies: true,
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
      downloadRenderInterval: 0,
    },
    cartItems: fixture.cartItems,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/#/download');
  await expect(page.getByRole('button', { name: /의존성 확인$/ })).toBeVisible();

  await page.evaluate((payload) => {
    const api = window as unknown as {
      electronAPI: { dependency: { resolve: () => Promise<unknown> } };
    };
    api.electronAPI.dependency.resolve = async () => payload;
  }, fixture.payload);

  await page.getByRole('button', { name: /의존성 확인$/ }).click();

  await expect(page.getByText('71개 패키지', { exact: true })).toBeVisible();
  await expect(page.getByText('+70 의존성', { exact: true })).toBeVisible();
  await expect(page.getByText('0/71 완료', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-list-item')).toHaveCount(70);
  await expect(page.locator('.ant-list-item').filter({ hasText: /\.pom/ })).toHaveCount(35);
  await expect(page.getByText('flink-metrics-1.20.5.pom', { exact: true })).toBeVisible();
  await expect(page.getByText('flink-parent-33-1.20.5.pom', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('maven-pom-preview.png'), fullPage: true });
});
