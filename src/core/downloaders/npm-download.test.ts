/**
 * npm downloader의 downloadPackage 및 downloadTarball 메서드 테스트
 * vi.mock()을 사용하여 axios를 모킹
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// vi.hoisted를 사용하여 모킹 함수 정의
const { mockAxiosDefault, mockAxiosGet } = vi.hoisted(() => {
  return {
    mockAxiosDefault: vi.fn(),
    mockAxiosGet: vi.fn(),
  };
});

// axios 모킹
vi.mock('axios', () => {
  const mockCreate = vi.fn(() => ({
    get: mockAxiosGet,
  }));

  const mockDefault = Object.assign(mockAxiosDefault, {
    create: mockCreate,
  });

  return {
    default: mockDefault,
    create: mockCreate,
  };
});

// fs-extra 모킹
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual('fs-extra');
  return {
    ...actual,
    ensureDir: vi.fn().mockResolvedValue(undefined),
    createWriteStream: vi.fn(),
    createReadStream: vi.fn(),
    remove: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
  };
});

import * as fs from 'fs-extra';
import { NpmDownloader } from './npm';

describe('NpmDownloader downloadPackage 테스트', () => {
  let downloader: NpmDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new NpmDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('downloadPackage', () => {
    it('다운로드 성공 (체크섬 없음)', async () => {
      // getPackageMetadata 모킹
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      // 스트림 모킹
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      // 스트림 이벤트 시뮬레이션
      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('test-pkg-1.0.0.tgz');
    });

    it('sha512 무결성 검증 성공', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
          checksum: {
            sha512: 'sha512-validhash',
          },
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyIntegrity 모킹
      const mockVerifyIntegrity = vi.fn().mockResolvedValue(true);
      (downloader as any).verifyIntegrity = mockVerifyIntegrity;

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(mockVerifyIntegrity).toHaveBeenCalled();
      expect(result).toContain('test-pkg-1.0.0.tgz');
    });

    it('sha512 무결성 검증 실패', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
          checksum: {
            sha512: 'sha512-invalidhash',
          },
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyIntegrity 모킹 - 실패
      const mockVerifyIntegrity = vi.fn().mockResolvedValue(false);
      (downloader as any).verifyIntegrity = mockVerifyIntegrity;

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      await expect(downloadPromise).rejects.toThrow('무결성 검증 실패');
    });

    it('sha1 체크섬 검증 성공', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
          checksum: {
            sha1: 'abc123',
          },
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyShasum 모킹
      const mockVerifyShasum = vi.fn().mockResolvedValue(true);
      (downloader as any).verifyShasum = mockVerifyShasum;

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(mockVerifyShasum).toHaveBeenCalled();
      expect(result).toContain('test-pkg-1.0.0.tgz');
    });

    it('sha1 체크섬 검증 실패', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
          checksum: {
            sha1: 'invalidsha1',
          },
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyShasum 모킹 - 실패
      const mockVerifyShasum = vi.fn().mockResolvedValue(false);
      (downloader as any).verifyShasum = mockVerifyShasum;

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      await expect(downloadPromise).rejects.toThrow('체크섬 검증 실패');
    });

    it('progress 콜백 호출', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '100' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const progressEvents: any[] = [];
      const onProgress = vi.fn((event) => progressEvents.push(event));

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test', onProgress);

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('1234567890')); // 10 bytes
        mockStream.emit('data', Buffer.from('1234567890')); // 10 more bytes
        mockWriter.emit('finish');
      }, 10);

      await downloadPromise;
      expect(onProgress).toHaveBeenCalled();
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[0]).toHaveProperty('itemId');
      expect(progressEvents[0]).toHaveProperty('progress');
      expect(progressEvents[0]).toHaveProperty('downloadedBytes');
    });

    it('네트워크 오류 처리', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      mockAxiosDefault.mockRejectedValue(new Error('Network Error'));

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      await expect(downloader.downloadPackage(info, '/tmp/test')).rejects.toThrow('Network Error');
    });

    it('writer 오류 처리', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '100' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test');

      setTimeout(() => {
        mockWriter.emit('error', new Error('Write Error'));
      }, 10);

      await expect(downloadPromise).rejects.toThrow('Write Error');
    });

    it('content-length가 없는 경우', async () => {
      const mockGetPackageMetadata = vi.fn().mockResolvedValue({
        name: 'test-pkg',
        version: '1.0.0',
        type: 'npm',
        metadata: {
          downloadUrl: 'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
        },
      });
      (downloader as any).getPackageMetadata = mockGetPackageMetadata;

      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: {}, // content-length 없음
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const onProgress = vi.fn();

      const info = { type: 'npm' as const, name: 'test-pkg', version: '1.0.0' };
      const downloadPromise = downloader.downloadPackage(info, '/tmp/test', onProgress);

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('test-pkg-1.0.0.tgz');
    });
  });

  describe('downloadTarball', () => {
    it('tarball 다운로드 성공', async () => {
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const downloadPromise = downloader.downloadTarball(tarballUrl, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('lodash-4.17.21.tgz');
    });

    it('무결성 검증과 함께 다운로드 성공', async () => {
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyIntegrity 모킹 - 성공
      const mockVerifyIntegrity = vi.fn().mockResolvedValue(true);
      (downloader as any).verifyIntegrity = mockVerifyIntegrity;

      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const integrity = 'sha512-validhash';
      const downloadPromise = downloader.downloadTarball(tarballUrl, '/tmp/test', integrity);

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(mockVerifyIntegrity).toHaveBeenCalled();
      expect(result).toContain('lodash-4.17.21.tgz');
    });

    it('무결성 검증 실패 시 에러', async () => {
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyIntegrity 모킹 - 실패
      const mockVerifyIntegrity = vi.fn().mockResolvedValue(false);
      (downloader as any).verifyIntegrity = mockVerifyIntegrity;

      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const integrity = 'sha512-invalidhash';
      const downloadPromise = downloader.downloadTarball(tarballUrl, '/tmp/test', integrity);

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      await expect(downloadPromise).rejects.toThrow('무결성 검증 실패');
    });

    it('progress 콜백 호출', async () => {
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '100' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const onProgress = vi.fn();

      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      const downloadPromise = downloader.downloadTarball(tarballUrl, '/tmp/test', undefined, onProgress);

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('12345'));
        mockWriter.emit('finish');
      }, 10);

      await downloadPromise;
      expect(onProgress).toHaveBeenCalled();
    });

    it('네트워크 오류 처리', async () => {
      mockAxiosDefault.mockRejectedValue(new Error('Network Error'));

      const tarballUrl = 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz';
      await expect(downloader.downloadTarball(tarballUrl, '/tmp/test')).rejects.toThrow('Network Error');
    });

    it('scoped 패키지 tarball 다운로드', async () => {
      const mockStream = new EventEmitter();
      (mockStream as any).pipe = vi.fn().mockReturnValue(mockStream);

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new EventEmitter();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const tarballUrl = 'https://registry.npmjs.org/@types/node/-/node-20.10.0.tgz';
      const downloadPromise = downloader.downloadTarball(tarballUrl, '/tmp/test');

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockWriter.emit('finish');
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('node-20.10.0.tgz');
    });
  });
});
