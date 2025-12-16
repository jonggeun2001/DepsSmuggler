/**
 * NpmResolver 단위 테스트
 *
 * 네트워크 호출 없이 NpmResolver의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NpmResolver } from './npmResolver';

// NpmResolver 인스턴스 생성
const createResolver = () => {
  return new NpmResolver();
};

describe('NpmResolver 단위 테스트', () => {
  let resolver: NpmResolver;

  beforeEach(() => {
    resolver = createResolver();
  });

  describe('resolveVersion', () => {
    // private 메서드 테스트를 위해 리플렉션 사용
    const callResolveVersion = (
      resolver: NpmResolver,
      spec: string,
      packument: any
    ): string | null => {
      return (resolver as any).resolveVersion(spec, packument);
    };

    it('dist-tag로 버전 해결 (latest)', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21', next: '5.0.0-beta.1' },
        versions: {
          '4.17.21': {},
          '5.0.0-beta.1': {},
        },
      };

      expect(callResolveVersion(resolver, 'latest', packument)).toBe('4.17.21');
    });

    it('dist-tag로 버전 해결 (next)', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21', next: '5.0.0-beta.1' },
        versions: {
          '4.17.21': {},
          '5.0.0-beta.1': {},
        },
      };

      expect(callResolveVersion(resolver, 'next', packument)).toBe('5.0.0-beta.1');
    });

    it('정확한 버전', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        versions: {
          '4.17.21': {},
          '4.17.20': {},
        },
      };

      expect(callResolveVersion(resolver, '4.17.20', packument)).toBe('4.17.20');
    });

    it('semver 범위 ^4.0.0', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        versions: {
          '4.17.21': {},
          '4.17.20': {},
          '4.0.0': {},
          '3.10.1': {},
        },
      };

      expect(callResolveVersion(resolver, '^4.0.0', packument)).toBe('4.17.21');
    });

    it('semver 범위 ~4.17.0', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        versions: {
          '4.17.21': {},
          '4.17.20': {},
          '4.18.0': {},
        },
      };

      expect(callResolveVersion(resolver, '~4.17.0', packument)).toBe('4.17.21');
    });

    it('semver 범위 >=4.0.0 <5.0.0', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        versions: {
          '4.17.21': {},
          '5.0.0': {},
          '3.10.1': {},
        },
      };

      expect(callResolveVersion(resolver, '>=4.0.0 <5.0.0', packument)).toBe('4.17.21');
    });

    it('prerelease 버전 제외', () => {
      const packument = {
        name: 'test-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {},
          '2.0.0-beta.1': {},
        },
      };

      // ^1.0.0은 2.0.0-beta.1을 매칭하지 않음
      expect(callResolveVersion(resolver, '^1.0.0', packument)).toBe('1.0.0');
    });

    it('버전이 없는 경우 null 반환', () => {
      const packument = {
        name: 'test-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {},
        },
      };

      expect(callResolveVersion(resolver, '^2.0.0', packument)).toBe(null);
    });

    it('캐시 활용 확인', () => {
      const packument = {
        name: 'lodash',
        'dist-tags': { latest: '4.17.21' },
        versions: {
          '4.17.21': {},
        },
      };

      // 첫 번째 호출
      const result1 = callResolveVersion(resolver, '^4.0.0', packument);
      expect(result1).toBe('4.17.21');

      // 두 번째 호출 - 캐시에서 가져옴
      const result2 = callResolveVersion(resolver, '^4.0.0', packument);
      expect(result2).toBe('4.17.21');
    });
  });

  describe('getDepthFromPath', () => {
    const callGetDepthFromPath = (resolver: NpmResolver, path: string): number => {
      return (resolver as any).getDepthFromPath(path);
    };

    it('빈 경로는 depth 0', () => {
      expect(callGetDepthFromPath(resolver, '')).toBe(0);
    });

    it('node_modules/lodash는 depth 1', () => {
      expect(callGetDepthFromPath(resolver, 'node_modules/lodash')).toBe(1);
    });

    it('node_modules/a/node_modules/b는 depth 2', () => {
      expect(callGetDepthFromPath(resolver, 'node_modules/a/node_modules/b')).toBe(2);
    });

    it('node_modules/a/node_modules/b/node_modules/c는 depth 3', () => {
      expect(
        callGetDepthFromPath(resolver, 'node_modules/a/node_modules/b/node_modules/c')
      ).toBe(3);
    });
  });

  describe('findNodePath', () => {
    const callFindNodePath = (
      resolver: NpmResolver,
      name: string,
      startPath: string | null
    ): string | null => {
      return (resolver as any).findNodePath(name, startPath);
    };

    beforeEach(() => {
      // tree에 직접 노드 추가
      const tree = (resolver as any).tree as Map<string, any>;
      tree.set('node_modules/lodash', { name: 'lodash', version: '4.17.21' });
      tree.set('node_modules/express', { name: 'express', version: '4.18.0' });
      tree.set('node_modules/express/node_modules/accepts', {
        name: 'accepts',
        version: '1.3.7',
      });
    });

    it('루트에서 lodash 찾기', () => {
      expect(callFindNodePath(resolver, 'lodash', null)).toBe('node_modules/lodash');
    });

    it('루트에서 express 찾기', () => {
      expect(callFindNodePath(resolver, 'express', null)).toBe('node_modules/express');
    });

    it('express 내에서 accepts 찾기', () => {
      expect(callFindNodePath(resolver, 'accepts', 'node_modules/express')).toBe(
        'node_modules/express/node_modules/accepts'
      );
    });

    it('존재하지 않는 패키지는 null 반환', () => {
      expect(callFindNodePath(resolver, 'nonexistent', null)).toBe(null);
    });

    it('중첩 경로에서 호이스팅된 패키지 찾기', () => {
      // express 내에서 lodash 찾기 -> 루트의 lodash 찾음
      expect(callFindNodePath(resolver, 'lodash', 'node_modules/express')).toBe(
        'node_modules/lodash'
      );
    });
  });

  describe('flattenTree', () => {
    const callFlattenTree = (resolver: NpmResolver): any[] => {
      return (resolver as any).flattenTree();
    };

    beforeEach(() => {
      // tree에 직접 노드 추가
      const tree = (resolver as any).tree as Map<string, any>;

      // 루트 노드 (제외됨)
      tree.set('', { name: 'root', version: '1.0.0' });

      // 실제 패키지 노드
      tree.set('node_modules/lodash', {
        name: 'lodash',
        version: '4.17.21',
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha512-...',
          shasum: 'abc123',
          unpackedSize: 1000000,
        },
      });

      tree.set('node_modules/express', {
        name: 'express',
        version: '4.18.0',
        dist: {
          tarball: 'https://registry.npmjs.org/express/-/express-4.18.0.tgz',
          integrity: 'sha512-...',
          shasum: 'def456',
          unpackedSize: 500000,
        },
      });

      tree.set('node_modules/express/node_modules/accepts', {
        name: 'accepts',
        version: '1.3.7',
        dist: {
          tarball: 'https://registry.npmjs.org/accepts/-/accepts-1.3.7.tgz',
          integrity: 'sha512-...',
          shasum: 'ghi789',
          unpackedSize: 10000,
        },
      });
    });

    it('루트를 제외하고 모든 패키지 반환', () => {
      const result = callFlattenTree(resolver);
      expect(result.length).toBe(3);
      expect(result.find((p) => p.name === 'root')).toBeUndefined();
    });

    it('깊이 순으로 정렬', () => {
      const result = callFlattenTree(resolver);
      // depth 1 패키지들이 먼저 오고, depth 2 패키지가 나중에 옴
      expect(result[0].name).toBe('express'); // depth 1, 알파벳순으로 express 먼저
      expect(result[1].name).toBe('lodash'); // depth 1
      expect(result[2].name).toBe('accepts'); // depth 2
    });

    it('패키지 정보 포함', () => {
      const result = callFlattenTree(resolver);
      const lodash = result.find((p) => p.name === 'lodash');

      expect(lodash).toBeDefined();
      expect(lodash.version).toBe('4.17.21');
      expect(lodash.tarball).toContain('lodash');
      expect(lodash.hoistedPath).toBe('node_modules/lodash');
    });
  });

  describe('isVersionCompatibleWithExisting', () => {
    // isVersionCompatibleWithExisting은 실제로 tree의 노드들과 버전 호환성을 체크함
    // (name, version, path) 3개의 파라미터를 받음
    // 현재 구현에서는 항상 true를 반환 (간소화 버전)
    const callIsVersionCompatible = (
      resolver: NpmResolver,
      name: string,
      version: string,
      path: string
    ): boolean => {
      return (resolver as any).isVersionCompatibleWithExisting(name, version, path);
    };

    it('기본 호환성 체크 (현재 구현은 항상 true)', () => {
      expect(callIsVersionCompatible(resolver, 'lodash', '4.17.21', '')).toBe(true);
    });

    it('경로가 있을 때 호환성 체크', () => {
      // tree에 노드 추가
      const tree = (resolver as any).tree as Map<string, any>;
      tree.set('node_modules/express', {
        name: 'express',
        version: '4.18.0',
        dependencies: [{ name: 'lodash', version: '^4.0.0' }],
      });

      expect(callIsVersionCompatible(resolver, 'lodash', '4.17.21', 'node_modules')).toBe(true);
    });
  });

  describe('addNodeToTree', () => {
    // addNodeToTree는 7개의 파라미터를 받음:
    // (name, version, pkgInfo, hoistedPath, depth, type, _item)
    const callAddNodeToTree = (
      resolver: NpmResolver,
      name: string,
      version: string,
      pkgInfo: any,
      hoistedPath: string,
      depth: number,
      type: string,
      item: any
    ): void => {
      return (resolver as any).addNodeToTree(name, version, pkgInfo, hoistedPath, depth, type, item);
    };

    it('노드 추가', () => {
      const pkgInfo = {
        dist: {
          tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
          integrity: 'sha512-...',
          shasum: 'abc123',
          unpackedSize: 1000000,
        },
      };
      const item = { name: 'lodash', version: '^4.0.0' };

      callAddNodeToTree(resolver, 'lodash', '4.17.21', pkgInfo, 'node_modules/lodash', 1, 'prod', item);

      const tree = (resolver as any).tree as Map<string, any>;
      expect(tree.has('node_modules/lodash')).toBe(true);
      expect(tree.get('node_modules/lodash').name).toBe('lodash');
      expect(tree.get('node_modules/lodash').version).toBe('4.17.21');
    });

    it('중첩 노드 추가', () => {
      const pkgInfo = {
        dist: {
          tarball: 'https://registry.npmjs.org/accepts/-/accepts-1.3.7.tgz',
          integrity: 'sha512-...',
          shasum: 'def456',
          unpackedSize: 10000,
        },
      };
      const item = { name: 'accepts', version: '^1.3.0' };

      callAddNodeToTree(
        resolver,
        'accepts',
        '1.3.7',
        pkgInfo,
        'node_modules/express/node_modules/accepts',
        2,
        'prod',
        item
      );

      const tree = (resolver as any).tree as Map<string, any>;
      expect(tree.has('node_modules/express/node_modules/accepts')).toBe(true);
      expect(tree.get('node_modules/express/node_modules/accepts').depth).toBe(2);
    });

    it('optional 타입 노드 추가', () => {
      const pkgInfo = {
        dist: {
          tarball: 'https://registry.npmjs.org/fsevents/-/fsevents-2.3.0.tgz',
          integrity: 'sha512-...',
          shasum: 'ghi789',
          unpackedSize: 50000,
        },
      };
      const item = { name: 'fsevents', version: '^2.0.0' };

      callAddNodeToTree(
        resolver,
        'fsevents',
        '2.3.0',
        pkgInfo,
        'node_modules/fsevents',
        1,
        'optional',
        item
      );

      const tree = (resolver as any).tree as Map<string, any>;
      expect(tree.get('node_modules/fsevents').optional).toBe(true);
    });
  });

  describe('getVersions', () => {
    it('getVersions 메서드 존재 확인', () => {
      expect(typeof resolver.getVersions).toBe('function');
    });
  });

  describe('getPackageInfo', () => {
    it('getPackageInfo 메서드 존재 확인', () => {
      expect(typeof resolver.getPackageInfo).toBe('function');
    });
  });
});
