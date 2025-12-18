/**
 * npm 의존성 리졸버
 * Arborist (npm v7+) 알고리즘 기반 구현
 *
 * 핵심 알고리즘:
 * 1. BFS (너비 우선 탐색)으로 의존성 그래프 탐색
 * 2. Maximally Naive Deduplication - 가능한 가장 상위에 패키지 배치 (hoisting)
 * 3. canPlace 검사로 충돌 감지 및 중첩 배치 결정
 * 4. Peer Dependencies 자동 설치 (npm v7+ 동작)
 *
 * 서비스 구조:
 * - NpmVersionResolver: 버전 해결 및 패키지 정보 조회
 * - NpmTreeManager: 의존성 트리 관리 및 호이스팅
 */

import {
  NpmPackageVersion,
  NpmResolverOptions,
  NpmResolutionResult,
  NpmResolvedNode,
  DependencyType,
  DepsQueueItem,
} from '../shared/npm-types';
import { NpmTreeManager, TreeManagerOptions } from './npm-tree-manager';
import { NpmVersionResolver } from './npm-version-resolver';
import { NPM_CONSTANTS } from '../constants/npm';
import logger from '../../utils/logger';

/**
 * 플랫폼 매핑 (설정값 → npm 값)
 */
const OS_MAPPING: Record<string, string> = {
  linux: 'linux',
  macos: 'darwin',
  windows: 'win32',
};

const CPU_MAPPING: Record<string, string> = {
  x86_64: 'x64',
  amd64: 'x64',
  aarch64: 'arm64',
  arm64: 'arm64',
};

/**
 * 네이티브 바이너리 패키지명 패턴
 * 패키지명에서 플랫폼 정보를 추출하기 위한 정규식 패턴
 */
const PLATFORM_PACKAGE_PATTERNS = [
  // @esbuild/linux-x64, @esbuild/darwin-arm64
  /^@[\w-]+\/(linux|darwin|win32)-(x64|arm64|ia32)$/,
  // @img/sharp-linux-x64, @img/sharp-darwin-arm64
  /^@[\w-]+\/[\w-]+-((linux|darwin|win32)-(x64|arm64|ia32))$/,
  // @swc/core-linux-x64-gnu, @swc/core-darwin-arm64
  /^@[\w-]+\/[\w-]+-((linux|darwin|win32)-(x64|arm64|ia32)(-gnu|-musl)?)$/,
  // lightningcss-linux-x64-gnu, rollup-linux-x64-gnu
  /^[\w-]+-((linux|darwin|win32)-(x64|arm64|ia32)(-gnu|-musl)?)$/,
  // @rollup/rollup-linux-x64-gnu
  /^@rollup\/rollup-((linux|darwin|win32)-(x64|arm64|ia32)(-gnu|-musl)?)$/,
];

/**
 * BFS 빌드 옵션
 */
interface BuildDepsOptions {
  maxDepth: number;
  includeDev: boolean;
  includeOptional: boolean;
  installPeers: boolean;
  preferDedupe: boolean;
  legacyPeerDeps: boolean;
  installStrategy: string;
}

/**
 * npm 리졸버 클래스
 *
 * BFS 기반 의존성 해결의 핵심 로직 담당
 * 트리 관리와 버전 해결은 별도 서비스에 위임
 */
export class NpmResolver {
  readonly type = 'npm' as const;

  // 서비스 인스턴스
  private versionResolver: NpmVersionResolver;
  private treeManager: NpmTreeManager;

  // BFS 탐색용
  private depsQueue: DepsQueueItem[] = [];
  private depsSeen: Set<string> = new Set();

  // 플랫폼 필터링용
  private targetOS: string | null = null;
  private targetArchitecture: string | null = null;

