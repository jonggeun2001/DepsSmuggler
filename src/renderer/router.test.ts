import { describe, expect, it } from 'vitest';
import { appRoutes } from './router';

describe('router', () => {
  it('라우트 정의가 단일 source of truth에 모여 있다', () => {
    expect(appRoutes).toHaveLength(1);
    expect(appRoutes[0].path).toBe('/');

    const childPaths = (appRoutes[0].children || []).map((route) => route.path ?? '(index)');

    expect(childPaths).toEqual([
      '(index)',
      'wizard',
      'cart',
      'download',
      'history',
      'settings',
      '*',
    ]);
  });
});
