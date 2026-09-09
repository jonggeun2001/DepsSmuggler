import * as crypto from 'crypto';
import { TextDecoder } from 'node:util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { machineIdSync } from 'node-machine-id';
import { mask } from '../utils/mask';

// 설정 인터페이스 정의
export interface Config {
  // 다운로드 설정
  concurrentDownloads: number;
  cachingEnabled: boolean;
  fileSplitSizeMB: number;

  // SMTP 설정 (메일 발송용)
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string; // 암호화되어 저장됨
  smtpFrom?: string;
  smtpTo?: string;

  // 기타 설정
  defaultOutputFormat: 'archive' | 'mirror' | 'withScript';
  defaultArchiveType: 'zip' | 'tar.gz';
}

// 기본 설정값
const DEFAULT_CONFIG: Config = {
  concurrentDownloads: 5,
  cachingEnabled: true,
  fileSplitSizeMB: 25,
  defaultOutputFormat: 'archive',
  defaultArchiveType: 'zip',
};

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const isPositiveInteger = (value: unknown): value is number =>
  isPositiveNumber(value) && Number.isSafeInteger(value);

const DEFAULT_CLI_MAX_CACHE_SIZE = 10 * 1024 * 1024 * 1024;

function getCacheAliasValue(rawConfig: Record<string, unknown>): { value: boolean; invalid: boolean } {
  const selected = rawConfig.enableCache ?? rawConfig.cachingEnabled ?? rawConfig.cacheEnabled;
  if (selected === undefined) {
    return { value: DEFAULT_CONFIG.cachingEnabled, invalid: false };
  }
  if (typeof selected !== 'boolean') {
    return { value: DEFAULT_CONFIG.cachingEnabled, invalid: true };
  }
  return { value: selected, invalid: false };
}

function canonicalizeCacheAliases(
  rawConfig: Record<string, unknown>,
  preferredValue?: boolean
): Record<string, unknown> {
  const aliases = getCacheAliasValue(rawConfig);
  const config = { ...rawConfig };
  config.enableCache = preferredValue ?? aliases.value;
  delete config.cachingEnabled;
  delete config.cacheEnabled;
  return config;
}

function readConfigObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('설정 파일은 객체여야 합니다');
  }
  return value as Record<string, unknown>;
}

// CLI용 설정 인터페이스
export interface CLIConfig {
  concurrentDownloads: number;
  cacheEnabled: boolean;
  cachePath: string;
  maxCacheSize: number;
  logLevel: string;
}

// 암호화 설정
const ENCRYPTION_IV_LENGTH = 16;
const ENCRYPTION_SALT = 'depssmuggler-salt';

// 레거시 키 (기존 설정 마이그레이션용) - 마이그레이션 완료 후 제거 예정
const LEGACY_ENCRYPTION_KEY = 'depssmuggler-secret-key-32bytes!';

/**
 * 머신별 고유 암호화 키를 생성합니다.
 * machineId + salt를 SHA-256으로 해싱하여 32바이트 키 생성
 */
function generateMachineKey(): Buffer {
  try {
    const machineId = machineIdSync();
    return crypto
      .createHash('sha256')
      .update(machineId + ENCRYPTION_SALT)
      .digest();
  } catch (error) {
    // machineId 획득 실패 시 폴백 (테스트 환경 등)
    console.warn('머신 ID 획득 실패, 폴백 키 사용:', error);
    return crypto
      .createHash('sha256')
      .update(os.hostname() + os.userInfo().username + ENCRYPTION_SALT)
      .digest();
  }
}

