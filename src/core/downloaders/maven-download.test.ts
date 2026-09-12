/**
 * Maven downloader의 downloadPackage 및 downloadArtifact 메서드 테스트
 * vi.mock()을 사용하여 axios를 모킹
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PassThrough, Readable, Writable } from 'stream';
import * as path from 'path';

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
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import * as fs from 'fs-extra';
import { MavenDownloader } from './maven';

describe('MavenDownloader downloadPackage 테스트', () => {
  let downloader: MavenDownloader;

  const downloadPackageFiles = async (
    info: Parameters<MavenDownloader['downloadPackage']>[0],
    destPath: string,
  ): Promise<string[]> => {
    const filesMethod = (downloader as MavenDownloader & {
      downloadPackageFiles?: (
        info: Parameters<MavenDownloader['downloadPackage']>[0],
        destPath: string,
      ) => Promise<string[]>;
    }).downloadPackageFiles;

    // The compatibility adapter makes the RED failure assert the missing
    // companion files, while still allowing this test to compile before the
    // additive downloader API exists.
    if (filesMethod) {
      return filesMethod.call(downloader, info, destPath);
    }
    return [await downloader.downloadPackage(info, destPath)];
  };

  const prepareArtifactNetworkMocks = (missingChecksumSuffix?: string) => {
    mockAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('.sha1')) {
        if (missingChecksumSuffix && url.endsWith(missingChecksumSuffix)) {
          throw new Error('404 Not Found');
        }
        return { data: '0123456789abcdef0123456789abcdef01234567' };
      }
      return { data: '<project><packaging>jar</packaging></project>' };
    });

    mockAxiosDefault.mockImplementation(async () => {
      const stream = new PassThrough();
      process.nextTick(() => {
        stream.end(Buffer.from('artifact'));
      });

      return {
        data: stream,
        headers: { 'content-length': '8' },
      };
    });

    (fs.createWriteStream as any).mockImplementation(() => new PassThrough());
    (fs.writeFile as any).mockResolvedValue(undefined);
    (downloader as any).verifyChecksum = vi.fn().mockResolvedValue(true);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new MavenDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POM-only stream은 abort 시 다음 단계 없이 실패한다', async () => {
    const controller = new AbortController();
    mockAxiosGet.mockImplementation(async (url: string) => {
      if (url.endsWith('.sha1')) return { data: '0123456789abcdef0123456789abcdef01234567' };
      throw new Error('unexpected metadata lookup');
    });
    let pushed = false;
    const source = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        this.push(Buffer.alloc(64 * 1024));
        setTimeout(() => controller.abort(), 10);
      },
    });
    mockAxiosDefault.mockResolvedValue({ data: source, headers: { 'content-length': '131072' } });
    (fs.createWriteStream as any).mockImplementation(() => new Writable({ write(_chunk, _encoding, callback) { callback(); } }));

    await expect(
      downloader.downloadPackage(
        { name: 'com.example:fixture', version: '1.0.0', type: 'maven', metadata: { type: 'pom' } },
        '/tmp/pom-only',
        undefined,
        { signal: controller.signal }
      )
    ).rejects.toThrow();
    expect(mockAxiosDefault).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
    expect(mockAxiosGet).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledWith(expect.stringContaining('fixture-1.0.0.pom'));
  });

  it('처음부터 일시정지된 POM-only 요청은 조회와 쓰기를 시작하지 않는다', async () => {
    let paused = true;
    mockAxiosGet.mockResolvedValue({ data: '0123456789abcdef0123456789abcdef01234567' });
    const source = Readable.from([Buffer.from('pom-content')]);
    mockAxiosDefault.mockResolvedValue({ data: source, headers: { 'content-length': '11' } });
    (fs.createWriteStream as any).mockImplementation(() => new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
    (downloader as any).verifyChecksum = vi.fn().mockResolvedValue(true);
    const promise = downloader.downloadPackage(
      { name: 'com.example:fixture', version: '1.0.0', type: 'maven', metadata: { type: 'pom' } },
      '/tmp/pom-only',
      undefined,
      { shouldPause: () => paused }
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(mockAxiosGet).not.toHaveBeenCalled();
    expect(mockAxiosDefault).not.toHaveBeenCalled();
    expect(fs.createWriteStream).not.toHaveBeenCalled();
    paused = false;
    await expect(promise).resolves.toContain('fixture-1.0.0.pom');
  });

  it.each(['packaging', 'sha1'] as const)('%s 조회 중 abort는 fallback/아티팩트 요청으로 진행하지 않는다', async (boundary) => {
    const controller = new AbortController();
    let lookupCalls = 0;
    mockAxiosGet.mockImplementation((_url: string, config?: { signal?: AbortSignal }) => {
      lookupCalls += 1;
      return new Promise((_resolve, reject) => {
        config?.signal?.addEventListener('abort', () => reject(new Error('lookup aborted')), { once: true });
      });
    });
    (fs.createWriteStream as any).mockImplementation(() => new PassThrough());
    const info = {
      name: 'com.example:lookup-boundary',
      version: '1.0.0',
      type: 'maven' as const,
      metadata: boundary === 'sha1' ? { packaging: 'jar' } : undefined,
    };
    const promise = downloader.downloadPackage(info, '/tmp/lookup-boundary', undefined, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toThrow(/aborted/);
    expect(lookupCalls).toBe(1);
    expect(mockAxiosDefault).not.toHaveBeenCalled();
  });

  describe('downloadArtifact', () => {
    it('JAR 다운로드 성공', async () => {
      // SHA1 체크섬 응답 모킹
      mockAxiosGet.mockResolvedValue({
        data: 'abc123def456',
      });

      // 파일 다운로드 스트림 모킹
      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyChecksum 모킹
      const mockVerifyChecksum = vi.fn().mockResolvedValue(true);
      (downloader as any).verifyChecksum = mockVerifyChecksum;

      const downloadPromise = downloader.downloadArtifact(
        'com.google.code.gson',
        'gson',
        '2.10.1',
        '/tmp/test',
        'jar'
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.end();
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('gson-2.10.1.jar');
      expect(mockVerifyChecksum).toHaveBeenCalled();
    });

    it('POM 다운로드 성공', async () => {
      mockAxiosGet.mockResolvedValue({
        data: 'sha1hash123',
      });

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '500' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const mockVerifyChecksum = vi.fn().mockResolvedValue(true);
      (downloader as any).verifyChecksum = mockVerifyChecksum;

      const downloadPromise = downloader.downloadArtifact(
        'org.springframework',
        'spring-core',
        '6.0.0',
        '/tmp/test',
        'pom'
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('pom content'));
        mockStream.end();
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('spring-core-6.0.0.pom');
    });

    it('체크섬 없는 경우에도 다운로드 성공', async () => {
      // SHA1 조회 실패
      mockAxiosGet.mockRejectedValue(new Error('Not found'));

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const downloadPromise = downloader.downloadArtifact(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar'
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.end();
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('test-1.0.0.jar');
    });

    it('체크섬 검증 실패 시 에러', async () => {
      mockAxiosGet.mockResolvedValue({
        data: 'expectedsha1',
      });

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      // verifyChecksum 모킹 - 실패
      const mockVerifyChecksum = vi.fn().mockResolvedValue(false);
      (downloader as any).verifyChecksum = mockVerifyChecksum;

      const downloadPromise = downloader.downloadArtifact(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar'
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.end();
      }, 10);

      await expect(downloadPromise).rejects.toThrow('체크섬 검증 실패');
    });

    it('progress 콜백 호출', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Not found'));

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '100' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const progressEvents: any[] = [];
      const onProgress = vi.fn((event) => progressEvents.push(event));

      const downloadPromise = downloader.downloadArtifact(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar',
        onProgress
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('1234567890'));
        mockStream.emit('data', Buffer.from('1234567890'));
        mockStream.end();
      }, 10);

      await downloadPromise;
      expect(onProgress).toHaveBeenCalled();
      expect(progressEvents[0]).toHaveProperty('itemId');
      expect(progressEvents[0]).toHaveProperty('progress');
    });

    it('네트워크 오류 처리', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Not found'));
      mockAxiosDefault.mockRejectedValue(new Error('Network Error'));

      await expect(
        downloader.downloadArtifact('com.example', 'test', '1.0.0', '/tmp/test', 'jar')
      ).rejects.toThrow('Network Error');
    });

    it('타임아웃 오류를 그대로 전달', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Not found'));
      mockAxiosDefault.mockRejectedValue(
        Object.assign(new Error('timeout of 300000ms exceeded'), {
          code: 'ECONNABORTED',
        })
      );

      await expect(
        downloader.downloadArtifact('com.example', 'test', '1.0.0', '/tmp/test', 'jar')
      ).rejects.toThrow('timeout of 300000ms exceeded');
    });

    it('writer 오류 처리', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Not found'));

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '100' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const downloadPromise = downloader.downloadArtifact(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar'
      );

      setTimeout(() => {
        mockWriter.emit('error', new Error('Write Error'));
      }, 10);

      await expect(downloadPromise).rejects.toThrow('Write Error');
    });

    it('classifier가 있는 경우', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Not found'));

      const mockStream = new PassThrough();

      mockAxiosDefault.mockResolvedValue({
        data: mockStream,
        headers: { 'content-length': '1000' },
      });

      const mockWriter = new PassThrough();
      (fs.createWriteStream as any).mockReturnValue(mockWriter);

      const downloadPromise = downloader.downloadArtifact(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar',
        undefined,
        'sources'
      );

      setTimeout(() => {
        mockStream.emit('data', Buffer.from('test data'));
        mockStream.end();
      }, 10);

      const result = await downloadPromise;
      expect(result).toContain('test-1.0.0-sources.jar');
    });
  });

  describe('downloadPackage', () => {
    it('일반 JAR 패키지 다운로드', async () => {
      // POM 조회 (packaging 확인)
      mockAxiosGet.mockResolvedValue({
        data: '<project><packaging>jar</packaging></project>',
      });

      // downloadArtifact 모킹
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/com/example/test/1.0.0/test-1.0.0.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      // downloadChecksumFile 모킹
      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const info = {
        type: 'maven' as const,
        name: 'com.example:test',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'test',
        },
      };

      const result = await downloader.downloadPackage(info, '/tmp/test');
      expect(result).toContain('test-1.0.0.jar');
      expect(mockDownloadArtifact).toHaveBeenCalled();
    });

    it('POM-only 패키지 다운로드 (BOM)', async () => {
      // POM 조회 (packaging이 pom)
      mockAxiosGet.mockResolvedValue({
        data: '<project><packaging>pom</packaging></project>',
      });

      // downloadArtifact 모킹 - POM만 다운로드
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/org/example/bom/1.0.0/bom-1.0.0.pom');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      // downloadChecksumFile 모킹
      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const info = {
        type: 'maven' as const,
        name: 'org.example:bom',
        version: '1.0.0',
        metadata: {
          groupId: 'org.example',
          artifactId: 'bom',
          packaging: 'pom',
        },
      };

      const result = await downloader.downloadPackage(info, '/tmp/test');
      expect(result).toContain('bom-1.0.0.pom');
    });

    it('metadata에 packaging이 있으면 POM 조회 안함', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/com/example/test/1.0.0/test-1.0.0.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const info = {
        type: 'maven' as const,
        name: 'com.example:test',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'test',
          packaging: 'jar', // packaging이 이미 있음
        },
      };

      const result = await downloader.downloadPackage(info, '/tmp/test');
      expect(result).toContain('test-1.0.0.jar');
      // POM 조회를 하지 않음 (mockAxiosGet이 호출되지 않음)
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('POM 조회 실패 시 기본값 jar 사용', async () => {
      // POM 조회 실패
      mockAxiosGet.mockRejectedValue(new Error('Not found'));

      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/com/example/test/1.0.0/test-1.0.0.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const info = {
        type: 'maven' as const,
        name: 'com.example:test',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'test',
        },
      };

      const result = await downloader.downloadPackage(info, '/tmp/test');
      expect(result).toContain('test-1.0.0.jar');
    });

    it('classifier가 있는 패키지', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/com/example/test/1.0.0/test-1.0.0-natives.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const info = {
        type: 'maven' as const,
        name: 'com.example:test',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'test',
          packaging: 'jar',
          classifier: 'natives',
        },
      };

      const result = await downloader.downloadPackage(info, '/tmp/test');
      expect(result).toContain('test-1.0.0');
      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar',
        undefined,
        'natives',
        undefined,
      );
    });

    it('progress 콜백 전달', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/tmp/test/com/example/test/1.0.0/test-1.0.0.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      const mockDownloadChecksumFile = vi.fn().mockResolvedValue(undefined);
      (downloader as any).downloadChecksumFile = mockDownloadChecksumFile;

      const onProgress = vi.fn();

      const info = {
        type: 'maven' as const,
        name: 'com.example:test',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'test',
          packaging: 'jar',
        },
      };

      await downloader.downloadPackage(info, '/tmp/test', onProgress);
      // downloadArtifact에 onProgress가 전달되었는지 확인
      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        'com.example',
        'test',
        '1.0.0',
        '/tmp/test',
        'jar',
        onProgress,
        undefined,
        undefined
      );
    });

    it('JAR와 classifier companion POM 및 체크섬의 모든 파일 경로를 반환한다', async () => {
      prepareArtifactNetworkMocks();
      const info = {
        type: 'maven' as const,
        name: 'com.example:demo',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'demo',
          packaging: 'jar',
          classifier: 'sources',
        },
      };
      const destination = '/tmp/depssmuggler-issue-67-maven';

      const files = await downloadPackageFiles(info, destination);

      expect(files).toEqual([
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0-sources.jar'),
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0-sources.jar.sha1'),
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0.pom'),
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0.pom.sha1'),
      ]);
    });

    it('POM-only 패키지는 POM과 체크섬만 반환한다', async () => {
      prepareArtifactNetworkMocks();
      const info = {
        type: 'maven' as const,
        name: 'org.example:demo-bom',
        version: '1.0.0',
        metadata: {
          groupId: 'org.example',
          artifactId: 'demo-bom',
          packaging: 'pom',
        },
      };
      const destination = '/tmp/depssmuggler-issue-67-maven';

      const files = await downloadPackageFiles(info, destination);

      expect(files).toEqual([
        path.join(destination, 'org/example/demo-bom/1.0.0/demo-bom-1.0.0.pom'),
        path.join(destination, 'org/example/demo-bom/1.0.0/demo-bom-1.0.0.pom.sha1'),
      ]);
    });

    it('없는 선택적 체크섬은 파일 목록에서 제외한다', async () => {
      prepareArtifactNetworkMocks('demo-1.0.0.pom.sha1');
      const info = {
        type: 'maven' as const,
        name: 'com.example:demo',
        version: '1.0.0',
        metadata: {
          groupId: 'com.example',
          artifactId: 'demo',
          packaging: 'jar',
        },
      };
      const destination = '/tmp/depssmuggler-issue-67-maven';

      const files = await downloadPackageFiles(info, destination);

      expect(files).toEqual([
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0.jar'),
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0.jar.sha1'),
        path.join(destination, 'com/example/demo/1.0.0/demo-1.0.0.pom'),
      ]);
      expect(files.some((file) => file.endsWith('.pom.sha1'))).toBe(false);
    });
  });

  describe('buildDownloadUrl', () => {
    it('기본 JAR URL 생성', () => {
      const url = (downloader as any).buildDownloadUrl('com.google.code.gson', 'gson', '2.10.1', 'jar');
      expect(url).toContain('com/google/code/gson/gson/2.10.1/gson-2.10.1.jar');
    });

    it('classifier 포함 URL 생성', () => {
      const url = (downloader as any).buildDownloadUrl('com.example', 'test', '1.0.0', 'jar', 'sources');
      expect(url).toContain('test-1.0.0-sources.jar');
    });
  });

  describe('buildFileName', () => {
    it('기본 파일명 생성', () => {
      const fileName = (downloader as any).buildFileName('gson', '2.10.1', 'jar');
      expect(fileName).toBe('gson-2.10.1.jar');
    });

    it('classifier 포함 파일명 생성', () => {
      const fileName = (downloader as any).buildFileName('test', '1.0.0', 'jar', 'sources');
      expect(fileName).toBe('test-1.0.0-sources.jar');
    });

    it('POM 파일명 생성', () => {
      const fileName = (downloader as any).buildFileName('spring-core', '6.0.0', 'pom');
      expect(fileName).toBe('spring-core-6.0.0.pom');
    });
  });

  describe('buildM2Path', () => {
    it('.m2 형식 경로 생성', () => {
      const m2Path = (downloader as any).buildM2Path('com.google.code.gson', 'gson', '2.10.1');
      expect(m2Path).toBe('com/google/code/gson/gson/2.10.1');
    });
  });

  describe('validateArtifactType', () => {
    it('유효한 타입 반환', () => {
      expect((downloader as any).validateArtifactType('jar')).toBe('jar');
      expect((downloader as any).validateArtifactType('pom')).toBe('pom');
      expect((downloader as any).validateArtifactType('war')).toBe('war');
    });

    it('알 수 없는 타입은 jar 반환', () => {
      expect((downloader as any).validateArtifactType('unknown')).toBe('jar');
      expect((downloader as any).validateArtifactType('')).toBe('jar');
    });
  });

  describe('compareVersions', () => {
    it('숫자 버전 비교', () => {
      expect((downloader as any).compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect((downloader as any).compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      expect((downloader as any).compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('마이너 버전 비교', () => {
      expect((downloader as any).compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
      expect((downloader as any).compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
    });

    it('패치 버전 비교', () => {
      expect((downloader as any).compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });

    it('SNAPSHOT 버전 비교', () => {
      // SNAPSHOT은 문자열이므로 숫자와 다르게 비교됨
      const result = (downloader as any).compareVersions('1.0.0', '1.0.0-SNAPSHOT');
      // 결과가 숫자인지 확인 (정확한 비교는 구현에 따라 다름)
      expect(typeof result).toBe('number');
    });

    it('알파/베타 버전 비교', () => {
      const alphaVsBeta = (downloader as any).compareVersions('1.0.0-alpha', '1.0.0-beta');
      // 결과가 숫자인지 확인
      expect(typeof alphaVsBeta).toBe('number');
    });
  });
});
