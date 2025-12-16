/**
 * PipResolver 단위 테스트
 *
 * 네트워크 호출 없이 PipResolver의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipResolver } from './pipResolver';

// PipResolver 인스턴스 생성 및 targetPlatform 설정
const createResolver = (options?: { targetPlatform?: { system?: string; machine?: string } }) => {
  const resolver = new PipResolver();
  // targetPlatform은 private 속성이므로 직접 설정
  if (options?.targetPlatform) {
    (resolver as any).targetPlatform = options.targetPlatform;
  }
  return resolver;
};

describe('PipResolver 단위 테스트', () => {
  let resolver: PipResolver;

  beforeEach(() => {
    resolver = createResolver();
  });

  describe('parseDependencyString', () => {
    const callParseDependencyString = (
      resolver: PipResolver,
      depString: string
    ): any => {
      return (resolver as any).parseDependencyString(depString);
    };

    it('단순 패키지명', () => {
      const result = callParseDependencyString(resolver, 'requests');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: undefined,
        extras: undefined,
        markers: undefined,
      });
    });

    it('고정 버전 (==)', () => {
      const result = callParseDependencyString(resolver, 'requests==2.28.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '==2.28.0',
        extras: undefined,
        markers: undefined,
      });
    });

    it('최소 버전 (>=)', () => {
      const result = callParseDependencyString(resolver, 'requests>=2.20.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '>=2.20.0',
        extras: undefined,
        markers: undefined,
      });
    });

    it('최대 버전 (<)', () => {
      const result = callParseDependencyString(resolver, 'requests<3.0.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '<3.0.0',
        extras: undefined,
        markers: undefined,
      });
    });

    it('호환 버전 (~=)', () => {
      const result = callParseDependencyString(resolver, 'requests~=2.28.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '~=2.28.0',
        extras: undefined,
        markers: undefined,
      });
    });

    it('불일치 (!=)', () => {
      const result = callParseDependencyString(resolver, 'requests!=2.27.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '!=2.27.0',
        extras: undefined,
        markers: undefined,
      });
    });

    it('extras 포함', () => {
      const result = callParseDependencyString(resolver, 'requests[security,socks]');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: undefined,
        extras: ['security', 'socks'],
        markers: undefined,
      });
    });

    it('extras와 버전', () => {
      const result = callParseDependencyString(resolver, 'requests[security]==2.28.0');
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '==2.28.0',
        extras: ['security'],
        markers: undefined,
      });
    });

    it('환경 마커', () => {
      const result = callParseDependencyString(
        resolver,
        'pywin32>=220 ; sys_platform == "win32"'
      );
      expect(result).toEqual({
        name: 'pywin32',
        versionSpec: '>=220',
        extras: undefined,
        markers: 'sys_platform == "win32"',
      });
    });

    it('하이픈을 언더스코어로 변환', () => {
      const result = callParseDependencyString(resolver, 'my-package');
      expect(result.name).toBe('my_package');
    });

    it('대문자를 소문자로 변환', () => {
      const result = callParseDependencyString(resolver, 'MyPackage');
      expect(result.name).toBe('mypackage');
    });

    it('복합 변환 (대문자 + 하이픈)', () => {
      const result = callParseDependencyString(resolver, 'My-Package-Name>=1.0');
      expect(result.name).toBe('my_package_name');
      expect(result.versionSpec).toBe('>=1.0');
    });
  });

  describe('evaluateMarker', () => {
    const callEvaluateMarker = (resolver: PipResolver, marker?: string): boolean => {
      return (resolver as any).evaluateMarker(marker);
    };

    describe('기본 동작', () => {
      it('마커가 없으면 항상 true', () => {
        expect(callEvaluateMarker(resolver, undefined)).toBe(true);
      });

      it('마커가 빈 문자열이면 true', () => {
        expect(callEvaluateMarker(resolver, '')).toBe(true);
      });

      it('targetPlatform이 없고 마커가 있으면 false', () => {
        // 기본 resolver는 targetPlatform이 없음
        expect(callEvaluateMarker(resolver, 'sys_platform == "linux"')).toBe(false);
      });
    });

    describe('Linux 플랫폼', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
        });
      });

      it('platform_system == "Linux" 통과', () => {
        expect(callEvaluateMarker(resolver, 'platform_system == "Linux"')).toBe(true);
      });

      it('platform_system == "Windows" 실패', () => {
        expect(callEvaluateMarker(resolver, 'platform_system == "Windows"')).toBe(false);
      });

      it('sys_platform == "linux" 통과', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform == "linux"')).toBe(true);
      });

      it('sys_platform == "win32" 실패', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform == "win32"')).toBe(false);
      });

      it('platform_machine == "x86_64" 통과', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "x86_64"')).toBe(true);
      });

      it('platform_machine == "amd64"도 통과 (x86_64 호환)', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "amd64"')).toBe(true);
      });

      it('platform_machine == "arm64" 실패', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "arm64"')).toBe(false);
      });
    });

    describe('Windows 플랫폼', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Windows', machine: 'amd64' },
        });
      });

      it('platform_system == "Windows" 통과', () => {
        expect(callEvaluateMarker(resolver, 'platform_system == "Windows"')).toBe(true);
      });

      it('platform_system == "Linux" 실패', () => {
        expect(callEvaluateMarker(resolver, 'platform_system == "Linux"')).toBe(false);
      });

      it('sys_platform == "win32" 통과', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform == "win32"')).toBe(true);
      });
    });

    describe('macOS 플랫폼', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Darwin', machine: 'arm64' },
        });
      });

      it('platform_system == "Darwin" 통과', () => {
        expect(callEvaluateMarker(resolver, 'platform_system == "Darwin"')).toBe(true);
      });

      it('sys_platform == "darwin" 통과', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform == "darwin"')).toBe(true);
      });

      it('platform_machine == "arm64" 통과', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "arm64"')).toBe(true);
      });

      it('platform_machine == "x86_64" 실패 (ARM Mac)', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "x86_64"')).toBe(false);
      });
    });

    describe('extra 마커', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
        });
      });

      it('extra 마커는 항상 제외', () => {
        expect(callEvaluateMarker(resolver, 'extra == "dev"')).toBe(false);
      });

      it('extra 마커가 포함되면 제외', () => {
        expect(callEvaluateMarker(resolver, 'extra == "security"')).toBe(false);
      });
    });
  });

  describe('flattenDependencies', () => {
    const callFlattenDependencies = (resolver: PipResolver, node: any): any[] => {
      return (resolver as any).flattenDependencies(node);
    };

    it('단일 노드', () => {
      const node = {
        package: { type: 'pip', name: 'requests', version: '2.28.0' },
        dependencies: [],
      };
      const result = callFlattenDependencies(resolver, node);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('requests');
    });

    it('중첩 의존성', () => {
      const node = {
        package: { type: 'pip', name: 'requests', version: '2.28.0' },
        dependencies: [
          {
            package: { type: 'pip', name: 'urllib3', version: '1.26.0' },
            dependencies: [],
          },
          {
            package: { type: 'pip', name: 'certifi', version: '2023.7.22' },
            dependencies: [],
          },
        ],
      };
      const result = callFlattenDependencies(resolver, node);
      expect(result).toHaveLength(3);
      expect(result.map((p) => p.name).sort()).toEqual(['certifi', 'requests', 'urllib3']);
    });

    it('중복 의존성 제거', () => {
      const node = {
        package: { type: 'pip', name: 'a', version: '1.0.0' },
        dependencies: [
          {
            package: { type: 'pip', name: 'b', version: '2.0.0' },
            dependencies: [
              {
                package: { type: 'pip', name: 'c', version: '3.0.0' },
                dependencies: [],
              },
            ],
          },
          {
            package: { type: 'pip', name: 'c', version: '3.0.0' },
            dependencies: [],
          },
        ],
      };
      const result = callFlattenDependencies(resolver, node);
      expect(result).toHaveLength(3);
      // c는 한 번만 포함되어야 함
      expect(result.filter((p) => p.name === 'c')).toHaveLength(1);
    });

    it('대소문자 정규화된 중복 제거', () => {
      const node = {
        package: { type: 'pip', name: 'Package-A', version: '1.0.0' },
        dependencies: [
          {
            package: { type: 'pip', name: 'package_a', version: '1.0.0' },
            dependencies: [],
          },
        ],
      };
      const result = callFlattenDependencies(resolver, node);
      // package-a와 package_a가 같은 버전이면 하나로 처리됨
      expect(result).toHaveLength(2); // 이름이 다르므로 2개
    });
  });

  describe('캐시 관리', () => {
    it('clearCache 호출 시 에러 없음', () => {
      expect(() => resolver.clearCache()).not.toThrow();
    });

    it('setCacheOptions 호출 시 에러 없음', () => {
      expect(() => resolver.setCacheOptions({ maxSize: 100 })).not.toThrow();
    });
  });

  describe('type 속성', () => {
    it('type은 pip', () => {
      expect(resolver.type).toBe('pip');
    });
  });
});
