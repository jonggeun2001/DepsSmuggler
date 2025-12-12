# pip install 의존성 해결 및 파일 선택 알고리즘 분석

## 1. 전체 아키텍처 개요

pip install은 크게 **두 가지 핵심 시스템**으로 구성됩니다:

```
┌─────────────────────────────────────────────────────────────┐
│                      pip install                             │
├─────────────────────────────────────────────────────────────┤
│  1. Resolver (resolvelib)     │  2. Finder (PackageFinder)  │
│  - 의존성 해결                 │  - 파일 검색 및 선택          │
│  - 백트래킹 알고리즘            │  - wheel/sdist 우선순위       │
│  - 버전 충돌 해결              │  - 플랫폼 호환성 검사          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 의존성 해결 알고리즘 (Resolver)

### 2.1 resolvelib 백트래킹 알고리즘

pip는 **resolvelib** 라이브러리를 사용합니다. 핵심은 **백트래킹(Backtracking)** 알고리즘입니다.

**왜 백트래킹인가?**
- 의존성 해결은 **NP-hard 문제**
- Python 패키지는 메타데이터를 **다운로드 후에만** 알 수 있음 (사전 계산 불가)
- 전체 의존성 트리를 미리 알 수 없어서 SAT solver 등 사용 불가

### 2.2 PipProvider의 우선순위 결정 (`get_preference`)

```python
# pip/_internal/resolution/resolvelib/provider.py
def get_preference(...) -> Preference:
    return (
        not direct,        # 1. 직접 URL 참조 (가장 높은 우선순위)
        not pinned,        # 2. 고정 버전 (== 또는 ===)
        not upper_bounded, # 3. 상한 제한 (<, <=, ~=, ==*)
        requested_order,   # 4. 사용자 지정 순서
        not unfree,        # 5. 제약 조건 있는 것
        identifier,        # 6. 알파벳 순서 (일관성)
    )
```

**우선순위 규칙:**
1. **Direct URL** - 명시적 URL 참조가 가장 먼저
2. **Pinned** - `==1.0.0` 같은 고정 버전
3. **Upper bounded** - `<2.0`, `<=1.5`, `~=1.4` 같은 상한 제한
4. **User order** - 사용자가 명령줄에 입력한 순서
5. **Constrained** - 어떤 제약이든 있는 것
6. **Alphabetical** - 디버깅 일관성을 위해

### 2.3 백트래킹 최적화 (`narrow_requirement_selection`)

```python
def narrow_requirement_selection(...) -> Iterable[str]:
    # 1. Requires-Python은 항상 먼저 (빠르고 실패 시 전체 중단)
    if identifier == REQUIRES_PYTHON_IDENTIFIER:
        return [identifier]

    # 2. 백트래킹 원인이 된 패키지들을 먼저 처리
    if identifier in backtrack_identifiers:
        current_backtrack_causes.append(identifier)
```

---

## 3. 패키지 파일 선택 알고리즘 (Finder)

### 3.1 PackageFinder 처리 흐름

```
1. LinkCollector.collect_sources()
   └─ PyPI/extra-index-url에서 HTML 페이지 수집

2. LinkEvaluator.evaluate_link()
   └─ 최소 조건 충족 여부 검사

3. CandidateEvaluator.get_applicable_candidates()
   └─ 호환 가능한 후보 필터링

4. CandidateEvaluator.sort_best_candidate()
   └─ 최적 후보 선택
```

### 3.2 LinkEvaluator - 링크 평가 기준

```python
class LinkType(enum.Enum):
    candidate = ...              # 설치 후보
    different_project = ...      # 다른 프로젝트
    yanked = ...                 # 철회된 버전
    format_unsupported = ...     # 지원 안 되는 형식
    format_invalid = ...         # 잘못된 형식
    platform_mismatch = ...      # 플랫폼 불일치
    requires_python_mismatch = ...  # Python 버전 불일치
```

### 3.3 Wheel 우선순위 결정 (CandidateSortingKey)

```python
# pip/_internal/index/package_finder.py
CandidateSortingKey = tuple[
    int,           # has_allowed_hash (해시 일치)
    int,           # yank_value (철회 여부)
    int,           # binary_preference (wheel > sdist)
    _BaseVersion,  # version (버전 - 높을수록 좋음)
    Optional[int], # wheel 태그 우선순위
    BuildTag,      # 빌드 태그
]
```

**정렬 우선순위:**
1. **Hash 일치** - 사용자 지정 해시와 일치하면 우선
2. **Yanked 여부** - 철회되지 않은 버전 우선
3. **Binary preference** - wheel이 sdist보다 우선
4. **Version** - 최신 버전 우선
5. **Tag priority** - 플랫폼 태그 일치도 (낮을수록 좋음)
6. **Build tag** - 빌드 번호

---

## 4. 플랫폼 호환성 태그 (PEP 425)

### 4.1 태그 형식

```
{python_tag}-{abi_tag}-{platform_tag}

