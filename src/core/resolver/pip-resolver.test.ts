/**
 * PipResolver 단위 테스트
 *
 * 네트워크 호출 없이 PipResolver의 핵심 로직을 테스트합니다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipResolver } from './pip-resolver';

// PipResolver 인스턴스 생성 및 targetPlatform 설정
const createResolver = (options?: {
  targetPlatform?: { system?: string; machine?: string };
  pythonVersion?: string;
}) => {
  const resolver = new PipResolver();
  // targetPlatform은 private 속성이므로 직접 설정
  if (options?.targetPlatform) {
    (resolver as any).targetPlatform = options.targetPlatform;
  }
  if (options?.pythonVersion) {
    (resolver as any).pythonVersion = options.pythonVersion;
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

    it('PEP 685 extra 이름을 정규화하고 중복 제거한다', () => {
      const result = callParseDependencyString(
        resolver,
        'requests[Foo.Bar,foo_bar,foo-bar]',
      );
      expect(result).toEqual({
        name: 'requests',
        versionSpec: undefined,
        extras: ['foo-bar'],
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

    it('괄호형 버전 제약식을 파싱한다', () => {
      const result = callParseDependencyString(resolver, 'cached-property (>=1.5.2)');
      expect(result).toEqual({
        name: 'cached_property',
        versionSpec: '>=1.5.2',
        extras: undefined,
        markers: undefined,
      });
    });

    it('괄호형 버전 제약식과 extras 및 환경 마커를 함께 보존한다', () => {
      const result = callParseDependencyString(
        resolver,
        'requests[security] (>=2.0) ; sys_platform == "linux"'
      );
      expect(result).toEqual({
        name: 'requests',
        versionSpec: '>=2.0',
        extras: ['security'],
        markers: 'sys_platform == "linux"',
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
    const callEvaluateMarker = (
      resolver: PipResolver,
      marker?: string,
      extras?: string[],
    ): boolean => {
      return (resolver as any).evaluateMarker(marker, extras);
    };

    describe('기본 동작', () => {
      it('마커가 없으면 항상 true', () => {
        expect(callEvaluateMarker(resolver, undefined)).toBe(true);
      });

      it('마커가 빈 문자열이면 true', () => {
        expect(callEvaluateMarker(resolver, '')).toBe(true);
      });

      it('대상 환경 값이 없으면 조건부 의존성을 제외한다', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform == "linux"')).toBe(false);
      });

      it('플랫폼 없이도 지정한 Python 버전 마커를 평가한다', () => {
        resolver = createResolver({ pythonVersion: '3.12' });
        expect(
          callEvaluateMarker(resolver, 'python_version >= "3.11"'),
        ).toBe(true);
      });

      it('major.minor 입력에서 확정할 수 있는 full version marker만 포함한다', () => {
        resolver = createResolver({ pythonVersion: '3.12' });
        expect(
          callEvaluateMarker(
            resolver,
            'python_full_version < "3.13.0"',
          ),
        ).toBe(true);
        expect(
          callEvaluateMarker(
            resolver,
            'implementation_version >= "3.13.0"',
          ),
        ).toBe(false);
        expect(
          callEvaluateMarker(
            resolver,
            'python_full_version == "3.12.5"',
          ),
        ).toBe(false);
        expect(
          callEvaluateMarker(
            resolver,
            'implementation_version < "3.12.1"',
          ),
        ).toBe(false);
      });

      it('patch 버전을 지정하면 full version 마커를 정확히 평가한다', () => {
        resolver = createResolver({ pythonVersion: '3.12.8' });
        expect(
          callEvaluateMarker(
            resolver,
            'python_full_version < "3.12.1"',
          ),
        ).toBe(false);
        expect(
          callEvaluateMarker(
            resolver,
            'implementation_version == "3.12.8"',
          ),
        ).toBe(true);
      });
    });

    describe('Linux 플랫폼', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.12',
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

      it('복합 Python 버전 범위를 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'python_version >= "3.10" and python_version < "3.12"',
          ),
        ).toBe(false);
        expect(
          callEvaluateMarker(
            resolver,
            'python_version >= "3.12" and sys_platform != "win32"',
          ),
        ).toBe(true);
      });

      it('괄호가 포함된 and/or 마커를 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            '(sys_platform == "win32" or platform_system == "Linux") and platform_machine != "arm64"',
          ),
        ).toBe(true);
      });

      it('not in 연산자를 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'sys_platform not in "win32 darwin"',
          ),
        ).toBe(true);
      });
    });

    describe('Linux ARM64 플랫폼', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'arm64' },
        });
      });

      it('platform_machine == "aarch64" 별칭을 통과시킨다', () => {
        expect(callEvaluateMarker(resolver, 'platform_machine == "aarch64"')).toBe(true);
      });
    });

    describe('Python 버전', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.12',
        });
      });

      it('python_version 최소 버전 마커를 평가한다', () => {
        expect(callEvaluateMarker(resolver, 'python_version >= "3.12"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'python_version > "3.12"')).toBe(false);
      });

      it('python_version 최대 버전 마커를 평가한다', () => {
        expect(callEvaluateMarker(resolver, 'python_version < "3.12"')).toBe(false);
        expect(callEvaluateMarker(resolver, 'python_version <= "3.12"')).toBe(true);
      });

      it('반복 Python 조건과 and/or 우선순위를 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'python_version >= "3.8" and python_version < "3.12"'
          )
        ).toBe(false);
        expect(
          callEvaluateMarker(
            resolver,
            'python_version < "3.12" or sys_platform == "linux"'
          )
        ).toBe(true);
        expect(
          callEvaluateMarker(
            resolver,
            'python_version >= "3.12" or python_version == "3.11" and sys_platform == "win32"'
          )
        ).toBe(true);
      });

      it('괄호로 묶인 marker 논리식을 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            '(python_version == "3.12" and sys_platform == "linux") or sys_platform == "win32"'
          )
        ).toBe(true);
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

    describe('확장 PEP 508 marker 환경', () => {
      beforeEach(() => {
        resolver = createResolver({
          targetPlatform: { system: 'Linux', machine: 'x86_64' },
          pythonVersion: '3.12.2',
        });
      });

      it('선택한 대상의 Python 및 구현 marker를 평가한다', () => {
        expect(callEvaluateMarker(resolver, 'python_full_version == "3.12.2"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'implementation_version >= "3.12.2"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'platform_python_implementation == "CPython"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'implementation_name == "cpython"')).toBe(true);
      });

      it('선택한 대상의 OS marker를 평가한다', () => {
        expect(callEvaluateMarker(resolver, 'os_name == "posix"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'os_name == "nt"')).toBe(false);
      });

      it('in, not in 및 리터럴-변수 역방향 비교를 평가한다', () => {
        expect(callEvaluateMarker(resolver, 'sys_platform in "linux win32"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'sys_platform not in "win32 darwin"')).toBe(true);
        expect(callEvaluateMarker(resolver, '"linux" == sys_platform')).toBe(true);
        expect(callEvaluateMarker(resolver, '"3.12.2" <= python_full_version')).toBe(true);
      });

      it('사용할 수 없거나 지원하지 않는 marker 조건은 제외한다', () => {
        expect(callEvaluateMarker(resolver, 'platform_release == "6.0"')).toBe(false);
        expect(callEvaluateMarker(resolver, 'platform_version == "1"')).toBe(false);
        expect(callEvaluateMarker(resolver, 'unknown_marker == "value"')).toBe(false);
        expect(callEvaluateMarker(resolver, 'python_version ~= "3.12"')).toBe(true);
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

      it('선택하지 않은 extra의 부정 마커는 포함한다', () => {
        expect(callEvaluateMarker(resolver, 'extra != "docs"')).toBe(true);
        expect(callEvaluateMarker(resolver, 'extra == "docs"')).toBe(false);
      });

      it('extra 부정 마커와 플랫폼 조건을 함께 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'extra != "docs" and sys_platform == "linux"'
          )
        ).toBe(true);
        expect(
          callEvaluateMarker(
            resolver,
            'extra != "docs" and sys_platform == "win32"'
          )
        ).toBe(false);
      });

      it('여러 extra는 각 값에 대해 전체 marker 식을 평가한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'extra == "foo" and extra != "bar"',
            ['foo', 'bar']
          )
        ).toBe(true);
        expect(
          callEvaluateMarker(
            resolver,
            'extra == "foo" and extra != "bar"',
            ['bar']
          )
        ).toBe(false);
      });
      it('선택한 extra가 복합 마커를 만족하면 포함한다', () => {
        expect(
          callEvaluateMarker(
            resolver,
            'extra == "security" and sys_platform == "linux"',
            ['security'],
          ),
        ).toBe(true);
      });
    });
  });

  // flattenDependencies는 이제 shared/dependency-tree-utils.ts로 이동
  // 테스트는 dependency-tree-utils.test.ts에서 수행

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
