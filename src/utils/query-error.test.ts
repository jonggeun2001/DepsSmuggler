import { describe, expect, it } from 'vitest';
import { QueryRequestError, toQueryFailure } from './query-error';

describe('query failure boundary', () => {
  it.each([
    [{ code: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'TLS_CERTIFICATE'],
    [new Error('self signed certificate in certificate chain'), 'TLS_CERTIFICATE'],
    [{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'TLS_CERTIFICATE'],
    [{ code: 'ECONNABORTED' }, 'TIMEOUT'],
    [new Error('timeout of 15000ms exceeded'), 'TIMEOUT'],
    [{ response: { status: 503 } }, 'HTTP'],
    [new Error('Request failed with status code 403'), 'HTTP'],
    [{ code: 'ENOTFOUND' }, 'NETWORK'],
    [new TypeError('Failed to fetch'), 'NETWORK'],
    [new SyntaxError('Unexpected token < in JSON'), 'INVALID_RESPONSE'],
    [new TypeError('Cannot read properties of undefined'), 'INVALID_RESPONSE'],
    [new Error('some other error'), 'UNKNOWN'],
  ])('classifies %j without raw error disclosure', (input, code) => {
    expect(toQueryFailure(input).code).toBe(code);
  });

  it('preserves structured status and redacts raw URLs/credentials', () => {
    const error = Object.assign(new Error('https://user:secret@example.com/private'), {
      response: { status: 401 },
    });
    expect(toQueryFailure(error)).toMatchObject({ code: 'HTTP', status: 401 });
    expect(toQueryFailure(error).message).not.toContain('secret');
    expect(toQueryFailure(new QueryRequestError('TIMEOUT')).code).toBe('TIMEOUT');
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(toQueryFailure(cycle).code).toBe('UNKNOWN');
  });
});
