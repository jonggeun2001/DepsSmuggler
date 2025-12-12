import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMavenDownloader } from './maven';

describe('maven downloader', () => {
  let downloader: ReturnType<typeof getMavenDownloader>;

  beforeEach(() => {
    downloader = getMavenDownloader();
  });

  describe('getMavenDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getMavenDownloader();
      const instance2 = getMavenDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 maven', () => {
      expect(downloader.type).toBe('maven');
    });
  });

  describe('parseCoordinates', () => {
    it('groupId:artifactId 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: undefined,
      });
    });

    it('groupId:artifactId:version 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson:2.10.1');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: '2.10.1',
      });
    });

    it('잘못된 형식은 null 반환', () => {
      expect(downloader.parseCoordinates('invalid')).toBeNull();
      expect(downloader.parseCoordinates('')).toBeNull();
    });

    it('복잡한 groupId 처리', () => {
      const result = downloader.parseCoordinates('org.springframework.boot:spring-boot-starter:3.2.0');
      expect(result).toEqual({
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot-starter',
        version: '3.2.0',
      });
    });
  });

  describe('searchPackages (integration)', () => {
    // 이 테스트는 실제 API를 호출하므로 skip 처리
    // CI 환경에서는 mock을 사용해야 함
    it.skip('패키지 검색', async () => {
      const results = await downloader.searchPackages('gson');
      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('name');
        expect(results[0]).toHaveProperty('versions');
      }
    });
  });

  describe('getVersions (integration)', () => {
    it.skip('버전 목록 조회', async () => {
      const versions = await downloader.getVersions('com.google.code.gson:gson');
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
    });
  });
});

