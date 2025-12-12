# Conda 의존성 해결 알고리즘 분석

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

### 5.1 간소화된 의존성 해결

완전한 SAT solver 대신 **재귀적 DFS + 버전 선택 휴리스틱** 사용:

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

class CondaDependencyResolver {
  private repoData: RepoData;
  private resolved: Map<string, PackageRecord> = new Map();
  private resolving: Set<string> = new Set(); // 순환 의존성 감지

  async resolve(specs: string[]): Promise<PackageRecord[]> {
    for (const spec of specs) {
      await this.resolveSpec(spec);
    }
    return Array.from(this.resolved.values());
  }

  private async resolveSpec(spec: string): Promise<void> {
    const matchSpec = parseMatchSpec(spec);

    // 이미 해결됨
    if (this.resolved.has(matchSpec.name)) {
      return;
    }

    // 순환 의존성 감지
    if (this.resolving.has(matchSpec.name)) {
      return; // 또는 에러
    }

    this.resolving.add(matchSpec.name);

    // 가장 적합한 패키지 선택
    const pkg = this.selectBestPackage(matchSpec);
    if (!pkg) {
      throw new Error(`Package not found: ${spec}`);
    }

    // 의존성 재귀 해결
    for (const dep of pkg.depends) {
      await this.resolveSpec(dep);
    }

    this.resolved.set(matchSpec.name, pkg);
    this.resolving.delete(matchSpec.name);
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
function getPackageUrl(
  channel: string,
  subdir: string,
  filename: string
): string {
  // conda-forge 채널
  if (channel === 'conda-forge') {
    return `https://conda.anaconda.org/conda-forge/${subdir}/${filename}`;
  }

  // Anaconda 기본 채널
  if (channel === 'defaults' || channel === 'main') {
    return `https://repo.anaconda.com/pkgs/main/${subdir}/${filename}`;
  }

  // 기타 채널
  return `https://conda.anaconda.org/${channel}/${subdir}/${filename}`;
}
```

## 7. DepsSmuggler 구현 세부사항

### 7.1 패키지 크기 정보 추출

CondaResolver는 repodata.json에서 패키지 크기(`size` 필드)를 추출하여 전달합니다.

```typescript
interface PackageCandidate {
  name: string;
  version: string;
  filename: string;
  buildNumber: number;
  depends: string[];
  subdir: string;
  size: number;  // repodata.json의 size 필드
}

// repodata에서 패키지 정보 추출 시 size 포함
candidates.push({
  name: pkg.name,
  version: pkg.version,
  filename: pkg.filename,
  buildNumber: pkg.build_number,
  depends: pkg.depends || [],
  subdir: pkg.subdir || repodata.info?.subdir || 'noarch',
  size: pkg.size || 0,  // 크기 정보 추가
});
```

### 7.2 총 크기 계산

의존성 해결 완료 후 전체 패키지의 총 크기를 계산하여 반환합니다.

```typescript
const flatList = this.flattenDependencies(root);
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

## 8. 참고 자료

- [conda Deep Dive: Solvers](https://docs.conda.io/projects/conda/en/4.13.x/dev-guide/deep-dive-solvers.html)
- [conda Package Specification](https://conda.io/projects/conda/en/latest/user-guide/concepts/pkg-specs.html)
- [libsolv GitHub](https://github.com/openSUSE/libsolv)
- [openSUSE: Libzypp satsolver](https://en.opensuse.org/openSUSE:Libzypp_satsolver)
- [libsolv History](https://manpages.ubuntu.com/manpages/noble/man3/libsolv-history.3.html)
- [mamba GitHub](https://github.com/mamba-org/mamba)
