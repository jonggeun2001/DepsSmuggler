/**
 * Maven BOM (Bill of Materials) 및 Parent POM 처리기
 *
 * MavenResolver에서 분리된 BOM/Parent 처리 로직
 * dependencyManagement 섹션의 버전 관리 및 BOM import 처리
 */

import { PomProject, PomDependency, MavenCoordinate } from './maven-types';
import { resolveProperty } from './maven-pom-utils';
import logger from '../../utils/logger';

/** POM 조회 함수 타입 */
export type FetchPomFunction = (coordinate: MavenCoordinate) => Promise<PomProject>;

/**
 * Maven BOM 및 Parent POM 처리 클래스
 *
 * dependencyManagement의 버전 정보를 수집하고 관리
 * Parent POM 체인을 따라가며 프로퍼티 상속 처리
 */
export class MavenBomProcessor {
  /** 의존성 버전 관리 맵 (groupId:artifactId -> version) */
  private dependencyManagement: Map<string, string>;

  /** POM 조회 함수 (외부 주입) */
  private fetchPom: FetchPomFunction;

  constructor(fetchPom: FetchPomFunction, dependencyManagement?: Map<string, string>) {
    this.fetchPom = fetchPom;
    this.dependencyManagement = dependencyManagement || new Map();
  }

  /**
   * dependencyManagement 맵 반환
   */
  getDependencyManagement(): Map<string, string> {
    return this.dependencyManagement;
  }

  /**
   * dependencyManagement 맵 설정
   */
  setDependencyManagement(dm: Map<string, string>): void {
    this.dependencyManagement = dm;
  }

  /**
   * dependencyManagement 초기화
   */
  clearDependencyManagement(): void {
    this.dependencyManagement.clear();
  }

  /**
   * Parent POM 체인을 처리하여 프로퍼티 상속
   *
   * @param pom - 현재 POM
   * @param coordinate - 현재 POM의 좌표
   * @param inheritedProperties - 상속받은 프로퍼티
   * @returns 병합된 프로퍼티
   */
  async processParentPom(
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
    const parentVersion = resolveProperty(pom.parent.version || '', mergedProperties);

    if (!parentArtifactId || !parentVersion) return mergedProperties;

    try {
      const parentCoordinate: MavenCoordinate = {
        groupId: parentGroupId,
        artifactId: parentArtifactId,
        version: parentVersion,
      };

      const parentPom = await this.fetchPom(parentCoordinate);

      // Parent의 parent도 재귀적으로 처리하고 properties 체인 받아오기
      const parentProperties = await this.processParentPom(
        parentPom,
        parentCoordinate,
        mergedProperties
      );

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
      await this.processDependencyManagement(parentPom, parentProperties);

      return finalProperties;
    } catch (error) {
      logger.debug('Parent POM 로드 실패 (계속 진행)', {
        parent: `${parentGroupId}:${parentArtifactId}:${parentVersion}`,
      });
      return mergedProperties;
    }
  }

  /**
   * dependencyManagement 섹션 처리
   *
   * BOM import와 일반 의존성 버전 등록
   *
   * @param pom - POM 프로젝트
   * @param properties - 프로퍼티 맵
   */
  async processDependencyManagement(
    pom: PomProject,
    properties?: Record<string, string>
  ): Promise<void> {
    const managed = pom.dependencyManagement?.dependencies?.dependency;
    if (!managed) return;

    const deps = Array.isArray(managed) ? managed : [managed];

    // BOM import를 먼저 수집하고 병렬로 처리
    const bomImports: { dep: PomDependency; properties?: Record<string, string> }[] = [];

    for (const dep of deps) {
      // BOM import 수집
      if (dep.scope === 'import' && dep.type === 'pom') {
        bomImports.push({ dep, properties });
      } else {
        // 일반 의존성 버전 등록
        const version = resolveProperty(dep.version || '', properties);
        if (version) {
          const key = `${dep.groupId}:${dep.artifactId}`;
          // 먼저 정의된 것이 우선 (Nearest Definition)
          if (!this.dependencyManagement.has(key)) {
            this.dependencyManagement.set(key, version);
          }
        }
      }
    }

    // BOM import를 병렬로 처리 (모두 완료될 때까지 대기)
    if (bomImports.length > 0) {
      await Promise.all(
        bomImports.map(async ({ dep, properties }) => {
          try {
            await this.importBom(dep, properties);
          } catch (err) {
            logger.debug('BOM import 실패', { dep: `${dep.groupId}:${dep.artifactId}`, err });
          }
        })
      );
    }
  }

  /**
   * BOM POM import 처리
   *
   * @param dep - BOM 의존성
   * @param properties - 프로퍼티 맵
   */
  async importBom(dep: PomDependency, properties?: Record<string, string>): Promise<void> {
    const version = resolveProperty(dep.version || '', properties);
    if (!version) return;

    try {
      const bomCoordinate: MavenCoordinate = {
        groupId: dep.groupId,
        artifactId: dep.artifactId,
        version,
      };

      const bomPom = await this.fetchPom(bomCoordinate);

      // BOM의 parent POM 체인을 처리하여 properties 상속받기
      // 예: spring-boot-dependencies의 ${jakarta.el-api.version} 같은 프로퍼티가 parent에서 정의됨
      const bomProperties = await this.processParentPom(bomPom, bomCoordinate);

      // 상속받은 properties로 dependencyManagement 처리
      await this.processDependencyManagement(bomPom, bomProperties);
    } catch (error) {
      logger.debug('BOM import 실패', { bom: `${dep.groupId}:${dep.artifactId}:${version}` });
    }
  }
}
