# Conda 의존성 해결 알고리즘 분석

> **알고리즘 분석 + 구현 대조 · 2026-09-08**: 1–4절은 Conda/SAT solver의 배경 분석, 5절은 BFS·MatchSpec·버전 비교를 설명하는 의사 코드입니다. DepsSmuggler는 SAT solver를 실행하지 않습니다. 실제 타입과 API는 [Resolvers](resolvers.md)와 [공유 Conda 유틸리티](shared-conda.md)를 참고하세요.

## 현재 구현 요약

- `CondaResolver.resolveDependencies()`는 BFS로 탐색하고, `CondaRepoDataProcessor`가 repodata 로딩·후보 인덱스·빌드 선택을 담당합니다. MatchSpec과 버전 비교는 `src/core/shared/conda-matchspec.ts`를 사용합니다.
- `PackageCandidate`는 `conda-repodata-processor.ts`에 정의되며 `build`, `buildNumber`, `isPythonMatch`, `size`, `filename`, `subdir`, `depends`를 포함합니다. 아래 축약 예시는 전체 인터페이스 선언을 대체하지 않습니다.
- 대상 플랫폼에 후보가 없거나 Python이 맞지 않을 때 noarch를 조회합니다. noarch도 Python/Python ABI 제약을 검증하며 무조건 호환으로 처리하지 않습니다. 호환 파일을 찾지 못하면 실패합니다.
- Python·Python ABI와 `__` 가상 패키지는 외부 환경 조건으로 취급합니다. OpenSSL·zlib·libgcc 같은 실제 런타임 패키지는 수집 대상입니다.
- `defaults`는 공유 채널 헬퍼를 통해 `https://repo.anaconda.com/pkgs/main`으로 변환합니다. 명시적 `main`과 다른 일반 채널은 `https://conda.anaconda.org/{channel}`을 유지하며, 그 뒤에 선택한 subdir와 파일명을 붙입니다.

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    conda install <package>                       │
├─────────────────────────────────────────────────────────────────┤
│  1. 채널에서 repodata.json 다운로드                              │
│  2. MatchSpec 객체로 요청 변환                                   │
│  3. SAT Solver로 의존성 해결                                     │
│  4. PackageRecord 목록 → 다운로드 → 설치                        │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 핵심 데이터 구조

### 2.1 repodata.json (채널별 패키지 메타데이터)

각 채널의 각 플랫폼(subdir)마다 존재하는 패키지 인덱스 파일.

**URL 형식**: `https://conda.anaconda.org/{channel}/{subdir}/repodata.json`

**예시**: `https://conda.anaconda.org/conda-forge/osx-arm64/repodata.json`

```json
{
  "info": {
    "subdir": "osx-arm64"
  },
  "packages": {
    "numpy-1.24.0-py311h123abc.tar.bz2": {
      "name": "numpy",
      "version": "1.24.0",
      "build": "py311h123abc",
      "build_number": 0,
      "depends": [
        "python >=3.11,<3.12.0a0",
        "libcblas >=3.9.0,<4.0a0",
        "libblas >=3.9.0,<4.0a0",
        "liblapack >=3.9.0,<4.0a0"
      ],
      "constrains": [
        "numpy-base <0a0"
      ],
      "license": "BSD-3-Clause",
      "md5": "abc123def456...",
      "sha256": "789xyz...",
      "size": 7654321,
      "subdir": "osx-arm64",
      "timestamp": 1699876543210
    }
  },
  "packages.conda": {
    "numpy-1.24.0-py311h123abc.conda": {
      // .conda 형식 패키지 (더 효율적인 압축)
      // 동일한 구조
    }
  }
}
```

