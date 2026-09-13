import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OsPackageCache } from './cache-manager';
import type { Repository } from './types';

describe('OsPackageCache', () => {
  let tempDir: string;

  function repo(overrides: Partial<Repository> = {}): Repository {
    return {
      id: 'baseos',
      name: 'BaseOS',
      baseUrl: 'https://example.test/baseos',
      enabled: true,
      gpgCheck: false,
      gpgKeyUrl: undefined,
      priority: undefined,
      isOfficial: true,
      ...overrides,
    };
  }

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

  it.each([
    ['레지스트리 포트', 'https://repo.example.test:8443/alpine/main'],
    ['IPv6 레지스트리 포트', 'https://[::1]:8443/alpine/main'],
  ])('persistent cache는 %s가 포함된 키를 재시작 후 보존한다', async (_caseName, baseUrl) => {
    const repo = {
      id: 'alpine-main',
      name: 'Alpine Main',
      baseUrl,
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    };
    const key = OsPackageCache.createKey('apk', repo, 'x86_64', 'apkindex');
    const filename = `${Buffer.from(key, 'utf8').toString('base64url')}.json`;
    const cacheValue = { packages: ['zlib'] };

    const writer = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
    });
    await writer.set(key, cacheValue);

    const reader = new OsPackageCache({
      type: 'persistent',
      directory: tempDir,
    });

    await expect(reader.get<typeof cacheValue>(key)).resolves.toEqual(cacheValue);
    expect(fs.existsSync(path.join(tempDir, filename))).toBe(true);
  });

  it('캐시 키는 v2 sha256 repository identity와 기존 구분자를 사용한다', () => {
    const key = OsPackageCache.createKey('yum', repo(), 'x86_64', 'primary');

    expect(key).toMatch(/^yum:v2-[a-f0-9]{64}:x86_64:primary$/);
  });

  it('APT component와 원본 repository URL의 trailing slash를 함께 식별한다', () => {
    const repository = repo({
      baseUrl: 'https://archive.example/ubuntu/dists/jammy/',
    });
    const normalizedRepository = repo({
      baseUrl: 'https://archive.example/ubuntu/dists/jammy',
    });
    const mainKey = OsPackageCache.createKey('apt', repository, 'amd64', 'packages', 'main');
    const universeKey = OsPackageCache.createKey('apt', repository, 'amd64', 'packages', 'universe');
    const normalizedKey = OsPackageCache.createKey(
      'apt', normalizedRepository, 'amd64', 'packages', 'main'
    );
    const omittedComponentKey = OsPackageCache.createKey(
      'apt', repository, 'amd64', 'packages'
    );
    const emptyComponentKey = OsPackageCache.createKey(
      'apt', repository, 'amd64', 'packages', ''
    );

    expect(universeKey).not.toBe(mainKey);
    expect(normalizedKey).not.toBe(mainKey);
    expect(omittedComponentKey).not.toBe(emptyComponentKey);
  });

  it.each([
    ['id', { id: 'changed-id' }],
    ['name', { name: 'Changed name' }],
    ['baseUrl', { baseUrl: 'http://example.test/baseos' }],
    ['enabled', { enabled: false }],
    ['gpgCheck', { gpgCheck: true }],
    ['gpgKeyUrl', { gpgKeyUrl: 'https://example.test/key.asc' }],
    ['priority', { priority: 10 }],
    ['isOfficial', { isOfficial: false }],
  ])('repository %s 변경은 캐시 키를 분리한다', (_field, change) => {
    const first = OsPackageCache.createKey('yum', repo(), 'x86_64', 'primary');
    const changed = OsPackageCache.createKey('yum', repo(change), 'x86_64', 'primary');

    expect(changed).not.toBe(first);
  });

  it('protocol, trailing slash, and slash-versus-underscore URL changes do not collide', () => {
    const identities = [
      repo({ baseUrl: 'http://mirror.example/repo' }),
      repo({ baseUrl: 'https://mirror.example/repo' }),
      repo({ baseUrl: 'https://mirror.example/repo/' }),
      repo({ baseUrl: 'https://mirror.example/repo_a' }),
      repo({ baseUrl: 'https://mirror.example/repo/a' }),
    ];
    const keys = identities.map((identity) =>
      OsPackageCache.createKey('yum', identity, 'x86_64', 'primary')
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('repository 객체 복제본은 같은 캐시 키를 재사용한다', () => {
    const original = repo();
    const clone = { ...original };

    expect(OsPackageCache.createKey('yum', original, 'x86_64', 'primary'))
      .toBe(OsPackageCache.createKey('yum', clone, 'x86_64', 'primary'));
  });

  it('persistent cache는 identity가 바뀐 repository에 이전 metadata를 반환하지 않는다', async () => {
    const original = repo();
    const changed = repo({ gpgCheck: true, gpgKeyUrl: 'https://example.test/key.asc' });
    const originalKey = OsPackageCache.createKey('yum', original, 'x86_64', 'primary');
    const changedKey = OsPackageCache.createKey('yum', changed, 'x86_64', 'primary');
    const writer = new OsPackageCache({ type: 'persistent', directory: tempDir });

    await writer.set(originalKey, { packages: ['old-metadata'] });

    const reader = new OsPackageCache({ type: 'persistent', directory: tempDir });
    await expect(reader.get(changedKey)).resolves.toBeNull();
    await expect(reader.get(originalKey)).resolves.toEqual({ packages: ['old-metadata'] });
  });

  it('persistent cache는 v1 base64url metadata 파일을 로드하지 않고 제거한다', () => {
    const oldKey = 'yum:example.test_baseos:x86_64:primary';
    const oldPath = path.join(tempDir, `${Buffer.from(oldKey, 'utf8').toString('base64url')}.json`);
    fs.writeFileSync(oldPath, JSON.stringify({
      data: { packages: ['old'] },
      timestamp: Date.now(),
      size: 32,
      lastAccess: Date.now(),
    }));

    const cacheManager = new OsPackageCache({ type: 'persistent', directory: tempDir });

    expect(cacheManager.getStats().entryCount).toBe(0);
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it.each([
    ['매니저 누락', ':repo.example.test:8443_alpine_main:x86_64:apkindex'],
    ['알 수 없는 매니저', 'rpm:repo.example.test:8443_alpine_main:x86_64:apkindex'],
    ['저장소 누락', 'apk::x86_64:apkindex'],
    ['아키텍처 누락', 'apk:repo.example.test:8443_alpine_main::apkindex'],
    ['알 수 없는 아키텍처', 'apk:repo.example.test:8443_alpine_main:not-an-architecture:apkindex'],
    ['데이터 형식 누락', 'apk:repo.example.test:8443_alpine_main:x86_64:'],
    ['알 수 없는 데이터 형식', 'apk:repo.example.test:8443_alpine_main:x86_64:unknown'],
  ])('persistent cache는 %s인 인코딩된 키를 로드하지 않고 파일을 제거한다', (_caseName, malformedKey) => {
    const malformedPath = path.join(
      tempDir,
      `${Buffer.from(malformedKey, 'utf8').toString('base64url')}.json`
    );
    fs.writeFileSync(
      malformedPath,
      JSON.stringify({
        data: { packages: ['invalid'] },
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
    expect(fs.existsSync(malformedPath)).toBe(false);
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

  it('persistent cache hit의 최근 접근 순서를 작은 용량으로 재오픈할 때 보존한다', async () => {
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
    const clock = vi.spyOn(Date, 'now');

    try {
      const writer = new OsPackageCache({ type: 'persistent', directory: tempDir, maxSize: 64 });
      clock.mockReturnValue(1_000);
      await writer.set(firstKey, { value: 'same' });
      clock.mockReturnValue(2_000);
      await writer.set(secondKey, { value: 'same' });
      clock.mockReturnValue(3_000);
      await expect(writer.get(firstKey)).resolves.toEqual({ value: 'same' });

      const reader = new OsPackageCache({ type: 'persistent', directory: tempDir, maxSize: 32 });
      await expect(reader.get(firstKey)).resolves.toEqual({ value: 'same' });
      await expect(reader.get(secondKey)).resolves.toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});