  constructor(registryUrl = 'https://registry.npmjs.org') {
    this.versionResolver = new NpmVersionResolver(registryUrl);
    this.treeManager = new NpmTreeManager();
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
    this.treeManager.clear();
    this.depsQueue = [];
    this.depsSeen.clear();

    const {
      maxDepth = NPM_CONSTANTS.DEFAULT_MAX_DEPTH,
      includeDev = false,
      includeOptional = false,
      installPeers = true,
      preferDedupe = false,
      legacyPeerDeps = false,
      installStrategy = 'hoisted',
      targetOS,
      targetArchitecture,
    } = options;

    // 플랫폼 필터링 설정
    this.targetOS = targetOS || null;
    this.targetArchitecture = targetArchitecture || null;

    try {
      // 1. 루트 패키지 정보 조회
      const packument = await this.versionResolver.fetchPackument(packageName);
      const resolvedVersion = this.versionResolver.resolveVersion(version, packument);

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

      this.treeManager.setRootNode(rootNode);

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
      const flatList = this.treeManager.flattenTree();
      const totalSize = flatList.reduce((sum, pkg) => sum + (pkg.size || 0), 0);
      const maxDepthReached = Math.max(
        ...flatList.map((p) => this.treeManager.getDepthFromPath(p.hoistedPath)),
        0
      );

      return {
        root: rootNode,
        flatList,
        conflicts: this.treeManager.getConflicts(),
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
  private async buildDeps(options: BuildDepsOptions): Promise<void> {
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
  private async processDepItem(item: DepsQueueItem, options: BuildDepsOptions): Promise<void> {
    const { name, spec, type, depth, parent } = item;

    // 패키지 정보 조회
    const packument = await this.versionResolver.fetchPackument(name);
    const resolvedVersion = this.versionResolver.resolveVersion(spec, packument);

    if (!resolvedVersion) {
      throw new Error(`호환 버전을 찾을 수 없습니다: ${name}@${spec}`);
    }

    const pkgInfo = packument.versions[resolvedVersion];
    if (!pkgInfo) {
      throw new Error(`패키지 버전 정보를 찾을 수 없습니다: ${name}@${resolvedVersion}`);
    }

    // 플랫폼 호환성 체크
    if (!this.isPlatformCompatible(pkgInfo)) {
      logger.debug(`플랫폼 불일치로 스킵: ${name}@${resolvedVersion}`);
      return;
    }

    // 배치 위치 결정 (hoisting)
    const treeOptions: TreeManagerOptions = {
      preferDedupe: options.preferDedupe,
      installStrategy: options.installStrategy,
    };
    const placement = this.treeManager.findPlacement(name, resolvedVersion, parent, treeOptions);

    if (placement.result === 'KEEP') {
      // 이미 호환되는 버전이 있음
      return;
    }

    if (placement.result === 'CONFLICT' && options.installStrategy === 'hoisted') {
      // 충돌 - 중첩 배치
      const nestedPath = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
      this.treeManager.addNodeToTree(name, resolvedVersion, pkgInfo, nestedPath, depth, type, item);

      // 충돌 기록
      if (placement.existing) {
        this.treeManager.recordConflict({
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
        const existingPath = this.treeManager.findNodePath(name, parent);
        if (existingPath) {
          this.treeManager.deleteNode(existingPath);
        }
      }

      this.treeManager.addNodeToTree(name, resolvedVersion, pkgInfo, hoistedPath, depth, type, item);
    }

    // 하위 의존성 큐에 추가
    const nodePath = this.treeManager.findNodePath(name, parent) || `node_modules/${name}`;
    this.enqueueDependencies(pkgInfo, depth + 1, nodePath, {
      includeDev: options.includeDev,
      includeOptional: options.includeOptional,
      installPeers: options.installPeers,
    });
  }

  /**
   * 플랫폼 호환성 체크
   * package.json의 os, cpu 필드를 확인하여 타겟 플랫폼과 호환되는지 검사
   */
  private isPlatformCompatible(pkgInfo: NpmPackageVersion): boolean {
    // 타겟 플랫폼이 설정되지 않았으면 모든 패키지 허용
    if (!this.targetOS && !this.targetArchitecture) {
      return true;
    }

    const { os: pkgOs, cpu: pkgCpu } = pkgInfo;

    // OS 체크
    if (this.targetOS && pkgOs && pkgOs.length > 0) {
      const npmOs = OS_MAPPING[this.targetOS];
      if (!npmOs || !pkgOs.includes(npmOs)) {
        logger.debug(`플랫폼 불일치로 스킵: ${pkgInfo.name} (os: ${pkgOs})`);
        return false;
      }
    }

    // CPU 체크
    if (this.targetArchitecture && pkgCpu && pkgCpu.length > 0) {
      const npmCpu = CPU_MAPPING[this.targetArchitecture];
      if (!npmCpu || !pkgCpu.includes(npmCpu)) {
        logger.debug(`플랫폼 불일치로 스킵: ${pkgInfo.name} (cpu: ${pkgCpu})`);
        return false;
      }
    }

    return true;
  }

  /**
   * 패키지명에서 플랫폼 정보 추출
   * @param pkgName - 패키지명 (예: @esbuild/linux-x64, @img/sharp-darwin-arm64)
   * @returns { os: string, cpu: string } | null
   */
  private extractPlatformFromPackageName(pkgName: string): { os: string; cpu: string } | null {
    for (const pattern of PLATFORM_PACKAGE_PATTERNS) {
      const match = pkgName.match(pattern);
      if (match) {
        // 매칭된 그룹에서 OS와 CPU 추출
        const groups = match.slice(1).filter(Boolean);

        // darwin|linux|win32 찾기
        const os = groups.find((g) => ['linux', 'darwin', 'win32'].includes(g));
        // x64|arm64|ia32 찾기
        const cpu = groups.find((g) => ['x64', 'arm64', 'ia32'].includes(g));

        if (os && cpu) {
          return { os, cpu };
        }
      }
    }

    return null;
  }

  /**
   * optionalDependency가 타겟 플랫폼과 호환되는지 확인
   * @param pkgName - 패키지명
   * @returns 호환 여부
   */
  private isOptionalDepCompatible(pkgName: string): boolean {
    // 타겟 플랫폼이 설정되지 않았으면 모든 패키지 허용
    if (!this.targetOS && !this.targetArchitecture) {
      return true;
    }

    // 패키지명에서 플랫폼 정보 추출
    const platformInfo = this.extractPlatformFromPackageName(pkgName);

    // 플랫폼 정보가 없으면 플랫폼 무관 패키지로 간주 (허용)
    if (!platformInfo) {
      return true;
    }

    // OS 매칭
    if (this.targetOS) {
      const npmOs = OS_MAPPING[this.targetOS];
      if (npmOs && platformInfo.os !== npmOs) {
        logger.debug(
          `플랫폼 불일치로 스킵 (OS): ${pkgName} (expected: ${npmOs}, found: ${platformInfo.os})`
        );
        return false;
      }
    }

    // CPU 매칭
    if (this.targetArchitecture) {
      const npmCpu = CPU_MAPPING[this.targetArchitecture];
      if (npmCpu && platformInfo.cpu !== npmCpu) {
        logger.debug(
          `플랫폼 불일치로 스킵 (CPU): ${pkgName} (expected: ${npmCpu}, found: ${platformInfo.cpu})`
        );
        return false;
      }
    }

    logger.debug(`플랫폼 호환 optionalDependency: ${pkgName}`);
    return true;
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
      this.enqueueDepType(pkgInfo.dependencies, 'prod', depth, parentPath);
    }

    // dev 의존성
    if (options.includeDev && pkgInfo.devDependencies) {
      this.enqueueDepType(pkgInfo.devDependencies, 'dev', depth, parentPath);
    }

    // optional 의존성 (플랫폼 필터링 적용)
    if (options.includeOptional && pkgInfo.optionalDependencies) {
      const filteredOptionalDeps: Record<string, string> = {};

      for (const [name, version] of Object.entries(pkgInfo.optionalDependencies)) {
        if (this.isOptionalDepCompatible(name)) {
          filteredOptionalDeps[name] = version;
        }
      }

      if (Object.keys(filteredOptionalDeps).length > 0) {
        this.enqueueDepType(filteredOptionalDeps, 'optional', depth, parentPath);
      }
    }

    // peer 의존성 (npm v7+ 자동 설치)
    if (options.installPeers && pkgInfo.peerDependencies) {
      this.enqueuePeerDeps(pkgInfo, depth, parentPath);
    }
  }

  /**
   * 특정 타입의 의존성을 큐에 추가
   */
  private enqueueDepType(
    deps: Record<string, string>,
    type: DependencyType,
    depth: number,
    parentPath: string
  ): void {
    for (const [name, spec] of Object.entries(deps)) {
      this.depsQueue.push({
        name,
        spec,
        type,
        depth,
        path: parentPath,
        parent: parentPath,
        edge: { from: parentPath, to: null, name, type, spec, valid: false },
      });
    }
  }

  /**
   * peer 의존성을 큐에 추가
   */
  private enqueuePeerDeps(pkgInfo: NpmPackageVersion, depth: number, parentPath: string): void {
    for (const [name, spec] of Object.entries(pkgInfo.peerDependencies!)) {
      const meta = pkgInfo.peerDependenciesMeta?.[name];
      const isOptional = meta?.optional === true;
      const type: DependencyType = isOptional ? 'peerOptional' : 'peer';

      this.depsQueue.push({
        name,
        spec,
        type,
        depth,
        path: parentPath,
        parent: parentPath,
        edge: { from: parentPath, to: null, name, type, spec, valid: false },
      });
    }
  }

  // ===== 공개 API (서비스 위임) =====

  /**
   * package.json 내용에서 의존성 파싱
   */
  async parseFromPackageJson(content: string): Promise<{ name: string; version: string }[]> {
    return this.versionResolver.parseFromPackageJson(content);
  }

  /**
   * 패키지 버전 목록 조회
   */
  async getVersions(packageName: string): Promise<string[]> {
    return this.versionResolver.getVersions(packageName);
  }

  /**
   * 패키지 정보 조회
   */
  async getPackageInfo(name: string, version: string): Promise<NpmPackageVersion | null> {
    return this.versionResolver.getPackageInfo(name, version);
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