### 2.2 PackageRecord 주요 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | string | 패키지 이름 (소문자, `-` 포함 가능) |
| `version` | string | 버전 문자열 (PEP 440 호환) |
| `build` | string | 빌드 문자열 (예: `py311h123abc_0`) |
| `build_number` | integer | 빌드 번호 (동일 버전 내 구분) |
| `depends` | string[] | 의존성 목록 (MatchSpec 형식) |
| `constrains` | string[] | 제약 조건 (설치 시 충돌 방지) |
| `subdir` | string | 플랫폼 (linux-64, osx-arm64 등) |
| `md5` | string | MD5 체크섬 |
| `sha256` | string | SHA256 체크섬 |
| `size` | integer | 파일 크기 (bytes) |
| `timestamp` | integer | 빌드 타임스탬프 (밀리초) |

### 2.3 플랫폼 (subdir) 목록

```
linux-64      linux-aarch64    linux-ppc64le    linux-s390x
osx-64        osx-arm64
win-64        win-32
noarch        (플랫폼 독립)
```

## 3. MatchSpec (의존성 쿼리 언어)

### 3.1 문법

```
<name> [<version>] [<build>]
```

공백으로 구분된 1~3개 부분:
1. **name**: 패키지 이름 (필수)
2. **version**: 버전 제약 (선택)
3. **build**: 빌드 문자열 제약 (선택)

### 3.2 버전 제약 연산자

| 연산자 | 설명 | 예시 |
|--------|------|------|
| `*` | 와일드카드 | `1.8.*` → 1.8.0, 1.8.1, 1.8.99 |
| `>=` | 이상 | `>=1.8` → 1.8, 1.9, 2.0 |
| `<=` | 이하 | `<=1.8` → 1.0, 1.7, 1.8 |
| `>` | 초과 | `>1.8` → 1.8.1, 1.9, 2.0 |
| `<` | 미만 | `<1.8` → 1.0, 1.7, 1.7.9 |
| `==` | 정확히 일치 | `==1.8.0` → 1.8.0만 |
| `!=` | 제외 | `!=1.8.0` → 1.8.0 제외 모두 |
| `,` | AND | `>=1.8,<2.0` → 1.8 이상 2.0 미만 |
| `\|` | OR | `1.8\|1.9` → 1.8 또는 1.9 |

### 3.3 예시

```
numpy                    → numpy 아무 버전
numpy 1.8*               → numpy 1.8.x
numpy >=1.8              → numpy 1.8 이상
numpy >=1.8,<2           → numpy 1.8 이상 2.0 미만
numpy 1.8.1|1.8.3        → numpy 1.8.1 또는 1.8.3
numpy 1.8.1 py39_0       → numpy 1.8.1, 빌드 py39_0
pytorch=1.8.*=*cuda*     → pytorch 1.8.x, CUDA 빌드
```

### 3.4 버전 비교 규칙

1. `.` 과 `_`로 구분
2. 숫자는 숫자로, 문자는 문자열로 비교
3. `dev` < `a` (alpha) < `b` (beta) < `rc` < 정식 < `post`

```
0.4 < 0.4.1.rc < 0.4.1 < 0.5a1 < 0.5b3 < 0.5 < 1.0
1.1dev1 < 1.1a1 < 1.1.0rc1 < 1.1.0 < 1.1.0post1
```

## 4. SAT Solver 알고리즘

### 4.1 SAT 문제로 변환

패키지 의존성을 **불리언 충족 가능성 문제**로 변환:

```
# 각 패키지 버전을 불리언 변수로
numpy_1.24.0 = True/False
numpy_1.23.0 = True/False
python_3.11.0 = True/False

# 사용자 요청
numpy_installed = True  (어떤 numpy 버전이든 설치)

# 의존성을 논리식으로 (numpy 1.24.0 설치하려면)
numpy_1.24.0 → (python_3.11 ∨ python_3.10) ∧ libcblas_3.9

# 충돌 방지 (같은 패키지의 다른 버전은 동시 설치 불가)
¬(numpy_1.24.0 ∧ numpy_1.23.0)
```

### 4.2 DPLL + CDCL 알고리즘

```
DPLL (Davis-Putnam-Logemann-Loveland):
1. Unit Propagation: 단일 리터럴 절 처리
2. Pure Literal Elimination: 순수 리터럴 제거
3. 변수 선택 후 분기 (True/False)
4. 충돌 시 백트래킹

CDCL (Conflict-Driven Clause Learning):
- 충돌 발생 시 원인 분석
- 새로운 절(clause) 학습
- Non-chronological 백트래킹
```

