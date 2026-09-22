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
