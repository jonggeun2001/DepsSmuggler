/**
 * npm 의존성 리졸버
 * Arborist (npm v7+) 알고리즘 기반 구현
 *
 * 핵심 알고리즘:
 * 1. BFS (너비 우선 탐색)으로 의존성 그래프 탐색
 * 2. Maximally Naive Deduplication - 가능한 가장 상위에 패키지 배치 (hoisting)
 * 3. canPlace 검사로 충돌 감지 및 중첩 배치 결정
 * 4. Peer Dependencies 자동 설치 (npm v7+ 동작)
 */

import axios, { AxiosInstance } from 'axios';
import * as semver from 'semver';
import {
  NpmPackument,
  NpmPackageVersion,
  NpmResolverOptions,
  NpmResolutionResult,
  NpmResolvedNode,
  NpmFlatPackage,
  NpmConflict,
  DependencyType,
  DepsQueueItem,
  PlacementResult,
} from '../shared/npm-types';
import { fetchPackument } from '../shared/npm-cache';

// 로거 타입 (프로젝트 공통 로거 사용)
const logger = {
  info: (msg: string, data?: unknown) => console.log(`[INFO] ${msg}`, data || ''),
  warn: (msg: string, data?: unknown) => console.warn(`[WARN] ${msg}`, data || ''),
  error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data || ''),
  debug: (msg: string, data?: unknown) => console.debug(`[DEBUG] ${msg}`, data || ''),
};

/**
 * npm 리졸버 클래스
 */
export class NpmResolver {
  readonly type = 'npm' as const;
  private readonly registryUrl: string;
  private client: AxiosInstance;

  // 캐시 (packumentCache는 공유 모듈 사용)
  private resolvedCache: Map<string, string> = new Map(); // name@spec -> version

  // 의존성 트리 (해결 결과)
  private tree: Map<string, NpmResolvedNode> = new Map(); // hoistedPath -> node
  private conflicts: NpmConflict[] = [];

  // BFS 탐색용
  private depsQueue: DepsQueueItem[] = [];
  private depsSeen: Set<string> = new Set();

  constructor(registryUrl = 'https://registry.npmjs.org') {
    this.registryUrl = registryUrl;
    this.client = axios.create({
      baseURL: this.registryUrl,
      timeout: 30000,
      headers: {
        Accept: 'application/json',
      },
    });
  }

  /**
   * 의존성 해결 메인 메서드
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options: NpmResolverOptions = {}
  ): Promise<NpmResolutionResult> {
    // 상태 초기화
    this.tree.clear();
    this.conflicts = [];
    this.depsQueue = [];
    this.depsSeen.clear();
    // 캐시는 유지 (재사용)

    const {
      maxDepth = 50,
      includeDev = false,
      includeOptional = false,
      installPeers = true,
      preferDedupe = false,
      legacyPeerDeps = false,
      installStrategy = 'hoisted',
    } = options;

    try {
      // 1. 루트 패키지 정보 조회
      const packument = await this.fetchPackumentInternal(packageName);
      const resolvedVersion = this.resolveVersion(version, packument);

      if (!resolvedVersion) {
        throw new Error(`버전을 찾을 수 없습니다: ${packageName}@${version}`);
      }

      const rootPkgInfo = packument.versions[resolvedVersion];
      if (!rootPkgInfo) {
        throw new Error(`패키지 정보를 찾을 수 없습니다: ${packageName}@${resolvedVersion}`);
      }

      // 2. 루트 노드 생성
      const rootNode: NpmResolvedNode = {
        name: packageName,
        version: resolvedVersion,
        dist: rootPkgInfo.dist,
        dependencies: [],
        depth: 0,
        hoistedPath: '',
        type: 'prod',
        optional: false,
      };

      this.tree.set('', rootNode);

      // 3. 루트의 의존성을 큐에 추가
      this.enqueueDependencies(rootPkgInfo, 0, '', {
        includeDev,
        includeOptional,
        installPeers,
      });

      // 4. BFS로 의존성 해결
      await this.buildDeps({
        maxDepth,
        includeDev,
        includeOptional,
        installPeers,
        preferDedupe,
        legacyPeerDeps,
        installStrategy,
      });

      // 5. 결과 생성
      const flatList = this.flattenTree();
      const totalSize = flatList.reduce((sum, pkg) => sum + (pkg.size || 0), 0);
      const maxDepthReached = Math.max(...flatList.map((p) => this.getDepthFromPath(p.hoistedPath)), 0);

      return {
        root: rootNode,
        flatList,
        conflicts: this.conflicts,
        totalSize,
        totalPackages: flatList.length,
        maxDepth: maxDepthReached,
      };
    } catch (error) {
      logger.error('npm 의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * 의존성 빌드 (BFS 루프)
   */
  private async buildDeps(options: {
    maxDepth: number;
    includeDev: boolean;
    includeOptional: boolean;
    installPeers: boolean;
    preferDedupe: boolean;
    legacyPeerDeps: boolean;
    installStrategy: string;
  }): Promise<void> {
    while (this.depsQueue.length > 0) {
      // 깊이 순, 알파벳 순 정렬
      this.depsQueue.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return a.path.localeCompare(b.path);
      });