### 4.3 해결 과정

```
Step 1: 인덱스 수집
━━━━━━━━━━━━━━━━━━
conda-forge/osx-arm64/repodata.json 다운로드
→ 700,000+ 패키지 메타데이터

Step 2: 요청 변환
━━━━━━━━━━━━━━━━
사용자 입력: "conda install xgboost"
→ MatchSpec("xgboost")

Step 3: 컨텍스트 수집
━━━━━━━━━━━━━━━━━━━━
- 현재 설치된 패키지 (PrefixData)
- 히스토리 (이전 install/update/remove)
- 핀된 패키지 (conda-meta/pinned)

Step 4: 인덱스 축소 (get_reduced_index)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
700,000개 → ~1,000개 (관련 패키지만)

Step 5: SAT 절 생성
━━━━━━━━━━━━━━━━━━
gen_clauses() → Clauses 객체 생성

Step 6: SAT 해결
━━━━━━━━━━━━━━━
해가 있으면 → 최적화 단계로
해가 없으면 → 충돌 분석, 에러 보고

Step 7: 최적화 (여러 해 중 최선 선택)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. minimize: 제거 패키지 수
2. maximize: 버전, 빌드 번호
3. prefer: 채널 우선순위
4. prefer: 최신 타임스탬프
5. minimize: 전체 패키지 수

Step 8: 트랜잭션 생성
━━━━━━━━━━━━━━━━━━━
현재 상태 vs 해결 상태 비교
→ FETCH, EXTRACT, LINK 작업 목록
```

## 5. 구현 전략 (DepsSmuggler)

### 5.1 BFS 큐 기반 의존성 해결

완전한 SAT solver 대신 **BFS 큐 + 버전 선택 휴리스틱** 사용:

> 기존 재귀적 DFS에서 BFS 큐 기반으로 변경하여 깊은 의존성 트리에서도 call stack overflow가 발생하지 않습니다.

```typescript
interface RepoData {
  packages: Record<string, PackageRecord>;
  'packages.conda': Record<string, PackageRecord>;
}

interface PackageRecord {
  name: string;
  version: string;
  build: string;
  build_number: number;
  depends: string[];
  constrains?: string[];
  md5: string;
  sha256: string;
  size: number;
  subdir: string;
  timestamp?: number;
}

interface QueueItem {
  name: string;
  version: string;
  depth: number;
  parentCacheKey?: string;  // 부모 패키지 캐시키 (트리 구축용)
}

class CondaDependencyResolver {
  private repoData: RepoData;
  private resolvedNodes: Map<string, DependencyNode> = new Map();
  private parentChildMap: Map<string, string[]> = new Map();

  async resolve(specs: string[]): Promise<DependencyNode> {
    const queue: QueueItem[] = [];
    let rootCacheKey: string | undefined;

    // 루트 패키지를 큐에 추가
    for (const spec of specs) {
      const matchSpec = parseMatchSpec(spec);
      queue.push({ name: matchSpec.name, version: matchSpec.version, depth: 0 });
    }

    // BFS 처리
    while (queue.length > 0) {
      const current = queue.shift()!;
      const { name, version, depth, parentCacheKey } = current;

      // 최대 깊이 체크
      if (depth > this.maxDepth) continue;

      const cacheKey = `${channel}/${name.toLowerCase()}@${version}`;

      // 이미 해결된 패키지면 부모-자식 관계만 추가
      if (this.resolvedNodes.has(cacheKey)) {
        if (parentCacheKey) {
          this.addChildToParent(parentCacheKey, cacheKey);
        }
        continue;
      }

      // 루트 캐시키 저장
      if (!rootCacheKey) rootCacheKey = cacheKey;

      // 패키지 정보 조회
      const pkgInfo = await this.fetchPackageInfo(name, version);

      // 노드 생성 및 저장
      const node = { package: pkgInfo, dependencies: [] };
      this.resolvedNodes.set(cacheKey, node);

      // 부모-자식 관계 저장
      if (parentCacheKey) {
        this.addChildToParent(parentCacheKey, cacheKey);
      }

      // 의존성 큐에 추가
      for (const dep of pkgInfo.depends) {
        const depSpec = parseMatchSpec(dep);
        const depVersion = await this.resolveVersion(depSpec);
        queue.push({
          name: depSpec.name,
          version: depVersion,
          depth: depth + 1,
          parentCacheKey: cacheKey,
        });
      }
    }

    // 트리 구축
    return this.buildTree(rootCacheKey);
  }

  private selectBestPackage(spec: MatchSpec): PackageRecord | null {
    const candidates = this.findMatchingPackages(spec);
    if (candidates.length === 0) return null;

    // 정렬: 버전 내림차순 → 빌드 번호 내림차순 → 타임스탬프 내림차순
    candidates.sort((a, b) => {
      const versionCmp = compareVersions(b.version, a.version);
      if (versionCmp !== 0) return versionCmp;

      const buildCmp = b.build_number - a.build_number;
      if (buildCmp !== 0) return buildCmp;

      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    return candidates[0];
  }
}
```

