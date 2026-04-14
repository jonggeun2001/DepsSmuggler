import { describe, expect, it } from 'vitest';
import { parseSearchInput } from './useWizardSearchFlow';

describe('useWizardSearchFlow helpers', () => {
  it('pip 검색어에서 extras를 분리한다', () => {
    expect(parseSearchInput('pip', 'jax[cuda, tpu]')).toEqual({
      searchQuery: 'jax',
      extras: ['cuda', 'tpu'],
    });
  });

  it('pip 이외 타입은 원본 검색어를 유지한다', () => {
    expect(parseSearchInput('npm', '@scope/pkg')).toEqual({
      searchQuery: '@scope/pkg',
      extras: [],
    });
  });
});
