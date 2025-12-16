/**
 * MavenResolver 단위 테스트
 *
 * 네트워크 호출 없이 MavenResolver의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MavenResolver } from './maven-resolver';
// 분리된 유틸리티 함수 import
import {
  resolveProperty,
  resolveVersionRange,
  extractExclusions,
  extractDependencies,
} from '../shared/maven-pom-utils';

// MavenResolver 인스턴스 생성
const createResolver = () => {
  return new MavenResolver();
};

describe('MavenResolver 단위 테스트', () => {
  let resolver: MavenResolver;

  beforeEach(() => {
    resolver = createResolver();
  });

  describe('resolveProperty (유틸리티 함수)', () => {
    it('빈 값은 그대로 반환', () => {
      expect(resolveProperty('')).toBe('');
    });

    it('플레이스홀더가 없으면 그대로 반환', () => {
      expect(resolveProperty('1.0.0')).toBe('1.0.0');
    });

    it('단순 속성 치환', () => {
      const properties = { 'spring.version': '5.3.0' };
      expect(resolveProperty('${spring.version}', properties)).toBe('5.3.0');
    });

    it('여러 속성 치환', () => {
      const properties = {
        major: '5',
        minor: '3',
        patch: '0',
      };
      expect(resolveProperty('${major}.${minor}.${patch}', properties)).toBe('5.3.0');
    });

    it('project.version 특수 처리', () => {
      const properties = { version: '1.0.0' };
      expect(resolveProperty('${project.version}', properties)).toBe('1.0.0');
    });

    it('pom.version 특수 처리', () => {
      const properties = { version: '2.0.0' };
      expect(resolveProperty('${pom.version}', properties)).toBe('2.0.0');
    });

    it('project.groupId 특수 처리', () => {
      const properties = { groupId: 'org.example' };
      expect(resolveProperty('${project.groupId}', properties)).toBe('org.example');
    });

    it('project.artifactId 특수 처리', () => {
      const properties = { artifactId: 'my-artifact' };
      expect(resolveProperty('${project.artifactId}', properties)).toBe('my-artifact');
    });

    it('존재하지 않는 속성은 치환하지 않음', () => {
      const properties = { existing: 'value' };
      expect(resolveProperty('${nonexistent}', properties)).toBe('${nonexistent}');
    });

    it('중첩 속성 치환 (최대 10회)', () => {
      const properties = {
        outer: '${inner}',
        inner: 'resolved',
      };
      expect(resolveProperty('${outer}', properties)).toBe('resolved');
    });

    it('properties가 undefined인 경우', () => {
      expect(resolveProperty('${any.property}', undefined)).toBe('${any.property}');
    });
  });

  describe('shouldIncludeDependency', () => {
    const callShouldIncludeDependency = (
      resolver: MavenResolver,
      dep: any,
      includeOptional: boolean
    ): boolean => {
      return (resolver as any).shouldIncludeDependency(dep, includeOptional);
    };

    it('compile scope는 포함', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', scope: 'compile' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(true);
    });

    it('runtime scope는 포함', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', scope: 'runtime' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(true);
    });

    it('test scope는 제외', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', scope: 'test' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(false);
    });

    it('provided scope는 제외', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', scope: 'provided' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(false);
    });

    it('system scope는 제외', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', scope: 'system' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(false);
    });

    it('optional (string "true")은 includeOptional=false일 때 제외', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', optional: 'true' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(false);
    });

    it('optional (boolean true)은 includeOptional=false일 때 제외', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', optional: true };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(false);
    });

    it('optional은 includeOptional=true일 때 포함', () => {
      const dep = { groupId: 'org.example', artifactId: 'test', optional: 'true' };
      expect(callShouldIncludeDependency(resolver, dep, true)).toBe(true);
    });

    it('scope가 없으면 (기본 compile) 포함', () => {
      const dep = { groupId: 'org.example', artifactId: 'test' };
      expect(callShouldIncludeDependency(resolver, dep, false)).toBe(true);
    });
  });

  describe('resolveVersionRange (유틸리티 함수)', () => {
    it('일반 버전은 그대로 반환', () => {
      expect(resolveVersionRange('1.0.0')).toBe('1.0.0');
    });

    it('[1.0,2.0) 범위에서 최소 버전 추출', () => {
      expect(resolveVersionRange('[1.0,2.0)')).toBe('1.0');
    });

    it('[1.0,) 범위에서 최소 버전 추출', () => {
      expect(resolveVersionRange('[1.0,)')).toBe('1.0');
    });

    it('(1.0,2.0] 범위에서 최소 버전 추출', () => {
      expect(resolveVersionRange('(1.0,2.0]')).toBe('1.0');
    });

    it('[1.5.0,2.0.0) 정확한 버전 범위', () => {
      expect(resolveVersionRange('[1.5.0,2.0.0)')).toBe('1.5.0');
    });

    it('[1.0] 고정 버전 범위', () => {
      expect(resolveVersionRange('[1.0]')).toBe('1.0');
    });
  });

  describe('extractExclusions (유틸리티 함수)', () => {
    it('exclusions가 없으면 빈 Set 반환', () => {
      const dep = { groupId: 'org.example', artifactId: 'test' };
      const result = extractExclusions(dep);
      expect(result.size).toBe(0);
    });

    it('단일 exclusion 처리', () => {
      const dep = {
        groupId: 'org.example',
        artifactId: 'test',
        exclusions: {
          exclusion: { groupId: 'org.excluded', artifactId: 'artifact' },
        },
      };
      const result = extractExclusions(dep);
      expect(result.size).toBe(1);
      expect(result.has('org.excluded:artifact')).toBe(true);
    });

    it('여러 exclusion 처리', () => {
      const dep = {
        groupId: 'org.example',
        artifactId: 'test',
        exclusions: {
          exclusion: [
            { groupId: 'org.excluded1', artifactId: 'artifact1' },
            { groupId: 'org.excluded2', artifactId: 'artifact2' },
          ],
        },
      };
      const result = extractExclusions(dep);
      expect(result.size).toBe(2);
      expect(result.has('org.excluded1:artifact1')).toBe(true);
      expect(result.has('org.excluded2:artifact2')).toBe(true);
    });

    it('와일드카드 exclusion 처리', () => {
      const dep = {
        groupId: 'org.example',
        artifactId: 'test',
        exclusions: {
          exclusion: { groupId: '*', artifactId: '*' },
        },
      };
      const result = extractExclusions(dep);
      expect(result.size).toBe(1);
      expect(result.has('*:*')).toBe(true);
    });
  });

  describe('createDependencyNode', () => {
    const callCreateDependencyNode = (
      resolver: MavenResolver,
      coordinate: any,
      scope: string
    ): any => {
      return (resolver as any).createDependencyNode(coordinate, scope);
    };

    it('기본 노드 생성', () => {
      const coordinate = {
        groupId: 'org.example',
        artifactId: 'test',
        version: '1.0.0',
      };
      const result = callCreateDependencyNode(resolver, coordinate, 'compile');

      expect(result).toEqual({
        package: {
          type: 'maven',
          name: 'org.example:test',
          version: '1.0.0',
          metadata: {
            groupId: 'org.example',
            artifactId: 'test',
            classifier: undefined,
            type: undefined,
          },
        },
        dependencies: [],
        scope: 'compile',
      });
    });

    it('classifier와 type 포함 노드 생성', () => {
      const coordinate = {
        groupId: 'org.example',
        artifactId: 'test',
        version: '1.0.0',
        classifier: 'sources',
        type: 'jar',
      };
      const result = callCreateDependencyNode(resolver, coordinate, 'runtime');

      expect(result.package.metadata.classifier).toBe('sources');
      expect(result.package.metadata.type).toBe('jar');
      expect(result.scope).toBe('runtime');
    });
  });

  describe('extractDependencies (유틸리티 함수)', () => {
    it('dependencies가 있으면 배열로 반환', () => {
      const pom = {
        dependencies: {
          dependency: [
            { groupId: 'org.example', artifactId: 'dep1', version: '1.0' },
            { groupId: 'org.example', artifactId: 'dep2', version: '2.0' },
          ],
        },
      };
      const coordinate = { groupId: 'org.test', artifactId: 'test', version: '1.0.0' };
      const result = extractDependencies(pom, coordinate, false);

      expect(result).toHaveLength(2);
      expect(result[0].artifactId).toBe('dep1');
      expect(result[1].artifactId).toBe('dep2');
    });

    it('단일 dependency는 배열로 변환', () => {
      const pom = {
        dependencies: {
          dependency: { groupId: 'org.example', artifactId: 'single', version: '1.0' },
        },
      };
      const coordinate = { groupId: 'org.test', artifactId: 'test', version: '1.0.0' };
      const result = extractDependencies(pom, coordinate, false);

      expect(result).toHaveLength(1);
      expect(result[0].artifactId).toBe('single');
    });

    it('dependencies가 없으면 빈 배열 반환', () => {
      const pom = {};
      const coordinate = { groupId: 'org.test', artifactId: 'test', version: '1.0.0' };
      const result = extractDependencies(pom as any, coordinate, false);

      expect(result).toHaveLength(0);
    });

    it('BOM/Parent POM에서 dependencyManagement만 있으면 빈 배열 반환 (버전 관리용)', () => {
      const pom = {
        packaging: 'pom',
        dependencyManagement: {
          dependencies: {
            dependency: [
              { groupId: 'org.managed', artifactId: 'dep1', version: '1.0' },
              { groupId: 'org.managed', artifactId: 'dep2', version: '2.0' },
            ],
          },
        },
      };
      const coordinate = { groupId: 'org.test', artifactId: 'test', version: '1.0.0' };
      const result = extractDependencies(pom as any, coordinate, true);

      // dependencyManagement는 버전 관리용이므로 의존성으로 반환하지 않음
      expect(result).toHaveLength(0);
    });

    it('dependencies와 dependencyManagement 둘 다 있으면 dependencies만 반환', () => {
      const pom = {
        dependencies: {
          dependency: [{ groupId: 'org.actual', artifactId: 'real-dep', version: '1.0' }],
        },
        dependencyManagement: {
          dependencies: {
            dependency: [
              { groupId: 'org.managed', artifactId: 'managed1', version: '2.0' },
              { groupId: 'org.managed', artifactId: 'managed2', version: '3.0' },
            ],
          },
        },
      };
      const coordinate = { groupId: 'org.test', artifactId: 'test', version: '1.0.0' };
      const result = extractDependencies(pom as any, coordinate, true);

      // 실제 dependencies 섹션만 반환
      expect(result).toHaveLength(1);
      expect(result[0].artifactId).toBe('real-dep');
    });
  });

  describe('캐시 관리', () => {
    it('clearCache 호출 시 에러 없음', () => {
      expect(() => resolver.clearCache()).not.toThrow();
    });

    it('setCacheOptions 호출 시 에러 없음', () => {
      expect(() => resolver.setCacheOptions({ maxSize: 100 })).not.toThrow();
    });

    it('getSkipperStats 호출 시 객체 반환', () => {
      const stats = resolver.getSkipperStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });
  });

  describe('parseFromText', () => {
    it('pom.xml 텍스트에서 의존성 파싱', async () => {
      const pomText = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>test-project</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.0</version>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`;

      const result = await resolver.parseFromText(pomText);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThanOrEqual(1);
      // test scope는 제외되어야 함
      const springCore = result.find((p) => p.name.includes('spring-core'));
      expect(springCore).toBeDefined();
    });

    it('의존성 없는 pom.xml은 프로젝트 자체만 반환', async () => {
      const pomText = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>empty-project</artifactId>
  <version>1.0.0</version>
</project>`;

      const result = await resolver.parseFromText(pomText);
      expect(result).toBeDefined();
      // 프로젝트 자체가 포함되므로 1개
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('org.example:empty-project');
      expect(result[0].version).toBe('1.0.0');
    });

    it('property가 있는 pom.xml 파싱', async () => {
      const pomText = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>property-project</artifactId>
  <version>1.0.0</version>
  <properties>
    <spring.version>5.3.0</spring.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>\${spring.version}</version>
    </dependency>
  </dependencies>
</project>`;

      const result = await resolver.parseFromText(pomText);
      expect(result).toBeDefined();
      // 프로젝트 자체 + spring-core 의존성 = 2개
      expect(result.length).toBe(2);
      const springCore = result.find((p) => p.name.includes('spring-core'));
      expect(springCore).toBeDefined();
      expect(springCore?.version).toBe('5.3.0');
    });
  });
});
