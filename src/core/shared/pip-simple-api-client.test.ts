import { describe, expect, it } from 'vitest';
import { parseSimpleApiHtml } from './pip-simple-api-client';

describe('parseSimpleApiHtml', () => {
  it('SHA-256 이외의 Simple API URL fragment 체크섬도 보존한다', () => {
    const [file] = parseSimpleApiHtml(
      '<a href="demo-1.0.0-py3-none-any.whl#md5=abc123">demo-1.0.0-py3-none-any.whl</a>',
      'https://index.example/simple/demo/',
    );

    expect(file).toMatchObject({
      url: 'https://index.example/simple/demo/demo-1.0.0-py3-none-any.whl',
      hash: {
        algorithm: 'md5',
        digest: 'abc123',
      },
    });
  });
});
