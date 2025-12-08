/**
 * OS Package Metadata Cache Manager
 * 메타데이터 캐싱으로 반복 요청 최소화
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import type { CacheMode, Repository, OSArchitecture } from '../types';

/**
 * 캐시 설정
 */
export interface OSCacheConfig {
  /** 캐시 타입: session(메모리만), persistent(디스크), none(비활성) */
  type: CacheMode;
  /** TTL (초 단위, 기본 3600초 = 1시간) */
  ttl: number;
  /** 최대 캐시 크기 (바이트, 기본 500MB) */
  maxSize: number;
  /** 디스크 캐시 디렉토리 (persistent일 때) */
  directory?: string;
}

/**
 * 캐시 엔트리
 */
interface CacheEntry {
  /** 저장된 데이터 */
  data: unknown;
  /** 저장 시간 (Unix timestamp) */
  timestamp: number;
  /** 데이터 크기 (bytes) */
  size: number;
  /** 마지막 접근 시간 (LRU용) */
  lastAccess: number;
}

/**
 * 캐시 통계
 */
export interface CacheStats {
  /** 전체 캐시 크기 (bytes) */
  totalSize: number;
  /** 엔트리 수 */
  entryCount: number;
  /** 히트 수 */
  hits: number;
  /** 미스 수 */
  misses: number;
  /** 히트율 */
  hitRate: number;
}

/**
 * 기본 캐시 설정
 */
const DEFAULT_CONFIG: OSCacheConfig = {
  type: 'session',
  ttl: 3600, // 1시간
  maxSize: 500 * 1024 * 1024, // 500MB
  directory: path.join(homedir(), '.depssmuggler', 'cache', 'os-packages'),
};

/**
 * OS 캐시 관리자
 */
export class OSCacheManager {
  private config: OSCacheConfig;
  private memoryCache: Map<string, CacheEntry> = new Map();
  private stats = { hits: 0, misses: 0 };

  constructor(config: Partial<OSCacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // persistent 모드일 때 디렉토리 생성
    if (this.config.type === 'persistent' && this.config.directory) {
      this.ensureDirectory(this.config.directory);
      this.loadFromDisk();
    }
  }

  /**
   * 캐시 키 생성
   */
  static createKey(
    type: 'yum' | 'apt' | 'apk',
    repo: Repository,
    architecture: OSArchitecture,
    dataType: 'repomd' | 'primary' | 'packages' | 'apkindex' | 'release'
  ): string {
    const repoUrl = repo.baseUrl.replace(/https?:\/\//, '').replace(/\//g, '_');
    return `${type}:${repoUrl}:${architecture}:${dataType}`;
  }

  /**
   * 캐시에서 데이터 가져오기
   */
  async get<T>(key: string): Promise<T | null> {
    if (this.config.type === 'none') {
      return null;
    }

    // 메모리 캐시 확인
    const entry = this.memoryCache.get(key);

    if (entry) {
      if (this.isExpired(entry)) {
        this.memoryCache.delete(key);
        this.stats.misses++;
        return null;
      }

      // LRU: 접근 시간 갱신
      entry.lastAccess = Date.now();
      this.stats.hits++;
      return entry.data as T;
    }

    // persistent 모드일 때 디스크에서 로드
    if (this.config.type === 'persistent') {
      const diskEntry = await this.readFromDisk(key);
      if (diskEntry && !this.isExpired(diskEntry)) {
        // 메모리 캐시에 추가
        this.memoryCache.set(key, diskEntry);
        this.stats.hits++;
        return diskEntry.data as T;
      }
    }

    this.stats.misses++;
    return null;
  }

  /**
   * 캐시에 데이터 저장
   */
  async set<T>(key: string, data: T): Promise<void> {
    if (this.config.type === 'none') {
      return;
    }

    const size = this.estimateSize(data);
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      size,
      lastAccess: Date.now(),
    };

    // 용량 확인 및 정리
    await this.enforceMaxSize(size);

    // 메모리 캐시에 저장
    this.memoryCache.set(key, entry);

    // persistent 모드일 때 디스크에도 저장
    if (this.config.type === 'persistent') {
      await this.writeToDisk(key, entry);
    }
  }