### 5.2 MatchSpec 파서

```typescript
interface MatchSpec {
  name: string;
  version?: VersionConstraint;
  build?: string;
}

interface VersionConstraint {
  operator: '==' | '>=' | '<=' | '>' | '<' | '!=' | '*';
  version: string;
  and?: VersionConstraint;
  or?: VersionConstraint;
}

function parseMatchSpec(spec: string): MatchSpec {
  // "numpy >=1.8,<2.0 py39*"
  const parts = spec.trim().split(/\s+/);
  const name = parts[0];

  let version: VersionConstraint | undefined;
  let build: string | undefined;

  if (parts.length >= 2) {
    version = parseVersionConstraint(parts[1]);
  }
  if (parts.length >= 3) {
    build = parts[2];
  }

  return { name, version, build };
}

function parseVersionConstraint(str: string): VersionConstraint {
  // Handle OR: "1.8|1.9"
  if (str.includes('|')) {
    const [left, right] = str.split('|');
    return {
      ...parseVersionConstraint(left),
      or: parseVersionConstraint(right)
    };
  }

  // Handle AND: ">=1.8,<2.0"
  if (str.includes(',')) {
    const [left, right] = str.split(',');
    return {
      ...parseVersionConstraint(left),
      and: parseVersionConstraint(right)
    };
  }

  // Handle operators
  const operators = ['>=', '<=', '==', '!=', '>', '<'];
  for (const op of operators) {
    if (str.startsWith(op)) {
      return {
        operator: op as any,
        version: str.slice(op.length)
      };
    }
  }

  // Wildcard or exact
  if (str.includes('*')) {
    return { operator: '*', version: str };
  }

  return { operator: '==', version: str };
}
```

### 5.3 버전 비교

```typescript
function compareVersions(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] ?? { type: 'num', value: 0 };
    const partB = partsB[i] ?? { type: 'num', value: 0 };

    // 타입이 다르면: 숫자 > 문자열 (dev, post 제외)
    if (partA.type !== partB.type) {
      if (partA.type === 'dev') return -1;
      if (partB.type === 'dev') return 1;
      if (partA.type === 'post') return 1;
      if (partB.type === 'post') return -1;
      return partA.type === 'num' ? 1 : -1;
    }

    // 같은 타입끼리 비교
    if (partA.value < partB.value) return -1;
    if (partA.value > partB.value) return 1;
  }

  return 0;
}

function parseVersion(version: string): VersionPart[] {
  const parts: VersionPart[] = [];
  const segments = version.split(/[._]/);

  for (const seg of segments) {
    // 숫자와 문자 분리: "3a1" → ["3", "a", "1"]
    const subparts = seg.match(/(\d+|[a-zA-Z]+)/g) || [];

    for (const part of subparts) {
      if (/^\d+$/.test(part)) {
        parts.push({ type: 'num', value: parseInt(part, 10) });
      } else {
        const lower = part.toLowerCase();
        if (lower === 'dev') {
          parts.push({ type: 'dev', value: lower });
        } else if (lower === 'post') {
          parts.push({ type: 'post', value: lower });
        } else {
          parts.push({ type: 'str', value: lower });
        }
      }
    }
  }

  return parts;
}
```

