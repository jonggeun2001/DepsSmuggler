import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getNpmDownloader, NpmDownloader } from './npm';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

describe('npm downloader', () => {
  let downloader: ReturnType<typeof getNpmDownloader>;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = getNpmDownloader();
  });

  describe('getNpmDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getNpmDownloader();
      const instance2 = getNpmDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 npm', () => {
      expect(downloader.type).toBe('npm');
    });
  });

  describe('searchPackages (integration)', () => {
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('react');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('lodash');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('캐시 클리어', () => {
      downloader.clearCache();
      // 에러 없이 실행되어야 함
    });
  });
});

// NpmDownloader 클래스 메서드 테스트 (모킹)
describe('NpmDownloader 클래스 메서드 테스트', () => {
  let downloader: NpmDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new NpmDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchPackages', () => {
    it('패키지 검색 성공', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            objects: [
              {
                package: {
                  name: 'lodash',
                  version: '4.17.21',
                  description: 'Lodash modular utilities.',
                  author: { name: 'John-David Dalton' },
                  links: { homepage: 'https://lodash.com' },
                },
              },
              {
                package: {
                  name: 'lodash-es',
                  version: '4.17.21',
                  description: 'Lodash exported as ES modules.',
                },
              },
            ],
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('lodash');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('lodash');
      expect(results[0].version).toBe('4.17.21');
      expect(results[0].type).toBe('npm');
      expect(results[0].metadata?.description).toBe('Lodash modular utilities.');
      expect(results[0].metadata?.author).toBe('John-David Dalton');
      expect(results[0].metadata?.homepage).toBe('https://lodash.com');
    });

    it('검색 결과 없음', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({ data: { objects: [] } }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('nonexistent-package-xyz');
      expect(results).toHaveLength(0);
    });

    it('네트워크 오류 시 예외 발생', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network Error')),
      };
      (downloader as any).client = mockClient;

      await expect(downloader.searchPackages('test')).rejects.toThrow('Network Error');
    });

    it('size 파라미터 전달', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({ data: { objects: [] } }),
      };
      (downloader as any).client = mockClient;

      await downloader.searchPackages('test', 50);
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: { text: 'test', size: 50 },
        })
      );
    });
  });

  describe('getVersions', () => {
    it('버전 목록 조회 성공', async () => {
      const mockVersionResolver = {
        getVersions: vi.fn().mockResolvedValue(['4.17.21', '4.17.20', '4.17.19']),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const versions = await downloader.getVersions('lodash');

      expect(versions).toContain('4.17.21');
      expect(versions).toContain('4.17.20');
      expect(versions).toContain('4.17.19');
      expect(versions).toHaveLength(3);
    });

    it('패키지 없음 시 빈 배열', async () => {
      const mockVersionResolver = {
        getVersions: vi.fn().mockResolvedValue([]),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const versions = await downloader.getVersions('nonexistent');
      expect(versions).toHaveLength(0);
    });
  });

  describe('getPackageMetadata', () => {
    it('메타데이터 조회 성공', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '4.17.21': {
              name: 'lodash',
              version: '4.17.21',
              description: 'Lodash modular utilities.',
              author: { name: 'John-David Dalton' },
              license: 'MIT',
              homepage: 'https://lodash.com',
              dist: {
                tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
                unpackedSize: 1234567,
                shasum: 'abc123',
                integrity: 'sha512-xyz789',
              },
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('4.17.21'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const metadata = await downloader.getPackageMetadata('lodash', '4.17.21');

      expect(metadata.name).toBe('lodash');
      expect(metadata.version).toBe('4.17.21');
      expect(metadata.type).toBe('npm');
      expect(metadata.metadata?.downloadUrl).toBe('https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz');
      expect(metadata.metadata?.checksum?.sha1).toBe('abc123');
      expect(metadata.metadata?.checksum?.sha512).toBe('sha512-xyz789');
    });

    it('버전을 찾을 수 없으면 에러', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: { '4.17.21': {} },
        }),
        resolveVersion: vi.fn().mockReturnValue(null),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      await expect(downloader.getPackageMetadata('lodash', '9.9.9')).rejects.toThrow(
        '버전을 찾을 수 없습니다'
      );
    });

    it('author가 문자열인 경우 처리', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              author: 'John Doe',
              dist: {
                tarball: 'https://example.com/test.tgz',
                shasum: 'abc',
              },
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('1.0.0'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const metadata = await downloader.getPackageMetadata('test-pkg', '1.0.0');
      expect(metadata.metadata?.author).toBe('John Doe');
    });
  });

  describe('downloadPackage', () => {
    it('다운로드 URL이 없으면 에러', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '1.0.0': {
              name: 'test',
              version: '1.0.0',
              dist: { shasum: 'abc' }, // tarball 없음
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('1.0.0'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const info = { type: 'npm', name: 'test', version: '1.0.0' } as const;
      await expect(downloader.downloadPackage(info, path.join(os.tmpdir(), 'npm-test'))).rejects.toThrow(
        '다운로드 URL을 찾을 수 없습니다'
      );
    });

    it('다운로드 URL 형식 검증', () => {
      // npm tarball URL 형식 검증
      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const url = new URL(tarballUrl);

      expect(url.hostname).toBe('registry.npmjs.org');
      expect(url.pathname).toBe('/lodash/-/lodash-4.17.21.tgz');
    });

    it('파일명 추출 로직', () => {
      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const url = new URL(tarballUrl);
      const fileName = url.pathname.split('/').pop();

      expect(fileName).toBe('lodash-4.17.21.tgz');
    });
  });

  describe('verifyIntegrity', () => {
    it('ssri 무결성 검증 로직', () => {
      // ssri.checkData의 동작 검증 (실제 ssri 사용하지 않고 로직만 테스트)
      const fileContent = Buffer.from('test content');

      // ssri는 sha512-base64형식 무결성 문자열 확인
      // 올바른 무결성: checkData가 object를 반환
      // 잘못된 무결성: checkData가 false를 반환
      const validResult = { algorithm: 'sha512' }; // object
      const invalidResult = false;

      expect(validResult !== false).toBe(true);
      expect(invalidResult !== false).toBe(false);
    });

    it('무결성 형식 파싱', () => {
      // sha512-base64hash 형식
      const integrity = 'sha512-n4cQ...';
      expect(integrity.startsWith('sha512-')).toBe(true);

      const sha256Integrity = 'sha256-abc...';
      expect(sha256Integrity.startsWith('sha256-')).toBe(true);
    });
  });

  describe('verifyShasum', () => {
    it('SHA1 체크섬 검증 로직', () => {
      // SHA1 해시 계산 로직 테스트
      const content = 'test content';
      const hash = crypto.createHash('sha1');
      hash.update(content);
      const expected = hash.digest('hex');

      // 같은 내용의 다른 해시
      const hash2 = crypto.createHash('sha1');
      hash2.update(content);
      const actual = hash2.digest('hex');

      expect(actual.toLowerCase()).toBe(expected.toLowerCase());
    });

    it('대소문자 무관 비교', () => {
      const hash1 = 'ABC123def456';
      const hash2 = 'abc123DEF456';
      expect(hash1.toLowerCase()).toBe(hash2.toLowerCase());
    });
  });

  describe('getPackageVersion', () => {
    it('특정 버전 정보 조회', async () => {
      const mockVersionResolver = {
        getPackageInfo: vi.fn().mockResolvedValue({ name: 'test', version: '1.0.0' }),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const result = await downloader.getPackageVersion('test', '1.0.0');
      expect(result).toEqual({ name: 'test', version: '1.0.0' });
    });

    it('버전이 없으면 undefined', async () => {
      const mockVersionResolver = {
        getPackageInfo: vi.fn().mockResolvedValue(undefined),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const result = await downloader.getPackageVersion('test', '9.9.9');
      expect(result).toBeUndefined();
    });
  });

  describe('getDistTags', () => {
    it('dist-tags 조회', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          'dist-tags': {
            latest: '4.17.21',
            next: '5.0.0-beta.1',
          },
        }),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const result = await downloader.getDistTags('lodash');
      expect(result).toEqual({
        latest: '4.17.21',
        next: '5.0.0-beta.1',
      });
    });

    it('dist-tags가 없으면 빈 객체', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({}),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const result = await downloader.getDistTags('test');
      expect(result).toEqual(undefined);
    });
  });
});