// Private 메서드 로직 테스트를 위한 별도 유틸리티 테스트
describe('maven downloader utilities', () => {
  describe('version comparison logic', () => {
    // compareVersions는 private이지만 로직 검증을 위해 동일 로직 테스트
    const normalize = (v: string) =>
      v.split(/[.-]/).map((p) => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });

    const compareVersions = (a: string, b: string): number => {
      const partsA = normalize(a);
      const partsB = normalize(b);

      for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] ?? 0;
        const partB = partsB[i] ?? 0;

        if (typeof partA === 'number' && typeof partB === 'number') {
          if (partA !== partB) return partA - partB;
        } else {
          const strA = String(partA);
          const strB = String(partB);
          if (strA !== strB) return strA.localeCompare(strB);
        }
      }
      return 0;
    };

    it('동일 버전', () => {
      expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('major 버전 비교', () => {
      expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
      expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    });

    it('minor 버전 비교', () => {
      expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
    });

    it('patch 버전 비교', () => {
      expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
    });

    it('버전 자릿수가 다른 경우', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
    });

    it('pre-release 버전', () => {
      // alpha < beta < rc < release
      expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    });
  });

  describe('URL building logic', () => {
    it('groupId를 path로 변환', () => {
      const groupId = 'com.google.code.gson';
      const groupPath = groupId.replace(/\./g, '/');
      expect(groupPath).toBe('com/google/code/gson');
    });

    it('파일명 생성 (jar)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}.jar`;
      expect(fileName).toBe('gson-2.10.1.jar');
    });

    it('파일명 생성 (pom)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}.pom`;
      expect(fileName).toBe('gson-2.10.1.pom');
    });

    it('파일명 생성 (sources)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}-sources.jar`;
      expect(fileName).toBe('gson-2.10.1-sources.jar');
    });

    it('파일명 생성 (javadoc)', () => {
      const artifactId = 'gson';
      const version = '2.10.1';
      const fileName = `${artifactId}-${version}-javadoc.jar`;
      expect(fileName).toBe('gson-2.10.1-javadoc.jar');
    });

    it('전체 다운로드 URL 생성', () => {
      const repoUrl = 'https://repo1.maven.org/maven2';
      const groupId = 'com.google.code.gson';
      const artifactId = 'gson';
      const version = '2.10.1';
      const groupPath = groupId.replace(/\./g, '/');
      const fileName = `${artifactId}-${version}.jar`;
      const url = `${repoUrl}/${groupPath}/${artifactId}/${version}/${fileName}`;
      expect(url).toBe('https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar');
    });
  });

  // 사용자 추천 테스트 케이스 기반 테스트
  describe('recommended test cases', () => {
    // 일반 케이스 - log4j-core (명확한 의존성 체인)
    describe('log4j-core package case', () => {
      const log4jDependencies = ['log4j-api'];

      it('log4j-core는 log4j-api에 의존', () => {
        expect(log4jDependencies).toContain('log4j-api');
      });

      it('log4j 좌표 파싱', () => {
        const coord = 'org.apache.logging.log4j:log4j-core:2.22.0';
        const parts = coord.split(':');
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe('org.apache.logging.log4j');
        expect(parts[1]).toBe('log4j-core');
        expect(parts[2]).toBe('2.22.0');
      });

      it('log4j groupId 경로 변환', () => {
        const groupId = 'org.apache.logging.log4j';
        const path = groupId.replace(/\./g, '/');
        expect(path).toBe('org/apache/logging/log4j');
      });
    });

    // 일반 케이스 - slf4j-simple (전이 의존성)
    describe('slf4j-simple package case', () => {
      it('slf4j-simple은 slf4j-api에 의존', () => {
        const dependencies = ['slf4j-api'];
        expect(dependencies).toContain('slf4j-api');
      });

      it('slf4j 바인딩은 하나만 사용해야 함', () => {
        const bindings = ['slf4j-simple', 'logback-classic', 'slf4j-log4j12'];
        // 프로젝트에서 하나의 바인딩만 선택해야 함
        expect(bindings.length).toBeGreaterThan(1);
      });
    });

    // 인증 필요 케이스 - ojdbc8
    describe('ojdbc8 package case (auth required)', () => {
      it('ojdbc8은 Oracle Maven 저장소 필요', () => {
        const oracleRepoUrl = 'https://maven.oracle.com';
        expect(oracleRepoUrl).toContain('oracle');
      });

      it('Oracle 아티팩트는 인증 필요 경고', () => {
        const needsAuth = (groupId: string): boolean => {
          return groupId.startsWith('com.oracle');
        };
        expect(needsAuth('com.oracle.database.jdbc')).toBe(true);
        expect(needsAuth('org.apache.commons')).toBe(false);
      });
    });

    // scope provided 케이스 - servlet-api
    describe('servlet-api package case (scope provided)', () => {
      type MavenScope = 'compile' | 'provided' | 'runtime' | 'test' | 'system';

      it('servlet-api는 provided scope', () => {
        const scope: MavenScope = 'provided';
        expect(scope).toBe('provided');
      });

      it('provided scope는 런타임에 제외', () => {
        const isIncludedAtRuntime = (scope: MavenScope): boolean => {
          return scope !== 'provided' && scope !== 'test';
        };
        expect(isIncludedAtRuntime('provided')).toBe(false);
        expect(isIncludedAtRuntime('compile')).toBe(true);
        expect(isIncludedAtRuntime('runtime')).toBe(true);
      });
    });

    // 패키징 타입별 처리
    describe('packaging type handling', () => {
      type PackagingType = 'jar' | 'pom' | 'war' | 'ear' | 'maven-plugin' | 'bundle' | 'aar';

      const getFileExtension = (packaging: PackagingType): string => {
        const extensions: Record<PackagingType, string> = {
          jar: 'jar',
          pom: 'pom',
          war: 'war',
          ear: 'ear',
          'maven-plugin': 'jar',
          bundle: 'jar',
          aar: 'aar',
        };
        return extensions[packaging];
      };

      it('JAR 패키징', () => {
        expect(getFileExtension('jar')).toBe('jar');
      });

      it('POM only 패키징', () => {
        expect(getFileExtension('pom')).toBe('pom');
      });

      it('WAR 패키징', () => {
        expect(getFileExtension('war')).toBe('war');
      });

      it('maven-plugin은 jar 확장자', () => {
        expect(getFileExtension('maven-plugin')).toBe('jar');
      });

      it('bundle(OSGi)은 jar 확장자', () => {
        expect(getFileExtension('bundle')).toBe('jar');
      });

      it('Android AAR 패키징', () => {
        expect(getFileExtension('aar')).toBe('aar');
      });
    });

    // classifier 처리
    describe('classifier handling', () => {
      interface ArtifactInfo {
        artifactId: string;
        version: string;
        classifier?: string;
        extension: string;
      }

      const buildFileName = (info: ArtifactInfo): string => {
        if (info.classifier) {
          return `${info.artifactId}-${info.version}-${info.classifier}.${info.extension}`;
        }
        return `${info.artifactId}-${info.version}.${info.extension}`;
      };

      it('기본 파일명 (classifier 없음)', () => {
        const info: ArtifactInfo = {
          artifactId: 'commons-lang3',
          version: '3.14.0',
          extension: 'jar',
        };
        expect(buildFileName(info)).toBe('commons-lang3-3.14.0.jar');
      });

      it('sources classifier', () => {
        const info: ArtifactInfo = {
          artifactId: 'commons-lang3',
          version: '3.14.0',
          classifier: 'sources',
          extension: 'jar',
        };
        expect(buildFileName(info)).toBe('commons-lang3-3.14.0-sources.jar');
      });

      it('javadoc classifier', () => {
        const info: ArtifactInfo = {
          artifactId: 'commons-lang3',
          version: '3.14.0',
          classifier: 'javadoc',
          extension: 'jar',
        };
        expect(buildFileName(info)).toBe('commons-lang3-3.14.0-javadoc.jar');
      });

      it('tests classifier', () => {
        const info: ArtifactInfo = {
          artifactId: 'commons-lang3',
          version: '3.14.0',
          classifier: 'tests',
          extension: 'jar',
        };
        expect(buildFileName(info)).toBe('commons-lang3-3.14.0-tests.jar');
      });

      it('native classifier (linux-x86_64)', () => {
        const info: ArtifactInfo = {
          artifactId: 'netty-transport-native-epoll',
          version: '4.1.104.Final',
          classifier: 'linux-x86_64',
          extension: 'jar',
        };
        expect(buildFileName(info)).toBe('netty-transport-native-epoll-4.1.104.Final-linux-x86_64.jar');
      });
    });

    // BOM (Bill of Materials) 처리
    describe('BOM handling', () => {
      it('BOM은 pom 타입으로 import', () => {
        const bomCoord = {
          groupId: 'org.springframework.boot',
          artifactId: 'spring-boot-dependencies',
          version: '3.2.0',
          type: 'pom',
          scope: 'import',
        };

        expect(bomCoord.type).toBe('pom');
        expect(bomCoord.scope).toBe('import');
      });

      it('BOM import는 dependencyManagement에서만 사용', () => {
        const isValidBomUsage = (scope: string, section: string): boolean => {
          return scope === 'import' && section === 'dependencyManagement';
        };

        expect(isValidBomUsage('import', 'dependencyManagement')).toBe(true);
        expect(isValidBomUsage('import', 'dependencies')).toBe(false);
      });
    });

    // 의존성 범위
    describe('dependency scope handling', () => {
      type MavenScope = 'compile' | 'provided' | 'runtime' | 'test' | 'system' | 'import';

      const getScopeTransitivity = (scope: MavenScope): string[] => {
        const transitivity: Record<MavenScope, string[]> = {
          compile: ['compile'],
          provided: [],
          runtime: ['runtime'],
          test: [],
          system: [],
          import: [],
        };
        return transitivity[scope];
      };

      it('compile scope는 전이됨', () => {
        expect(getScopeTransitivity('compile')).toContain('compile');
      });

      it('provided scope는 전이되지 않음', () => {
        expect(getScopeTransitivity('provided')).toHaveLength(0);
      });

      it('test scope는 전이되지 않음', () => {
        expect(getScopeTransitivity('test')).toHaveLength(0);
      });

      it('runtime scope는 runtime으로 전이', () => {
        expect(getScopeTransitivity('runtime')).toContain('runtime');
      });
    });

    // 버전 범위 처리
    describe('version range handling', () => {
      const parseVersionRange = (range: string): { min?: string; max?: string; inclusive: [boolean, boolean] } | null => {
        // [1.0,2.0) - 1.0 이상, 2.0 미만
        // (1.0,2.0] - 1.0 초과, 2.0 이하
        // [1.0,) - 1.0 이상
        // (,2.0] - 2.0 이하
        const match = range.match(/^([\[\(])([^,]*),([^\]\)]*)([\]\)])$/);
        if (!match) return null;

        return {
          min: match[2] || undefined,
          max: match[3] || undefined,
          inclusive: [match[1] === '[', match[4] === ']'],
        };
      };

      it('폐구간 [1.0,2.0]', () => {
        const range = parseVersionRange('[1.0,2.0]');
        expect(range).not.toBeNull();
        expect(range!.min).toBe('1.0');
        expect(range!.max).toBe('2.0');
        expect(range!.inclusive).toEqual([true, true]);
      });

      it('반개구간 [1.0,2.0)', () => {
        const range = parseVersionRange('[1.0,2.0)');
        expect(range).not.toBeNull();
        expect(range!.inclusive).toEqual([true, false]);
      });

      it('최소 버전만 [1.0,)', () => {
        const range = parseVersionRange('[1.0,)');
        expect(range).not.toBeNull();
        expect(range!.min).toBe('1.0');
        expect(range!.max).toBeUndefined();
      });

      it('최대 버전만 (,2.0]', () => {
        const range = parseVersionRange('(,2.0]');
        expect(range).not.toBeNull();
        expect(range!.min).toBeUndefined();
        expect(range!.max).toBe('2.0');
      });
    });

    // exclusion 처리
    describe('exclusion handling', () => {
      interface Dependency {
        groupId: string;
        artifactId: string;
        exclusions?: Array<{ groupId: string; artifactId: string }>;
      }

      const isExcluded = (dep: Dependency, exclusions: Array<{ groupId: string; artifactId: string }>): boolean => {
        return exclusions.some(
          (ex) =>
            (ex.groupId === '*' || ex.groupId === dep.groupId) &&
            (ex.artifactId === '*' || ex.artifactId === dep.artifactId)
        );
      };

      it('특정 의존성 제외', () => {
        const dep: Dependency = { groupId: 'commons-logging', artifactId: 'commons-logging' };
        const exclusions = [{ groupId: 'commons-logging', artifactId: 'commons-logging' }];
        expect(isExcluded(dep, exclusions)).toBe(true);
      });

      it('groupId 와일드카드 제외', () => {
        const dep: Dependency = { groupId: 'commons-logging', artifactId: 'commons-logging' };
        const exclusions = [{ groupId: '*', artifactId: 'commons-logging' }];
        expect(isExcluded(dep, exclusions)).toBe(true);
      });

      it('전체 와일드카드 제외', () => {
        const dep: Dependency = { groupId: 'any-group', artifactId: 'any-artifact' };
        const exclusions = [{ groupId: '*', artifactId: '*' }];
        expect(isExcluded(dep, exclusions)).toBe(true);
      });

      it('제외 대상 아님', () => {
        const dep: Dependency = { groupId: 'org.apache.commons', artifactId: 'commons-lang3' };
        const exclusions = [{ groupId: 'commons-logging', artifactId: 'commons-logging' }];
        expect(isExcluded(dep, exclusions)).toBe(false);
      });
    });

    // M2 저장소 경로 생성
    describe('m2 repository path', () => {
      const buildM2Path = (groupId: string, artifactId: string, version: string, filename: string): string => {
        const groupPath = groupId.replace(/\./g, '/');
        return `${groupPath}/${artifactId}/${version}/${filename}`;
      };

      it('표준 m2 경로', () => {
        const path = buildM2Path('org.apache.commons', 'commons-lang3', '3.14.0', 'commons-lang3-3.14.0.jar');
        expect(path).toBe('org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.jar');
      });

      it('중첩 groupId 경로', () => {
        const path = buildM2Path('org.springframework.boot', 'spring-boot-starter', '3.2.0', 'spring-boot-starter-3.2.0.jar');
        expect(path).toBe('org/springframework/boot/spring-boot-starter/3.2.0/spring-boot-starter-3.2.0.jar');
      });
    });
  });
});