## 6. 다운로드 URL 구성

```typescript
import { getCondaRepositoryBase } from '../shared/conda-channel';

function getPackageUrl(channel: string, subdir: string, filename: string): string {
  return `${getCondaRepositoryBase(channel)}/${subdir}/${filename}`;
}
```

`defaults`의 변환은 기본 저장소 origin에만 적용합니다. 사용자 지정 base URL과 Anaconda API 소유자 매핑은 [공유 Conda 유틸리티](shared-conda.md#채널-url-conda-channelts)를 참고하세요.

## 7. DepsSmuggler 구현 세부사항

### 7.1 패키지 크기 정보 추출

CondaResolver는 repodata.json에서 패키지 크기(`size` 필드)를 추출하여 전달합니다.

```typescript
interface PackageCandidate {
  name: string;
  version: string;
  filename: string;
  build: string;
  buildNumber: number;
  depends: string[];
  subdir: string;
  size: number;  // repodata.json의 size 필드
  isPythonMatch: boolean;
}

// 후보 구성의 개념 발췌: filename은 repodata 패키지 맵의 키,
// isPythonMatch는 build와 depends를 평가한 결과
candidates.push({
  name: pkg.name,
  version: pkg.version,
  filename,
  build: pkg.build,
  buildNumber: pkg.build_number,
  depends: pkg.depends || [],
  subdir: pkg.subdir || repodata.info?.subdir || 'noarch',
  size: pkg.size || 0,
  isPythonMatch,
});
```

### 7.2 총 크기 계산

의존성 해결 완료 후 전체 패키지의 총 크기를 계산하여 반환합니다.

```typescript
// src/core/shared에서 가져온 공용 함수
const flatList = flattenDependencyTree(root);
const totalSize = flatList.reduce(
  (sum, pkg) => sum + ((pkg.metadata?.size as number) || 0),
  0
);

return {
  root,
  flatList,
  conflicts: this.conflicts,
  totalSize,  // 총 크기 반환
};
```

**활용**:
- UI에서 다운로드 전 예상 크기 표시
- 다운로드 완료 시 총 크기 로깅

### 7.3 Python 버전 호환성

현재 `CondaRepoDataProcessor.isBuildCompatibleWithPython(build, depends)`는 빌드 문자열과 의존성 조건을 함께 검사합니다.

1. 대상 Python이 없으면 Python 필터를 적용하지 않습니다.
2. `py311`, `cp312` 같은 태그가 있으면 대상 Python과 일치해야 합니다.
3. 태그가 없는 `pyhd...` noarch 빌드도 `depends`의 `python`/`python_abi` 버전과 ABI build 제약을 검사합니다. 예를 들어 Python 3.12 대상은 `python >=3.13` noarch 패키지를 선택할 수 없습니다.
4. `major.minor` 대상 버전은 버전 범위 평가 시 `.0`을 붙여 비교합니다.

| 패턴 | 설명 | 예시 |
|------|------|------|
| `py` + 숫자 | Conda Python 태그 | `py311`, `py312`, `py313` |
| `cp` + 숫자 | CPython ABI 태그 | `cp311`, `cp312`, `cp313` |
| Python 태그 없음 | `depends` 조건을 별도로 검사 | `pyhd8ed1ab_0`, 네이티브 라이브러리 빌드 |

빌드 태그만 보는 과거 예시와 달리 Python 범위를 가진 noarch 패키지도 정확히 필터링합니다.

### 7.4 플랫폼 호환성 체크

의존성에 플랫폼 마커가 있으면 해당 플랫폼 전용 빌드로 판단하여 호환성을 확인합니다. `CondaRepoDataProcessor.isBuildCompatibleWithPlatform(depends)`는 OS 마커와 `__archspec` 아키텍처를 검사합니다.

CUDA 호환성은 별도 `isBuildCompatibleWithCuda(packageName, packageVersion, build, depends)`가 검사하며, 후보 수집 단계에서 두 메서드를 각각 호출합니다. CUDA 버전이 없으면 CUDA 의존 빌드를 제외하고, 지정한 버전이 있으면 그 버전 제약을 확인합니다. 아래는 플랫폼 검사의 OS 마커 부분만 설명한 축약 예시입니다.

```typescript
/**
 * 빌드가 타겟 플랫폼과 호환되는지 확인
 * depends에 플랫폼 마커(__win, __unix, __linux, __osx)가 있으면 해당 플랫폼 전용
 */
isBuildCompatibleWithPlatform(depends: string[]): boolean {
  const targetSubdir = this.config.targetSubdir;
  const isLinux = targetSubdir.startsWith('linux-');
  const isWindows = targetSubdir.startsWith('win-');
  const isMacOS = targetSubdir.startsWith('osx-');

  // 플랫폼 마커 확인 (버전 스펙 포함 가능: "__glibc >=2.17,<3.0.a0")
  const hasWin = depends.some(d => d === '__win' || d.startsWith('__win '));
  const hasUnix = depends.some(d => d === '__unix' || d.startsWith('__unix '));
  const hasLinux = depends.some(d => d === '__linux' || d.startsWith('__linux '));
  const hasOSX = depends.some(d =>
    d === '__osx' || d.startsWith('__osx ') ||
    d === '__macos' || d.startsWith('__macos ')
  );
  const hasGlibc = depends.some(d => d === '__glibc' || d.startsWith('__glibc '));

  // 플랫폼 마커가 없으면 모든 플랫폼과 호환
  if (!hasWin && !hasUnix && !hasLinux && !hasOSX && !hasGlibc) return true;

  // __glibc가 있으면 Linux 전용
  if (hasGlibc && !isLinux) return false;

  // 타겟 플랫폼에 따른 호환성 확인
  if (isLinux) return !(hasWin || hasOSX);
  if (isWindows) return !(hasUnix || hasLinux || hasOSX);
  if (isMacOS) return !(hasWin || hasLinux);

  // OS 마커가 있지만 대상 OS를 알 수 없으면 공통 빌드로 간주하지 않는다.
  return false;
}
```

예를 들어 `targetSubdir = 'noarch'`, `depends = ['__linux']`이면 `false`입니다. OS 마커가 없는 빌드는 위의 조기 반환으로 이 OS 검사 부분을 통과하며, 아키텍처·Python·CUDA 조건은 각각의 검사 결과도 만족해야 합니다.

**플랫폼 마커**:
| 마커 | 설명 | 호환 플랫폼 |
|------|------|------------|
| `__win` | Windows 전용 | Windows |
| `__unix` | Unix 계열 | Linux, macOS |
| `__linux` | Linux 전용 | Linux |
| `__osx`, `__macos` | macOS 전용 | macOS |
| `__glibc` | glibc 필요 | Linux |

### 7.5 noarch 폴백 처리

`CondaResolver.fetchPackageInfoBFS()`의 폴백 조건은 **선택 파일이 없거나 Python이 맞지 않는 경우**입니다. 의존성이 비어 있는 정상 패키지는 파일이 있다는 이유만으로 noarch에 덮어쓰지 않습니다.

```typescript
// 실제 조건 발췌: targetSubdir 후보를 평가한 이후
if (targetSubdir !== 'noarch' && (!resolvedFilename || !isPythonMatch)) {
  // noarch repodata를 읽고 동일한 버전·build·Python 제약으로 후보 평가
}
if (!resolvedSubdir || !resolvedFilename || !isPythonMatch) {
  throw new Error('대상 환경과 호환되는 Conda 아티팩트를 찾을 수 없습니다');
}
```

**폴백 우선순위**:

1. 대상 플랫폼에서 버전·build·Python 조건을 만족하는 파일을 선택합니다.
2. 후보가 없거나 Python이 맞지 않으면 noarch에서 같은 조건을 만족하는 파일을 선택합니다.
3. noarch 후보에도 `isPythonMatch`를 그대로 적용하고, 호환 파일이 없으면 실패합니다. 루트 오류와 전이 의존성 오류의 처리는 [Resolvers](resolvers.md)의 결과·오류 계약을 따릅니다.

### 7.6 외부 런타임 및 가상 패키지 스킵

대상 Python 런타임과 Conda 가상 패키지는 다운로드하지 않고
호환성 조건으로만 사용합니다. OpenSSL, zlib, libgcc 같은 실제 Conda
런타임 패키지는 오프라인 묶음에 포함합니다.

```typescript
private isSystemPackage(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return (
    normalizedName === 'python' ||
    normalizedName === 'python_abi' ||
    normalizedName.startsWith('__')
  );
}
```

### 7.7 downloadUrl 전달 흐름

```text
CondaResolver.resolveDependencies()
  → CondaRepoDataProcessor가 파일·subdir·size 선택
  → PackageInfo.metadata에 downloadUrl / filename / subdir / repository / size 저장
  → resolveAllDependencies()가 요청 패키지와 resolver 메타데이터 병합
  → GUI 다운로드 항목 또는 CLI DownloadManager 큐
  → Electron download-package-router 또는 공통 CondaDownloader
  → 선택된 URL로 다운로드
```

**장점과 적용 조건**:

- 의존성 해결에서 선택한 URL이 있으면 실제 다운로드에서 재사용해 아티팩트가 바뀌지 않습니다.
- URL이 없는 기존 입력에는 downloader의 메타데이터 조회 폴백이 남아 있습니다.
- 선택된 `filename`, `subdir`와 Python 호환성이 함께 전달됩니다. 공개 메서드 이름은 `resolveDependencies()`이며 과거 예시의 `resolve()`는 현재 API가 아닙니다.

## 8. 요청 단위 조회 재사용

`resolveAllDependencies()`의 한 요청 안에서는 공통 Conda 전이 의존성의
repodata 호환 후보 선택과 선택된 artifact 정보를 재사용합니다. 조회 키는
소문자로 정규화한 이름, 최신 선택용 버전 조건 또는 정확 artifact 버전, build,
channel, target subdir·아키텍처, Python 버전, CUDA 버전을 포함합니다. 따라서
channel이나 대상 환경, build 조건이 다르면 결과를 공유하지 않습니다.

동일 키의 in-flight 조회는 한 번만 실행하고 consumer마다 복제한 결과를
반환합니다. 후보가 없거나 오류가 나면 결과를 남기지 않으므로 다음 직접 루트가
기존 방식으로 다시 후보를 찾습니다. repodata의 메모리·디스크 cache와
noarch/fallback 처리도 그대로 사용합니다.

이 재사용은 후보와 artifact metadata에 한정됩니다. 각 직접 루트의 BFS 상태,
부모-자식 관계, Python 호환성 판단과 최종 다운로드 목록은 계속 별도로
구성되며, 다른 `resolveAllDependencies()` 요청에는 세션이 유지되지 않습니다.

## 9. 참고 자료

- [conda Deep Dive: Solvers](https://docs.conda.io/projects/conda/en/4.13.x/dev-guide/deep-dive-solvers.html)
- [conda Package Specification](https://conda.io/projects/conda/en/latest/user-guide/concepts/pkg-specs.html)
- [libsolv GitHub](https://github.com/openSUSE/libsolv)
- [openSUSE: Libzypp satsolver](https://en.opensuse.org/openSUSE:Libzypp_satsolver)
- [libsolv History](https://manpages.ubuntu.com/manpages/noble/man3/libsolv-history.3.html)
- [mamba GitHub](https://github.com/mamba-org/mamba)
