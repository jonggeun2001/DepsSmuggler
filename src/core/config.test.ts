import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { getConfigManager, ConfigManager, Config } from './config';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('node-machine-id', () => ({ machineIdSync: () => 'config-test-machine-id' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => testHome.path };
});

beforeAll(async () => {
  testHome.path = await fs.mkdtemp(path.join(os.tmpdir(), 'depssmuggler-config-'));
});
afterAll(async () => {
  await fs.remove(testHome.path);
});

describe('ConfigManager', () => {
  describe('getConfigManager', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getConfigManager();
      const instance2 = getConfigManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('암호화/복호화', () => {
    let testConfigDir: string;
    let originalConfigDir: string;
    let configManager: ConfigManager;

    beforeEach(async () => {
      // 테스트용 임시 디렉토리 생성
      testConfigDir = path.join(os.tmpdir(), `depssmuggler-test-${Date.now()}`);
      await fs.ensureDir(testConfigDir);

      // ConfigManager의 configDir을 테스트 디렉토리로 변경하기 어려우므로
      // 새 인스턴스를 생성하여 테스트
      configManager = new ConfigManager();
    });

    afterEach(async () => {
      // 테스트 디렉토리 정리
      if (testConfigDir && await fs.pathExists(testConfigDir)) {
        await fs.remove(testConfigDir);
      }
    });

    it.each(['test-smtp-password-123!@#', '\uFEFF비밀번호\uFFFD🔐'])('SMTP 비밀번호 암호화/복호화 라운드트립 (%s)', async (testPassword) => {

      // 설정 저장 (비밀번호가 암호화됨)
      const testConfig: Config = {
        concurrentDownloads: 5,
        cachingEnabled: true,
        fileSplitSizeMB: 25,
        defaultOutputFormat: 'archive',
        defaultArchiveType: 'zip',
        smtpHost: 'smtp.test.com',
        smtpPort: 587,
        smtpUser: 'test@test.com',
        smtpPassword: testPassword,
      };

      await configManager.saveConfig(testConfig);

      // 설정 파일에서 암호화된 비밀번호 확인
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      const savedConfig = await fs.readJson(configPath);

      // 저장된 비밀번호는 암호화되어 있어야 함 (원본과 다름)
      expect(savedConfig.smtpPassword).not.toBe(testPassword);
      // 암호화 형식: iv:encryptedData
      expect(savedConfig.smtpPassword).toMatch(/^[0-9a-f]+:[0-9a-f]+$/i);

      // 설정 로드 (비밀번호가 복호화됨)
      const loadedConfig = await configManager.loadConfig();

      // 복호화된 비밀번호가 원본과 일치
      expect(loadedConfig.smtpPassword).toBe(testPassword);
    });

    it('암호화되지 않은 비밀번호도 처리 가능', async () => {
      // 암호화되지 않은 설정 파일 직접 생성
      const testPassword = 'plain-text-password';
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');

      await fs.ensureDir(configManager.getConfigDir());
      await fs.writeJson(configPath, {
        concurrentDownloads: 5,
        cachingEnabled: true,
        fileSplitSizeMB: 25,
        defaultOutputFormat: 'archive',
        defaultArchiveType: 'zip',
        smtpPassword: testPassword, // 암호화되지 않은 상태
      });

      // 설정 로드
      const loadedConfig = await configManager.loadConfig();

      // 암호화되지 않은 비밀번호는 그대로 반환
      expect(loadedConfig.smtpPassword).toBe(testPassword);
    });

    it('빈 비밀번호 처리', async () => {
      const testConfig: Config = {
        concurrentDownloads: 5,
        cachingEnabled: true,
        fileSplitSizeMB: 25,
        defaultOutputFormat: 'archive',
        defaultArchiveType: 'zip',
        smtpPassword: '',
      };

      await configManager.saveConfig(testConfig);
      const loadedConfig = await configManager.loadConfig();

      expect(loadedConfig.smtpPassword).toBe('');
    });

    it('비밀번호 없이 설정 저장/로드', async () => {
      const testConfig: Config = {
        concurrentDownloads: 10,
        cachingEnabled: false,
        fileSplitSizeMB: 50,
        defaultOutputFormat: 'mirror',
        defaultArchiveType: 'tar.gz',
      };

      await configManager.saveConfig(testConfig);
      const loadedConfig = await configManager.loadConfig();

      expect(loadedConfig.concurrentDownloads).toBe(10);
      expect(loadedConfig.cachingEnabled).toBe(false);
      expect(loadedConfig.smtpPassword).toBeUndefined();
    });
  });

  describe('기본 설정', () => {
    it('resetToDefaults는 기본값으로 초기화', async () => {
      const configManager = getConfigManager();

      // 설정 변경
      await configManager.updateConfig({ concurrentDownloads: 20 });

      // 기본값으로 초기화
      const defaultConfig = await configManager.resetToDefaults();

      expect(defaultConfig.concurrentDownloads).toBe(5);
      expect(defaultConfig.cachingEnabled).toBe(true);
      expect(defaultConfig.fileSplitSizeMB).toBe(25);
    });
  });

  describe('경로 게터', () => {
    it('getConfigDir는 설정 디렉토리 경로 반환', () => {
      const configManager = new ConfigManager();
      const configDir = configManager.getConfigDir();

      expect(configDir).toContain('.depssmuggler');
      expect(typeof configDir).toBe('string');
    });

    it('getLogsDir는 로그 디렉토리 경로 반환', () => {
      const configManager = new ConfigManager();
      const logsDir = configManager.getLogsDir();

      expect(logsDir).toContain('logs');
      expect(logsDir).toContain('.depssmuggler');
    });

    it('getCacheDir는 캐시 디렉토리 경로 반환', () => {
      const configManager = new ConfigManager();
      const cacheDir = configManager.getCacheDir();

      expect(cacheDir).toContain('cache');
      expect(cacheDir).toContain('.depssmuggler');
    });
  });

  describe('CLI 동기 메서드', () => {
    let configManager: ConfigManager;

    beforeEach(() => {
      configManager = new ConfigManager();
    });

    it('getConfig는 기본 설정 반환', () => {
      const config = configManager.getConfig();

      expect(config).toHaveProperty('concurrentDownloads');
      expect(config).toHaveProperty('cacheEnabled');
      expect(config).toHaveProperty('cachePath');
      expect(config).toHaveProperty('maxCacheSize');
      expect(config).toHaveProperty('logLevel');
      expect(config.maxCacheSize).toBe(10 * 1024 * 1024 * 1024); // 10GB
    });

    it('set은 단일 설정값 저장', () => {
      const testValue = 15;
      configManager.set('concurrentDownloads', testValue);

      const config = configManager.getConfig();
      expect(config.concurrentDownloads).toBe(testValue);
    });

    it('reset은 설정을 기본값으로 초기화', () => {
      // 설정 변경
      configManager.set('concurrentDownloads', 99);

      // 리셋
      configManager.reset();

      const config = configManager.getConfig();
      expect(config.concurrentDownloads).toBe(5); // 기본값
    });

    it('getConfig는 enableCache 필드 호환성 처리', async () => {
      // enableCache 필드로 설정 저장
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      await fs.ensureDir(configManager.getConfigDir());
      await fs.writeJson(configPath, {
        concurrentDownloads: 3,
        enableCache: false,
        cachePath: '/custom/cache',
        logLevel: 'debug',
      });

      const config = configManager.getConfig();

      expect(config.cacheEnabled).toBe(false);
      expect(config.cachePath).toBe('/custom/cache');
      expect(config.logLevel).toBe('debug');
    });

    it.each(['cacheEnabled', 'cachingEnabled'])('%s 단독 저장 형식을 async/sync 양쪽에서 읽는다', async (field) => {
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      await fs.outputJson(configPath, { [field]: false });

      await expect(configManager.loadConfig()).resolves.toMatchObject({ cachingEnabled: false });
      expect(configManager.getConfig().cacheEnabled).toBe(false);
    });

    it('캐시 별칭은 enableCache를 우선하고 maxCacheSize를 보존한다', async () => {
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      await fs.ensureDir(configManager.getConfigDir());
      await fs.writeJson(configPath, {
        enableCache: false,
        cachingEnabled: true,
        cacheEnabled: true,
        maxCacheSize: 1234,
        customField: 'preserve-me',
      });

      await expect(configManager.loadConfig()).resolves.toMatchObject({ cachingEnabled: false });
      expect(configManager.getConfig()).toMatchObject({ cacheEnabled: false, maxCacheSize: 1234 });
    });

    it('선택된 캐시 별칭이 invalid이면 낮은 우선순위 별칭으로 대체하지 않는다', async () => {
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      await fs.outputJson(configPath, {
        enableCache: 'false',
        cachingEnabled: false,
        cacheEnabled: false,
      });
      const original = await fs.readFile(configPath, 'utf8');

      await expect(configManager.loadConfig()).resolves.toMatchObject({ cachingEnabled: true });
      expect(configManager.getConfig().cacheEnabled).toBe(true);
      expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    });

    it('캐시 설정 저장은 canonical enableCache만 기록하고 unknown field를 유지한다', async () => {
      await configManager.saveConfig({
        concurrentDownloads: 5,
        cachingEnabled: false,
        fileSplitSizeMB: 25,
        defaultOutputFormat: 'archive',
        defaultArchiveType: 'zip',
        enableCache: true,
        cacheEnabled: true,
        customField: 'preserve-me',
      } as Config & Record<string, unknown>);

      const saved = await fs.readJson(path.join(configManager.getConfigDir(), 'settings.json'));
      expect(saved.enableCache).toBe(false);
      expect(saved).not.toHaveProperty('cachingEnabled');
      expect(saved).not.toHaveProperty('cacheEnabled');
      expect(saved.customField).toBe('preserve-me');
    });

    it('updateConfig의 cachingEnabled 변경은 stale enableCache보다 우선한다', async () => {
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');
      await fs.outputJson(configPath, {
        concurrentDownloads: 5,
        enableCache: true,
        cachingEnabled: true,
        cacheEnabled: true,
      });

      await configManager.updateConfig({ cachingEnabled: false });
      const saved = await fs.readJson(configPath);
      expect(saved.enableCache).toBe(false);
      expect(saved).not.toHaveProperty('cachingEnabled');
      expect(saved).not.toHaveProperty('cacheEnabled');
    });
  });

  describe('에러 처리', () => {
    afterEach(() => vi.restoreAllMocks());

    it('디렉토리 생성 실패도 기본값으로 복구하고 저장을 시도하지 않는다', async () => {
      const manager = new ConfigManager();
      vi.spyOn(manager, 'ensureDirectories').mockRejectedValue(new Error('EACCES'));
      const save = vi.spyOn(manager, 'saveConfig');
      await expect(manager.loadConfig()).resolves.toMatchObject({ concurrentDownloads: 5 });
      expect(save).not.toHaveBeenCalled();
    });

    it('최초 기본값 저장 실패에도 설정 읽기는 사용 가능하다', async () => {
      const manager = new ConfigManager();
      await fs.remove(path.join(manager.getConfigDir(), 'settings.json'));
      vi.spyOn(manager, 'saveConfig').mockRejectedValue(new Error('ENOSPC'));
      await expect(manager.loadConfig()).resolves.toMatchObject({ concurrentDownloads: 5 });
    });

    it('손상된 설정을 읽어도 원본 파일을 덮어쓰지 않는다', async () => {
      const manager = new ConfigManager();
      const file = path.join(manager.getConfigDir(), 'settings.json');
      await fs.outputFile(file, '{ broken settings }');
      await manager.loadConfig();
      expect(await fs.readFile(file, 'utf8')).toBe('{ broken settings }');
    });

    it('CLI 설정의 잘못된 타입과 숫자는 안전한 기본값을 사용한다', async () => {
      const manager = new ConfigManager();
      await fs.outputJson(path.join(manager.getConfigDir(), 'settings.json'), {
        concurrentDownloads: -3, enableCache: 'false', cachePath: 42, logLevel: {},
      });
      expect(manager.getConfig()).toEqual({
        concurrentDownloads: 5, cacheEnabled: true, cachePath: manager.getCacheDir(),
        maxCacheSize: 10 * 1024 * 1024 * 1024, logLevel: 'info',
      });
    });

    it('CLI maxCacheSize가 유효하지 않으면 파일을 변경하지 않고 거부한다', async () => {
      const manager = new ConfigManager();
      const configPath = path.join(manager.getConfigDir(), 'settings.json');
      await fs.outputJson(configPath, { maxCacheSize: 4096, customField: 'preserve-me' });
      const original = await fs.readFile(configPath, 'utf8');

      expect(() => manager.set('maxCacheSize', 0)).toThrow();
      expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    });

    it.each([0, -1, 1.5, '1024', Number.MAX_SAFE_INTEGER + 1])(
      '저장된 invalid maxCacheSize %s는 기본값으로 읽고 원본을 보존한다',
      async (value) => {
        const manager = new ConfigManager();
        const configPath = path.join(manager.getConfigDir(), 'settings.json');
        await fs.outputJson(configPath, { maxCacheSize: value, customField: 'preserve-me' });
        const original = await fs.readFile(configPath, 'utf8');

        expect(manager.getConfig().maxCacheSize).toBe(10 * 1024 * 1024 * 1024);
        expect(await fs.readFile(configPath, 'utf8')).toBe(original);
      }
    );

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1024'])(
      'CLI maxCacheSize 값 %s는 저장 전에 거부한다',
      async (value) => {
        const manager = new ConfigManager();
        const configPath = path.join(manager.getConfigDir(), 'settings.json');
        await fs.outputJson(configPath, { maxCacheSize: 4096, customField: 'preserve-me' });
        const original = await fs.readFile(configPath, 'utf8');

        expect(() => manager.set('maxCacheSize', value)).toThrow();
        expect(await fs.readFile(configPath, 'utf8')).toBe(original);
      }
    );

    it.each(['false', 0, null, 1])('CLI cache alias 값 %s는 저장 전에 거부한다', async (value) => {
      const manager = new ConfigManager();
      const configPath = path.join(manager.getConfigDir(), 'settings.json');
      await fs.outputJson(configPath, { enableCache: true, customField: 'preserve-me' });
      const original = await fs.readFile(configPath, 'utf8');

      expect(() => manager.set('cacheEnabled', value)).toThrow();
      expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    });

    it('비정상 비동기 설정 필드를 복구하면서 정상 필드는 유지한다', async () => {
      const manager = new ConfigManager();
      await fs.outputJson(path.join(manager.getConfigDir(), 'settings.json'), {
        concurrentDownloads: 0, cachingEnabled: null, fileSplitSizeMB: -1,
        smtpPassword: {}, smtpHost: 'smtp.example.com',
      });
      const loaded = await manager.loadConfig();
      expect(loaded).toMatchObject({
        concurrentDownloads: 5, cachingEnabled: true, fileSplitSizeMB: 25,
        smtpHost: 'smtp.example.com',
      });
      expect(loaded.smtpPassword).toBeUndefined();
    });

    it('손상된 설정 파일은 기본값으로 대체', async () => {
      const configManager = new ConfigManager();
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');

      // 손상된 JSON 파일 생성
      await fs.ensureDir(configManager.getConfigDir());
      await fs.writeFile(configPath, '{ invalid json }');

      // loadConfig는 에러를 잡고 기본값 반환
      const config = await configManager.loadConfig();

      expect(config.concurrentDownloads).toBe(5);
      expect(config.cachingEnabled).toBe(true);
    });

    it('updateConfig는 현재 설정과 병합', async () => {
      const configManager = new ConfigManager();

      // 초기 설정
      await configManager.saveConfig({
        concurrentDownloads: 5,
        cachingEnabled: true,
        fileSplitSizeMB: 25,
        defaultOutputFormat: 'archive',
        defaultArchiveType: 'zip',
      });

      // 부분 업데이트
      const updated = await configManager.updateConfig({
        concurrentDownloads: 10,
        smtpHost: 'smtp.example.com',
      });

      expect(updated.concurrentDownloads).toBe(10);
      expect(updated.cachingEnabled).toBe(true); // 기존 값 유지
      expect(updated.smtpHost).toBe('smtp.example.com');
    });
  });

  describe('암호화 마이그레이션', () => {
    it.each([-1, 5])('잘못된 머신 키가 CBC 패딩을 통과해도 레거시 비밀번호를 복원한다 (%s)', async (concurrentDownloads) => {
      const manager = new ConfigManager();
      const configPath = path.join(manager.getConfigDir(), 'settings.json');
      // 이 벡터는 고정된 테스트 머신 키에서 패딩 검사는 통과하지만 UTF-8은 깨진다.
      const encrypted = '0000000000000000000000000000000b:458405b2bbd8bf4b8a2424319b57f9e86c3432eb5b6145b44f809393c8cbe2b2';
      await fs.outputJson(configPath, { concurrentDownloads, smtpPassword: encrypted });
      const original = await fs.readFile(configPath, 'utf8');

      expect((await manager.loadConfig()).smtpPassword).toBe('legacy-test-password');
      if (concurrentDownloads < 0) {
        expect(await fs.readFile(configPath, 'utf8')).toBe(original);
        await manager.updateConfig({ concurrentDownloads: 7 });
      } else {
        expect((await fs.readJson(configPath)).smtpPassword).not.toBe(encrypted);
      }
      expect((await manager.loadConfig()).smtpPassword).toBe('legacy-test-password');
    });

    it.each(['machine', 'legacy'])('유효한 UTF-8 비밀번호를 복원할 수 없으면 저장된 원문을 보존한다 (%s 키)', async (keyType) => {
      const manager = new ConfigManager();
      const configPath = path.join(manager.getConfigDir(), 'settings.json');
      const machineKey = crypto.createHash('sha256').update('config-test-machine-iddepssmuggler-salt').digest();
      const key = keyType === 'machine' ? machineKey : Buffer.from('depssmuggler-secret-key-32bytes!');
      const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from([0xff, 0xfe])), cipher.final()]);
      const encrypted = `${Buffer.alloc(16).toString('hex')}:${ciphertext.toString('hex')}`;
      await fs.outputJson(configPath, { concurrentDownloads: 5, smtpPassword: encrypted });
      const original = await fs.readFile(configPath, 'utf8');

      expect((await manager.loadConfig()).smtpPassword).toBe(encrypted);
      expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    });

    it.each([-1, 5])('레거시 비밀번호 로드는 잘못된 설정(%s)을 자동 저장하지 않고 정상 설정만 마이그레이션한다', async (concurrentDownloads) => {
      const manager = new ConfigManager();
      const configPath = path.join(manager.getConfigDir(), 'settings.json');
      const password = 'legacy-test-password';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from('depssmuggler-secret-key-32bytes!'), iv);
      const encrypted = `${iv.toString('hex')}:${cipher.update(password, 'utf8', 'hex')}${cipher.final('hex')}`;
      await fs.outputJson(configPath, { concurrentDownloads, smtpPassword: encrypted });
      const original = await fs.readFile(configPath, 'utf8');

      const loaded = await manager.loadConfig();
      expect(loaded).toMatchObject({ concurrentDownloads: 5, smtpPassword: password });
      if (concurrentDownloads < 0) {
        expect(await fs.readFile(configPath, 'utf8')).toBe(original);
        await manager.updateConfig({ concurrentDownloads: 7 });
        expect(await manager.loadConfig()).toMatchObject({ concurrentDownloads: 7, smtpPassword: password });
      } else {
        expect((await fs.readJson(configPath)).smtpPassword).not.toBe(encrypted);
        expect(await manager.loadConfig()).toMatchObject({ concurrentDownloads: 5, smtpPassword: password });
      }
    });

    it('잘못된 형식의 암호화 값은 원본 반환', async () => {
      const configManager = new ConfigManager();
      const configPath = path.join(configManager.getConfigDir(), 'settings.json');

      // 잘못된 암호화 형식의 설정 파일
      await fs.ensureDir(configManager.getConfigDir());
      await fs.writeJson(configPath, {
        concurrentDownloads: 5,
        smtpPassword: 'invalid:format:too:many:colons',
      });

      const config = await configManager.loadConfig();

      // 잘못된 형식은 그대로 반환
      expect(config.smtpPassword).toBe('invalid:format:too:many:colons');
    });
  });
});