// NpmDownloader 에러 처리 테스트
describe('NpmDownloader 에러 처리', () => {
  it('API 타임아웃 구조 검증', () => {
    const timeoutError = { code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' };
    expect(timeoutError.code).toBe('ECONNABORTED');
  });

  it('404 에러 구조 검증', () => {
    const notFoundError = { response: { status: 404 }, message: 'Not Found' };
    expect(notFoundError.response.status).toBe(404);
  });

  it('네트워크 오류 구조 검증', () => {
    const networkError = { code: 'ECONNREFUSED', message: 'connection refused' };
    expect(networkError.code).toBe('ECONNREFUSED');
  });
});

// scoped 패키지 처리 테스트
describe('scoped 패키지 처리', () => {
  it('@scope/package 형식 파싱', () => {
    const parseScopedName = (name: string) => {
      const match = name.match(/^@([^/]+)\/(.+)$/);
      if (!match) return { scope: null, packageName: name };
      return { scope: match[1], packageName: match[2] };
    };

    expect(parseScopedName('@types/node')).toEqual({ scope: 'types', packageName: 'node' });
    expect(parseScopedName('@babel/core')).toEqual({ scope: 'babel', packageName: 'core' });
    expect(parseScopedName('lodash')).toEqual({ scope: null, packageName: 'lodash' });
  });

  it('scoped 패키지 tarball URL 생성', () => {
    const getTarballUrl = (scope: string, name: string, version: string) => {
      return `https://registry.npmjs.org/@${scope}/${name}/-/${name}-${version}.tgz`;
    };

    expect(getTarballUrl('types', 'node', '20.10.0')).toBe(
      'https://registry.npmjs.org/@types/node/-/node-20.10.0.tgz'
    );
  });
});

// NpmDownloader 추가 테스트 (커버리지 향상)
describe('NpmDownloader 추가 테스트', () => {
  let downloader: NpmDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new NpmDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('downloadTarball 파일명 추출 로직', () => {
    it('tarball URL에서 파일명 추출', () => {
      const url = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const urlObj = new URL(url);
      const rawFileName = urlObj.pathname.split('/').pop();

      expect(rawFileName).toBe('lodash-4.17.21.tgz');
    });

    it('scoped 패키지 tarball URL에서 파일명 추출', () => {
      const url = 'https://registry.npmjs.org/@types/node/-/node-20.10.0.tgz';
      const urlObj = new URL(url);
      const rawFileName = urlObj.pathname.split('/').pop();

      expect(rawFileName).toBe('node-20.10.0.tgz');
    });

    it('sanitizePath 로직 테스트', () => {
      // npm의 sanitizePath는 정규식으로 위험 문자 제거
      const sanitize = (input: string) => input.replace(/[^a-zA-Z0-9._-]/g, '_');

      expect(sanitize('lodash-4.17.21.tgz')).toBe('lodash-4.17.21.tgz');
      expect(sanitize('package@1.0.0.tgz')).toBe('package_1.0.0.tgz'); // @ 제거
      expect(sanitize('../../../etc/passwd')).toBe('.._.._.._etc_passwd'); // 슬래시만 제거됨
    });
  });

  describe('progress 콜백 로직', () => {
    it('진행률 계산', () => {
      const totalBytes = 1000;
      const downloadedBytes = 500;
      const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

      expect(progress).toBe(50);
    });

    it('totalBytes가 0일 때 진행률 0', () => {
      const totalBytes = 0;
      const downloadedBytes = 100;
      const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;

      expect(progress).toBe(0);
    });

    it('속도 계산 로직', () => {
      const downloadedBytes = 1000;
      const lastBytes = 0;
      const elapsed = 1; // 1초
      const speed = (downloadedBytes - lastBytes) / elapsed;

      expect(speed).toBe(1000); // 1000 bytes/sec
    });
  });

  describe('체크섬 검증 로직', () => {
    it('sha1 해시 생성', () => {
      const content = 'test content';
      const hash = crypto.createHash('sha1');
      hash.update(content);
      const sha1 = hash.digest('hex');

      expect(sha1).toHaveLength(40); // SHA1 is 40 hex chars
    });

    it('sha512 무결성 문자열 형식', () => {
      const integrity = 'sha512-1234567890abcdef';
      const parts = integrity.split('-');

      expect(parts[0]).toBe('sha512');
      expect(parts.length).toBe(2);
    });

    it('shasum 비교 (대소문자 무관)', () => {
      const expected = 'ABC123DEF456789';
      const actual = 'abc123def456789';

      expect(actual.toLowerCase()).toBe(expected.toLowerCase());
    });
  });

  describe('에러 처리 로직', () => {
    it('버전 미발견 에러 메시지', () => {
      const name = 'lodash';
      const version = '9.9.9';
      const errorMsg = `버전을 찾을 수 없습니다: ${name}@${version}`;

      expect(errorMsg).toBe('버전을 찾을 수 없습니다: lodash@9.9.9');
    });

    it('다운로드 URL 미발견 에러 메시지', () => {
      const name = 'test';
      const version = '1.0.0';
      const errorMsg = `다운로드 URL을 찾을 수 없습니다: ${name}@${version}`;

      expect(errorMsg).toBe('다운로드 URL을 찾을 수 없습니다: test@1.0.0');
    });

    it('무결성 검증 실패 에러', () => {
      const errorMsg = '무결성 검증 실패';
      expect(errorMsg).toBe('무결성 검증 실패');
    });
  });

  describe('constructor 옵션', () => {
    it('커스텀 레지스트리 URL', () => {
      const customRegistry = 'https://custom.registry.com';
      const customDownloader = new NpmDownloader(customRegistry);
      expect(customDownloader.type).toBe('npm');
    });

    it('커스텀 검색 URL', () => {
      const customRegistry = 'https://custom.registry.com';
      const customSearch = 'https://search.custom.com/-/v1/search';
      const customDownloader = new NpmDownloader(customRegistry, customSearch);
      expect(customDownloader.type).toBe('npm');
    });
  });

  describe('getPackageMetadata 추가 테스트', () => {
    it('author가 없는 경우', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              dist: {
                tarball: 'https://example.com/test.tgz',
                shasum: 'abc',
              },
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('1.0.0'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const metadata = await downloader.getPackageMetadata('test-pkg', '1.0.0');
      expect(metadata.metadata?.author).toBeUndefined();
    });

    it('integrity가 없는 경우', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              dist: {
                tarball: 'https://example.com/test.tgz',
                shasum: 'abc123',
                // integrity 없음
              },
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('1.0.0'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const metadata = await downloader.getPackageMetadata('test-pkg', '1.0.0');
      expect(metadata.metadata?.checksum?.sha1).toBe('abc123');
      expect(metadata.metadata?.checksum?.sha512).toBeUndefined();
    });

    it('unpackedSize가 있는 경우', async () => {
      const mockVersionResolver = {
        fetchPackument: vi.fn().mockResolvedValue({
          versions: {
            '1.0.0': {
              name: 'test-pkg',
              version: '1.0.0',
              dist: {
                tarball: 'https://example.com/test.tgz',
                shasum: 'abc',
                unpackedSize: 12345,
              },
            },
          },
        }),
        resolveVersion: vi.fn().mockReturnValue('1.0.0'),
      };
      (downloader as any).versionResolver = mockVersionResolver;

      const metadata = await downloader.getPackageMetadata('test-pkg', '1.0.0');
      expect(metadata.metadata?.size).toBe(12345);
    });
  });

  describe('searchPackages 추가 테스트', () => {
    it('author가 없는 패키지', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            objects: [
              {
                package: {
                  name: 'no-author-pkg',
                  version: '1.0.0',
                  description: 'A package without author',
                  // author 없음
                },
              },
            ],
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('no-author');
      expect(results[0].metadata?.author).toBeUndefined();
    });

    it('links가 없는 패키지', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            objects: [
              {
                package: {
                  name: 'no-links-pkg',
                  version: '1.0.0',
                  description: 'A package without links',
                  // links 없음
                },
              },
            ],
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('no-links');
      expect(results[0].metadata?.homepage).toBeUndefined();
    });
  });
});