// 머신별 고유 암호화 키 (32 bytes for AES-256)
const ENCRYPTION_KEY = generateMachineKey();

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private logsDir: string;
  private cacheDir: string;
  private needsEncryptionMigration: boolean = false;

  constructor() {
    this.configDir = path.join(os.homedir(), '.depssmuggler');
    this.configPath = path.join(this.configDir, 'settings.json');  // config.json → settings.json으로 통합
    this.logsDir = path.join(this.configDir, 'logs');
    this.cacheDir = path.join(this.configDir, 'cache');
  }

  /**
   * 필요한 디렉토리들을 생성합니다.
   */
  async ensureDirectories(): Promise<void> {
    await fs.ensureDir(this.configDir);
    await fs.ensureDir(this.logsDir);
    await fs.ensureDir(this.cacheDir);
  }

  /**
   * 설정을 로드합니다. 파일이 없으면 기본값을 생성합니다.
   */
  async loadConfig(): Promise<Config> {
    this.needsEncryptionMigration = false; // 마이그레이션 플래그 초기화

    try {
      await this.ensureDirectories();
      if (await fs.pathExists(this.configPath)) {
        const rawConfig = readConfigObject(await fs.readJson(this.configPath));
        // 저장된 설정과 기본값을 병합 (새로운 설정 항목 대응)
        const config: Config = { ...DEFAULT_CONFIG, ...rawConfig };
        const invalidFields: string[] = [];
        const cacheAlias = getCacheAliasValue(rawConfig);
        config.cachingEnabled = cacheAlias.value;
        if (!isPositiveInteger(config.concurrentDownloads)) {
          config.concurrentDownloads = DEFAULT_CONFIG.concurrentDownloads;
          invalidFields.push('concurrentDownloads');
        }
        if (!isPositiveNumber(config.fileSplitSizeMB)) {
          config.fileSplitSizeMB = DEFAULT_CONFIG.fileSplitSizeMB;
          invalidFields.push('fileSplitSizeMB');
        }
        if (cacheAlias.invalid) {
          invalidFields.push('cachingEnabled');
        }
        for (const key of ['smtpHost', 'smtpUser', 'smtpPassword', 'smtpFrom', 'smtpTo'] as const) {
          if (config[key] !== undefined && typeof config[key] !== 'string') {
            delete config[key];
            invalidFields.push(key);
          }
        }
        if (config.smtpPort !== undefined && (!isPositiveInteger(config.smtpPort) || config.smtpPort > 65535)) {
          delete config.smtpPort;
          invalidFields.push('smtpPort');
        }
        if (invalidFields.length) console.warn('[config:load] 잘못된 설정 필드에 기본값 사용:', invalidFields);

        // SMTP 비밀번호 복호화
        if (config.smtpPassword) {
          config.smtpPassword = this.decrypt(config.smtpPassword);
        }

        // 잘못된 필드가 있으면 원본 보존을 위해 명시적 저장까지 마이그레이션을 미룬다.
        if (this.needsEncryptionMigration && config.smtpPassword && invalidFields.length === 0) {
          console.info('[config] 암호화 키 마이그레이션을 수행합니다...');
          try {
            await this.saveConfig(config);
            this.needsEncryptionMigration = false;
            console.info('[config] 암호화 키 마이그레이션 완료.');
          } catch (error) {
            console.error('[config:migrate] 설정은 읽었지만 마이그레이션 저장 실패:', mask(error));
          }
        }

        return config;
      }
      // 파일이 없는 경우에만 기본값 저장을 시도한다. 읽기 실패한 원본은 보존한다.
      await this.saveConfig(DEFAULT_CONFIG);
    } catch (error) {
      console.error('[config:load] 설정 로드/초기화 실패, 메모리 기본값 사용:', mask(error));
    }

    return { ...DEFAULT_CONFIG };
  }

  /**
   * 설정을 저장합니다.
   */
  async saveConfig(config: Config): Promise<void> {
    const configRecord = config as Config & Record<string, unknown>;
    if (typeof config.cachingEnabled !== 'boolean') {
      throw new TypeError('cachingEnabled는 boolean이어야 합니다');
    }
    if (configRecord.maxCacheSize !== undefined && !isPositiveInteger(configRecord.maxCacheSize)) {
      throw new TypeError('maxCacheSize는 양의 안전한 정수여야 합니다');
    }
    await this.ensureDirectories();

    // 저장용 설정 복사 (원본 수정 방지)
    const configToSave = canonicalizeCacheAliases(configRecord, config.cachingEnabled);

    // SMTP 비밀번호 암호화
    if (config.smtpPassword) {
      configToSave.smtpPassword = this.encrypt(config.smtpPassword);
    }

    await fs.writeJson(this.configPath, configToSave, { spaces: 2 });
  }

  /**
   * 설정을 기본값으로 초기화합니다.
   */
  async resetToDefaults(): Promise<Config> {
    await this.saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  /**
   * 특정 설정값을 업데이트합니다.
   */
  async updateConfig(updates: Partial<Config>): Promise<Config> {
    const currentConfig = await this.loadConfig();
    const newConfig = { ...currentConfig, ...updates };
    await this.saveConfig(newConfig);
    return newConfig;
  }

  /**
   * 설정 디렉토리 경로를 반환합니다.
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * 로그 디렉토리 경로를 반환합니다.
   */
  getLogsDir(): string {
    return this.logsDir;
  }

  /**
   * 캐시 디렉토리 경로를 반환합니다.
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * 설정을 동기적으로 로드합니다 (CLI용).
   * settings.json의 필드명에 맞춤 (enableCache, cachePath)
   */
  getConfig(): CLIConfig {
    try {
      fs.ensureDirSync(this.configDir);
      if (fs.pathExistsSync(this.configPath)) {
        const rawConfig = readConfigObject(fs.readJsonSync(this.configPath));
        const cacheAlias = getCacheAliasValue(rawConfig);
        const validConcurrency = isPositiveInteger(rawConfig.concurrentDownloads);
        const validCacheEnabled = !cacheAlias.invalid;
        const validMaxCacheSize = rawConfig.maxCacheSize === undefined || isPositiveInteger(rawConfig.maxCacheSize);
        const validCachePath = typeof rawConfig.cachePath === 'string' && rawConfig.cachePath.trim().length > 0;
        const validLogLevel = typeof rawConfig.logLevel === 'string' &&
          ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'].includes(rawConfig.logLevel);
        if ((!validConcurrency && rawConfig.concurrentDownloads !== undefined) ||
            cacheAlias.invalid ||
            !validMaxCacheSize ||
            (!validCachePath && rawConfig.cachePath !== undefined && rawConfig.cachePath !== '') ||
            (!validLogLevel && rawConfig.logLevel !== undefined)) {
          console.warn('[config:get] 잘못된 CLI 설정에 기본값 사용');
        }
        return {
          concurrentDownloads: validConcurrency ? rawConfig.concurrentDownloads as number : DEFAULT_CONFIG.concurrentDownloads,
          // settings.json은 enableCache 사용, 기존 cachingEnabled도 호환
          cacheEnabled: validCacheEnabled ? cacheAlias.value : DEFAULT_CONFIG.cachingEnabled,
          cachePath: validCachePath ? rawConfig.cachePath as string : this.cacheDir,
          maxCacheSize: validMaxCacheSize && rawConfig.maxCacheSize !== undefined
            ? rawConfig.maxCacheSize as number
            : DEFAULT_CLI_MAX_CACHE_SIZE,
          logLevel: validLogLevel ? rawConfig.logLevel as string : 'info',
        };
      }
    } catch (error) {
      console.error('[config:get] CLI 설정 로드 실패, 기본값 사용:', mask(error));
    }
    return {
      concurrentDownloads: DEFAULT_CONFIG.concurrentDownloads,
      cacheEnabled: DEFAULT_CONFIG.cachingEnabled,
      cachePath: this.cacheDir,
      maxCacheSize: DEFAULT_CLI_MAX_CACHE_SIZE,
      logLevel: 'info',
    };
  }

  /**
   * 설정값을 동기적으로 설정합니다 (CLI용).
   */
  set(key: string, value: unknown): void {
    fs.ensureDirSync(this.configDir);
    let config: Record<string, unknown> = {};

    if (fs.pathExistsSync(this.configPath)) {
      config = readConfigObject(fs.readJsonSync(this.configPath));
    }

    const isCacheAlias = key === 'enableCache' || key === 'cachingEnabled' || key === 'cacheEnabled';
    if (isCacheAlias && typeof value !== 'boolean') {
      throw new TypeError(`${key}는 boolean이어야 합니다`);
    }
    if (key === 'maxCacheSize' && !isPositiveInteger(value)) {
      throw new TypeError('maxCacheSize는 양의 안전한 정수여야 합니다');
    }

    config[key] = value;
    const canonicalConfig = canonicalizeCacheAliases(config, isCacheAlias ? value as boolean : undefined);
    fs.writeJsonSync(this.configPath, canonicalConfig, { spaces: 2 });
  }

  /**
   * 설정을 동기적으로 초기화합니다 (CLI용).
   */
  reset(): void {
    fs.ensureDirSync(this.configDir);
    fs.writeJsonSync(this.configPath, canonicalizeCacheAliases({ ...DEFAULT_CONFIG }), { spaces: 2 });
  }

  /**
   * 문자열을 암호화합니다.
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      ENCRYPTION_KEY,
      iv
    );
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * 암호화된 문자열을 복호화합니다.
   */
  private decrypt(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        return encryptedText; // 암호화되지 않은 값은 그대로 반환
      }
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      // 잘못된 키도 CBC 패딩 검사를 통과할 수 있으므로 UTF-8 유효성까지 확인한다.
      // 비밀번호에 포함된 선행 BOM은 제거하지 않는다.
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      
      // 새로운 머신별 키로 복호화 시도
      try {
        const decipher = crypto.createDecipheriv(
          'aes-256-cbc',
          ENCRYPTION_KEY,
          iv
        );
        return decoder.decode(Buffer.concat([decipher.update(encrypted, 'hex'), decipher.final()]));
      } catch {
        // 새 키로 실패 시 레거시 키로 복호화 시도 (마이그레이션)
        const legacyDecipher = crypto.createDecipheriv(
          'aes-256-cbc',
          Buffer.from(LEGACY_ENCRYPTION_KEY),
          iv
        );
        const decrypted = decoder.decode(Buffer.concat([legacyDecipher.update(encrypted, 'hex'), legacyDecipher.final()]));
        this.needsEncryptionMigration = true;
        console.info('[config] 레거시 키로 복호화 성공 - 마이그레이션을 수행합니다.');
        return decrypted;
      }
    } catch {
      return encryptedText; // 복호화 실패 시 원본 반환
    }
  }
}

// 싱글톤 인스턴스
let configManagerInstance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}
