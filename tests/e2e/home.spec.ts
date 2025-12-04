import { test, expect } from '@playwright/test';

test.describe('홈페이지', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('메인 타이틀이 표시된다', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'DepsSmuggler' })).toBeVisible();
  });

  test('설명 텍스트가 표시된다', async ({ page }) => {
    await expect(page.getByText('폐쇄망에서 일하시는 형님들을 위한')).toBeVisible();
  });

  test('패키지 검색 시작 버튼이 있다', async ({ page }) => {
    const searchButton = page.getByRole('button', { name: /패키지 검색 시작/ });
    await expect(searchButton).toBeVisible();
  });

  test('장바구니 버튼이 있다', async ({ page }) => {
    const cartButton = page.getByRole('button', { name: /장바구니/ });
    await expect(cartButton).toBeVisible();
  });

  test('지원하는 패키지 타입 카드들이 표시된다', async ({ page }) => {
    await expect(page.getByText('Python')).toBeVisible();
    await expect(page.getByText('Java')).toBeVisible();
    await expect(page.getByText('Linux')).toBeVisible();
    await expect(page.getByText('Container')).toBeVisible();
  });

  test('빠른 시작 카드들이 표시된다', async ({ page }) => {
    await expect(page.getByText('패키지 검색').first()).toBeVisible();
    await expect(page.getByText('장바구니 확인')).toBeVisible();
    await expect(page.getByText('다운로드').first()).toBeVisible();
  });

  test('통계 카드들이 표시된다', async ({ page }) => {
    await expect(page.getByText('지원 패키지 매니저')).toBeVisible();
    await expect(page.getByText('컨테이너 레지스트리')).toBeVisible();
  });

  test('패키지 검색 시작 버튼 클릭 시 위자드 페이지로 이동', async ({ page }) => {
    await page.getByRole('button', { name: /패키지 검색 시작/ }).click();
    await expect(page).toHaveURL(/.*wizard/);
  });

  test('장바구니 버튼 클릭 시 장바구니 페이지로 이동', async ({ page }) => {
    await page.getByRole('button', { name: /장바구니/ }).click();
    await expect(page).toHaveURL(/.*cart/);
  });
});