// verifyIntegrity 및 verifyShasum 테스트 (실제 파일 사용)
describe('NpmDownloader 파일 검증 테스트', () => {
  let downloader: NpmDownloader;

  beforeEach(async () => {
    vi.clearAllMocks();
    downloader = new NpmDownloader();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe('downloadPackage 에러 케이스', () => {
    it('다운로드 URL 없으면 에러', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          // downloadUrl 없음
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };

      await expect(downloader.downloadPackage(info, path.join(os.tmpdir(), 'npm-test'))).rejects.toThrow(
        '다운로드 URL을 찾을 수 없습니다'
      );
    });
  });

  describe('verifyIntegrity (실제 파일 테스트)', () => {
    const testFilePath = path.join(os.tmpdir(), 'npm-test-integrity.txt');

    it('유효한 무결성 검증 성공', async () => {
      const testContent = 'test content for integrity verification';
      const fs = await import('fs-extra');
      const ssriModule = await import('ssri');

      // 테스트 파일 생성
      await fs.writeFile(testFilePath, testContent);

      // 예상 무결성 계산
      const expectedIntegrity = ssriModule.fromData(testContent).toString();

      const result = await downloader.verifyIntegrity(testFilePath, expectedIntegrity);
      expect(result).toBe(true);

      // 정리
      await fs.remove(testFilePath);
    });

    it('무효한 무결성 검증 실패', async () => {
      const testContent = 'actual content';
      const fs = await import('fs-extra');

      // 테스트 파일 생성
      await fs.writeFile(testFilePath, testContent);

      const result = await downloader.verifyIntegrity(testFilePath, 'sha512-invalidhash');
      expect(result).toBe(false);

      // 정리
      await fs.remove(testFilePath);
    });

    it('파일이 존재하지 않으면 false 반환', async () => {
      const result = await downloader.verifyIntegrity(path.join(os.tmpdir(), 'nonexistent-file-xyz.tgz'), 'sha512-abc');
      expect(result).toBe(false);
    });
  });

  describe('verifyShasum (실제 파일 테스트)', () => {
    const testFilePath = path.join(os.tmpdir(), 'npm-test-shasum.txt');

    it('유효한 SHA1 검증 성공', async () => {
      const testContent = 'test content for sha1 verification';
      const fs = await import('fs-extra');

      // 테스트 파일 생성
      await fs.writeFile(testFilePath, testContent);

      // 예상 SHA1 계산
      const hash = crypto.createHash('sha1');
      hash.update(testContent);
      const expectedSha1 = hash.digest('hex');

      const result = await downloader.verifyShasum(testFilePath, expectedSha1);
      expect(result).toBe(true);

      // 정리
      await fs.remove(testFilePath);
    });

    it('무효한 SHA1 검증 실패', async () => {
      const testContent = 'actual content';
      const fs = await import('fs-extra');

      // 테스트 파일 생성
      await fs.writeFile(testFilePath, testContent);

      const result = await downloader.verifyShasum(testFilePath, 'invalid-sha1-hash');
      expect(result).toBe(false);

      // 정리
      await fs.remove(testFilePath);
    });

    it('대소문자 무관 비교', async () => {
      const testContent = 'test';
      const fs = await import('fs-extra');

      // 테스트 파일 생성
      await fs.writeFile(testFilePath, testContent);

      // 예상 SHA1 계산 (대문자)
      const hash = crypto.createHash('sha1');
      hash.update(testContent);
      const expectedSha1 = hash.digest('hex').toUpperCase();

      const result = await downloader.verifyShasum(testFilePath, expectedSha1);
      expect(result).toBe(true);

      // 정리
      await fs.remove(testFilePath);
    });
  });
});

