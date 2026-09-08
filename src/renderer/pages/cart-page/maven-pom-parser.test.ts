import { describe, expect, it } from 'vitest';
import { parseMavenPomDependencies } from './maven-pom-parser';

describe('parseMavenPomDependencies', () => {
  it('일반 의존성과 dependencyManagement의 BOM 선언을 함께 가져온다', () => {
    const packages = parseMavenPomDependencies(`
      <project>
        <dependencyManagement><dependencies><dependency>
          <groupId>org.example</groupId><artifactId>platform</artifactId>
          <version>1.0</version><type>pom</type><scope>import</scope>
        </dependency></dependencies></dependencyManagement>
        <dependencies><dependency>
          <groupId>org.example</groupId><artifactId>library</artifactId>
          <version>1.0</version>
        </dependency></dependencies>
      </project>
    `);

    expect(packages).toEqual([
      { name: 'org.example:platform', version: '1.0', metadata: { type: 'pom' } },
      { name: 'org.example:library', version: '1.0', metadata: undefined },
    ]);
  });

  it('POM 전용 의존성의 type을 장바구니 metadata에 보존한다', () => {
    const packages = parseMavenPomDependencies(`
      <project>
        <dependencies>
          <dependency>
            <groupId>org.apache.flink</groupId>
            <artifactId>flink-metrics</artifactId>
            <version>1.20.5</version>
            <type>pom</type>
          </dependency>
        </dependencies>
      </project>
    `);

    expect(packages).toEqual([
      {
        name: 'org.apache.flink:flink-metrics',
        version: '1.20.5',
        metadata: { type: 'pom' },
      },
    ]);
  });

  it('단일 dependency XML 조각에서도 POM type을 보존한다', () => {
    const packages = parseMavenPomDependencies(`
      <dependency>
        <groupId>org.apache.flink</groupId>
        <artifactId>flink-metrics</artifactId>
        <version>1.20.5</version>
        <type>pom</type>
      </dependency>
    `);

    expect(packages).toEqual([
      {
        name: 'org.apache.flink:flink-metrics',
        version: '1.20.5',
        metadata: { type: 'pom' },
      },
    ]);
  });
});
