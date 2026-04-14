import { describe, expect, it } from 'vitest';
import {
  resolveWizardTypeParam,
  stripWizardTypeParam,
} from './query-params';

describe('query-params', () => {
  it('유효한 type 파라미터를 category/packageType/step으로 해석한다', () => {
    expect(resolveWizardTypeParam(new URLSearchParams('type=yum'))).toEqual({
      category: 'os',
      packageType: 'yum',
      currentStep: 2,
    });
  });

  it('유효하지 않은 type 파라미터는 무시한다', () => {
    expect(resolveWizardTypeParam(new URLSearchParams('type=unknown'))).toBeNull();
    expect(resolveWizardTypeParam(new URLSearchParams('type=toString'))).toBeNull();
    expect(resolveWizardTypeParam(new URLSearchParams('type=__proto__'))).toBeNull();
    expect(resolveWizardTypeParam(new URLSearchParams('foo=bar'))).toBeNull();
  });

  it('type 파라미터만 제거하고 다른 파라미터는 유지한다', () => {
    const params = stripWizardTypeParam(new URLSearchParams('type=apk&tab=advanced'));

    expect(params.toString()).toBe('tab=advanced');
  });
});
