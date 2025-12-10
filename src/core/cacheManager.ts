/**
 * 캐시 관리 시스템
 * 다운로드한 패키지를 로컬 캐시에 저장하여 재사용
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { PackageInfo } from '../types';
import logger from '../utils/logger';
import { sanitizeCacheKey } from './shared/filename-utils';

export interface CacheOptions {
  cacheDir?: string;
  maxSizeGB?: number;
  enabled?: boolean;
}

export interface CacheEntry {
  packageInfo: PackageInfo;
  filePath: string;
  checksum: string;
  size: number;
  cachedAt: string;
  lastAccessedAt: string;
}

export interface CacheManifest {
  version: string;
  entries: Map<string, CacheEntry>;
  totalSize: number;
  lastUpdated: string;
}

interface CacheManifestJson {
  version: string;
  entries: Array<[string, CacheEntry]>;
  totalSize: number;
  lastUpdated: string;
}

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.depssmuggler', 'cache');
const DEFAULT_MAX_SIZE_GB = 10;
const MANIFEST_FILE = 'cache-manifest.json';
const CACHE_VERSION = '1.0';

/**
 * 캐시 관리자 클래스
 */
export class CacheManager {
  private cacheDir: string;
  private maxSizeBytes: number;
  private enabled: boolean;
  private manifest: CacheManifest | null = null;

  constructor(options: CacheOptions = {}) {
    this.cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
    this.maxSizeBytes = (options.maxSizeGB || DEFAULT_MAX_SIZE_GB) * 1024 * 1024 * 1024;
    this.enabled = options.enabled !== false;
  }

  /**
   * 캐시 초기화
   */
  async initialize(): Promise<void> {
    if (!this.enabled) return;

    await fs.ensureDir(this.cacheDir);
    await this.loadManifest();
  }

  /**
   * 캐시된 파일 조회
   * @param packageInfo 패키지 정보
   * @returns 캐시된 파일 경로 또는 null
   */
  async getCachedFile(packageInfo: PackageInfo): Promise<string | null> {
    if (!this.enabled) return null;

    await this.ensureManifest();

    const cacheKey = this.generateCacheKey(packageInfo);
    const entry = this.manifest!.entries.get(cacheKey);

    if (!entry) {
      return null;
    }

    // 파일 존재 확인
    if (!(await fs.pathExists(entry.filePath))) {
      // 캐시 엔트리 제거
      this.manifest!.entries.delete(cacheKey);
      await this.saveManifest();
      return null;
    }

    // 체크섬 검증
    const isValid = await this.verifyChecksum(entry.filePath, entry.checksum);
    if (!isValid) {
      logger.warn('캐시 파일 체크섬 불일치, 캐시에서 제거', { cacheKey });
      await this.removeFromCache(cacheKey);
      return null;
    }

    // 마지막 접근 시간 업데이트 (LRU)
    entry.lastAccessedAt = new Date().toISOString();
    await this.saveManifest();

    logger.info('캐시 히트', {
      name: packageInfo.name,
      version: packageInfo.version,
      filePath: entry.filePath,
    });

    return entry.filePath;
  }

  /**
   * 캐시에 파일 추가
   * @param packageInfo 패키지 정보
   * @param filePath 파일 경로
   */
  async addToCache(packageInfo: PackageInfo, filePath: string): Promise<void> {
    if (!this.enabled) return;

    await this.ensureManifest();

    const cacheKey = this.generateCacheKey(packageInfo);

    // 파일 크기 확인
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;

    // 캐시 크기 확인 및 정리 (LRU)
    await this.ensureCacheSpace(fileSize);

    // 캐시 디렉토리 생성
    const cacheEntryDir = path.join(this.cacheDir, cacheKey);
    await fs.ensureDir(cacheEntryDir);

    // 파일 복사
    const cachedFilePath = path.join(cacheEntryDir, path.basename(filePath));
    await fs.copy(filePath, cachedFilePath);

    // 체크섬 계산
    const checksum = await this.calculateChecksum(cachedFilePath);

    // 엔트리 추가
    const entry: CacheEntry = {
      packageInfo,
      filePath: cachedFilePath,
      checksum,
      size: fileSize,
      cachedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };

    this.manifest!.entries.set(cacheKey, entry);
    this.manifest!.totalSize += fileSize;
    await this.saveManifest();

    logger.info('캐시에 추가', {
      name: packageInfo.name,
      version: packageInfo.version,
      size: fileSize,
      cacheKey,
    });
  }

  /**
   * 캐시에서 특정 항목 제거
   */
  private async removeFromCache(cacheKey: string): Promise<void> {
    const entry = this.manifest!.entries.get(cacheKey);
    if (!entry) return;

    // 파일 삭제
    const cacheEntryDir = path.dirname(entry.filePath);
    try {
      await fs.remove(cacheEntryDir);
    } catch (err) {
      logger.warn('캐시 디렉토리 삭제 실패', { cacheKey, error: err });
    }

    // 엔트리 제거
    this.manifest!.totalSize -= entry.size;
    this.manifest!.entries.delete(cacheKey);
    await this.saveManifest();
  }

