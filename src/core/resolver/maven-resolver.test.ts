/**
 * MavenResolver 단위 테스트
 *
 * 네트워크 호출 없이 MavenResolver의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createRequestMavenResolver,
  getMavenResolver,
  MavenResolver,
} from './maven-resolver';
import { ResolutionSession } from '../shared/internal/resolution-session';
import { getAttachedResolutionSession } from '../shared/internal/resolution-session-registry';
import * as mavenCache from '../shared/maven-cache';
import { loadMavenLifecyclePlugins } from '../shared/maven-lifecycle';
import { MavenCoordinate, PomProject } from '../shared/maven-types';
// 분리된 유틸리티 함수 import
import {
  resolveProperty,
  resolveVersionRange,
  extractExclusions,
  extractDependencies,
} from '../shared/maven-pom-utils';

vi.mock('../shared/maven-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/maven-cache')>();

  return {
    ...actual,
    fetchPom: vi.fn(),
    prefetchPomsParallel: vi.fn(),
  };
});

const fetchPomFromCacheMock = vi.mocked(mavenCache.fetchPom);
vi.mock('../shared/maven-lifecycle', () => ({
  DEFAULT_MAVEN_BUILD_VERSION: '3.9.11',
  loadMavenLifecyclePlugins: vi.fn().mockResolvedValue({
    plugins: [{ groupId: 'org.apache.maven.plugins', artifactId: 'maven-compiler-plugin', version: '3.13.0' }],
    sourceUrl: 'fixture', sha256: 'fixture-hash',
  }),
}));
const defaultRepoUrl = 'https://repo1.maven.org/maven2';
const sharedCoordinate: MavenCoordinate = {
  groupId: 'org.example',
  artifactId: 'shared',
  version: '1.0.0',
};

function createSharedPom(): PomProject {
  return {
    groupId: sharedCoordinate.groupId,
    artifactId: sharedCoordinate.artifactId,
    version: sharedCoordinate.version,
    properties: { source: 'registry' },
  };
}

function fetchRawPom(resolver: MavenResolver, coordinate: MavenCoordinate): Promise<PomProject> {
  return (resolver as any).fetchPomWithCache(coordinate);
}

// MavenResolver 인스턴스 생성
const createResolver = () => {
  return new MavenResolver();
};

describe('MavenResolver 단위 테스트', () => {
  let resolver: MavenResolver;

  beforeEach(() => {
    resolver = createResolver();
    fetchPomFromCacheMock.mockReset();
    getMavenResolver().setCacheOptions({});
  });

  it('요청 resolver는 singleton cache options의 독립 snapshot과 session을 사용한다', () => {
    const singleton = getMavenResolver();
    singleton.setCacheOptions({ memoryTtl: 120, useDiskCache: true });
    const session = new ResolutionSession();

    const requestResolver = createRequestMavenResolver(session);

    expect(requestResolver).not.toBe(singleton);
    expect(requestResolver.getCacheOptions()).toEqual({
      memoryTtl: 120,
      useDiskCache: true,
    });
    expect(requestResolver.getCacheOptions()).not.toBe(singleton.getCacheOptions());
    expect(getAttachedResolutionSession(requestResolver)).toBe(session);
    expect(getAttachedResolutionSession(singleton)).toBeUndefined();

    requestResolver.setCacheOptions({ memoryTtl: 60 });
    expect(singleton.getCacheOptions()).toEqual({
      memoryTtl: 120,
      useDiskCache: true,
    });
  });

  describe('요청 세션 Maven metadata 재사용', () => {
    it('동일 GAV의 raw POM은 두 요청 resolver에서 한 번 조회하고 consumer별 clone을 반환한다', async () => {
      fetchPomFromCacheMock.mockResolvedValue(createSharedPom());
      const session = new ResolutionSession();
      const first = createRequestMavenResolver(session);
      const second = createRequestMavenResolver(session);

      const [firstPom, secondPom] = await Promise.all([
        fetchRawPom(first, sharedCoordinate),
        fetchRawPom(second, sharedCoordinate),
      ]);

      firstPom.properties!.source = 'mutated-by-first-root';

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1);
      expect(secondPom.properties?.source).toBe('registry');
    });

    it('classifier가 다른 root는 raw POM은 공유하지만 artifact 선택 결과는 독립적이다', async () => {
      fetchPomFromCacheMock.mockResolvedValue(createSharedPom());
      const session = new ResolutionSession();
      const first = createRequestMavenResolver(session);
      const second = createRequestMavenResolver(session);
      const linuxCoordinate = { ...sharedCoordinate, classifier: 'linux-x86_64' };
      const macCoordinate = { ...sharedCoordinate, classifier: 'osx-aarch_64' };

      await Promise.all([
        fetchRawPom(first, linuxCoordinate),
        fetchRawPom(second, macCoordinate),
      ]);

      const linuxNode = (first as any).createDependencyNode(linuxCoordinate, 'compile');
      const macNode = (second as any).createDependencyNode(macCoordinate, 'compile');

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1);
      expect(linuxNode.package.metadata.classifier).toBe('linux-x86_64');
      expect(macNode.package.metadata.classifier).toBe('osx-aarch_64');
      expect(linuxNode.package.metadata.filename).toContain('linux-x86_64');
      expect(macNode.package.metadata.filename).toContain('osx-aarch_64');
    });

    it('기본 저장소와 명시한 기본 저장소 URL은 같은 raw POM producer를 사용한다', async () => {
      fetchPomFromCacheMock.mockResolvedValue(createSharedPom());
      const session = new ResolutionSession();
      const implicitDefault = createRequestMavenResolver(session);
      const explicitDefault = createRequestMavenResolver(session);
      explicitDefault.setCacheOptions({ repoUrl: defaultRepoUrl });

      await Promise.all([
        fetchRawPom(implicitDefault, sharedCoordinate),
        fetchRawPom(explicitDefault, sharedCoordinate),
      ]);

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1);
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        sharedCoordinate,
        expect.objectContaining({ repoUrl: defaultRepoUrl }),
      );
    });

    it('서로 다른 저장소는 같은 GAV raw POM을 공유하지 않는다', async () => {
      fetchPomFromCacheMock.mockResolvedValue(createSharedPom());
      const session = new ResolutionSession();
      const repoA = createRequestMavenResolver(session);
      const repoB = createRequestMavenResolver(session);
      repoA.setCacheOptions({ repoUrl: 'https://repo-a.example/maven2' });
      repoB.setCacheOptions({ repoUrl: 'https://repo-b.example/maven2' });

      await Promise.all([
        fetchRawPom(repoA, sharedCoordinate),
        fetchRawPom(repoB, sharedCoordinate),
      ]);

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(2);
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        sharedCoordinate,
        expect.objectContaining({ repoUrl: 'https://repo-a.example/maven2' }),
      );
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        sharedCoordinate,
        expect.objectContaining({ repoUrl: 'https://repo-b.example/maven2' }),
      );
    });

    it('prefetch와 이후 단건 조회는 진행 중인 같은 raw POM producer를 공유한다', async () => {
      let release!: (pom: PomProject) => void;
      const pendingPom = new Promise<PomProject>((resolve) => {
        release = resolve;
      });
      fetchPomFromCacheMock.mockReturnValue(pendingPom);
      const resolver = createRequestMavenResolver(new ResolutionSession());

      (resolver as any).prefetchPomsParallelInternal([sharedCoordinate]);
      await vi.waitFor(() => expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1));
      const requestedPom = fetchRawPom(resolver, sharedCoordinate);
      release(createSharedPom());

      await expect(requestedPom).resolves.toEqual(createSharedPom());
      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1);
    });

    it('prefetch 실패는 소비되며 이후 단건 조회가 다시 시도할 수 있다', async () => {
      let reject!: (error: Error) => void;
      const pendingPom = new Promise<PomProject>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      });
      fetchPomFromCacheMock
        .mockReturnValueOnce(pendingPom)
        .mockResolvedValueOnce(createSharedPom());
      const resolver = createRequestMavenResolver(new ResolutionSession());

      (resolver as any).prefetchPomsParallelInternal([sharedCoordinate]);
      await vi.waitFor(() => expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(1));
      reject(new Error('prefetch repository failure'));
      await Promise.resolve();
      await Promise.resolve();

      await expect(fetchRawPom(resolver, sharedCoordinate)).resolves.toEqual(createSharedPom());
      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(2);
    });

    it('진행 중인 최신 버전 metadata 조회는 요청 resolver 사이에서 한 번만 호출한다', async () => {
      let release!: (value: { data: string }) => void;
      const pendingMetadata = new Promise<{ data: string }>((resolve) => {
        release = resolve;
      });
      const get = vi.fn(() => pendingMetadata);
      const session = new ResolutionSession();
      const first = createRequestMavenResolver(session);
      const second = createRequestMavenResolver(session);
      second.setCacheOptions({ repoUrl: defaultRepoUrl });
      (first as any).axiosInstance.get = get;
      (second as any).axiosInstance.get = get;

      const versions = Promise.all([
        first.getLatestVersion('org.example', 'shared'),
        second.getLatestVersion('org.example', 'shared'),
      ]);
      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      release({
        data: '<metadata><versioning><release>1.0.0</release></versioning></metadata>',
      });

      await expect(versions).resolves.toEqual(['1.0.0', '1.0.0']);
    });

    it('실패한 raw POM 조회는 세션에서 제거되어 다음 root가 재시도한다', async () => {
      fetchPomFromCacheMock
        .mockRejectedValueOnce(new Error('temporary repository failure'))
        .mockResolvedValueOnce(createSharedPom());
      const session = new ResolutionSession();

      await expect(
        fetchRawPom(createRequestMavenResolver(session), sharedCoordinate),
      ).rejects.toThrow('temporary repository failure');
      await expect(
        fetchRawPom(createRequestMavenResolver(session), sharedCoordinate),
      ).resolves.toEqual(createSharedPom());

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(2);
    });

    it('legacy singleton은 요청 세션 없이 raw POM 조회를 기존처럼 각각 수행한다', async () => {
      fetchPomFromCacheMock.mockResolvedValue(createSharedPom());
      const legacyResolver = getMavenResolver();

      expect(getAttachedResolutionSession(legacyResolver)).toBeUndefined();
      await fetchRawPom(legacyResolver, sharedCoordinate);
      await fetchRawPom(legacyResolver, sharedCoordinate);

      expect(fetchPomFromCacheMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('latest root version resolution', () => {
    it('latest는 metadata의 concrete version으로 root POM과 artifact metadata를 조회한다', async () => {
      const metadataGet = vi.fn().mockResolvedValue({
        data: '<metadata><versioning><latest>3.0.2</latest><release>3.0.1</release></versioning></metadata>',
      });
      const head = vi.fn().mockResolvedValue({ headers: { 'content-length': '10' } });
      (resolver as any).axiosInstance.get = metadataGet;
      (resolver as any).axiosInstance.head = head;
      fetchPomFromCacheMock.mockResolvedValue({
        groupId: 'org.example',
        artifactId: 'demo',
        version: '3.0.2',
        packaging: 'jar',
      });

      const result = await resolver.resolveDependencies('org.example:demo', 'latest', {
        maxDepth: 0,
        classifier: 'sources',
        artifactType: 'jar',
      });

      expect(metadataGet).toHaveBeenCalledWith(
        'https://repo1.maven.org/maven2/org/example/demo/maven-metadata.xml',
      );
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'org.example',
          artifactId: 'demo',
          version: '3.0.2',
          classifier: 'sources',
          type: 'jar',
        }),
        expect.any(Object),
      );
      expect(result.root.package.version).toBe('3.0.2');
      expect(result.root.package.metadata).toMatchObject({
        classifier: 'sources',
        type: 'jar',
        filename: 'demo-3.0.2-sources.jar',
      });
      expect(result.flatList).toHaveLength(1);
      expect(head).toHaveBeenCalled();
    });

    it('latest의 concrete root로 전체 의존성 그래프를 해결한다', async () => {
      const metadataGet = vi.fn().mockResolvedValue({
        data: '<metadata><versioning><latest>3.0.2</latest></versioning></metadata>',
      });
      const head = vi.fn().mockResolvedValue({ headers: { 'content-length': '10' } });
      (resolver as any).axiosInstance.get = metadataGet;
      (resolver as any).axiosInstance.head = head;
      fetchPomFromCacheMock.mockImplementation(async (coordinate) => {
        if (coordinate.artifactId === 'demo' && coordinate.version === '3.0.2') {
          return {
            groupId: 'org.example',
            artifactId: 'demo',
            version: '3.0.2',
            dependencies: {
              dependency: {
                groupId: 'org.example',
                artifactId: 'child',
                version: '1.0.0',
              },
            },
          };
        }
        if (coordinate.artifactId === 'child' && coordinate.version === '1.0.0') {
          return {
            groupId: 'org.example',
            artifactId: 'child',
            version: '1.0.0',
          };
        }
        throw new Error(`Unexpected POM: ${coordinate.groupId}:${coordinate.artifactId}:${coordinate.version}`);
      });

      const result = await resolver.resolveDependencies('org.example:demo', 'latest');

      expect(result.flatList.map((pkg) => `${pkg.name}@${pkg.version}`).sort()).toEqual([
        'org.example:child@1.0.0',
        'org.example:demo@3.0.2',
      ]);
      expect(fetchPomFromCacheMock.mock.calls.map(([coordinate]) => coordinate.version)).not.toContain('latest');
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        expect.objectContaining({ artifactId: 'child', version: '1.0.0' }),
        expect.any(Object),
      );
    });

    it('latest가 없으면 release를 사용하고 metadata가 둘 다 비어 있으면 실패한다', async () => {
      const metadataGet = vi
        .fn()
        .mockResolvedValueOnce({
          data: '<metadata><versioning><release>2.4.1</release></versioning></metadata>',
        })
        .mockResolvedValueOnce({
          data: '<metadata><versioning><latest></latest><release></release></versioning></metadata>',
        });
      (resolver as any).axiosInstance.get = metadataGet;

      await expect(resolver.getLatestVersion('org.example', 'release-only'))
        .resolves.toBe('2.4.1');
      await expect(resolver.getLatestVersion('org.example', 'empty-metadata'))
        .rejects.toThrow('org.example:empty-metadata');
      expect(metadataGet).toHaveBeenNthCalledWith(
        1,
        'https://repo1.maven.org/maven2/org/example/release-only/maven-metadata.xml',
      );
      expect(metadataGet).toHaveBeenNthCalledWith(
        2,
        'https://repo1.maven.org/maven2/org/example/empty-metadata/maven-metadata.xml',
      );
    });

    it('명시 버전은 latest metadata를 조회하지 않는다', async () => {
      const metadataGet = vi.fn();
      const head = vi.fn().mockResolvedValue({ headers: { 'content-length': '10' } });
      (resolver as any).axiosInstance.get = metadataGet;
      (resolver as any).axiosInstance.head = head;
      fetchPomFromCacheMock.mockResolvedValue({
        groupId: 'org.example',
        artifactId: 'demo',
        version: '3.0.1',
      });

      const result = await resolver.resolveDependencies('org.example:demo', '3.0.1', {
        maxDepth: 0,
      });

      expect(metadataGet).not.toHaveBeenCalled();
      expect(result.root.package.version).toBe('3.0.1');
      expect(fetchPomFromCacheMock).toHaveBeenCalledWith(
        expect.objectContaining({ version: '3.0.1' }),
        expect.any(Object),
      );
    });
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
            filename: 'test-1.0.0.jar',
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
      expect(result.some(p => p.name === 'junit:junit')).toBe(true);
      expect(result.some(p => p.name === 'org.example:test-project')).toBe(false);
      const springCore = result.find((p) => p.name.includes('spring-core'));
      expect(springCore).toBeDefined();
    });

    it('POM 전용 의존성의 type을 다운로드 메타데이터에 보존한다', async () => {
      const pomText = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.apache.flink</groupId>
  <artifactId>flink-streaming-java</artifactId>
  <version>1.20.5</version>
  <dependencies>
    <dependency>
      <groupId>org.apache.flink</groupId>
      <artifactId>flink-metrics</artifactId>
      <version>1.20.5</version>
      <type>pom</type>
    </dependency>
  </dependencies>
</project>`;

      const result = await resolver.parseFromText(pomText);
      const flinkMetrics = result.find((pkg) => pkg.name === 'org.apache.flink:flink-metrics');

      expect(flinkMetrics).toMatchObject({
        version: '1.20.5',
        metadata: {
          groupId: 'org.apache.flink',
          artifactId: 'flink-metrics',
          type: 'pom',
        },
      });
    });

    it('의존성 없는 pom.xml도 package 플러그인을 반환하고 로컬 프로젝트는 제외한다', async () => {
      const pomText = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.example</groupId>
  <artifactId>empty-project</artifactId>
  <version>1.0.0</version>
</project>`;

      const result = await resolver.parseFromText(pomText);
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('org.apache.maven.plugins:maven-compiler-plugin');
      expect(result[0].version).toBe('3.13.0');
      expect(loadMavenLifecyclePlugins).toHaveBeenCalledWith('3.9.11', 'jar');
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
      // spring-core 의존성 + package 플러그인
      expect(result.length).toBe(2);
      const springCore = result.find((p) => p.name.includes('spring-core'));
      expect(springCore).toBeDefined();
      expect(springCore?.version).toBe('5.3.0');
    });
  });
});