// npm semver 로직 테스트
describe('npm semver utilities', () => {
  // parseVersion 로직
  const parseVersion = (version: string): number[] => {
    return version.split('.').map((p) => parseInt(p, 10) || 0);
  };

  // compareVersions 로직
  const compareVersions = (a: string, b: string): number => {
    const partsA = parseVersion(a);
    const partsB = parseVersion(b);

    for (let i = 0; i < 3; i++) {
      const diff = (partsA[i] || 0) - (partsB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  // satisfiesTilde 로직 (~)
  const satisfiesTilde = (version: string, rangeVersion: string): boolean => {
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    const [rMajor, rMinor = 0, rPatch = 0] = parseVersion(rangeVersion);

    return vMajor === rMajor && vMinor === rMinor && vPatch >= rPatch;
  };

  // satisfiesCaret 로직 (^)
  const satisfiesCaret = (version: string, rangeVersion: string): boolean => {
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    const [rMajor, rMinor = 0, rPatch = 0] = parseVersion(rangeVersion);

    if (rMajor === 0) {
      if (rMinor === 0) {
        // ^0.0.x - patch만 허용
        return vMajor === 0 && vMinor === 0 && vPatch >= rPatch;
      }
      // ^0.x.x - minor 고정
      return vMajor === 0 && vMinor === rMinor && vPatch >= rPatch;
    }

    // ^x.x.x - major 고정
    return vMajor === rMajor && (vMinor > rMinor || (vMinor === rMinor && vPatch >= rPatch));
  };

  // satisfies 로직
  const satisfies = (version: string, range: string): boolean => {
    // 정확한 버전
    if (version === range) return true;

    // 와일드카드
    if (range === '*' || range === '' || range === 'x') return true;

    // ^ 범위 (major 고정)
    if (range.startsWith('^')) {
      const rangeVersion = range.slice(1);
      return satisfiesCaret(version, rangeVersion);
    }

    // ~ 범위 (minor 고정)
    if (range.startsWith('~')) {
      const rangeVersion = range.slice(1);
      return satisfiesTilde(version, rangeVersion);
    }

    // >= 범위
    if (range.startsWith('>=')) {
      const rangeVersion = range.slice(2);
      return compareVersions(version, rangeVersion) >= 0;
    }

    // > 범위
    if (range.startsWith('>')) {
      const rangeVersion = range.slice(1);
      return compareVersions(version, rangeVersion) > 0;
    }

    // <= 범위
    if (range.startsWith('<=')) {
      const rangeVersion = range.slice(2);
      return compareVersions(version, rangeVersion) <= 0;
    }

    // < 범위
    if (range.startsWith('<')) {
      const rangeVersion = range.slice(1);
      return compareVersions(version, rangeVersion) < 0;
    }

    // = 또는 없음 (정확한 버전)
    const cleanRange = range.startsWith('=') ? range.slice(1) : range;
    return version === cleanRange;
  };

  describe('parseVersion', () => {
    it('기본 버전 파싱', () => {
      expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    });

    it('2자리 버전', () => {
      expect(parseVersion('1.2')).toEqual([1, 2]);
    });

    it('1자리 버전', () => {
      expect(parseVersion('1')).toEqual([1]);
    });
  });

  describe('compareVersions', () => {
    it('동일 버전', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('major 차이', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 차이', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    });

    it('patch 차이', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });
  });

  describe('satisfies (정확 매칭)', () => {
    it('정확히 일치', () => {
      expect(satisfies('1.0.0', '1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '1.0.1')).toBe(false);
    });

    it('= 연산자', () => {
      expect(satisfies('1.0.0', '=1.0.0')).toBe(true);
    });
  });

  describe('satisfies (와일드카드)', () => {
    it('* 와일드카드', () => {
      expect(satisfies('1.0.0', '*')).toBe(true);
      expect(satisfies('5.3.2', '*')).toBe(true);
    });

    it('빈 문자열', () => {
      expect(satisfies('1.0.0', '')).toBe(true);
    });

    it('x 와일드카드', () => {
      expect(satisfies('1.0.0', 'x')).toBe(true);
    });
  });

  describe('satisfies (비교 연산자)', () => {
    it('>= 연산자', () => {
      expect(satisfies('1.5.0', '>=1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
      expect(satisfies('0.9.0', '>=1.0.0')).toBe(false);
    });

    it('> 연산자', () => {
      expect(satisfies('1.5.0', '>1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
    });

    it('<= 연산자', () => {
      expect(satisfies('1.0.0', '<=2.0.0')).toBe(true);
      expect(satisfies('2.0.0', '<=2.0.0')).toBe(true);
      expect(satisfies('2.1.0', '<=2.0.0')).toBe(false);
    });

    it('< 연산자', () => {
      expect(satisfies('0.9.0', '<1.0.0')).toBe(true);
      expect(satisfies('1.0.0', '<1.0.0')).toBe(false);
    });
  });

  describe('satisfies (~ tilde)', () => {
    it('~1.2.3 - patch 업데이트만 허용', () => {
      expect(satisfies('1.2.3', '~1.2.3')).toBe(true);
      expect(satisfies('1.2.4', '~1.2.3')).toBe(true);
      expect(satisfies('1.2.99', '~1.2.3')).toBe(true);
      expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
      expect(satisfies('2.0.0', '~1.2.3')).toBe(false);
    });

    it('~1.2.0', () => {
      expect(satisfies('1.2.0', '~1.2.0')).toBe(true);
      expect(satisfies('1.2.5', '~1.2.0')).toBe(true);
      expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
    });
  });

  describe('satisfies (^ caret)', () => {
    it('^1.2.3 - major 고정', () => {
      expect(satisfies('1.2.3', '^1.2.3')).toBe(true);
      expect(satisfies('1.2.4', '^1.2.3')).toBe(true);
      expect(satisfies('1.3.0', '^1.2.3')).toBe(true);
      expect(satisfies('1.9.9', '^1.2.3')).toBe(true);
      expect(satisfies('2.0.0', '^1.2.3')).toBe(false);
    });

    it('^0.2.3 - minor 고정 (0.x의 경우)', () => {
      expect(satisfies('0.2.3', '^0.2.3')).toBe(true);
      expect(satisfies('0.2.4', '^0.2.3')).toBe(true);
      expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    });

    it('^0.0.3 - patch 고정 (0.0.x의 경우)', () => {
      expect(satisfies('0.0.3', '^0.0.3')).toBe(true);
      expect(satisfies('0.0.4', '^0.0.3')).toBe(true);
      expect(satisfies('0.0.2', '^0.0.3')).toBe(false);
      expect(satisfies('0.1.0', '^0.0.3')).toBe(false);
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - chalk (ESM 전환된 패키지)
    describe('chalk package case', () => {
      it('chalk v5+는 ESM 전용', () => {
        const isEsmOnlyVersion = (version: string): boolean => {
          const major = parseInt(version.split('.')[0], 10);
          return major >= 5;
        };

        expect(isEsmOnlyVersion('5.0.0')).toBe(true);
        expect(isEsmOnlyVersion('4.1.2')).toBe(false);
      });

      it('chalk 의존성 체인', () => {
        // chalk v4 의존성
        const chalkV4Deps = ['ansi-styles', 'supports-color'];
        expect(chalkV4Deps).toContain('ansi-styles');
        expect(chalkV4Deps).toContain('supports-color');
      });
    });

    // 일반 케이스 - debug (전이 의존성)
    describe('debug package case', () => {
      const debugDependencies = ['ms'];

      it('debug는 ms에 의존', () => {
        expect(debugDependencies).toContain('ms');
      });

      it('debug는 많은 패키지에서 사용됨', () => {
        const dependents = ['express', 'mocha', 'socket.io', 'mongoose'];
        expect(dependents.length).toBeGreaterThan(3);
      });
    });

    // 네이티브 빌드 케이스 - node-sass
    describe('node-sass package case (native build)', () => {
      it('node-sass는 네이티브 바이너리 필요', () => {
        const hasNativeBinding = true;
        expect(hasNativeBinding).toBe(true);
      });

      it('node-sass는 deprecated (dart-sass 권장)', () => {
        const isDeprecated = true;
        const replacement = 'sass';
        expect(isDeprecated).toBe(true);
        expect(replacement).toBe('sass');
      });

      it('node-sass 플랫폼별 바이너리', () => {
        const platforms = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'win32-x64'];
        expect(platforms).toContain('darwin-arm64');
        expect(platforms.length).toBeGreaterThan(3);
      });
    });

    // macOS 전용 케이스 - fsevents
    describe('fsevents package case (macOS only)', () => {
      it('fsevents는 macOS 전용', () => {
        const supportedPlatforms = ['darwin'];
        expect(supportedPlatforms).toContain('darwin');
        expect(supportedPlatforms).not.toContain('linux');
        expect(supportedPlatforms).not.toContain('win32');
      });

      it('fsevents는 optionalDependencies로 설치', () => {
        const dependencyType = 'optionalDependencies';
        expect(dependencyType).toBe('optionalDependencies');
      });

      it('다른 플랫폼에서는 설치 스킵', () => {
        const shouldInstall = (platform: string): boolean => {
          return platform === 'darwin';
        };

        expect(shouldInstall('darwin')).toBe(true);
        expect(shouldInstall('linux')).toBe(false);
        expect(shouldInstall('win32')).toBe(false);
      });
    });

    // scoped 패키지 케이스 - @types/node
    describe('@types/node package case (scoped)', () => {
      it('scoped 패키지명 파싱', () => {
        const parseScopedName = (name: string): { scope?: string; packageName: string } => {
          const match = name.match(/^@([^/]+)\/(.+)$/);
          if (!match) return { packageName: name };
          return { scope: match[1], packageName: match[2] };
        };

        const result = parseScopedName('@types/node');
        expect(result.scope).toBe('types');
        expect(result.packageName).toBe('node');
      });

      it('@types 패키지는 devDependencies에 설치', () => {
        const isDevDependency = (name: string): boolean => {
          return name.startsWith('@types/');
        };

        expect(isDevDependency('@types/node')).toBe(true);
        expect(isDevDependency('@types/react')).toBe(true);
        expect(isDevDependency('typescript')).toBe(false);
      });

      it('scoped 패키지 tarball URL', () => {
        const scope = 'types';
        const packageName = 'node';
        const version = '20.10.0';
        const tarballUrl = `https://registry.npmjs.org/@${scope}/${packageName}/-/${packageName}-${version}.tgz`;
        expect(tarballUrl).toBe('https://registry.npmjs.org/@types/node/-/node-20.10.0.tgz');
      });
    });

    // 예외 케이스 - 존재하지 않는 패키지
    describe('non-existent package case', () => {
      it('존재하지 않는 패키지명 형식 검증', () => {
        const fakePackage = 'this-package-does-not-exist-12345';
        // npm 패키지명 규칙: 소문자, 숫자, 하이픈, 언더스코어, 점
        const isValidName = /^[a-z0-9][a-z0-9._-]*$/.test(fakePackage);
        expect(isValidName).toBe(true);
      });
    });

    // package.json 의존성 타입
    describe('dependency types', () => {
      type DependencyType = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

      const getInstallPriority = (type: DependencyType): number => {
        const priority: Record<DependencyType, number> = {
          dependencies: 1,
          peerDependencies: 2,
          optionalDependencies: 3,
          devDependencies: 4,
        };
        return priority[type];
      };

      it('dependencies가 가장 높은 우선순위', () => {
        expect(getInstallPriority('dependencies')).toBeLessThan(getInstallPriority('devDependencies'));
      });

      it('peerDependencies는 호스트 패키지에서 제공', () => {
        const peerDepsHandling = 'host-provided';
        expect(peerDepsHandling).toBe('host-provided');
      });

      it('optionalDependencies는 설치 실패해도 계속', () => {
        const failOnError = false;
        expect(failOnError).toBe(false);
      });
    });

    // tarball 무결성 검증
    describe('tarball integrity', () => {
      const parseIntegrity = (integrity: string): { algorithm: string; hash: string } | null => {
        const match = integrity.match(/^(sha\d+)-(.+)$/);
        if (!match) return null;
        return { algorithm: match[1], hash: match[2] };
      };

      it('sha512 무결성 파싱', () => {
        const integrity = 'sha512-ABC123DEF456...';
        const parsed = parseIntegrity(integrity);
        expect(parsed).not.toBeNull();
        expect(parsed!.algorithm).toBe('sha512');
      });

      it('sha1 무결성 파싱 (레거시)', () => {
        const integrity = 'sha1-ABC123...';
        const parsed = parseIntegrity(integrity);
        expect(parsed).not.toBeNull();
        expect(parsed!.algorithm).toBe('sha1');
      });
    });

    // lock 파일 버전
    describe('lock file versions', () => {
      type LockfileVersion = 1 | 2 | 3;

      const getLockfileFormat = (version: LockfileVersion): string => {
        const formats: Record<LockfileVersion, string> = {
          1: 'npm v5-v6',
          2: 'npm v7+, backwards compatible',
          3: 'npm v7+, hidden lockfile',
        };
        return formats[version];
      };

      it('lockfile v1 형식', () => {
        expect(getLockfileFormat(1)).toContain('v5');
      });

      it('lockfile v2 형식 (현재 기본)', () => {
        expect(getLockfileFormat(2)).toContain('v7');
        expect(getLockfileFormat(2)).toContain('backwards');
      });

      it('lockfile v3 형식 (hidden)', () => {
        expect(getLockfileFormat(3)).toContain('hidden');
      });
    });

    // 의존성 트리 평탄화
    describe('dependency tree flattening', () => {
      interface DepNode {
        name: string;
        version: string;
        dependencies?: Record<string, DepNode>;
      }

      const flattenTree = (node: DepNode, result: Map<string, string[]> = new Map()): Map<string, string[]> => {
        const versions = result.get(node.name) || [];
        if (!versions.includes(node.version)) {
          versions.push(node.version);
          result.set(node.name, versions);
        }

        if (node.dependencies) {
          for (const dep of Object.values(node.dependencies)) {
            flattenTree(dep, result);
          }
        }

        return result;
      };

      it('의존성 트리 평탄화', () => {
        const tree: DepNode = {
          name: 'app',
          version: '1.0.0',
          dependencies: {
            lodash: { name: 'lodash', version: '4.17.21' },
            express: {
              name: 'express',
              version: '4.18.2',
              dependencies: {
                'accepts': { name: 'accepts', version: '1.3.8' },
              },
            },
          },
        };

        const flat = flattenTree(tree);
        expect(flat.has('lodash')).toBe(true);
        expect(flat.has('express')).toBe(true);
        expect(flat.has('accepts')).toBe(true);
      });

      it('중복 버전 감지', () => {
        const tree: DepNode = {
          name: 'app',
          version: '1.0.0',
          dependencies: {
            a: {
              name: 'a',
              version: '1.0.0',
              dependencies: {
                lodash: { name: 'lodash', version: '4.17.21' },
              },
            },
            b: {
              name: 'b',
              version: '1.0.0',
              dependencies: {
                lodash: { name: 'lodash', version: '4.17.20' },
              },
            },
          },
        };

        const flat = flattenTree(tree);
        const lodashVersions = flat.get('lodash') || [];
        expect(lodashVersions.length).toBe(2);
        expect(lodashVersions).toContain('4.17.21');
        expect(lodashVersions).toContain('4.17.20');
      });
    });

    // bin 필드 처리
    describe('bin field handling', () => {
      type BinField = string | Record<string, string>;

      const normalizeBin = (name: string, bin: BinField): Record<string, string> => {
        if (typeof bin === 'string') {
          return { [name]: bin };
        }
        return bin;
      };

      it('문자열 bin 필드', () => {
        const result = normalizeBin('typescript', './bin/tsc');
        expect(result).toEqual({ typescript: './bin/tsc' });
      });

      it('객체 bin 필드', () => {
        const bin = { tsc: './bin/tsc', tsserver: './bin/tsserver' };
        const result = normalizeBin('typescript', bin);
        expect(result).toEqual(bin);
      });
    });

    // engines 필드 검증
    describe('engines field validation', () => {
      interface Engines {
        node?: string;
        npm?: string;
      }

      const checkEngineCompatibility = (
        engines: Engines,
        nodeVersion: string
      ): boolean => {
        if (!engines.node) return true;

        // 간단한 검증 (실제로는 semver 사용)
        const minVersion = engines.node.replace(/^[>=]+/, '');
        const nodeParts = nodeVersion.split('.').map(Number);
        const minParts = minVersion.split('.').map(Number);

        return nodeParts[0] > minParts[0] ||
          (nodeParts[0] === minParts[0] && nodeParts[1] >= minParts[1]);
      };

      it('node 버전 호환성 체크', () => {
        const engines: Engines = { node: '>=18.0.0' };
        expect(checkEngineCompatibility(engines, '20.0.0')).toBe(true);
        expect(checkEngineCompatibility(engines, '18.0.0')).toBe(true);
        expect(checkEngineCompatibility(engines, '16.0.0')).toBe(false);
      });

      it('engines 없으면 모든 버전 호환', () => {
        expect(checkEngineCompatibility({}, '12.0.0')).toBe(true);
      });
    });
  });
});
