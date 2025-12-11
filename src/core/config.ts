import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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

// CLI용 설정 인터페이스
export interface CLIConfig {
  concurrentDownloads: number;
  cacheEnabled: boolean;
  cachePath: string;
  maxCacheSize: number;
  logLevel: string;
}

// 암호화 키 (실제 운영에서는 더 안전한 방법 사용 권장)
const ENCRYPTION_KEY = 'depssmuggler-secret-key-32bytes!';
const ENCRYPTION_IV_LENGTH = 16;

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private logsDir: string;
  private cacheDir: string;

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
    await this.ensureDirectories();

    try {
      if (await fs.pathExists(this.configPath)) {
        const rawConfig = await fs.readJson(this.configPath);
        // 저장된 설정과 기본값을 병합 (새로운 설정 항목 대응)
        const config: Config = { ...DEFAULT_CONFIG, ...rawConfig };

        // SMTP 비밀번호 복호화
        if (config.smtpPassword) {
          config.smtpPassword = this.decrypt(config.smtpPassword);
        }

        return config;
      }
    } catch (error) {
      console.error('설정 파일 로드 실패, 기본값 사용:', error);
    }

    // 기본 설정 생성 및 저장
    await this.saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  /**
   * 설정을 저장합니다.
   */
  async saveConfig(config: Config): Promise<void> {
    await this.ensureDirectories();

    // 저장용 설정 복사 (원본 수정 방지)
    const configToSave = { ...config };

    // SMTP 비밀번호 암호화
    if (configToSave.smtpPassword) {
      configToSave.smtpPassword = this.encrypt(configToSave.smtpPassword);
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
        const rawConfig = fs.readJsonSync(this.configPath);
        return {
          concurrentDownloads: rawConfig.concurrentDownloads || DEFAULT_CONFIG.concurrentDownloads,
          // settings.json은 enableCache 사용, 기존 cachingEnabled도 호환
          cacheEnabled: rawConfig.enableCache ?? rawConfig.cachingEnabled ?? DEFAULT_CONFIG.cachingEnabled,
          cachePath: rawConfig.cachePath || this.cacheDir,
          maxCacheSize: 10 * 1024 * 1024 * 1024, // 10GB
          logLevel: rawConfig.logLevel || 'info',
        };
      }
    } catch {
      // 에러 무시
    }
    return {
      concurrentDownloads: DEFAULT_CONFIG.concurrentDownloads,
      cacheEnabled: DEFAULT_CONFIG.cachingEnabled,
      cachePath: this.cacheDir,
      maxCacheSize: 10 * 1024 * 1024 * 1024,
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
      config = fs.readJsonSync(this.configPath);
    }

    config[key] = value;
    fs.writeJsonSync(this.configPath, config, { spaces: 2 });
  }

  /**
   * 설정을 동기적으로 초기화합니다 (CLI용).
   */
  reset(): void {
    fs.ensureDirSync(this.configDir);
    fs.writeJsonSync(this.configPath, DEFAULT_CONFIG, { spaces: 2 });
  }

  /**
   * 문자열을 암호화합니다.
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(ENCRYPTION_KEY),
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
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        Buffer.from(ENCRYPTION_KEY),
        iv
      );
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
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