  /**
   * 전체 캐시 삭제
   */
  async clearCache(): Promise<void> {
    await fs.emptyDir(this.cacheDir);

    this.manifest = {
      version: CACHE_VERSION,
      entries: new Map(),
      totalSize: 0,
      lastUpdated: new Date().toISOString(),
    };
    await this.saveManifest();

    logger.info('캐시 전체 삭제 완료');
  }

  /**
   * 캐시 크기 조회
   */
  async getCacheSize(): Promise<number> {
    await this.ensureManifest();
    return this.manifest!.totalSize;
  }

  /**
   * 캐시 항목 수 조회
   */
  async getCacheCount(): Promise<number> {
    await this.ensureManifest();
    return this.manifest!.entries.size;
  }

  /**
   * 캐시 목록 조회
   */
  async getCacheEntries(): Promise<CacheEntry[]> {
    await this.ensureManifest();
    return Array.from(this.manifest!.entries.values());
  }

  /**
   * 캐시 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 캐시 활성화 여부 조회
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 캐시 공간 확보 (LRU 정책)
   */
  private async ensureCacheSpace(requiredSize: number): Promise<void> {
    if (!this.manifest) return;

    const targetSize = this.maxSizeBytes - requiredSize;

    if (this.manifest.totalSize <= targetSize) {
      return;
    }

    // LRU: 마지막 접근 시간 기준으로 정렬
    const entries = Array.from(this.manifest.entries.entries())
      .sort((a, b) => {
        const timeA = new Date(a[1].lastAccessedAt).getTime();
        const timeB = new Date(b[1].lastAccessedAt).getTime();
        return timeA - timeB; // 오래된 것부터
      });

    // 공간 확보될 때까지 오래된 캐시 삭제
    for (const [key] of entries) {
      if (this.manifest.totalSize <= targetSize) {
        break;
      }

      logger.info('LRU 정책에 의해 캐시 삭제', { cacheKey: key });
      await this.removeFromCache(key);
    }
  }

  /**
   * 캐시 키 생성
   */
  private generateCacheKey(packageInfo: PackageInfo): string {
    const keyParts = [
      packageInfo.type,
      packageInfo.name,
      packageInfo.version,
      packageInfo.arch || 'noarch',
    ];

    const hash = crypto
      .createHash('sha256')
      .update(keyParts.join('-'))
      .digest('hex')
      .slice(0, 16);

    return `${packageInfo.type}-${this.sanitizeFileName(packageInfo.name)}-${hash}`;
  }

  /**
   * 파일명에 안전한 문자로 변환
   */
  private sanitizeFileName(name: string): string {
    return sanitizeCacheKey(name, 50);
  }

  /**
   * 체크섬 계산
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 체크섬 검증
   */
  private async verifyChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    try {
      const actualChecksum = await this.calculateChecksum(filePath);
      return actualChecksum === expectedChecksum;
    } catch {
      return false;
    }
  }

  /**
   * 매니페스트 로드
   */
  private async loadManifest(): Promise<void> {
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);

    if (await fs.pathExists(manifestPath)) {
      try {
        const data: CacheManifestJson = await fs.readJson(manifestPath);
        this.manifest = {
          version: data.version,
          entries: new Map(data.entries),
          totalSize: data.totalSize,
          lastUpdated: data.lastUpdated,
        };
      } catch (err) {
        logger.warn('캐시 매니페스트 로드 실패, 새로 생성', { error: err });
        this.manifest = this.createEmptyManifest();
      }
    } else {
      this.manifest = this.createEmptyManifest();
    }
  }

  /**
   * 매니페스트 저장
   */
  private async saveManifest(): Promise<void> {
    if (!this.manifest) return;

    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    this.manifest.lastUpdated = new Date().toISOString();

    const data: CacheManifestJson = {
      version: this.manifest.version,
      entries: Array.from(this.manifest.entries.entries()),
      totalSize: this.manifest.totalSize,
      lastUpdated: this.manifest.lastUpdated,
    };

    await fs.writeJson(manifestPath, data, { spaces: 2 });
  }

  /**
   * 빈 매니페스트 생성
   */
  private createEmptyManifest(): CacheManifest {
    return {
      version: CACHE_VERSION,
      entries: new Map(),
      totalSize: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 매니페스트 확인 및 로드
   */
  private async ensureManifest(): Promise<void> {
    if (!this.manifest) {
      await this.loadManifest();
    }
  }

  /**
   * 캐시 통계 조회
   */
  async getStats(): Promise<{
    enabled: boolean;
    cacheDir: string;
    totalSize: number;
    maxSize: number;
    entryCount: number;
    usagePercent: number;
  }> {
    await this.ensureManifest();

    return {
      enabled: this.enabled,
      cacheDir: this.cacheDir,
      totalSize: this.manifest!.totalSize,
      maxSize: this.maxSizeBytes,
      entryCount: this.manifest!.entries.size,
      usagePercent: (this.manifest!.totalSize / this.maxSizeBytes) * 100,
    };
  }
}

// 싱글톤 인스턴스
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(options?: CacheOptions): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager(options);
  }
  return cacheManagerInstance;
}

export async function initializeCacheManager(options?: CacheOptions): Promise<CacheManager> {
  const manager = getCacheManager(options);
  await manager.initialize();
  return manager;
}
