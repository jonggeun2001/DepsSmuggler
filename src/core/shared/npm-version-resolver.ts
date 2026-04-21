/**
 * npm 버전 리졸버
 *
 * 버전 스펙 해결 및 패키지 정보 조회 담당
 */

import * as semver from 'semver';
import { fetchPackument } from './npm-cache';
import { NpmPackument, NpmPackageVersion } from './npm-types';
import { NPM_CONSTANTS } from '../constants/npm';

// 로거 타입 (프로젝트 공통 로거 사용)
const logger = {
  warn: (msg: string, data?: unknown) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data || ''),
};

/**
 * npm 버전 리졸버
 *
 * 책임:
 * - 버전 스펙에서 실제 버전 해결
 * - packument 조회 (캐싱)
 * - 패키지 버전 목록 조회
 * - 패키지 정보 조회
 */
export class NpmVersionResolver {
  private readonly registryUrl: string;

  /** 버전 해결 캐시 (name@spec -> version) */
  private resolvedCache: Map<string, string> = new Map();

  constructor(registryUrl: string = NPM_CONSTANTS.DEFAULT_REGISTRY_URL) {
    this.registryUrl = registryUrl;
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    this.resolvedCache.clear();
  }

  /**
   * packument 조회 (캐싱)
   */
  async fetchPackument(name: string): Promise<NpmPackument> {
    return fetchPackument(name, { registryUrl: this.registryUrl });
  }

  /**
   * 버전 스펙에서 실제 버전 해결
   *
   * @param spec 버전 스펙 (예: ^1.0.0, latest, 1.2.3)
   * @param packument 패키지 정보
   * @returns 해결된 버전 또는 null
   */
  resolveVersion(spec: string, packument: NpmPackument): string | null {
    const cacheKey = `${packument.name}@${spec}`;
    const cached = this.resolvedCache.get(cacheKey);
    if (cached) return cached;

    let resolved: string | null = null;

    // dist-tag (latest, next 등)
    if (packument['dist-tags'][spec]) {
      resolved = packument['dist-tags'][spec];
    }
    // 정확한 버전
    else if (packument.versions[spec]) {
      resolved = spec;
    }
    // semver 범위
    else {
      resolved = this.resolveFromSemverRange(spec, packument);
    }

    if (resolved) {
      this.resolvedCache.set(cacheKey, resolved);
    }

    return resolved;
  }

  /**
   * semver 범위에서 버전 해결
   */
  private resolveFromSemverRange(spec: string, packument: NpmPackument): string | null {
    // prerelease 제외하고 최신순 정렬
    const versions = Object.keys(packument.versions)
      .filter((v) => !semver.prerelease(v))
      .sort((a, b) => semver.rcompare(a, b));

    for (const v of versions) {
      if (semver.satisfies(v, spec)) {
        return v;
      }
    }

    // prerelease 포함해서 재검색
    const allVersions = Object.keys(packument.versions).sort((a, b) => semver.rcompare(a, b));
    for (const v of allVersions) {
      if (semver.satisfies(v, spec, { includePrerelease: true })) {
        return v;
      }
    }

    return null;
  }

  /**
   * 패키지 버전 목록 조회
   *
   * @param packageName 패키지 이름
   * @returns 버전 목록 (최신순, prerelease 제외)
   */
  async getVersions(packageName: string): Promise<string[]> {
    const packument = await this.fetchPackument(packageName);
    return Object.keys(packument.versions)
      .filter((v) => !semver.prerelease(v))
      .sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * 패키지 정보 조회
   *
   * @param name 패키지 이름
   * @param version 버전 스펙
   * @returns 패키지 버전 정보 또는 null
   */
  async getPackageInfo(name: string, version: string): Promise<NpmPackageVersion | null> {
    try {
      const packument = await this.fetchPackument(name);
      const resolvedVersion = this.resolveVersion(version, packument);
      if (!resolvedVersion) return null;
      return packument.versions[resolvedVersion] || null;
    } catch {
      return null;
    }
  }

  /**
   * package.json에서 의존성 파싱 및 버전 해결
   *
   * @param content package.json 문자열
   * @returns 해결된 의존성 목록
   */
  async parseFromPackageJson(content: string): Promise<{ name: string; version: string }[]> {
    try {
      const pkg = JSON.parse(content);
      const result: { name: string; version: string }[] = [];

      const dependencies = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
      };

      for (const [name, spec] of Object.entries(dependencies)) {
        if (typeof spec !== 'string') continue;

        try {
          const packument = await this.fetchPackument(name);
          const version = this.resolveVersion(spec, packument);
          if (version) {
            result.push({ name, version });
          }
        } catch (error) {
          logger.warn('패키지 버전 해결 실패', { name, spec, error });
        }
      }

      return result;
    } catch (error) {
      logger.error('package.json 파싱 실패', { error });
      throw error;
    }
  }
}
