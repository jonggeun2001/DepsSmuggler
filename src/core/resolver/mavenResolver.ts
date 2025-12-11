/**
 * Maven Dependency Resolver
 *
 * BF(Breadth-First) + Skipper 알고리즘 기반 의존성 해결
 * 문서 참고: docs/maven-dependency-resolution.md
 */

import axios, { AxiosInstance } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import {
  IResolver,
  PackageInfo,
  DependencyNode,
  DependencyResolutionResult,
  DependencyConflict,
  DependencyScope,
  ResolverOptions,
} from '../../types';
import logger from '../../utils/logger';
import {
  PomProject,
  PomDependency,
  PomExclusion,
  MavenCoordinate,
  DependencyProcessingContext,
  NodeCoordinate,
  coordinateToString,
  coordinateToKey,
  exclusionKey,
  matchesExclusion,
  transitScope,
} from '../shared/maven-types';
import { DependencyResolutionSkipper } from '../shared/maven-skipper';
import {
  fetchPom as fetchPomFromCache,
  prefetchPomsParallel,
  clearMemoryCache as clearMavenCache,
  MavenCacheOptions,
} from '../shared/maven-cache';

/** Maven Resolver 옵션 */
export interface MavenResolverOptions extends ResolverOptions {
  /** 알고리즘 선택 ('bf' | 'df', 기본값: 'bf') */
  algorithm?: 'bf' | 'df';
  /** 병렬 POM 다운로드 스레드 수 (기본값: 5) */
  parallelThreads?: number;
  /** POM 캐시 TTL (ms, 기본값: 5분) */
  pomCacheTtl?: number;
}

export class MavenResolver implements IResolver {
  readonly type = 'maven' as const;
  private readonly repoUrl = 'https://repo1.maven.org/maven2';
  private parser: XMLParser;
  private axiosInstance: AxiosInstance;

  /** dependencyManagement 버전 관리 */
  private dependencyManagement: Map<string, string> = new Map();

  /** 충돌 목록 */
  private conflicts: DependencyConflict[] = [];

  /** Skipper 인스턴스 */
  private skipper: DependencyResolutionSkipper;

  /** 캐시 옵션 */
  private cacheOptions: MavenCacheOptions = {};

