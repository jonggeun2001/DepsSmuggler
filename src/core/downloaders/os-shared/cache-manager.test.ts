import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OsPackageCache } from './cache-manager';

describe('OsPackageCache', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'depssmuggler-os-cache-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persistent cache는 base64url 키로 저장한 항목을 다음 인스턴스에서 다시 읽는다', async () => {
    const repo = {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    const key = OsPackageCache.createKey('yum', repo, 'x86_64', 'primary');

    const writer = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
    });
    await writer.set(key, { packages: ['httpd'] });

    const reader = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
    });

    await expect(reader.get<{ packages: string[] }>(key)).resolves.toEqual({
      packages: ['httpd'],
    });
  });

  it('이전 lossy 파일명 캐시는 로드 시 제거한다', () => {
    const legacyPath = path.join(tempDir, 'yum_repo_example_com_x86_64_primary.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        data: { packages: ['httpd'] },
        timestamp: Date.now(),
        size: 10,
        lastAccess: Date.now(),
      })
    );

    const cacheManager = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
    });

    expect(cacheManager.getStats().entryCount).toBe(0);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('oversized entry는 다른 항목을 유지하고 같은 키의 기존 항목만 제거한다', async () => {
    const repo = {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    const keepKey = OsPackageCache.createKey('yum', repo, 'x86_64', 'primary');
    const replaceKey = OsPackageCache.createKey('yum', repo, 'x86_64', 'packages');
    const cacheManager = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
      maxSize: 100,
    });

    await cacheManager.set(keepKey, { value: 'keep' });
    await cacheManager.set(replaceKey, { value: 'old' });
    await cacheManager.set(replaceKey, { value: 'x'.repeat(200) });

    await expect(cacheManager.get(keepKey)).resolves.toEqual({ value: 'keep' });
    await expect(cacheManager.get(replaceKey)).resolves.toBeNull();

    const reader = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
      maxSize: 100,
    });
    await expect(reader.get(keepKey)).resolves.toEqual({ value: 'keep' });
    await expect(reader.get(replaceKey)).resolves.toBeNull();
  });

  it('용량을 넘는 새 항목은 최근 사용하지 않은 항목만 LRU로 정리한다', async () => {
    const repo = {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    const firstKey = OsPackageCache.createKey('yum', repo, 'x86_64', 'primary');
    const secondKey = OsPackageCache.createKey('yum', repo, 'x86_64', 'packages');
    const thirdKey = OsPackageCache.createKey('yum', repo, 'x86_64', 'repomd');
    const clock = vi.spyOn(Date, 'now');
    const cacheManager = new OsPackageCache({ type: 'persistent', directory: tempDir, maxSize: 64 });

    clock.mockReturnValue(1_000);
    await cacheManager.set(firstKey, { value: 'same' });
    clock.mockReturnValue(2_000);
    await cacheManager.set(secondKey, { value: 'same' });
    clock.mockReturnValue(3_000);
    await cacheManager.get(firstKey);
    clock.mockReturnValue(4_000);
    await cacheManager.set(thirdKey, { value: 'same' });

    await expect(cacheManager.get(firstKey)).resolves.toEqual({ value: 'same' });
    await expect(cacheManager.get(secondKey)).resolves.toBeNull();
    await expect(cacheManager.get(thirdKey)).resolves.toEqual({ value: 'same' });

    const reader = new OsPackageCache({ type: 'persistent', directory: tempDir, maxSize: 32 });
    await expect(reader.get(firstKey)).resolves.toBeNull();
    await expect(reader.get(secondKey)).resolves.toBeNull();
    await expect(reader.get(thirdKey)).resolves.toEqual({ value: 'same' });
    clock.mockRestore();
  });

  it('동시에 저장해도 캐시 총량을 maxSize 이하로 유지한다', async () => {
    const repo = {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    const keys = [
      OsPackageCache.createKey('yum', repo, 'x86_64', 'primary'),
      OsPackageCache.createKey('yum', repo, 'x86_64', 'packages'),
      OsPackageCache.createKey('yum', repo, 'x86_64', 'repomd'),
    ];
    const cacheManager = new OsPackageCache({ type: 'session', maxSize: 64 });

    await Promise.all(keys.map((key) => cacheManager.set(key, { value: 'same' })));

    expect(cacheManager.getStats().totalSize).toBeLessThanOrEqual(64);
    expect(cacheManager.getStats().entryCount).toBeLessThanOrEqual(2);
  });
});