예시:
- cp311-cp311-manylinux_2_17_x86_64
- cp311-abi3-macosx_11_0_arm64
- py3-none-any
```

### 4.2 태그 우선순위 (CPython 3.11 linux_x86_64 예시)

```python
# 가장 선호 → 덜 선호 순서
1. cp311-cp311-linux_x86_64      # 현재 버전 + ABI + 플랫폼
2. cp311-abi3-linux_x86_64       # stable ABI
3. cp311-none-linux_x86_64       # ABI 무관
4. cp311-none-manylinux_2_17_x86_64  # manylinux
5. py311-none-any                # 순수 Python (버전 특정)
6. py3-none-any                  # 순수 Python (Python 3)
7. py310-none-any                # 이전 버전 호환
...
```

### 4.3 Wheel.support_index_min()

```python
# pip/_internal/models/wheel.py
def support_index_min(self, tags: list[Tag]) -> int:
    """지원 태그 목록에서 가장 낮은(=가장 선호되는) 인덱스 반환"""
    return next(i for i, t in enumerate(tags) if t in self.file_tags)
```

---

## 5. 실제 동작 예시

```bash
pip install requests
```

### 5.1 단계별 처리

```
1. PyPI에서 requests 프로젝트 페이지 조회
   https://pypi.org/simple/requests/

2. 모든 링크 파싱 후 LinkEvaluator로 필터링
   - Python 버전 호환성 검사
   - 플랫폼 호환성 검사

3. 최신 호환 버전 선택 (예: 2.31.0)

4. 해당 버전의 wheel/sdist 중 최적 선택
   - requests-2.31.0-py3-none-any.whl (순수 Python → 우선)

5. 의존성 메타데이터 읽기
   - charset-normalizer, idna, urllib3, certifi

6. 각 의존성에 대해 재귀적으로 1-5 반복

7. 충돌 발생 시 백트래킹
   - 이전 선택으로 돌아가 다른 버전 시도
```

### 5.2 백트래킹 예시

```
A 1.0 requires B>=2.0
C 1.0 requires B<2.0

→ 충돌 발생!
→ A 또는 C의 다른 버전 시도
→ 해결될 때까지 반복
```

---

## 6. 핵심 소스코드 위치 (pip 저장소)

| 파일 | 역할 |
|------|------|
| `pip/_internal/resolution/resolvelib/provider.py` | resolvelib 인터페이스 구현 |
| `pip/_internal/index/package_finder.py` | 패키지 검색 및 선택 |
| `pip/_internal/models/wheel.py` | Wheel 파일 파싱 및 태그 매칭 |
| `pip/_internal/models/target_python.py` | 타겟 Python 환경 정보 |
| `pip/_internal/utils/compatibility_tags.py` | PEP 425 태그 생성 |

---

## 7. DepsSmuggler 구현 가이드

### 7.1 핵심 구현 항목

1. **버전 선택**: 최신 호환 버전 우선, 제약 조건 고려
2. **Wheel 우선**: sdist보다 wheel 선호 (빌드 불필요)
3. **플랫폼 태그 매칭**: 타겟 플랫폼에 맞는 wheel 선택
4. **의존성 재귀 해결**: 전이적 의존성 모두 수집
5. **충돌 처리**: 호환 버전 없으면 모든 버전 다운로드 옵션

### 7.2 구현 우선순위

```typescript
// 1. PEP 425 태그 생성기
interface PlatformTag {
  pythonTag: string;   // cp311, py3
  abiTag: string;      // cp311, abi3, none
  platformTag: string; // manylinux_2_17_x86_64, win_amd64
}

// 2. 후보 정렬 키
interface CandidateSortingKey {
  hasAllowedHash: boolean;
  isYanked: boolean;
  isBinary: boolean;      // wheel = true, sdist = false
  version: string;
  tagPriority: number;    // 낮을수록 좋음
  buildTag?: number;
}

// 3. 백트래킹 Resolver
interface ResolverState {
  resolutions: Map<string, Candidate>;
  requirements: Requirement[];
  backtrackCauses: string[];
}
```

### 7.3 패키지 크기 추출

PipResolver는 PyPI JSON API에서 패키지 크기를 추출합니다.

```typescript
// PyPI JSON API 응답 구조
// https://pypi.org/pypi/{package}/{version}/json
{
  "info": { "name": "requests", "version": "2.31.0", ... },
  "urls": [
    {
      "packagetype": "bdist_wheel",
      "filename": "requests-2.31.0-py3-none-any.whl",
      "size": 62574,
      ...
    },
    {
      "packagetype": "sdist",
      "filename": "requests-2.31.0.tar.gz",
      "size": 110346,
      ...
    }
  ]
}

// 크기 추출 로직
let packageSize = 0;
if (urls && urls.length > 0) {
  // wheel 파일 우선, 없으면 sdist
  const wheel = urls.find((u) => u.packagetype === 'bdist_wheel');
  const sdist = urls.find((u) => u.packagetype === 'sdist');
  packageSize = (wheel || sdist || urls[0]).size || 0;
}
```

**우선순위**:
1. `bdist_wheel` (wheel 파일) - 설치가 빠르고 일반적으로 크기가 작음
2. `sdist` (소스 배포) - wheel이 없는 경우 폴백
3. 첫 번째 URL - 둘 다 없는 경우

### 7.4 참고 링크

- [resolvelib GitHub](https://github.com/sarugaku/resolvelib)
- [pip GitHub](https://github.com/pypa/pip)
- [PEP 425 - Compatibility Tags](https://peps.python.org/pep-0425/)
- [PEP 503 - Simple Repository API](https://peps.python.org/pep-0503/)
- [pip 공식 문서 - Dependency Resolution](https://pip.pypa.io/en/stable/topics/dependency-resolution/)
