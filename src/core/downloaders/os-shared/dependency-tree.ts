/**
 * OS Package Dependency Tree
 * 의존성 트리 구조 및 설치 순서 계산
 */

import type { OSPackageInfo, PackageDependency } from './types';

/**
 * 의존성 노드
 */
export interface DependencyNode {
  /** 패키지 정보 */
  package: OSPackageInfo;
  /** 이 패키지에 의존하는 패키지들 (부모) */
  dependedBy: Set<string>;
  /** 이 패키지가 의존하는 패키지들 (자식) */
  dependsOn: Set<string>;
  /** 방문 여부 (순환 의존성 탐지용) */
  visited: boolean;
  /** 처리 완료 여부 */
  processed: boolean;
}

/**
 * 의존성 엣지
 */
export interface DependencyEdge {
  /** 부모 패키지 키 */
  parent: string;
  /** 자식 패키지 키 */
  child: string;
  /** 의존성 정보 */
  dependency: PackageDependency;
}

/**
 * 누락된 의존성
 */
export interface MissingDependency {
  /** 요청한 패키지 */
  requestedBy: OSPackageInfo;
  /** 누락된 의존성 정보 */
  dependency: PackageDependency;
  /** 이유 */
  reason: 'not_found' | 'version_mismatch' | 'architecture_mismatch';
}

/**
 * 버전 충돌 정보
 */
export interface VersionConflict {
  /** 패키지 이름 */
  packageName: string;
  /** 충돌하는 버전들 */
  versions: OSPackageInfo[];
  /** 요청한 패키지들 */
  requestedBy: Array<{
    package: OSPackageInfo;
    requiredVersion?: string;
  }>;
}

/**
 * 시각화용 데이터
 */
export interface VisualizationData {
  nodes: Array<{
    id: string;
    label: string;
    version: string;
    size: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    optional: boolean;
  }>;
}

/**
 * OS 의존성 트리
 */
export class OSDependencyTree {
  private nodes: Map<string, DependencyNode> = new Map();
  private edges: DependencyEdge[] = [];
  private missingDeps: MissingDependency[] = [];
  private conflicts: Map<string, VersionConflict> = new Map();

  /**
   * 패키지 키 생성
   */
  private getPackageKey(pkg: OSPackageInfo): string {
    return `${pkg.name}-${pkg.version}-${pkg.architecture}`;
  }

  /**
   * 패키지 이름만으로 키 생성 (버전 무관)
   */
  private getPackageNameKey(pkg: OSPackageInfo): string {
    return `${pkg.name}-${pkg.architecture}`;
  }

  /**
   * 노드 추가
   */
  addNode(pkg: OSPackageInfo): void {
    const key = this.getPackageKey(pkg);
    if (!this.nodes.has(key)) {
      this.nodes.set(key, {
        package: pkg,
        dependedBy: new Set(),
        dependsOn: new Set(),
        visited: false,
        processed: false,
      });
    }
  }

  /**
   * 노드 존재 여부 확인
   */
  hasNode(pkg: OSPackageInfo): boolean {
    return this.nodes.has(this.getPackageKey(pkg));
  }

  /**
   * 엣지 추가 (의존성 관계)
   */
  addEdge(parent: OSPackageInfo, child: OSPackageInfo, dependency: PackageDependency): void {
    const parentKey = this.getPackageKey(parent);
    const childKey = this.getPackageKey(child);

    // 노드가 없으면 추가
    if (!this.nodes.has(parentKey)) {
      this.addNode(parent);
    }
    if (!this.nodes.has(childKey)) {
      this.addNode(child);
    }

    // 관계 설정
    const parentNode = this.nodes.get(parentKey)!;
    const childNode = this.nodes.get(childKey)!;

    parentNode.dependsOn.add(childKey);
    childNode.dependedBy.add(parentKey);

    // 엣지 저장
    this.edges.push({
      parent: parentKey,
      child: childKey,
      dependency,
    });
  }

  /**
   * 누락된 의존성 추가
   */
  addMissingDependency(
    pkg: OSPackageInfo,
    dep: PackageDependency,
    reason: MissingDependency['reason'] = 'not_found'
  ): void {
    this.missingDeps.push({
      requestedBy: pkg,
      dependency: dep,
      reason,
    });
  }

  /**
   * 버전 충돌 추가
   */
  addConflict(
    packageName: string,
    versions: OSPackageInfo[],
    requestedBy: VersionConflict['requestedBy']
  ): void {
    const existing = this.conflicts.get(packageName);
    if (existing) {
      // 기존 충돌에 버전 추가
      for (const ver of versions) {
        if (!existing.versions.find((v) => v.version === ver.version)) {
          existing.versions.push(ver);
        }
      }
      existing.requestedBy.push(...requestedBy);
    } else {
      this.conflicts.set(packageName, {
        packageName,
        versions,
        requestedBy,
      });
    }
  }