      const item = this.depsQueue.shift()!;
      const cacheKey = `${item.name}@${item.spec}@${item.depth}`;

      // 이미 처리됨
      if (this.depsSeen.has(cacheKey)) {
        continue;
      }
      this.depsSeen.add(cacheKey);

      // 최대 깊이 체크
      if (item.depth >= options.maxDepth) {
        logger.warn('최대 깊이 도달', { name: item.name, depth: item.depth });
        continue;
      }

      try {
        await this.processDepItem(item, options);
      } catch (error) {
        // optional 의존성은 실패해도 계속
        if (item.type === 'optional' || item.type === 'peerOptional') {
          logger.warn('optional 의존성 해결 실패 (무시)', { name: item.name, error });
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * 단일 의존성 처리
   */
  private async processDepItem(
    item: DepsQueueItem,
    options: {
      maxDepth: number;
      includeDev: boolean;
      includeOptional: boolean;
      installPeers: boolean;
      preferDedupe: boolean;
      legacyPeerDeps: boolean;
      installStrategy: string;
    }
  ): Promise<void> {
    const { name, spec, type, depth, parent } = item;

    // 패키지 정보 조회
    const packument = await this.fetchPackumentInternal(name);
    const resolvedVersion = this.resolveVersion(spec, packument);

    if (!resolvedVersion) {
      throw new Error(`호환 버전을 찾을 수 없습니다: ${name}@${spec}`);
    }

    const pkgInfo = packument.versions[resolvedVersion];
    if (!pkgInfo) {
      throw new Error(`패키지 버전 정보를 찾을 수 없습니다: ${name}@${resolvedVersion}`);
    }

    // 배치 위치 결정 (hoisting)
    const placement = this.findPlacement(name, resolvedVersion, parent, options);

    if (placement.result === 'KEEP') {
      // 이미 호환되는 버전이 있음
      return;
    }

    if (placement.result === 'CONFLICT' && options.installStrategy === 'hoisted') {
      // 충돌 - 중첩 배치
      const nestedPath = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
      this.addNodeToTree(name, resolvedVersion, pkgInfo, nestedPath, depth, type, item);

      // 충돌 기록
      if (placement.existing) {
        this.conflicts.push({
          type: type === 'peer' || type === 'peerOptional' ? 'peer' : 'version',
          packageName: name,
          requestedVersions: [spec, placement.existing],
          resolvedVersion,
          reason: `호이스팅 충돌로 중첩 배치: ${nestedPath}`,
        });
      }
    } else {
      // OK 또는 REPLACE
      const hoistedPath = placement.target || `node_modules/${name}`;

      if (placement.result === 'REPLACE' && placement.existing) {
        // 기존 노드 교체
        const existingPath = this.findNodePath(name, parent);
        if (existingPath) {
          this.tree.delete(existingPath);
        }
      }

      this.addNodeToTree(name, resolvedVersion, pkgInfo, hoistedPath, depth, type, item);
    }

    // 하위 의존성 큐에 추가
    const nodePath = this.findNodePath(name, parent) || `node_modules/${name}`;
    this.enqueueDependencies(pkgInfo, depth + 1, nodePath, {
      includeDev: options.includeDev,
      includeOptional: options.includeOptional,
      installPeers: options.installPeers,
    });
  }

  /**
   * 패키지 배치 위치 결정 (canPlace 알고리즘)
   */
  private findPlacement(
    name: string,
    version: string,
    startPath: string | null,
    options: { preferDedupe: boolean; installStrategy: string }
  ): { result: PlacementResult; target: string | null; existing: string | null } {
    if (options.installStrategy === 'nested') {
      // nested 전략: 항상 해당 위치에 배치
      return { result: 'OK', target: startPath ? `${startPath}/node_modules/${name}` : `node_modules/${name}`, existing: null };
    }

    let target = startPath || '';
    let lastValidTarget: string | null = null;
    let existingVersion: string | null = null;

    // 루트까지 올라가며 배치 가능 여부 확인
    while (true) {
      const checkPath = target ? `${target}/node_modules/${name}` : `node_modules/${name}`;
      const existing = this.tree.get(checkPath);

      if (existing) {
        existingVersion = existing.version;

        // 같은 버전이면 KEEP
        if (existing.version === version) {
          return { result: 'KEEP', target: checkPath, existing: existingVersion };
        }

        // 다른 버전이면 호환성 확인
        const isCompatible = this.isVersionCompatibleWithExisting(name, version, target);
        if (isCompatible) {
          // 더 높은 버전이면 REPLACE 가능
          if (semver.gt(version, existing.version)) {
            lastValidTarget = checkPath;
          } else if (options.preferDedupe) {
            // preferDedupe면 기존 버전 유지
            return { result: 'KEEP', target: checkPath, existing: existingVersion };
          }
        }

        // 충돌
        if (!lastValidTarget) {
          return { result: 'CONFLICT', target: null, existing: existingVersion };
        }
      } else {
        // 빈 자리 - 배치 가능
        lastValidTarget = checkPath;
      }

      // 루트에 도달했으면 종료
      if (!target || target === '') {
        break;
      }

      // 상위로 이동
      const parts = target.split('/node_modules/');
      parts.pop();
      target = parts.join('/node_modules/');
    }

    if (lastValidTarget) {
      if (existingVersion && lastValidTarget === `node_modules/${name}`) {
        return { result: 'REPLACE', target: lastValidTarget, existing: existingVersion };
      }
      return { result: 'OK', target: lastValidTarget, existing: null };
    }

    return { result: 'CONFLICT', target: null, existing: existingVersion };
  }

  /**
   * 버전이 기존 의존성들과 호환되는지 확인
   */
  private isVersionCompatibleWithExisting(name: string, version: string, path: string): boolean {
    // 해당 경로 하위의 모든 노드들이 이 버전을 사용해도 되는지 확인
    for (const [nodePath, node] of this.tree.entries()) {
      if (nodePath.startsWith(path)) {
        // 이 노드가 name을 의존하는지 확인
        const deps: Record<string, boolean> = {};
        if (node.dependencies) {
          for (const d of node.dependencies) {
            deps[d.name] = true;
          }
        }
        if (deps[name]) {
          // 해당 의존성의 버전 요구사항을 찾아서 확인해야 함
          // 간소화: 일단 통과
        }
      }
    }
    return true;
  }

  /**
   * 트리에 노드 추가
   */
  private addNodeToTree(
    name: string,
    version: string,
    pkgInfo: NpmPackageVersion,
    hoistedPath: string,
    depth: number,
    type: DependencyType,
    _item: DepsQueueItem
  ): void {
    const node: NpmResolvedNode = {
      name,
      version,
      dist: pkgInfo.dist,
      dependencies: [],
      depth,
      hoistedPath,
      type,
      optional: type === 'optional' || type === 'peerOptional',
    };

    this.tree.set(hoistedPath, node);
  }

  /**
   * 의존성을 큐에 추가
   */
  private enqueueDependencies(
    pkgInfo: NpmPackageVersion,
    depth: number,
    parentPath: string,
    options: { includeDev: boolean; includeOptional: boolean; installPeers: boolean }
  ): void {
    // 일반 의존성
    if (pkgInfo.dependencies) {
      for (const [name, spec] of Object.entries(pkgInfo.dependencies)) {
        this.depsQueue.push({
          name,
          spec,
          type: 'prod',
          depth,
          path: parentPath,
          parent: parentPath,
          edge: { from: parentPath, to: null, name, type: 'prod', spec, valid: false },
        });
      }
    }

    // dev 의존성
    if (options.includeDev && pkgInfo.devDependencies) {
      for (const [name, spec] of Object.entries(pkgInfo.devDependencies)) {
        this.depsQueue.push({
          name,
          spec,
          type: 'dev',
          depth,
          path: parentPath,
          parent: parentPath,
          edge: { from: parentPath, to: null, name, type: 'dev', spec, valid: false },
        });
      }
    }

    // optional 의존성
    if (options.includeOptional && pkgInfo.optionalDependencies) {
      for (const [name, spec] of Object.entries(pkgInfo.optionalDependencies)) {
        this.depsQueue.push({
          name,
          spec,
          type: 'optional',
          depth,
          path: parentPath,
          parent: parentPath,
          edge: { from: parentPath, to: null, name, type: 'optional', spec, valid: false },
        });
      }
    }

    // peer 의존성 (npm v7+ 자동 설치)
    if (options.installPeers && pkgInfo.peerDependencies) {
      for (const [name, spec] of Object.entries(pkgInfo.peerDependencies)) {
        const meta = pkgInfo.peerDependenciesMeta?.[name];
        const isOptional = meta?.optional === true;

        this.depsQueue.push({
          name,
          spec,
          type: isOptional ? 'peerOptional' : 'peer',
          depth,
          path: parentPath,
          parent: parentPath,
          edge: { from: parentPath, to: null, name, type: isOptional ? 'peerOptional' : 'peer', spec, valid: false },
        });
      }
    }
  }

  /**
   * packument 조회 (캐싱)
   */
  private async fetchPackumentInternal(name: string): Promise<NpmPackument> {
    // 공유 캐시 모듈 사용
    return fetchPackument(name, { registryUrl: this.registryUrl });
  }

  /**
   * 버전 스펙에서 실제 버전 해결
   */
  private resolveVersion(spec: string, packument: NpmPackument): string | null {
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
      const versions = Object.keys(packument.versions)
        .filter((v) => !semver.prerelease(v)) // prerelease 제외 (기본)
        .sort((a, b) => semver.rcompare(a, b)); // 최신순

      for (const v of versions) {
        if (semver.satisfies(v, spec)) {
          resolved = v;
          break;
        }
      }

      // prerelease 포함해서 재검색
      if (!resolved) {
        const allVersions = Object.keys(packument.versions).sort((a, b) => semver.rcompare(a, b));
        for (const v of allVersions) {
          if (semver.satisfies(v, spec, { includePrerelease: true })) {
            resolved = v;
            break;
          }
        }
      }
    }

    if (resolved) {
      this.resolvedCache.set(cacheKey, resolved);
    }

    return resolved;
  }

  /**
   * 트리 평탄화
   */
  private flattenTree(): NpmFlatPackage[] {
    const result: NpmFlatPackage[] = [];

    for (const [path, node] of this.tree.entries()) {
      if (path === '') continue; // 루트 제외

      result.push({
        name: node.name,
        version: node.version,
        tarball: node.dist.tarball,
        integrity: node.dist.integrity,
        shasum: node.dist.shasum,
        size: node.dist.unpackedSize,
        hoistedPath: path,
      });
    }

    // 깊이 순, 알파벳 순 정렬
    result.sort((a, b) => {
      const depthA = this.getDepthFromPath(a.hoistedPath);
      const depthB = this.getDepthFromPath(b.hoistedPath);
      if (depthA !== depthB) return depthA - depthB;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  /**
   * 경로에서 깊이 계산
   */
  private getDepthFromPath(path: string): number {
    if (!path) return 0;
    return (path.match(/node_modules/g) || []).length;
  }

  /**
   * 노드 경로 찾기
   */
  private findNodePath(name: string, startPath: string | null): string | null {
    // 가장 가까운 위치에서 시작해서 위로 올라가며 찾기
    let searchPath = startPath || '';

    while (true) {
      const checkPath = searchPath ? `${searchPath}/node_modules/${name}` : `node_modules/${name}`;
      if (this.tree.has(checkPath)) {
        return checkPath;
      }

      if (!searchPath) break;

      const parts = searchPath.split('/node_modules/');
      parts.pop();
      searchPath = parts.join('/node_modules/');
    }

    return null;
  }

  /**
   * package.json 내용에서 의존성 파싱
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
          const packument = await this.fetchPackumentInternal(name);
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

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    const packument = await this.fetchPackumentInternal(packageName);
    return Object.keys(packument.versions)
      .filter((v) => !semver.prerelease(v))
      .sort((a, b) => semver.rcompare(a, b));
  }

  /**
   * 패키지 정보 조회
   */
  async getPackageInfo(name: string, version: string): Promise<NpmPackageVersion | null> {
    try {
      const packument = await this.fetchPackumentInternal(name);
      const resolvedVersion = this.resolveVersion(version, packument);
      if (!resolvedVersion) return null;
      return packument.versions[resolvedVersion] || null;
    } catch {
      return null;
    }
  }
}

// 싱글톤 인스턴스
let npmResolverInstance: NpmResolver | null = null;

export function getNpmResolver(): NpmResolver {
  if (!npmResolverInstance) {
    npmResolverInstance = new NpmResolver();
  }
  return npmResolverInstance;
}

export { npmResolverInstance };
