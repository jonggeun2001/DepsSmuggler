import { describe, expect, it, vi } from 'vitest';
import { collectMavenTestRuntimePackages } from './maven-test-runtime';
import type { PackageInfo } from '../../types/package-manager/metadata';

const maven = (name: string, version: string, type = 'jar'): PackageInfo => ({
  type: 'maven',
  name,
  version,
  metadata: { groupId: name.split(':')[0], artifactId: name.split(':')[1], type },
});

describe('Maven 테스트 런타임 동반자 수집', () => {
  it('직접 JUnit API에서 같은 버전의 engine과 platform launcher를 찾는다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:tests') {
        return [pkg, maven('org.junit.jupiter:junit-jupiter-api', '5.10.1'), maven('org.junit.platform:junit-platform-engine', '1.10.1')];
      }
      if (pkg.name === 'org.junit.jupiter:junit-jupiter-engine') {
        return [pkg, maven('org.junit.platform:junit-platform-engine', '1.10.1')];
      }
      return [pkg];
    });

    const result = await collectMavenTestRuntimePackages([maven('app:tests', '1.0')], resolver);

    expect(result.map((pkg) => `${pkg.name}:${pkg.version}`)).toEqual([
      'org.junit.jupiter:junit-jupiter-engine:5.10.1',
      'org.junit.platform:junit-platform-launcher:1.10.1',
    ]);
  });

  it('wrapper의 전이 API도 발견하고 모든 engine 버전을 유지한다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:tests') {
        return [pkg, maven('com.example:test-wrapper', '2.0'), maven('org.junit.jupiter:junit-jupiter-api', '5.9.3'), maven('org.junit.platform:junit-platform-engine', '1.9.3')];
      }
      if (pkg.name === 'com.example:test-wrapper') {
        return [pkg, maven('org.junit.jupiter:junit-jupiter-api', '5.9.3'), maven('org.junit.platform:junit-platform-engine', '1.9.3')];
      }
      if (pkg.name === 'org.junit.jupiter:junit-jupiter-engine') {
        return [pkg, maven('org.junit.platform:junit-platform-engine', '1.9.3')];
      }
      return [pkg];
    });

    const result = await collectMavenTestRuntimePackages([maven('app:tests', '1.0')], resolver);
    expect(result.map((pkg) => `${pkg.name}:${pkg.version}`)).toEqual([
      'org.junit.jupiter:junit-jupiter-engine:5.9.3',
      'org.junit.platform:junit-platform-launcher:1.9.3',
    ]);
  });

  it('여러 API와 engine 버전을 합치되 중복은 제거한다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:a') return [pkg, maven('org.junit.jupiter:junit-jupiter-api', '5.10.1')];
      if (pkg.name === 'app:b') return [pkg, maven('org.junit.jupiter:junit-jupiter-api', '5.9.3')];
      if (pkg.name === 'org.junit.jupiter:junit-jupiter-engine') {
        return [pkg, maven('org.junit.platform:junit-platform-engine', pkg.version === '5.10.1' ? '1.10.1' : '1.9.3')];
      }
      return [pkg];
    });

    const result = await collectMavenTestRuntimePackages([maven('app:a', '1'), maven('app:b', '1')], resolver);
    expect(result.map((pkg) => `${pkg.name}:${pkg.version}`)).toEqual([
      'org.junit.jupiter:junit-jupiter-engine:5.10.1',
      'org.junit.jupiter:junit-jupiter-engine:5.9.3',
      'org.junit.platform:junit-platform-launcher:1.10.1',
      'org.junit.platform:junit-platform-launcher:1.9.3',
    ]);
  });

  it('JUnit 4와 Jupiter가 함께 발견되면 각 Jupiter 버전의 Vintage engine을 추가한다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:mixed') {
        return [pkg, maven('junit:junit', '4.13.2'), maven('org.junit.jupiter:junit-jupiter-api', '5.10.1')];
      }
      if (pkg.name === 'org.junit.jupiter:junit-jupiter-engine') {
        return [pkg, maven('org.junit.platform:junit-platform-engine', '1.10.1')];
      }
      if (pkg.name === 'org.junit.vintage:junit-vintage-engine') {
        return [pkg, maven('org.junit.platform:junit-platform-engine', '1.10.1')];
      }
      return [pkg];
    });

    const result = await collectMavenTestRuntimePackages([maven('app:mixed', '1')], resolver);
    expect(result.map((pkg) => `${pkg.name}:${pkg.version}`)).toEqual([
      'org.junit.jupiter:junit-jupiter-engine:5.10.1',
      'org.junit.vintage:junit-vintage-engine:5.10.1',
      'org.junit.platform:junit-platform-launcher:1.10.1',
    ]);
  });

  it('JUnit 4만 있으면 Vintage engine을 추가하지 않는다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => [pkg, maven('junit:junit', '4.13.2')]);
    await expect(collectMavenTestRuntimePackages([maven('app:legacy', '1')], resolver)).resolves.toEqual([]);
  });

  it('Platform Commons의 각 버전에도 대응하는 Launcher를 추가한다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:commons') {
        return [pkg, maven('org.junit.jupiter:junit-jupiter-api', '5.10.1'), maven('org.junit.platform:junit-platform-engine', '1.10.1'), maven('org.junit.platform:junit-platform-commons', '1.10.2')];
      }
      if (pkg.name === 'org.junit.jupiter:junit-jupiter-engine') return [pkg, maven('org.junit.platform:junit-platform-engine', '1.10.1')];
      return [pkg];
    });

    const result = await collectMavenTestRuntimePackages([maven('app:commons', '1')], resolver);
    expect(result.map((pkg) => `${pkg.name}:${pkg.version}`)).toEqual([
      'org.junit.jupiter:junit-jupiter-engine:5.10.1',
      'org.junit.platform:junit-platform-launcher:1.10.1',
      'org.junit.platform:junit-platform-launcher:1.10.2',
    ]);
  });

  it('JUnit이 없으면 빈 결과를 반환하고 POM 루트와 provider 루트는 제외한다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => [pkg]);
    const result = await collectMavenTestRuntimePackages([
      maven('model:parent', '1', 'pom'),
      { ...maven('org.apache.maven.plugins:maven-surefire-plugin', '3.2.5'), metadata: { type: 'maven-plugin', origin: 'provider-plugin' } },
      maven('app:tests', '1'),
    ], resolver);
    expect(result).toEqual([]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('어느 트리의 오류도 숨기지 않고 실패시킨다', async () => {
    const resolver = vi.fn(async (pkg: PackageInfo) => {
      if (pkg.name === 'app:broken') throw new Error('resolver failed');
      return [pkg];
    });
    await expect(collectMavenTestRuntimePackages([maven('app:broken', '1')], resolver)).rejects.toThrow('resolver failed');
  });
});
