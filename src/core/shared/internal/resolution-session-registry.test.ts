import { describe, expect, it } from 'vitest';
import { ResolutionSession } from './resolution-session';
import {
  attachResolutionSession,
  getAttachedResolutionSession,
} from './resolution-session-registry';

describe('resolution-session-registry', () => {
  it('owner별 ResolutionSession 연결을 격리한다', () => {
    const firstOwner = {};
    const secondOwner = {};
    const firstSession = new ResolutionSession();
    const secondSession = new ResolutionSession();

    attachResolutionSession(firstOwner, firstSession);
    attachResolutionSession(secondOwner, secondSession);

    expect(getAttachedResolutionSession(firstOwner)).toBe(firstSession);
    expect(getAttachedResolutionSession(secondOwner)).toBe(secondSession);
  });

  it('연결되지 않은 owner에는 undefined를 반환한다', () => {
    expect(getAttachedResolutionSession({})).toBeUndefined();
  });
});
