/**
 * pip-simple-api.ts 단위 테스트
 */

import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import {
  extractVersionFromFilename,
  getPackageType,
  parseSimpleApiHtml,
  extractVersionsFromReleases,
  fetchVersionsFromSimpleApi,
} from './pip-simple-api';

// axios 모킹
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('pip-simple-api', () => {
  describe('extractVersionFromFilename', () => {
    it('wheel 파일에서 버전을 추출해야 함', () => {
      expect(extractVersionFromFilename('requests-2.28.0-py3-none-any.whl', 'requests')).toBe('2.28.0');
      expect(extractVersionFromFilename('numpy-1.24.0-cp311-cp311-macosx_10_9_x86_64.whl', 'numpy')).toBe('1.24.0');
      expect(extractVersionFromFilename('Flask-2.0.1-py3-none-any.whl', 'flask')).toBe('2.0.1');
    });

    it('sdist 파일에서 버전을 추출해야 함', () => {
      expect(extractVersionFromFilename('requests-2.28.0.tar.gz', 'requests')).toBe('2.28.0');
      expect(extractVersionFromFilename('numpy-1.24.0.zip', 'numpy')).toBe('1.24.0');
      expect(extractVersionFromFilename('Flask-2.0.1.tar.bz2', 'flask')).toBe('2.0.1');
    });

    it('패키지명에 하이픈/언더스코어가 포함된 경우 처리', () => {
      expect(extractVersionFromFilename('my-package-1.0.0.tar.gz', 'my_package')).toBe('1.0.0');
      expect(extractVersionFromFilename('my_package-1.0.0.tar.gz', 'my-package')).toBe('1.0.0');
      expect(extractVersionFromFilename('zope.interface-5.0.0.tar.gz', 'zope.interface')).toBe('5.0.0');
    });

    it('버전 추출 실패 시 null 반환', () => {
      expect(extractVersionFromFilename('invalid-file.txt', 'requests')).toBeNull();
      expect(extractVersionFromFilename('another-package-1.0.0.tar.gz', 'requests')).toBeNull();
    });
  });

  describe('getPackageType', () => {
    it('wheel 파일 인식', () => {
      expect(getPackageType('requests-2.28.0-py3-none-any.whl')).toBe('wheel');
    });

    it('sdist 파일 인식', () => {
      expect(getPackageType('requests-2.28.0.tar.gz')).toBe('sdist');
      expect(getPackageType('requests-2.28.0.zip')).toBe('sdist');
      expect(getPackageType('requests-2.28.0.tar.bz2')).toBe('sdist');
      expect(getPackageType('requests-2.28.0.tar.xz')).toBe('sdist');
    });

    it('egg 파일 인식', () => {
      expect(getPackageType('requests-2.28.0-py3.8.egg')).toBe('egg');
    });

    it('알 수 없는 형식', () => {
      expect(getPackageType('requests-2.28.0.exe')).toBe('unknown');
    });
  });

  describe('parseSimpleApiHtml', () => {
    const sampleHtml = `
<!DOCTYPE html>
<html>
<head><title>Links for requests</title></head>
<body>
<h1>Links for requests</h1>
<a href="https://files.pythonhosted.org/packages/requests-2.27.0.tar.gz#sha256=abc123" data-requires-python="&gt;=3.7">requests-2.27.0.tar.gz</a>
<a href="https://files.pythonhosted.org/packages/requests-2.28.0.tar.gz#sha256=def456" data-requires-python="&gt;=3.7, &lt;4">requests-2.28.0.tar.gz</a>
<a href="https://files.pythonhosted.org/packages/requests-2.28.0-py3-none-any.whl#sha256=ghi789">requests-2.28.0-py3-none-any.whl</a>
</body>
</html>
`;

    it('HTML에서 릴리스 목록을 파싱해야 함', () => {
      const releases = parseSimpleApiHtml(sampleHtml, 'requests');

      expect(releases.length).toBe(3);
    });

    it('파일명, URL, 해시를 올바르게 추출해야 함', () => {
      const releases = parseSimpleApiHtml(sampleHtml, 'requests');

      const firstRelease = releases[0];
      expect(firstRelease.filename).toBe('requests-2.27.0.tar.gz');
      expect(firstRelease.url).toBe('https://files.pythonhosted.org/packages/requests-2.27.0.tar.gz');
      expect(firstRelease.hash).toBe('abc123');
      expect(firstRelease.hashAlgorithm).toBe('sha256');
    });

    it('버전을 올바르게 추출해야 함', () => {
      const releases = parseSimpleApiHtml(sampleHtml, 'requests');

      expect(releases[0].version).toBe('2.27.0');
      expect(releases[1].version).toBe('2.28.0');
      expect(releases[2].version).toBe('2.28.0');
    });

    it('패키지 타입을 올바르게 식별해야 함', () => {
      const releases = parseSimpleApiHtml(sampleHtml, 'requests');

      expect(releases[0].packageType).toBe('sdist');
      expect(releases[2].packageType).toBe('wheel');
    });

    it('data-requires-python을 올바르게 디코딩해야 함', () => {
      const releases = parseSimpleApiHtml(sampleHtml, 'requests');

      expect(releases[0].requiresPython).toBe('>=3.7');
      expect(releases[1].requiresPython).toBe('>=3.7, <4');
    });
  });

  describe('extractVersionsFromReleases', () => {
    it('유니크한 버전 목록을 추출해야 함', () => {
      const releases = [
        { filename: 'pkg-1.0.0.tar.gz', url: '', version: '1.0.0', packageType: 'sdist' as const },
        { filename: 'pkg-1.0.0-py3-none-any.whl', url: '', version: '1.0.0', packageType: 'wheel' as const },
        { filename: 'pkg-2.0.0.tar.gz', url: '', version: '2.0.0', packageType: 'sdist' as const },
      ];

      const versions = extractVersionsFromReleases(releases);

      expect(versions).toHaveLength(2);
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('2.0.0');
    });
  });

  describe('fetchVersionsFromSimpleApi', () => {
    it('Simple API에서 버전 목록을 가져와야 함', async () => {
      const mockHtml = `
<html>
<body>
<a href="https://files.pythonhosted.org/packages/requests-2.27.0.tar.gz#sha256=abc">requests-2.27.0.tar.gz</a>
<a href="https://files.pythonhosted.org/packages/requests-2.28.0.tar.gz#sha256=def">requests-2.28.0.tar.gz</a>
</body>
</html>
`;
      mockedAxios.get.mockResolvedValueOnce({ data: mockHtml });

      const versions = await fetchVersionsFromSimpleApi('requests');

      expect(versions).not.toBeNull();
      expect(versions).toContain('2.27.0');
      expect(versions).toContain('2.28.0');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/simple/requests/'),
        expect.any(Object)
      );
    });

    it('404 에러 시 null 반환', async () => {
      const error = { isAxiosError: true, response: { status: 404 } };
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.isAxiosError.mockReturnValue(true);

      const versions = await fetchVersionsFromSimpleApi('nonexistent-package');

      expect(versions).toBeNull();
    });

    it('패키지명을 정규화해야 함', async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: '<html><body></body></html>' });

      await fetchVersionsFromSimpleApi('My_Package');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/simple/my-package/'),
        expect.any(Object)
      );
    });
  });
});
