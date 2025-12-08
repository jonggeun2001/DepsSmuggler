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
    const result: OSPackageInfo[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>(); // 순환 감지용

    const visit = (key: string): void => {
      if (visited.has(key)) return;
      if (temp.has(key)) {
        // 순환 의존성 발견 - 건너뛰기
        console.warn(`Circular dependency detected involving: ${key}`);
        return;
      }

      temp.add(key);
      const node = this.nodes.get(key);
      if (node) {
        // 먼저 의존하는 패키지들 방문
        Array.from(node.dependsOn).forEach((depKey) => {
          visit(depKey);
        });
        result.push(node.package);
      }
      temp.delete(key);
      visited.add(key);
    };

    // 모든 노드 방문
    Array.from(this.nodes.keys()).forEach((key) => {
      visit(key);
    });

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
    // 최대 깊이 계산
    const depths = new Map<string, number>();
    const calculateDepth = (key: string): number => {
      if (depths.has(key)) return depths.get(key)!;

      const node = this.nodes.get(key);
      if (!node || node.dependsOn.size === 0) {
        depths.set(key, 0);
        return 0;
      }

      let maxChildDepth = 0;
      Array.from(node.dependsOn).forEach((childKey) => {
        maxChildDepth = Math.max(maxChildDepth, calculateDepth(childKey));
      });

      const depth = maxChildDepth + 1;
      depths.set(key, depth);
      return depth;
    };

    let maxDepth = 0;
    Array.from(this.nodes.keys()).forEach((key) => {
      maxDepth = Math.max(maxDepth, calculateDepth(key));
    });

    return {
      totalPackages: this.nodes.size,
      totalSize: this.getTotalSize(),
      missingCount: this.missingDeps.length,
      conflictCount: this.conflicts.size,
      maxDepth,
    };
  }
}