  /**
   * 설치 순서대로 정렬 (위상 정렬)
   * 의존성이 없는 것부터 순서대로 반환
   */
  getInstallOrder(): OSPackageInfo[] {
    // BFS 기반 토폴로지 정렬 (Kahn's algorithm)
    const result: OSPackageInfo[] = [];
    
    // 각 노드의 처리되지 않은 의존성 개수 (in-degree)
    const inDegree = new Map<string, number>();
    
    // 초기화
    for (const [key, node] of this.nodes) {
      inDegree.set(key, node.dependsOn.size);
    }
    
    // BFS 큐: 의존성이 없는 노드(리프)부터 시작
    const queue: string[] = [];
    for (const [key, count] of inDegree) {
      if (count === 0) {
        queue.push(key);
      }
    }
    
    // 처리된 노드 추적 (순환 의존성 감지용)
    const processed = new Set<string>();
    
    // BFS 처리
    while (queue.length > 0) {
      const key = queue.shift()!;
      
      if (processed.has(key)) {
        continue;
      }
      processed.add(key);
      
      const node = this.nodes.get(key);
      if (node) {
        result.push(node.package);
        
        // 이 노드를 의존하는 부모 노드들의 in-degree 감소
        for (const [parentKey, parentNode] of this.nodes) {
          if (parentNode.dependsOn.has(key)) {
            const newDegree = inDegree.get(parentKey)! - 1;
            inDegree.set(parentKey, newDegree);
            
            // 모든 의존성이 처리되면 큐에 추가
            if (newDegree === 0 && !processed.has(parentKey)) {
              queue.push(parentKey);
            }
          }
        }
      }
    }
    
    // 순환 의존성으로 처리되지 않은 노드들 처리 (경고 출력 후 추가)
    for (const [key, node] of this.nodes) {
      if (!processed.has(key)) {
        console.warn(`Circular dependency detected involving: ${key}`);
        result.push(node.package);
      }
    }

    return result;
  }

  /**
   * 모든 고유 패키지 반환
   */
  getAllPackages(): OSPackageInfo[] {
    return Array.from(this.nodes.values()).map((node) => node.package);
  }

  /**
   * 루트 패키지들 반환 (다른 패키지에 의존되지 않는 것)
   */
  getRootPackages(): OSPackageInfo[] {
    return Array.from(this.nodes.values())
      .filter((node) => node.dependedBy.size === 0)
      .map((node) => node.package);
  }

  /**
   * 리프 패키지들 반환 (다른 패키지에 의존하지 않는 것)
   */
  getLeafPackages(): OSPackageInfo[] {
    return Array.from(this.nodes.values())
      .filter((node) => node.dependsOn.size === 0)
      .map((node) => node.package);
  }

  /**
   * 누락된 의존성 반환
   */
  getMissingDependencies(): MissingDependency[] {
    return [...this.missingDeps];
  }

  /**
   * 버전 충돌 반환
   */
  getConflicts(): VersionConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * 패키지 수 반환
   */
  getPackageCount(): number {
    return this.nodes.size;
  }

  /**
   * 총 다운로드 크기 계산
   */
  getTotalSize(): number {
    return Array.from(this.nodes.values()).reduce(
      (total, node) => total + node.package.size,
      0
    );
  }

  /**
   * 시각화용 데이터 반환
   */
  toVisualizationData(): VisualizationData {
    const nodes = Array.from(this.nodes.values()).map((node) => ({
      id: this.getPackageKey(node.package),
      label: node.package.name,
      version: node.package.version,
      size: node.package.size,
    }));

    const edges = this.edges.map((edge) => ({
      source: edge.parent,
      target: edge.child,
      optional: edge.dependency.isOptional || false,
    }));

    return { nodes, edges };
  }

  /**
   * 트리 통계 반환
   */
  getStats(): {
    totalPackages: number;
    totalSize: number;
    missingCount: number;
    conflictCount: number;
    maxDepth: number;
  } {
    // BFS 기반 최대 깊이 계산 (Kahn's algorithm)
    const depths = new Map<string, number>();
    
    // 역방향 그래프 구축: childKey -> parentKeys (이 노드를 의존하는 노드들)
    const dependedBy = new Map<string, Set<string>>();
    // 각 노드의 처리되지 않은 의존성 개수
    const pendingDeps = new Map<string, number>();
    
    // 초기화
    for (const [key, node] of this.nodes) {
      dependedBy.set(key, new Set());
      pendingDeps.set(key, node.dependsOn.size);
    }
    
    // 역방향 엣지 구축
    for (const [key, node] of this.nodes) {
      for (const depKey of node.dependsOn) {
        if (dependedBy.has(depKey)) {
          dependedBy.get(depKey)!.add(key);
        }
      }
    }
    
    // BFS 큐: 의존성이 없는 노드(리프)부터 시작
    const queue: string[] = [];
    for (const [key, count] of pendingDeps) {
      if (count === 0) {
        queue.push(key);
        depths.set(key, 0);
      }
    }
    
    let maxDepth = 0;
    
    // BFS 처리
    while (queue.length > 0) {
      const key = queue.shift()!;
      const currentDepth = depths.get(key) || 0;
      maxDepth = Math.max(maxDepth, currentDepth);
      
      // 이 노드를 의존하는 부모 노드들 처리
      const parents = dependedBy.get(key);
      if (parents) {
        for (const parentKey of parents) {
          const remaining = pendingDeps.get(parentKey)! - 1;
          pendingDeps.set(parentKey, remaining);
          
          // 부모의 깊이 업데이트: max(현재 깊이, 자식 깊이 + 1)
          const parentDepth = depths.get(parentKey) || 0;
          depths.set(parentKey, Math.max(parentDepth, currentDepth + 1));
          
          // 모든 의존성이 처리되면 큐에 추가
          if (remaining === 0) {
            queue.push(parentKey);
          }
        }
      }
    }
    
    // 순환 의존성으로 처리되지 않은 노드들 처리
    for (const key of this.nodes.keys()) {
      if (!depths.has(key)) {
        depths.set(key, 0);
      }
      maxDepth = Math.max(maxDepth, depths.get(key)!);
    }

    return {
      totalPackages: this.nodes.size,
      totalSize: this.getTotalSize(),
      missingCount: this.missingDeps.length,
      conflictCount: this.conflicts.size,
      maxDepth,
    };
  }
}
