import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OSCacheManager } from './cache-manager';

describe('OSCacheManager', () => {
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
    const key = OSCacheManager.createKey('yum', repo, 'x86_64', 'primary');

    const writer = new OSCacheManager({
      type: 'persistent',
      directory: tempDir,
    });
    await writer.set(key, { packages: ['httpd'] });

    const reader = new OSCacheManager({
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

    const cacheManager = new OSCacheManager({
      type: 'persistent',
      directory: tempDir,
    });

    expect(cacheManager.getStats().entryCount).toBe(0);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});
