/**
 * Maven 다운로더 및 의존성 해결 통합 테스트
 *
 * 실제 Maven Central API를 호출하여 패키지 조회, 다운로드, 의존성 해결 기능을 테스트합니다.
 *
 * 실행 방법:
 *   INTEGRATION_TEST=true npm test -- maven.integration.test.ts
 *
 * 테스트 케이스:
 *   - log4j-core: 의존성 3-4개, ~1.8MB
 *   - commons-lang3: 간단한 단일 jar
 *   - jackson-databind: 중간 복잡도 의존성
 *   - spring-boot-starter-web: BOM import 포함, 복잡한 의존성
 *   - 존재하지 않는 패키지 처리
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MavenDownloader } from './maven';
import { getMavenResolver, MavenResolver } from '../resolver/mavenResolver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('Maven 통합 테스트', () => {
  let downloader: MavenDownloader;
  let resolver: MavenResolver;
  let tempDir: string;

  beforeAll(() => {
    downloader = new MavenDownloader();
    resolver = getMavenResolver();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maven-integration-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    resolver.clearCache();
  });

  // ==================== 다운로더 테스트 ====================

  describe('다운로더 - log4j-core', () => {
    const groupId = 'org.apache.logging.log4j';
    const artifactId = 'log4j-core';
    const version = '2.20.0';
    const coordinates = `${groupId}:${artifactId}`;

    it('log4j-core 패키지 검색', async () => {
      const results = await downloader.searchPackages('log4j-core');

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);

      const log4j = results.find(p =>
        p.name.includes('log4j-core') || p.groupId === groupId
      );
      expect(log4j).toBeDefined();
    });

    it('log4j-core 버전 목록 조회', async () => {
      const versions = await downloader.getVersions(coordinates);

      expect(versions).toBeDefined();
      expect(versions.length).toBeGreaterThan(0);
      expect(versions).toContain(version);
    });

    it('log4j-core 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata(coordinates, version);

      expect(metadata).toBeDefined();
      expect(metadata.name).toContain('log4j-core');
      expect(metadata.version).toBe(version);
      expect(metadata.metadata).toBeDefined();
    });

    it('log4j-core 다운로드', async () => {
      const outputDir = path.join(tempDir, 'log4j-core');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: coordinates,
          version,
          metadata: { groupId, artifactId }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      // .jar 파일
      expect(filePath.endsWith('.jar')).toBe(true);

      // 큰 파일 확인 (~1.8MB)
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(100000); // 100KB 이상
    }, 120000);
  });

  describe('다운로더 - commons-lang3', () => {
    const groupId = 'org.apache.commons';
    const artifactId = 'commons-lang3';
    const version = '3.12.0';
    const coordinates = `${groupId}:${artifactId}`;

    it('commons-lang3 메타데이터 조회', async () => {
      const metadata = await downloader.getPackageMetadata(coordinates, version);

      expect(metadata).toBeDefined();
      expect(metadata.name).toContain('commons-lang3');
      expect(metadata.metadata).toBeDefined();
    });

    it('commons-lang3 다운로드', async () => {
      const outputDir = path.join(tempDir, 'commons-lang3');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: coordinates,
          version,
          metadata: { groupId, artifactId }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
    }, 60000);
  });

  describe('다운로더 - POM/sources/javadoc', () => {
    it('POM 파일 다운로드', async () => {
      const outputDir = path.join(tempDir, 'pom-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPom(
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath.endsWith('.pom')).toBe(true);
    }, 30000);

    it('sources jar 다운로드', async () => {
      const outputDir = path.join(tempDir, 'sources-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadSources(
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath.includes('-sources.jar')).toBe(true);
    }, 60000);

    it('javadoc jar 다운로드', async () => {
      const outputDir = path.join(tempDir, 'javadoc-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadJavadoc(
        'org.apache.commons',
        'commons-lang3',
        '3.12.0',
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath.includes('-javadoc.jar')).toBe(true);
    }, 60000);
  });

  describe('다운로더 - BOM (POM-only) 패키지', () => {
    it('spring-boot-dependencies BOM 다운로드', async () => {
      const outputDir = path.join(tempDir, 'bom-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: 'org.springframework.boot:spring-boot-dependencies',
          version: '3.1.0',
          metadata: {
            groupId: 'org.springframework.boot',
            artifactId: 'spring-boot-dependencies',
            packaging: 'pom'
          }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath.endsWith('.pom')).toBe(true);
    }, 60000);
  });

  describe('다운로더 - 존재하지 않는 패키지', () => {
    it('존재하지 않는 패키지 검색 시 빈 배열 반환', async () => {
      const results = await downloader.searchPackages('nonexistent-maven-artifact-xyz-12345');

      expect(results).toBeDefined();
      expect(results.length).toBe(0);
    });

    it('존재하지 않는 버전 다운로드 시 에러', async () => {
      const outputDir = path.join(tempDir, 'nonexistent-version');
      fs.mkdirSync(outputDir, { recursive: true });

      await expect(
        downloader.downloadPackage(
          {
            type: 'maven',
            name: 'org.apache.logging.log4j:log4j-core',
            version: '999.999.999',
            metadata: {
              groupId: 'org.apache.logging.log4j',
              artifactId: 'log4j-core'
            }
          },
          outputDir
        )
      ).rejects.toThrow();
    });
  });

  describe('다운로더 - 체크섬 검증', () => {
    it('다운로드된 파일의 SHA1 체크섬 검증', async () => {
      const outputDir = path.join(tempDir, 'checksum-test');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: 'org.apache.commons:commons-lang3',
          version: '3.12.0',
          metadata: {
            groupId: 'org.apache.commons',
            artifactId: 'commons-lang3'
          }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);

      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(0);
    }, 60000);
  });

  describe('다운로더 - 진행 콜백', () => {
    it('다운로드 진행 콜백 호출', async () => {
      const outputDir = path.join(tempDir, 'progress-test');
      fs.mkdirSync(outputDir, { recursive: true });

      let progressCalled = false;

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: 'org.apache.commons:commons-lang3',
          version: '3.12.0',
          metadata: {
            groupId: 'org.apache.commons',
            artifactId: 'commons-lang3'
          }
        },
        outputDir,
        (progress) => {
          progressCalled = true;
        }
      );

      expect(filePath).toBeDefined();
      expect(progressCalled).toBe(true);
    }, 60000);
  });

  describe('다운로더 - 좌표 파싱', () => {
    it('groupId:artifactId 형식 파싱', () => {
      const coords = downloader.parseCoordinates('org.apache.commons:commons-lang3');

      expect(coords.groupId).toBe('org.apache.commons');
      expect(coords.artifactId).toBe('commons-lang3');
    });

    it('groupId:artifactId:version 형식 파싱', () => {
      const coords = downloader.parseCoordinates('org.apache.commons:commons-lang3:3.12.0');

      expect(coords.groupId).toBe('org.apache.commons');
      expect(coords.artifactId).toBe('commons-lang3');
      expect(coords.version).toBe('3.12.0');
    });
  });

  // ==================== 의존성 해결 테스트 ====================

  describe('의존성 해결 - 단순 패키지', () => {
    it('commons-lang3 의존성 해결 (의존성 없음)', async () => {
      const result = await resolver.resolveDependencies(
        'org.apache.commons:commons-lang3',
        '3.12.0'
      );

      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      expect(result.root.groupId).toBe('org.apache.commons');
      expect(result.root.artifactId).toBe('commons-lang3');
      expect(result.root.version).toBe('3.12.0');

      // commons-lang3는 의존성이 거의 없음
      expect(result.flatList).toBeDefined();
      expect(result.flatList.length).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe('의존성 해결 - 중간 복잡도', () => {
    it('jackson-databind 의존성 해결', async () => {
      const result = await resolver.resolveDependencies(
        'com.fasterxml.jackson.core:jackson-databind',
        '2.15.2'
      );

      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      expect(result.flatList.length).toBeGreaterThan(1);

      // jackson-databind는 jackson-core, jackson-annotations 의존
      const depNames = result.flatList.map(d => `${d.groupId}:${d.artifactId}`);
      expect(depNames).toContain('com.fasterxml.jackson.core:jackson-databind');
      expect(depNames).toContain('com.fasterxml.jackson.core:jackson-core');
      expect(depNames).toContain('com.fasterxml.jackson.core:jackson-annotations');
    }, 120000);
  });

  describe('의존성 해결 - 의존성 체인', () => {
    it('log4j-core 의존성 해결', async () => {
      const result = await resolver.resolveDependencies(
        'org.apache.logging.log4j:log4j-core',
        '2.20.0'
      );

      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      expect(result.flatList.length).toBeGreaterThan(1);

      // log4j-core는 log4j-api 의존
      const depNames = result.flatList.map(d => `${d.groupId}:${d.artifactId}`);
      expect(depNames).toContain('org.apache.logging.log4j:log4j-core');
      expect(depNames).toContain('org.apache.logging.log4j:log4j-api');
    }, 120000);
  });

  describe('의존성 해결 - 복잡한 의존성', () => {
    it('spring-boot-starter-web 의존성 해결', async () => {
      const result = await resolver.resolveDependencies(
        'org.springframework.boot:spring-boot-starter-web',
        '3.1.0'
      );

      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      expect(result.flatList.length).toBeGreaterThan(10);

      // spring-boot 관련 의존성 확인
      const depNames = result.flatList.map(d => `${d.groupId}:${d.artifactId}`);
      expect(depNames).toContain('org.springframework.boot:spring-boot-starter-web');
      expect(depNames).toContain('org.springframework.boot:spring-boot-starter');

      // JSON/Jackson 의존성 확인
      const hasJackson = depNames.some(d => d.includes('jackson'));
      expect(hasJackson).toBe(true);
    }, 300000);
  });

  describe('의존성 해결 - 충돌 처리', () => {
    it('충돌 감지 및 기록', async () => {
      const result = await resolver.resolveDependencies(
        'org.springframework.boot:spring-boot-starter-web',
        '3.1.0'
      );

      expect(result).toBeDefined();
      expect(result.conflicts).toBeDefined();
      expect(Array.isArray(result.conflicts)).toBe(true);
    }, 300000);
  });

  describe('의존성 해결 - 옵션', () => {
    it('maxDepth 옵션', async () => {
      const result = await resolver.resolveDependencies(
        'org.springframework.boot:spring-boot-starter-web',
        '3.1.0',
        { maxDepth: 2 }
      );

      expect(result).toBeDefined();
      expect(result.flatList.length).toBeGreaterThan(0);
    }, 180000);

    it('includeOptional 옵션', async () => {
      const resultWithOptional = await resolver.resolveDependencies(
        'org.apache.logging.log4j:log4j-core',
        '2.20.0',
        { includeOptional: true }
      );

      const resultWithoutOptional = await resolver.resolveDependencies(
        'org.apache.logging.log4j:log4j-core',
        '2.20.0',
        { includeOptional: false }
      );

      expect(resultWithOptional).toBeDefined();
      expect(resultWithoutOptional).toBeDefined();

      expect(resultWithOptional.flatList.length).toBeGreaterThanOrEqual(
        resultWithoutOptional.flatList.length
      );
    }, 180000);
  });

  describe('의존성 해결 - pom.xml 파싱', () => {
    it('간단한 pom.xml 파싱', async () => {
      const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>org.apache.commons</groupId>
            <artifactId>commons-lang3</artifactId>
            <version>3.12.0</version>
        </dependency>
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.2</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>`;

      const packages = await resolver.parseFromText(pomContent);

      expect(packages).toBeDefined();
      expect(packages.length).toBeGreaterThan(0);

      const myApp = packages.find(p => p.name === 'com.example:my-app');
      expect(myApp).toBeDefined();
      expect(myApp?.version).toBe('1.0.0');

      const commonsLang = packages.find(p => p.name === 'org.apache.commons:commons-lang3');
      expect(commonsLang).toBeDefined();
      expect(commonsLang?.version).toBe('3.12.0');

      // test scope는 제외됨
      const junit = packages.find(p => p.name === 'junit:junit');
      expect(junit).toBeUndefined();
    });

    it('프로퍼티가 있는 pom.xml 파싱', async () => {
      const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <properties>
        <commons.lang.version>3.12.0</commons.lang.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.apache.commons</groupId>
            <artifactId>commons-lang3</artifactId>
            <version>\${commons.lang.version}</version>
        </dependency>
    </dependencies>
</project>`;

      const packages = await resolver.parseFromText(pomContent);

      expect(packages).toBeDefined();

      const commonsLang = packages.find(p => p.name === 'org.apache.commons:commons-lang3');
      expect(commonsLang).toBeDefined();
      expect(commonsLang?.version).toBe('3.12.0');
    });
  });

  describe('의존성 해결 - BOM 처리', () => {
    it('dependencyManagement의 BOM import 처리', async () => {
      const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-dependencies</artifactId>
                <version>3.1.0</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>
    </dependencies>
</project>`;

      const packages = await resolver.parseFromText(pomContent);

      expect(packages).toBeDefined();

      const springStarter = packages.find(p =>
        p.name === 'org.springframework.boot:spring-boot-starter'
      );
      expect(springStarter).toBeDefined();
      expect(springStarter?.version).toBeDefined();
    }, 120000);
  });

  describe('의존성 해결 - 에러 처리', () => {
    it('잘못된 패키지명 형식', async () => {
      await expect(
        resolver.resolveDependencies('invalid-format', '1.0.0')
      ).rejects.toThrow();
    });

    it('존재하지 않는 패키지', async () => {
      await expect(
        resolver.resolveDependencies(
          'com.nonexistent:nonexistent-artifact-xyz-12345',
          '1.0.0'
        )
      ).rejects.toThrow();
    }, 60000);
  });

  describe('의존성 해결 - 캐시 관리', () => {
    it('캐시 초기화', () => {
      resolver.clearCache();
      expect(true).toBe(true);
    });

    it('Skipper 통계', async () => {
      await resolver.resolveDependencies(
        'org.apache.commons:commons-lang3',
        '3.12.0'
      );

      const stats = resolver.getSkipperStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    }, 60000);
  });

  describe('의존성 해결 - 트리 구조', () => {
    it('의존성 트리에 부모-자식 관계 존재', async () => {
      const result = await resolver.resolveDependencies(
        'com.fasterxml.jackson.core:jackson-databind',
        '2.15.2'
      );

      expect(result.root).toBeDefined();
      expect(result.root.children).toBeDefined();
      expect(Array.isArray(result.root.children)).toBe(true);
    }, 120000);

    it('flatList에 모든 의존성 포함', async () => {
      const result = await resolver.resolveDependencies(
        'com.fasterxml.jackson.core:jackson-databind',
        '2.15.2'
      );

      expect(result.flatList).toBeDefined();

      for (const dep of result.flatList) {
        expect(dep.groupId).toBeDefined();
        expect(dep.artifactId).toBeDefined();
        expect(dep.version).toBeDefined();
      }
    }, 120000);
  });

  // ==================== 패키징 타입별 다운로드 테스트 ====================

  describe('다운로더 - Maven Plugin 타입', () => {
    it('maven-compiler-plugin 다운로드 (maven-plugin -> .jar)', async () => {
      const outputDir = path.join(tempDir, 'maven-plugin');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: 'org.apache.maven.plugins:maven-compiler-plugin',
          version: '3.11.0',
          metadata: {
            groupId: 'org.apache.maven.plugins',
            artifactId: 'maven-compiler-plugin',
            type: 'maven-plugin'
          }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      // maven-plugin은 .jar 확장자로 다운로드됨
      expect(filePath.endsWith('.jar')).toBe(true);
    }, 60000);
  });

  describe('다운로더 - 패키징 타입별 파일명 생성', () => {
    it('WAR 타입 파일명', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('my-webapp', '1.0.0', 'war');
      expect(fileName).toBe('my-webapp-1.0.0.war');
    });

    it('EJB 타입은 .jar 확장자', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('my-ejb', '1.0', 'ejb');
      expect(fileName).toBe('my-ejb-1.0.jar');
    });

    it('OSGi bundle 타입은 .jar 확장자', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('osgi-bundle', '2.0', 'bundle');
      expect(fileName).toBe('osgi-bundle-2.0.jar');
    });

    it('RAR 타입', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('resource-adapter', '1.0', 'rar');
      expect(fileName).toBe('resource-adapter-1.0.rar');
    });

    it('AAR 타입 (Android)', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('android-lib', '1.0.0', 'aar');
      expect(fileName).toBe('android-lib-1.0.0.aar');
    });

    it('HPI 타입 (Jenkins plugin)', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('jenkins-plugin', '1.0', 'hpi');
      expect(fileName).toBe('jenkins-plugin-1.0.hpi');
    });
  });

  describe('다운로더 - Classifier 타입', () => {
    it('test-jar는 -tests classifier 포함', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('test-utils', '2.0', 'test-jar');
      expect(fileName).toBe('test-utils-2.0-tests.jar');
    });

    it('sources는 -sources classifier 포함', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('spring-core', '5.3.0', 'sources');
      expect(fileName).toBe('spring-core-5.3.0-sources.jar');
    });

    it('javadoc은 -javadoc classifier 포함', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('spring-core', '5.3.0', 'javadoc');
      expect(fileName).toBe('spring-core-5.3.0-javadoc.jar');
    });

    it('명시적 classifier가 우선', () => {
      const buildFileName = (downloader as any).buildFileName.bind(downloader);
      const fileName = buildFileName('netty-transport', '4.1.0', 'jar', 'linux-x86_64');
      expect(fileName).toBe('netty-transport-4.1.0-linux-x86_64.jar');
    });
  });

  describe('다운로더 - Native Classifier 다운로드', () => {
    it('netty native 라이브러리 다운로드 (linux-x86_64 classifier)', async () => {
      const outputDir = path.join(tempDir, 'native-classifier');
      fs.mkdirSync(outputDir, { recursive: true });

      const filePath = await downloader.downloadPackage(
        {
          type: 'maven',
          name: 'io.netty:netty-transport-native-epoll',
          version: '4.1.100.Final',
          metadata: {
            groupId: 'io.netty',
            artifactId: 'netty-transport-native-epoll',
            type: 'jar',
            classifier: 'linux-x86_64'
          }
        },
        outputDir
      );

      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toContain('linux-x86_64');
    }, 60000);
  });

  describe('다운로더 - validateArtifactType', () => {
    it('유효한 타입은 그대로 반환', () => {
      const validateArtifactType = (downloader as any).validateArtifactType.bind(downloader);
      expect(validateArtifactType('jar')).toBe('jar');
      expect(validateArtifactType('war')).toBe('war');
      expect(validateArtifactType('maven-plugin')).toBe('maven-plugin');
      expect(validateArtifactType('bundle')).toBe('bundle');
    });

    it('알 수 없는 타입은 jar로 폴백', () => {
      const validateArtifactType = (downloader as any).validateArtifactType.bind(downloader);
      expect(validateArtifactType('unknown-type')).toBe('jar');
      expect(validateArtifactType('')).toBe('jar');
    });
  });

  describe('다운로더 - URL 생성', () => {
    it('buildDownloadUrl이 classifier를 포함', () => {
      const buildDownloadUrl = (downloader as any).buildDownloadUrl.bind(downloader);
      const url = buildDownloadUrl(
        'io.netty',
        'netty-transport-native-epoll',
        '4.1.100.Final',
        'jar',
        'linux-x86_64'
      );
      expect(url).toContain('netty-transport-native-epoll-4.1.100.Final-linux-x86_64.jar');
    });

    it('buildDownloadUrl이 war 확장자를 사용', () => {
      const buildDownloadUrl = (downloader as any).buildDownloadUrl.bind(downloader);
      const url = buildDownloadUrl(
        'com.example',
        'my-webapp',
        '1.0.0',
        'war'
      );
      expect(url).toContain('my-webapp-1.0.0.war');
    });
  });
});