  /** 기본 옵션 */
  private defaultOptions: MavenResolverOptions = {
    algorithm: 'bf',
    parallelThreads: 5,
    pomCacheTtl: 5 * 60 * 1000, // 5분
    maxDepth: 20,
    includeOptionalDependencies: false,
  };

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'DepsSmuggler/1.0',
      },
    });

    this.skipper = new DependencyResolutionSkipper();
  }

  /**
   * 의존성 해결 (진입점)
   */
  async resolveDependencies(
    packageName: string,
    version: string,
    options?: MavenResolverOptions
  ): Promise<DependencyResolutionResult> {
    const opts = { ...this.defaultOptions, ...options };
    const [groupId, artifactId] = packageName.split(':');

    if (!groupId || !artifactId) {
      throw new Error(`잘못된 패키지명 형식: ${packageName} (groupId:artifactId 형식 필요)`);
    }

    // 상태 초기화
    this.conflicts = [];
    this.dependencyManagement.clear();
    this.skipper.clear();

    const rootCoordinate: MavenCoordinate = {
      groupId,
      artifactId,
      version,
    };

    try {
      logger.info('Maven 의존성 해결 시작', {
        package: packageName,
        version,
        algorithm: opts.algorithm,
      });

      const root = await this.resolveBF(rootCoordinate, opts);
      const flatList = this.flattenDependencies(root);

      const stats = this.skipper.getStats();
      logger.info('Maven 의존성 해결 완료', {
        package: packageName,
        totalDependencies: flatList.length,
        conflicts: this.conflicts.length,
        skipperStats: stats,
      });

      return {
        root,
        flatList,
        conflicts: this.conflicts,
      };
    } catch (error) {
      logger.error('Maven 의존성 해결 실패', { packageName, version, error });
      throw error;
    }
  }

  /**
   * BF(너비 우선) 알고리즘으로 의존성 해결
   */
  private async resolveBF(
    rootCoordinate: MavenCoordinate,
    options: MavenResolverOptions
  ): Promise<DependencyNode> {
    const maxDepth = options.maxDepth ?? 20;
    const includeOptional = options.includeOptionalDependencies ?? false;

    // 노드 저장소 (G:A:V -> DependencyNode)
    const nodeMap: Map<string, DependencyNode> = new Map();

    // 루트 노드 생성
    const rootNode = this.createDependencyNode(rootCoordinate, 'compile');
    const rootKey = coordinateToString(rootCoordinate);
    nodeMap.set(rootKey, rootNode);

    // BF 큐 초기화
    const queue: DependencyProcessingContext[] = [];

    // 루트 POM 로드 및 초기 의존성 큐에 추가
    const rootPom = await this.fetchPomWithCache(rootCoordinate);

    // Parent POM 처리 및 properties 체인 구축
    const resolvedProperties = await this.processParentPom(rootPom, rootCoordinate);

    // 현재 POM의 dependencyManagement 처리 (해결된 properties 사용)
    this.processDependencyManagement(rootPom, resolvedProperties);

    // 루트의 직접 의존성을 큐에 추가
    // isRoot=true로 설정하여 dependencies가 없는 pom 타입도 dependencyManagement에서 의존성 추출
    const rootDependencies = this.extractDependencies(rootPom, rootCoordinate, true);

    // 좌표 할당 (루트)
    this.skipper.getCoordinateManager().createCoordinate(rootCoordinate, 0);
    this.skipper.recordResolved(rootCoordinate);

    // 먼저 모든 의존성 좌표를 수집
    const coordinatesToPrefetch: MavenCoordinate[] = [];
    let sequence = 0;
    for (const dep of rootDependencies) {
      if (!this.shouldIncludeDependency(dep, includeOptional)) continue;

      const depCoordinate = this.resolveDependencyCoordinate(dep, resolvedProperties);
      if (!depCoordinate) continue;

      coordinatesToPrefetch.push(depCoordinate);

      sequence++;
      const context: DependencyProcessingContext = {
        coordinate: depCoordinate,
        parentPath: [rootKey],
        depth: 1,
        nodeCoordinate: { depth: 1, sequence },
        scope: (dep.scope as DependencyScope) || 'compile',
        originalScope: (dep.scope as DependencyScope) || 'compile',
        exclusions: this.extractExclusions(dep),
        managedVersion: !!this.dependencyManagement.get(coordinateToKey(depCoordinate)),
      };

      queue.push(context);
    }

    // 모든 루트 의존성 POM을 병렬로 프리페치
    if (coordinatesToPrefetch.length > 0) {
      this.prefetchPomsParallel(coordinatesToPrefetch);
    }

    // BF 탐색
    while (queue.length > 0) {
      const context = queue.shift()!;
      const { coordinate, parentPath, depth, scope, exclusions } = context;

      // 최대 깊이 체크
      if (depth > maxDepth) continue;

      // Exclusion 체크
      if (matchesExclusion(coordinate, exclusions)) {
        logger.debug('의존성 제외됨 (exclusion)', { coordinate: coordinateToString(coordinate) });
        continue;
      }

      // Skipper로 건너뛰기 여부 결정
      const skipResult = this.skipper.skipResolution(coordinate, depth, parentPath);

      if (skipResult.skip) {
        // 충돌 기록
        if (skipResult.reason === 'version_conflict') {
          const winnerVersion = this.skipper.getResolvedVersion(
            coordinate.groupId,
            coordinate.artifactId
          );
          this.recordConflict(coordinate, winnerVersion || '', parentPath);
        }
        continue;
      }

      // 노드 생성 또는 가져오기
      const nodeKey = coordinateToString(coordinate);
      let node = nodeMap.get(nodeKey);

      if (!node) {
        node = this.createDependencyNode(coordinate, scope);
        nodeMap.set(nodeKey, node);
      }

      // 부모 노드에 자식 추가
      const parentKey = parentPath[parentPath.length - 1];
      const parentNode = nodeMap.get(parentKey);
      if (parentNode && !parentNode.dependencies.some((d) => coordinateToString({
        groupId: d.package.metadata?.groupId as string,
        artifactId: d.package.metadata?.artifactId as string,
        version: d.package.version,
      }) === nodeKey)) {
        parentNode.dependencies.push(node);
      }

      // 이미 처리된 노드이고 강제 해결이 아니면 자식 탐색 건너뛰기
      if (skipResult.forceResolution) {
        continue;
      }

      // 해결됨으로 기록
      this.skipper.recordResolved(coordinate);

      // POM 로드
      let pom: PomProject;
      try {
        pom = await this.fetchPomWithCache(coordinate);
      } catch (error) {
        logger.warn('POM 로드 실패', {
          coordinate: coordinateToString(coordinate),
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      // 하위 의존성의 properties 체인 구축 (parent POM에서 상속)
      const childProperties = await this.processParentPom(pom, coordinate);

      // 하위 의존성 처리
      const dependencies = this.extractDependencies(pom, coordinate);
      const newPath = [...parentPath, nodeKey];
      let childSequence = 0;

      // 하위 의존성들의 좌표 수집
      const childCoordinates: MavenCoordinate[] = [];

      for (const dep of dependencies) {
        if (!this.shouldIncludeDependency(dep, includeOptional)) continue;

        const depCoordinate = this.resolveDependencyCoordinate(dep, childProperties);
        if (!depCoordinate) continue;

        // Scope 전이 계산
        const depOriginalScope = (dep.scope as DependencyScope) || 'compile';
        const transitedScope = transitScope(scope, depOriginalScope);

        if (!transitedScope) continue; // 전이되지 않는 scope

        // Exclusion 병합
        const mergedExclusions = new Set([...exclusions, ...this.extractExclusions(dep)]);

        childCoordinates.push(depCoordinate);

        childSequence++;
        const childContext: DependencyProcessingContext = {
          coordinate: depCoordinate,
          parentPath: newPath,
          depth: depth + 1,
          nodeCoordinate: { depth: depth + 1, sequence: childSequence },
          scope: transitedScope,
          originalScope: depOriginalScope,
          exclusions: mergedExclusions,
          managedVersion: !!this.dependencyManagement.get(coordinateToKey(depCoordinate)),
        };

        queue.push(childContext);
      }

      // 하위 의존성들 POM 병렬 프리페치
      if (childCoordinates.length > 0) {
        this.prefetchPomsParallel(childCoordinates);
      }
    }

    return rootNode;
  }

  /**
   * DependencyNode 생성
   */
  private createDependencyNode(
    coordinate: MavenCoordinate,
    scope: DependencyScope
  ): DependencyNode {
    return {
      package: {
        type: 'maven',
        name: `${coordinate.groupId}:${coordinate.artifactId}`,
        version: coordinate.version,
        metadata: {
          groupId: coordinate.groupId,
          artifactId: coordinate.artifactId,
          classifier: coordinate.classifier,
          type: coordinate.type,
        },
      },
      dependencies: [],
      scope,
    };
  }

  /**
   * 의존성 포함 여부 결정
   */
  private shouldIncludeDependency(dep: PomDependency, includeOptional: boolean): boolean {
    const scope = dep.scope as DependencyScope;

    // test, provided, system scope는 전이적 의존성에서 제외
    if (scope === 'test' || scope === 'provided' || scope === 'system') {
      return false;
    }

    // optional 처리
    if (dep.optional === 'true' || dep.optional === true) {
      return includeOptional;
    }

    return true;
  }

  /**
   * POM에서 의존성 좌표 해결
   */
  private resolveDependencyCoordinate(
    dep: PomDependency,
    properties?: Record<string, string>
  ): MavenCoordinate | null {
    let version = this.resolveProperty(dep.version || '', properties);

    // dependencyManagement에서 버전 찾기
    if (!version) {
      const managedKey = `${dep.groupId}:${dep.artifactId}`;
      version = this.dependencyManagement.get(managedKey) || '';
    }

    if (!version) {
      logger.debug('버전 정보 없음', { groupId: dep.groupId, artifactId: dep.artifactId });
      return null;
    }

    // 버전 범위 처리 (단순화: 범위의 첫 번째 버전 사용)
    version = this.resolveVersionRange(version);

    return {
      groupId: dep.groupId,
      artifactId: dep.artifactId,
      version,
      classifier: dep.classifier,
      type: dep.type,
    };
  }

  /**
   * 버전 범위 해결 (단순화된 구현)
   */
  private resolveVersionRange(version: string): string {
    // [1.0,2.0) 같은 범위 표기 처리
    if (version.startsWith('[') || version.startsWith('(')) {
      const match = version.match(/[\[(]([^,\])]+)/);
      if (match) {
        return match[1];
      }
    }
    return version;
  }

  /**
   * Exclusions 추출
   */
  private extractExclusions(dep: PomDependency): Set<string> {
    const exclusions = new Set<string>();

    if (dep.exclusions?.exclusion) {
      const excls = Array.isArray(dep.exclusions.exclusion)
        ? dep.exclusions.exclusion
        : [dep.exclusions.exclusion];

      for (const excl of excls) {
        exclusions.add(exclusionKey(excl.groupId, excl.artifactId));
      }
    }

    return exclusions;
  }

  /**
   * POM에서 의존성 목록 추출
   * dependencies가 없는 pom 타입(parent/BOM)의 경우 dependencyManagement의 의존성 반환
   */
  private extractDependencies(pom: PomProject, coordinate: MavenCoordinate, isRoot = false): PomDependency[] {
    const deps = pom.dependencies?.dependency;
    if (deps) {
      return Array.isArray(deps) ? deps : [deps];
    }

    // 루트 패키지이고 dependencies가 없는 경우 (parent POM, BOM 등)
    // dependencyManagement의 의존성을 반환 (parent로부터 상속받은 것 포함)
    if (isRoot) {
      // 1. 먼저 현재 POM의 dependencyManagement 확인
      const managed = pom.dependencyManagement?.dependencies?.dependency;
      if (managed) {
        const managedDeps = Array.isArray(managed) ? managed : [managed];
        // import 타입(BOM)이 아닌 실제 의존성만 반환
        return managedDeps.filter(dep => dep.scope !== 'import' || dep.type !== 'pom');
      }

      // 2. 현재 POM에 없으면 상속받은 dependencyManagement 사용 (this.dependencyManagement)
      if (this.dependencyManagement.size > 0) {
        const inheritedDeps: PomDependency[] = [];
        for (const [key, version] of this.dependencyManagement.entries()) {
          const [groupId, artifactId] = key.split(':');
          if (groupId && artifactId) {
            inheritedDeps.push({
              groupId,
              artifactId,
              version,
              scope: 'compile',
            });
          }
        }
        return inheritedDeps;
      }
    }

    return [];
  }

  /**
   * 충돌 기록
   */
  private recordConflict(
    coordinate: MavenCoordinate,
    winnerVersion: string,
    path: string[]
  ): void {
    const packageName = coordinateToKey(coordinate);

    // 이미 기록된 충돌인지 확인
    const existing = this.conflicts.find(
      (c) => c.packageName === packageName && c.versions.includes(coordinate.version)
    );

    if (existing) {
      if (!existing.versions.includes(coordinate.version)) {
        existing.versions.push(coordinate.version);
      }
    } else {
      this.conflicts.push({
        type: 'version',
        packageName,
        versions: [coordinate.version, winnerVersion].filter((v) => v),
        resolvedVersion: winnerVersion,
      });
    }
  }

  /**
   * Parent POM 처리
   */
  private async processParentPom(
    pom: PomProject,
    coordinate: MavenCoordinate,
    inheritedProperties?: Record<string, string>
  ): Promise<Record<string, string>> {
    // 현재 POM의 properties와 상속받은 properties 병합
    // 자식의 properties가 부모보다 우선 (오버라이드)
    const mergedProperties: Record<string, string> = {
      ...inheritedProperties,
      ...pom.properties,
      // 프로젝트 좌표 정보 추가
      'project.version': coordinate.version,
      'project.groupId': coordinate.groupId,
      'project.artifactId': coordinate.artifactId,
      version: coordinate.version,
      groupId: coordinate.groupId,
      artifactId: coordinate.artifactId,
    };

    if (!pom.parent) return mergedProperties;

    const parentGroupId = pom.parent.groupId || coordinate.groupId;
    const parentArtifactId = pom.parent.artifactId;
    const parentVersion = this.resolveProperty(pom.parent.version || '', mergedProperties);

    if (!parentArtifactId || !parentVersion) return mergedProperties;

    try {
      const parentCoordinate: MavenCoordinate = {
        groupId: parentGroupId,
        artifactId: parentArtifactId,
        version: parentVersion,
      };

      const parentPom = await this.fetchPomWithCache(parentCoordinate);

      // Parent의 parent도 재귀적으로 처리하고 properties 체인 받아오기
      const parentProperties = await this.processParentPom(parentPom, parentCoordinate, mergedProperties);

      // 최종 properties: 부모 체인의 properties + 현재 POM의 properties
      const finalProperties: Record<string, string> = {
        ...parentProperties,
        ...pom.properties,
        'project.version': coordinate.version,
        'project.groupId': coordinate.groupId,
        'project.artifactId': coordinate.artifactId,
        version: coordinate.version,
        groupId: coordinate.groupId,
        artifactId: coordinate.artifactId,
      };

      // Parent의 dependencyManagement 상속 (부모의 properties로 해결)
      this.processDependencyManagement(parentPom, parentProperties);

      return finalProperties;
    } catch (error) {
      logger.debug('Parent POM 로드 실패 (계속 진행)', {
        parent: `${parentGroupId}:${parentArtifactId}:${parentVersion}`,
      });
      return mergedProperties;
    }
  }

  /**
   * dependencyManagement 처리
   */
  private processDependencyManagement(
    pom: PomProject,
    properties?: Record<string, string>
  ): void {
    const managed = pom.dependencyManagement?.dependencies?.dependency;
    if (!managed) return;

    const deps = Array.isArray(managed) ? managed : [managed];

    for (const dep of deps) {
      const version = this.resolveProperty(dep.version || '', properties);
      if (version) {
        const key = `${dep.groupId}:${dep.artifactId}`;
        // 먼저 정의된 것이 우선 (Nearest Definition)
        if (!this.dependencyManagement.has(key)) {
          this.dependencyManagement.set(key, version);
        }
      }

      // BOM import 처리
      if (dep.scope === 'import' && dep.type === 'pom') {
        this.importBom(dep, properties).catch((err) => {
          logger.debug('BOM import 실패', { dep: `${dep.groupId}:${dep.artifactId}`, err });
        });
      }
    }
  }

  /**
   * BOM import 처리
   */
  private async importBom(
    dep: PomDependency,
    properties?: Record<string, string>
  ): Promise<void> {
    const version = this.resolveProperty(dep.version || '', properties);
    if (!version) return;

    try {
      const bomCoordinate: MavenCoordinate = {
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version,
      };

      const bomPom = await this.fetchPomWithCache(bomCoordinate);
      this.processDependencyManagement(bomPom, bomPom.properties);
    } catch (error) {
      logger.debug('BOM import 실패', { bom: `${dep.groupId}:${dep.artifactId}:${version}` });
    }
  }

  /**
   * Properties 치환 (${...} 형식)
   */
  private resolveProperty(value: string, properties?: Record<string, string>): string {
    if (!value) return value;

    // value가 문자열이 아닌 경우 문자열로 변환
    let resolved = typeof value === 'string' ? value : String(value);
    let iterations = 0;
    const maxIterations = 10; // 무한 루프 방지

    while (resolved.includes('${') && iterations < maxIterations) {
      const before = resolved;
      resolved = resolved.replace(/\$\{([^}]+)\}/g, (_, key) => {
        // 특수 키 처리
        if (key === 'project.version' || key === 'pom.version') {
          return properties?.['version'] || _;
        }
        if (key === 'project.groupId' || key === 'pom.groupId') {
          return properties?.['groupId'] || _;
        }
        if (key === 'project.artifactId' || key === 'pom.artifactId') {
          return properties?.['artifactId'] || _;
        }
        return properties?.[key] || _;
      });

      if (resolved === before) break; // 더 이상 치환할 것이 없음
      iterations++;
    }

    return resolved;
  }

  /**
   * POM 캐시와 함께 조회 (공유 캐시 모듈 사용)
   */
  private async fetchPomWithCache(coordinate: MavenCoordinate): Promise<PomProject> {
    return fetchPomFromCache(coordinate, {
      repoUrl: this.repoUrl,
      memoryTtl: this.defaultOptions.pomCacheTtl,
      ...this.cacheOptions,
    });
  }

  /**
   * POM 프리페치 (비동기, 병렬)
   */
  private prefetchPom(coordinate: MavenCoordinate): void {
    // 단일 프리페치는 그냥 백그라운드로 실행
    this.fetchPomWithCache(coordinate).catch((err) => {
      logger.debug('POM 프리페치 실패', { coordinate: coordinateToString(coordinate) });
    });
  }

  /**
   * 여러 POM 병렬 프리페치
   */
  private prefetchPomsParallel(coordinates: MavenCoordinate[]): void {
    prefetchPomsParallel(coordinates, {
      repoUrl: this.repoUrl,
      memoryTtl: this.defaultOptions.pomCacheTtl,
      batchSize: this.defaultOptions.parallelThreads,
      ...this.cacheOptions,
    });
  }

  /**
   * 최신 버전 조회
   */
  async getLatestVersion(groupId: string, artifactId: string): Promise<string> {
    const groupPath = groupId.replace(/\./g, '/');
    const url = `${this.repoUrl}/${groupPath}/${artifactId}/maven-metadata.xml`;

    try {
      const response = await this.axiosInstance.get<string>(url);
      const parsed = this.parser.parse(response.data);
      return (
        parsed.metadata?.versioning?.latest ||
        parsed.metadata?.versioning?.release ||
        ''
      );
    } catch {
      throw new Error(`버전 조회 실패: ${groupId}:${artifactId}`);
    }
  }

  /**
   * 의존성 트리 평탄화
   */
  private flattenDependencies(node: DependencyNode): PackageInfo[] {
    const result: Map<string, PackageInfo> = new Map();
    const visited = new Set<string>();

    const traverse = (n: DependencyNode, path: string[]) => {
      const key = `${n.package.name}@${n.package.version}`;

      // 순환 참조 방지
      if (path.includes(key)) {
        return;
      }

      if (!result.has(key)) {
        result.set(key, n.package);
      }

      const newPath = [...path, key];
      for (const child of n.dependencies) {
        traverse(child, newPath);
      }
    };

    traverse(node, []);
    return Array.from(result.values());
  }

  /**
   * pom.xml 텍스트 파싱
   */
  async parseFromText(content: string): Promise<PackageInfo[]> {
    try {
      const parsed = this.parser.parse(content);
      const pom = parsed.project as PomProject;
      const packages: PackageInfo[] = [];

      // dependencyManagement 처리
      this.dependencyManagement.clear();
      this.processDependencyManagement(pom, pom.properties);

      // 프로젝트 자체
      const projectGroupId = pom.groupId || pom.parent?.groupId;
      const projectVersion = pom.version || pom.parent?.version;

      if (projectGroupId && pom.artifactId && projectVersion) {
        packages.push({
          type: 'maven',
          name: `${projectGroupId}:${pom.artifactId}`,
          version: projectVersion,
          metadata: {
            groupId: projectGroupId,
            artifactId: pom.artifactId,
          },
        });
      }

      // Dependencies
      const deps = pom.dependencies?.dependency;
      if (deps) {
        const dependencies = Array.isArray(deps) ? deps : [deps];

        for (const dep of dependencies) {
          const scope = dep.scope as DependencyScope;
          if (scope === 'test') continue;

          let version = this.resolveProperty(dep.version || '', pom.properties);
          if (!version) {
            version =
              this.dependencyManagement.get(`${dep.groupId}:${dep.artifactId}`) || 'LATEST';
          }

          packages.push({
            type: 'maven',
            name: `${dep.groupId}:${dep.artifactId}`,
            version,
            metadata: {
              groupId: dep.groupId,
              artifactId: dep.artifactId,
              scope: dep.scope,
            },
          });
        }
      }

      return packages;
    } catch (error) {
      logger.error('pom.xml 파싱 실패', { error });
      throw error;
    }
  }

  /**
   * POM 캐시 클리어
   */
  clearCache(): void {
    clearMavenCache();
  }

  /**
   * 캐시 옵션 설정
   */
  setCacheOptions(options: MavenCacheOptions): void {
    this.cacheOptions = options;
  }

  /**
   * Skipper 통계 가져오기
   */
  getSkipperStats(): ReturnType<DependencyResolutionSkipper['getStats']> {
    return this.skipper.getStats();
  }
}

// 싱글톤 인스턴스
let mavenResolverInstance: MavenResolver | null = null;

export function getMavenResolver(): MavenResolver {
  if (!mavenResolverInstance) {
    mavenResolverInstance = new MavenResolver();
  }
  return mavenResolverInstance;
}
