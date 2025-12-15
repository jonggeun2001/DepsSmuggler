import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { getConfigManager, ConfigManager, Config } from './config';

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

    it('SMTP 비밀번호 암호화/복호화 라운드트립', async () => {
      const testPassword = 'test-smtp-password-123!@#';

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
  });

  describe('에러 처리', () => {
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