  /**
   * 캐시 무효화
   */
  async invalidate(pattern?: string): Promise<void> {
    if (!pattern) {
      // 전체 캐시 삭제
      this.memoryCache.clear();

      if (this.config.type === 'persistent' && this.config.directory) {
        await this.clearDiskCache();
      }
      return;
    }

    // 패턴 매칭으로 삭제
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    const keysToDelete: string[] = [];

    this.memoryCache.forEach((_, key) => {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    });

    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
      if (this.config.type === 'persistent') {
        await this.deleteFromDisk(key);
      }
    }
  }

  /**
   * 캐시 통계 반환
   */
  getStats(): CacheStats {
    let totalSize = 0;
    this.memoryCache.forEach((entry) => {
      totalSize += entry.size;
    });

    const totalRequests = this.stats.hits + this.stats.misses;

    return {
      totalSize,
      entryCount: this.memoryCache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: totalRequests > 0 ? this.stats.hits / totalRequests : 0,
    };
  }

  /**
   * 만료 여부 확인
   */
  private isExpired(entry: CacheEntry): boolean {
    const age = (Date.now() - entry.timestamp) / 1000;
    return age > this.config.ttl;
  }

  /**
   * 데이터 크기 추정
   */
  private estimateSize(data: unknown): number {
    try {
      return JSON.stringify(data).length * 2; // UTF-16 고려
    } catch {
      return 1024; // 기본값
    }
  }

  /**
   * 최대 크기 제한 적용 (LRU 정책)
   */
  private async enforceMaxSize(newEntrySize: number): Promise<void> {
    let currentSize = 0;
    this.memoryCache.forEach((entry) => {
      currentSize += entry.size;
    });

    if (currentSize + newEntrySize <= this.config.maxSize) {
      return;
    }

    // LRU: 오래된 항목부터 삭제
    const entries = Array.from(this.memoryCache.entries()).sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess
    );

    for (const [key, entry] of entries) {
      if (currentSize + newEntrySize <= this.config.maxSize) {
        break;
      }

      this.memoryCache.delete(key);
      currentSize -= entry.size;

      if (this.config.type === 'persistent') {
        await this.deleteFromDisk(key);
      }
    }
  }

  /**
   * 디렉토리 생성
   */
  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 캐시 키를 파일명으로 변환
   */
  private keyToFilename(key: string): string {
    // 안전한 파일명으로 변환
    return key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  }

  /**
   * 디스크에서 읽기
   */
  private async readFromDisk(key: string): Promise<CacheEntry | null> {
    if (!this.config.directory) return null;

    const filePath = path.join(this.config.directory, this.keyToFilename(key));

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as CacheEntry;
    } catch {
      return null;
    }
  }

  /**
   * 디스크에 쓰기
   */
  private async writeToDisk(key: string, entry: CacheEntry): Promise<void> {
    if (!this.config.directory) return;

    const filePath = path.join(this.config.directory, this.keyToFilename(key));

    try {
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    } catch (error) {
      console.warn(`Failed to write cache to disk: ${(error as Error).message}`);
    }
  }

  /**
   * 디스크에서 삭제
   */
  private async deleteFromDisk(key: string): Promise<void> {
    if (!this.config.directory) return;

    const filePath = path.join(this.config.directory, this.keyToFilename(key));

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.warn(`Failed to delete cache from disk: ${(error as Error).message}`);
    }
  }

  /**
   * 디스크 캐시 전체 삭제
   */
  private async clearDiskCache(): Promise<void> {
    if (!this.config.directory) return;

    try {
      const files = fs.readdirSync(this.config.directory);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.config.directory, file));
        }
      }
    } catch (error) {
      console.warn(`Failed to clear disk cache: ${(error as Error).message}`);
    }
  }

  /**
   * 디스크에서 캐시 로드
   */
  private loadFromDisk(): void {
    if (!this.config.directory) return;

    try {
      if (!fs.existsSync(this.config.directory)) {
        return;
      }

      const files = fs.readdirSync(this.config.directory);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(this.config.directory, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const entry = JSON.parse(content) as CacheEntry;

          // 만료된 항목은 건너뛰기
          if (this.isExpired(entry)) {
            fs.unlinkSync(filePath);
            continue;
          }

          // 키 복원
          const key = file.replace('.json', '').replace(/_/g, ':');
          this.memoryCache.set(key, entry);
        } catch {
          // 파싱 실패한 파일 삭제
          fs.unlinkSync(filePath);
        }
      }
    } catch (error) {
      console.warn(`Failed to load cache from disk: ${(error as Error).message}`);
    }
  }

  /**
   * 캐시 설정 업데이트
   */
  updateConfig(config: Partial<OSCacheConfig>): void {
    const oldType = this.config.type;
    this.config = { ...this.config, ...config };

    // 타입이 변경되었을 때 처리
    if (oldType !== this.config.type) {
      if (this.config.type === 'none') {
        // 캐시 비활성화 - 모두 삭제
        this.memoryCache.clear();
      } else if (this.config.type === 'persistent' && this.config.directory) {
        // persistent로 전환 - 디렉토리 생성 및 현재 메모리 캐시 저장
        this.ensureDirectory(this.config.directory);
        this.memoryCache.forEach(async (entry, key) => {
          await this.writeToDisk(key, entry);
        });
      }
    }
  }
}
