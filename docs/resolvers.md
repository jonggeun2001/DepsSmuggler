# Resolvers

## 개요
- 목적: 패키지 의존성 트리 해결 및 충돌 감지
- 위치: `src/core/resolver/`

---

## 요청 단위 원격 조회 재사용

공통 `resolveAllDependencies()`는 의존성 포함 요청마다 pip·Conda·Maven·npm의
새 resolver 묶음과 내부 조회 세션을 만듭니다. 같은 요청 안에서 공통 전이
의존성이 같은 원격 조회 문맥을 다시 요구하면 후보 선택·metadata/manifest
조회만 재사용합니다. 동일한 in-flight 조회도 하나의 작업으로 합쳐지고 각
consumer에는 독립 복제본이 반환됩니다.

세션은 요청 종료와 함께 사라집니다. 실패, `null`, 빈 후보는 저장하지 않아
뒤의 직접 루트가 재시도할 수 있습니다. 이는 최종 패키지 목록이나 전역 그래프를
공유하는 기능이 아니므로 각 루트의 BFS 상태, pip extras·marker, Maven
scope·exclusion·dependencyManagement, npm peer dependency·hoisting 규칙은
그대로 유지됩니다. OS 패키지(yum/apt/apk)와 Docker는 대상이 아닙니다.

키에는 resolver별 결과에 영향을 주는 입력만 넣습니다. pip은 PEP 503 이름·
버전 조건·저장소·대상 환경·source 검증 모드, Conda는 이름·버전/build·channel·
subdir/아키텍처·Python/CUDA, Maven은 실제 저장소 URL과 좌표, npm은 소문자 이름·
버전 조건·registry URL을 사용합니다. pip과 Maven의 cache option은 요청 시작 시
전용 resolver에 snapshot으로 복사되며 legacy singleton과 요청 상태를 공유하지
않습니다. 상세 경계는 [공통 의존성 해결 문서](./shared-dependency.md)와 각
resolver 문서를 참고합니다.

---

## PipResolver

### 개요
- 목적: Python/PyPI 패키지 의존성 해결
- 위치: `src/core/resolver/pip-resolver.ts`
- 캐시: `src/core/shared/pip-cache.ts` 모듈 사용 (메모리 + 디스크 캐싱)
- **알고리즘**: BFS 큐 기반 (v1.x 대비 call stack overflow 문제 해결)

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | 메인 진입점: 패키지 의존성 트리 해결 (BFS 큐 기반) |
| `parseFromText` | content: string | Promise<PackageInfo[]> | requirements.txt를 읽고 버전 조회 |
| `flattenDependencyTree` (공유 함수) | node: DependencyNode | PackageInfo[] | 결과 flatList 생성에 사용 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `fetchPackageInfo` | 패키지 정보 조회 (캐시 활용) |
| `parseDependencyString` | 의존성 문자열 파싱 (예: "requests>=2.0,<3.0; python_version >= '3.8'") |
| `getLatestVersion` | 버전 제약조건에 맞는 최신 버전 조회 |
| `evaluateMarker` | 환경 마커 평가 (예: `python_version >= '3.8'`, `sys_platform == 'linux'`) |

### BFS 큐 알고리즘

기존 재귀 방식(`resolvePackage`)에서 BFS 큐 기반으로 변경되어 깊은 의존성 트리에서도 call stack overflow가 발생하지 않습니다.

```typescript
// 내부 타입
interface QueueItem {
  name: string;
  version: string;
  indexUrl?: string;
  extras?: string[];
  parentCacheKey?: string; // 부모 패키지 캐시키 (트리 구축용)
}

// 알고리즘 흐름
// 1. 루트 패키지를 큐에 추가
// 2. 큐에서 패키지를 꺼내어 정보 조회
// 3. 동일한 이름과 버전이면 부모-자식 관계를 추가하고, 새 extra가 있을 때만 그 extra로 다시 확장
// 4. 노드 생성 및 저장
// 5. 하위 의존성을 큐에 추가
// 6. 큐가 빌 때까지 반복
// 7. 부모-자식 관계 맵을 이용해 트리 구축
```

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'pip' |
| `baseUrl` | string | PyPI API URL |
| `visited` | Map<string, DependencyNode> | 방문한 패키지 캐시 |
| `conflicts` | DependencyConflict[] | 감지된 충돌 목록 |
| `pythonVersion` | string 또는 null | 타겟 Python 버전 (예: '3.11') |
| `targetPlatform` | TargetPlatform 또는 null | 타겟 플랫폼 정보 |
| `cacheOptions` | PipCacheOptions | 공유 캐시 옵션 (메타데이터 캐시는 공유 모듈 사용) |

### 메서드 (캐시 관련)

| 메서드 | 설명 |
|--------|------|
| `setCacheOptions` / `getCacheOptions` | 캐시 옵션 설정/복사본 조회 |
| `clearCache` | 캐시 초기화 (공유 캐시 초기화) |

### Python 대상 옵션

```typescript
interface ResolverOptions {
  targetPlatform?: {
    system?: 'Linux' | 'Darwin' | 'Windows';
    machine?: 'x86_64' | 'aarch64' | 'arm64';
  };
  pythonVersion?: string; // '3.11', '3.12'
}
```

### 환경 마커 평가

PEP 508 환경 마커를 평가하여 플랫폼별 의존성 필터링:

```typescript
// 현재 평가하는 marker 변수
- python_version, python_full_version, implementation_version
- os_name, sys_platform, platform_system, platform_machine
- platform_python_implementation, implementation_name
- extra
```

`pythonVersion`이 설정된 경우 `python_version`은 `major.minor`를, `python_full_version`과 `implementation_version`은 patch까지 포함한 값을 사용합니다. 버전 변수는 PEP 440으로, 나머지 변수는 문자열로 비교합니다. resolver identity는 CPython(`platform_python_implementation = 'CPython'`, `implementation_name = 'cpython'`)으로 고정합니다. `platform_machine` 비교에서는 `amd64`를 `x86_64`로, Linux ARM64의 `arm64`/`aarch64` 별칭을 `aarch64`로 정규화합니다. extra가 선택되지 않으면 빈 값으로 보존하고, 같은 정규화 이름과 버전에 새 extra가 발견되면 해당 extra로만 다시 확장합니다. 이 상태는 한 `resolveDependencies` 호출에만 유지됩니다.

지원하는 marker 조건은 괄호와 `and`/`or`, `===`, `==`, `!=`, `~=`, `>=`, `<=`, `>`, `<`, `in`, `not in`을 조합할 수 있으며, `and`를 `or`보다 먼저 평가합니다. 리터럴-변수 순서를 바꾼 비교도 지원합니다. `platform_release`, `platform_version`, 알 수 없는 변수, 지원하지 않는 연산자나 문법은 fail-closed로 처리하여 의존성을 포함하지 않습니다. Python full version의 patch가 제공되지 않아 비교 결과를 확정할 수 없는 marker도 제외합니다. wheel 선택은 대상 CPython 태그, 범용 `py3`/`py2.py3`, 대상보다 같거나 낮은 CPython 버전의 `abi3` 태그만 호환으로 판단합니다. 대상 Python이 지정되면 PyPI JSON API와 Simple API의 후보를 모두 `호환 wheel → Requires-Python 호환 source distribution → 후보 없음` 순서로 선택합니다. 호환 wheel과 source distribution이 모두 없으면 요청한 정확 버전·`latest`·범위 spec 및 대상 Python/OS/아키텍처를 포함한 동일한 진단을 반환합니다. `latest`와 범위 의존성은 호환 산출물이 있는 비철회 릴리스만 후보로 삼아 PEP 440 순서로 가장 높은 안정 버전을 선택합니다. wildcard가 없는 `==`/`===` 정확 고정만 철회 릴리스를 허용하고, 프리릴리스는 제약에 포함됐거나 안정 후보가 없을 때만 후보가 됩니다. Simple API는 `--no-deps`에서 artifact hash를 가진 source distribution만 Core Metadata 없이 반입할 수 있으며, wheel과 의존성 확장 모드는 검증된 Core Metadata를 계속 요구합니다. 필수 전이 의존성의 버전 선택, 메타데이터 조회 또는 네트워크 요청이 실패하면 해당 직접 루트 전체를 해결 실패로 반환합니다.

#### 최대 깊이와 루트 전용 처리

`PipResolver.resolveDependencies`를 직접 호출할 때 `maxDepth` 기본값은 `10`입니다. CLI의 기본 의존성 포함 다운로드 경로는 `--max-depth`를 공통 resolver에 전달하며 기본값은 `5`입니다. `depth >= maxDepth`인 노드는 조회·트리 결과에 유지하고, 적용 가능한 의존성이 있더라도 자식 큐 추가만 생략하면서 깊이와 생략 수가 포함된 경고를 애플리케이션 로그에 기록합니다. 따라서 최대 깊이 경계는 탐색을 제한하는 정상적인 bounded traversal이며 직접 루트를 실패로 만들지 않습니다.

필수 전이 의존성에 대해 호환되는 버전을 찾지 못하거나 메타데이터 조회·네트워크 요청이 실패하면 `RequiredDependencyResolutionError`가 발생하고 해당 직접 루트 전체가 해결 실패로 반환됩니다. 이는 깊이 경계 경고와 구별되는 실제 필수 의존성 해결 오류입니다. `resolveRootArtifactsOnly`는 shared resolver에서 pip의 `skipDependencyExpansion`으로만 전달됩니다. CLI의 `--no-deps`는 여기에 더해 `maxDepth: 0`도 전달하므로 pip와 Conda 모두 루트만 처리하며, 깊이 경계 경고 없이 조용히 종료합니다.

### Characterization 회귀 고정

`src/core/resolver/pip-resolver.characterization.test.ts`는 `resolveDependencies` 결과를 fixture별 JSON snapshot으로 고정합니다. 현재 유지하는 fixture는 다음 5종입니다.

- `simple`: 기본 PyPI 의존성 트리
- `extras`: extra marker가 켜진 의존성 포함 여부
- `conflicts`: 버전 제약 충돌 시 fallback과 conflict 기록
- `markers`: `sys_platform` / `platform_machine` 조건 필터링
- `wheel-tags`: Simple API + wheel tag 선택 + `pythonVersion`/platform 매칭

이 테스트는 BFS 트리 구조, flat list, conflict 목록을 함께 비교해 이후 구조 리팩터링에서 resolver 결과가 바뀌지 않았는지 확인하는 회귀 게이트 역할을 합니다.

### 사용 예시
```typescript
import { getPipResolver } from './core/resolver/pip-resolver';

const resolver = getPipResolver();

// 특정 플랫폼용 의존성 해결
const result = await resolver.resolveDependencies('flask', '2.0.0', {
  pythonVersion: '3.11',
  targetPlatform: { system: 'Linux', machine: 'x86_64' },
});

console.log(result.root);       // 의존성 트리
console.log(result.conflicts);  // 충돌 목록
console.log(result.flatList);   // 플랫 패키지 목록
```

### requirements.txt 파싱
```typescript
const deps = await resolver.parseFromText(`
flask>=2.0.0
requests==2.31.0
numpy>=1.20,<2.0
pywin32>=300; sys_platform == 'win32'
`);
// 결과: Array<{ type: 'pip', name: string, version: string }>
// 정확 고정은 그대로, 범위/미지정은 원격 조회로 선택한 실제 버전.
```

`parseFromText()`는 비동기이며 `-r`, `-e`, `--`로 시작하는 행을 무시합니다. 내부 문자열 파서는 extras/markers를 인식하지만 이 메서드의 반환값에는 이를 보존하지 않습니다. 의존성 해결 단계의 marker 평가와 텍스트 입력 변환은 별도 동작입니다.

### 의존성 해결 메커니즘

pip은 **패키지명 파싱이 아닌 메타데이터**에서 의존성을 가져옵니다.

#### 의존성 정보 출처

```
wheel (.whl)
└── {package}-{version}.dist-info/
    └── METADATA          ← Requires-Dist 필드에서 의존성 추출

source distribution (.tar.gz)
└── 빌드 후 메타데이터 추출  ← 비용이 큼 (backtracking 원인)
```

#### METADATA 파일 예시

```
Metadata-Version: 2.1
Name: requests
Version: 2.31.0
Requires-Dist: charset-normalizer <4,>=2
Requires-Dist: idna <4,>=2.5
Requires-Dist: urllib3 <3,>=1.21.1
Requires-Dist: certifi >=2017.4.17
Requires-Dist: PySocks !=1.5.7,>=1.5.6 ; extra == 'socks'
```

`Requires-Dist`는 다음처럼 버전 제약식을 괄호로 감싼 PEP 508 표현도 사용할 수 있습니다. resolver는 이 형태와 extras, 환경 마커를 함께 파싱합니다.

```
Requires-Dist: cached-property (>=1.5.2)
Requires-Dist: requests[security] (>=2.0) ; sys_platform == 'linux'
```

#### DepsSmuggler 구현

기본 PyPI 경로는 JSON API의 `requires_dist`를 사용합니다. 커스텀 Simple API 경로는 검증된 Core Metadata를 조회하며, 소스를 빌드해서 메타데이터를 생성하는 pip 실행기는 아닙니다:

```typescript
// pip-cache.ts
const url = `https://pypi.org/pypi/${packageName}/${version}/json`;
const response = await axios.get(url);
const requiresDist = response.data.info.requires_dist;  // 의존성 목록
```

### GPU/CPU 패키지 처리

#### PEP 440 로컬 버전 식별자

GPU 패키지는 로컬 버전 식별자(`+cu118` 등)나 별도 인덱스로 배포될 수 있습니다. 아래처럼 public version으로 지정한 조건은 여러 로컬 빌드와 호환될 수 있습니다:

```python
# public version 조건에 대한 로컬 빌드 매칭 예시
torch>=2.0.0  # 다음 모두와 매칭:
              # - torch 2.0.0
              # - torch 2.0.0+cpu
              # - torch 2.0.0+cu118
              # - torch 2.0.0+cu121
```

#### GPU 패키지 배포 방식

```bash
# CPU 버전
pip install torch --index-url https://download.pytorch.org/whl/cpu

# CUDA 11.8 버전
pip install torch --index-url https://download.pytorch.org/whl/cu118

# CUDA 12.1 버전
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

각각 **다른 wheel 파일**이고, 각자의 METADATA에 **다른 의존성**이 있습니다:

```
torch-2.1.0+cpu-cp311-cp311-linux_x86_64.whl
torch-2.1.0+cu118-cp311-cp311-linux_x86_64.whl
torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl
```

#### pip vs conda GPU 처리 비교

| 구분 | conda | pip |
|------|-------|-----|
| **GPU 구분** | 같은 패키지, `__cuda` 마커로 필터링 | 별도 패키지/인덱스 |
| **선택 방식** | solver가 자동 선택 | 사용자가 index-url 지정 |
| **의존성 처리** | 가상 패키지 제약과 build/dependency 검사 | 선택한 wheel의 `Requires-Dist` 처리 |

#### pip의 CUDA 선택 경계

현재 `PipResolver`는 Conda의 `cudaVersion` 필터를 적용하지 않습니다. 사용자가 선택한 `indexUrl`·패키지 버전으로 후보를 조회하고, 해당 배포물의 메타데이터를 기준으로 전이 의존성을 해결합니다.

1. GPU/CPU용 별도 인덱스가 제공되면 사용자가 대상 인덱스를 지정합니다.
2. 같은 public version의 다른 wheel도 메타데이터와 해시가 다를 수 있습니다.
3. 로컬 버전 식별자를 포함한 정확한 요구사항이 가능한 경우까지 모두 무시한다고 설명하지 않습니다.
4. 추가 GPU 의존성은 패키지 메타데이터가 선언한 내용에 따릅니다.

위 PyTorch 이름과 버전은 배포 형식을 보여주는 예시이며 현재 다운로드 가능 목록을 고정한 표가 아닙니다.

---

## CondaResolver

### 개요
- 목적: Conda/Anaconda 패키지 의존성 해결
- 위치: `src/core/resolver/conda-resolver.ts`
- RepoData 처리: `src/core/resolver/conda-repodata-processor.ts` (분리된 모듈)
- 캐시: `src/core/shared/conda-cache.ts` 모듈 사용 (repodata 디스크 캐시와 processor의 요청 중 메모리 캐시)
- **알고리즘**: BFS 큐 기반 (call stack overflow 방지)

`defaults` 채널은 `https://repo.anaconda.com/pkgs/main`을 기준으로 대상 subdir와 `noarch`의 repodata를 조회하고 다운로드 URL을 생성합니다. `metadata.repository`에는 요청한 `defaults/<name>`을 유지합니다. 명시적인 `main` 등 일반 채널은 `https://conda.anaconda.org/<채널>`을 사용합니다. 채널 URL 변환은 [공유 헬퍼](shared-conda.md#채널-url-conda-channelts)에 모으며, 버전·빌드 선택은 계속 repodata에 한정합니다.

### 모듈 구조

```
conda-resolver.ts
├── CondaResolver 클래스
│   ├── resolveDependencies() - 메인 진입점 (BFS 큐 기반)
│   ├── fetchPackageInfoBFS() - 단일 패키지 정보 조회
│   ├── parseDependencyString() - 의존성 문자열 파싱
│   ├── isSystemPackage() - 시스템 패키지 확인
│   ├── flattenDependencyTree() 호출 - 공유 유틸리티로 플랫 리스트 변환
│   ├── clearCache() - 캐시 초기화 (프로세서 위임)
│   └── parseFromText() - environment.yml 파싱
└── getCondaResolver() - 싱글톤 팩토리

conda-repodata-processor.ts
├── PackageCandidate 인터페이스
├── RepoDataProcessorConfig 인터페이스
└── CondaRepoDataProcessor 클래스
    ├── getRepoData() - repodata 로드 (캐싱 포함)
    ├── buildPackageIndex() - 패키지 인덱스 생성 (O(1) 조회용)
    ├── findPackageCandidates() - 패키지 후보 검색 및 정렬
    ├── getPythonBuildTag() - Python 빌드 태그 생성
    ├── isBuildCompatibleWithPython() - Python 호환성 체크
    ├── getLatestVersionFromRepoData() - repodata에서 최신 버전 조회
    └── clearCache() - 캐시 초기화
```

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name, version, options?: ResolverOptions & { channel?: string } | Promise<DependencyResolutionResult> | Conda 패키지 의존성 해결 (BFS) |
| `fetchPackageInfoBFS` (private) | name, version, channel, buildSpec? | Promise<{ packageInfo, depends, isPythonMatch }> | BFS용 패키지 정보 조회 |
| `parseFromText` | content: string | Promise<PackageInfo[]> | environment.yml 파싱과 버전 선택 |
| `flattenDependencyTree` (공유 함수) | node: DependencyNode | PackageInfo[] | 플랫 리스트 변환 |
| `clearCache` | - | void | repodata 캐시 초기화 |

### BFS 큐 알고리즘

기존 재귀 방식에서 BFS 큐 기반으로 변경되어 깊은 의존성 트리에서도 call stack overflow가 발생하지 않습니다.

```typescript
interface QueueItem {
  name: string;
  version: string;
  depth: number;
  parentCacheKey?: string;  // 부모 패키지 캐시키 (트리 구축용)
  buildSpec?: string;
}

// 알고리즘 흐름
// 1. 루트 패키지를 큐에 추가
// 2. 큐에서 패키지를 꺼내어 정보 조회
// 3. 이미 해결된 패키지면 부모-자식 관계만 추가하고 스킵
// 4. 노드 생성 및 resolvedNodes에 저장
// 5. 하위 의존성을 큐에 추가
// 6. 큐가 빌 때까지 반복
// 7. parentChildMap을 이용해 트리 구축
```

### 내부 메서드와 processor 위임

`getRepoData`, `findPackageCandidates`, `getLatestVersionFromRepoData`, `getPythonBuildTag`, `isBuildCompatibleWithPython`은 `CondaRepoDataProcessor`의 메서드입니다.

| 메서드 | 설명 |
|--------|------|
| `getRepoData` | repodata.json 가져오기 (zstd 압축 지원, 캐싱) |
| `findPackageCandidates` | repodata에서 패키지 후보 검색 |
| `parseDependencyString` | Conda 의존성 문자열 파싱 |
| `getLatestVersionFromRepoData` | repodata에서 최신 버전 조회 |
| `isSystemPackage` | 외부 Python 런타임 및 Conda 가상 패키지 여부 확인 |
| `getPythonBuildTag` | Python 버전에서 build 태그 추출 (예: '3.12' -> 'py312') |
| `isBuildCompatibleWithPython` | build 문자열이 Python 버전과 호환되는지 확인 |

버전 선택은 대상 플랫폼과 `noarch`의 repodata에 한정합니다. 이미 실행되지 않던 Anaconda API fallback 메서드와 전달 콜백을 제거했으며, `getLatestVersionFromRepoData`의 네 번째 인수는 기존 호출 호환용으로만 유지합니다. 대상 플랫폼·Python 호환성 판단은 `conda-resolver-target.test.ts`로 검증합니다.

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'conda' |
| `condaUrl` | string | Conda 패키지 저장소 URL |
| `defaultChannel` | string | 기본 채널 (conda-forge) |
| `visited` | Map | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `repoDataProcessor.repodataCache` | Map<string, RepoData> | processor의 repodata 메모리 캐시 |
| `repoDataProcessor.packageIndex` | Map<string, Map<string, Array>> | 패키지 이름별 인덱스 캐시 (O(1) 조회용) |
| `repoDataProcessor.targetSubdir` | string | 타겟 subdir (예: 'linux-64') |
| `pythonVersion` | string 또는 null | 타겟 Python 버전 |

### 특징

- **repodata.json.zst 지원**: zstd 압축 파일 우선 사용 (대역폭 절약)
- **캐싱**: repodata 캐싱으로 중복 요청 방지
- **Python 버전 필터링**: py312, py311 등 build 태그로 Python 버전에 맞는 패키지 선택
- **noarch 지원**: 아키텍처 독립 패키지 자동 탐색
- **런타임 구분**: 외부 Python 런타임과 `__` 가상 패키지만 제외하고 OpenSSL, zlib, libgcc 같은 실제 Conda 패키지는 포함
- **조회 범위**: resolver는 대상 subdir와 noarch의 repodata만 조회하며 Anaconda API fallback은 하지 않음

### 성능 최적화

#### 패키지 인덱스 캐시

repodata 로드 시 패키지 이름별 인덱스를 생성하여 O(n) 전체 순회를 O(1) 해시맵 조회로 최적화합니다.

```typescript
// 인덱스 구조: Map<cacheKey, Map<packageName, Array<{filename, pkg}>>>
const packageIndex: Map<string, Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>> = new Map();

// repodata 로드 시 인덱스 생성 (핵심 흐름)
function buildPackageIndex(repodata: RepoData) {
  const index = new Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>();
  const allPackages = { ...repodata.packages, ...repodata['packages.conda'] };
  for (const [filename, pkg] of Object.entries(allPackages)) {
    const normalizedName = pkg.name.toLowerCase();
    if (!index.has(normalizedName)) {
      index.set(normalizedName, []);
    }
    index.get(normalizedName)!.push({ filename, pkg });
  }
  return index;
}
```

#### 다운로드 URL 사전 생성

resolver에서 패키지 정보를 해결할 때 `downloadUrl`, `subdir`, `filename`을 metadata에 저장하여 다운로드 시 중복 조회를 방지합니다.

```typescript
// resolver에서 저장
const packageInfo: PackageInfo = {
  type: 'conda',
  name,
  version: resolvedVersion,
  metadata: {
    repository: `${channel}/${name}`,
    subdir: resolvedSubdir,      // 예: 'linux-64'
    filename: resolvedFilename,  // 예: 'numpy-1.26.0-py312h8753938_0.conda'
    downloadUrl,                 // 전체 URL
  },
};

// downloader에서 재사용
let downloadUrl = info.metadata?.downloadUrl as string | undefined;
if (!downloadUrl) {
  // fallback: 메타데이터 다시 조회
}
```

#### 로깅 개선

의존성 해결 시간과 진행 상황을 로그로 출력합니다. 아래 수치와 문구는 로그 형식의 예시입니다:

```
[INFO] repodata 로드 시작: conda-forge/linux-64 (처음 로드 시 시간이 걸릴 수 있습니다)
[INFO] repodata 다운로드 중: conda-forge/linux-64 (20.5MB / 102.3MB, 20%, 5.2초)
[INFO] repodata 로드 완료: conda-forge/linux-64 (fromCache: 네트워크, packages: 285000)
[INFO] 패키지 인덱스 생성 완료: conda-forge/linux-64 (45000개 패키지명, 850ms)
[INFO] Conda 의존성 해결 완료: numpy@1.26.0 (15개 패키지, 2.3초)
```

### Subdir 매핑

| OS + 아키텍처 | Subdir |
|---------------|--------|
| linux + x86_64 | linux-64 |
| linux + arm64/aarch64 | linux-aarch64 |
| macos + x86_64 | osx-64 |
| macos + arm64 | osx-arm64 |
| windows + x86_64 | win-64 |
| windows + arm64 | win-arm64 |

### 사용 예시
```typescript
import { getCondaResolver } from './core/resolver/conda-resolver';

const resolver = getCondaResolver();

// 특정 플랫폼/Python 버전용 의존성 해결
const result = await resolver.resolveDependencies('numpy', '1.26.0', {
  channel: 'conda-forge',
  pythonVersion: '3.12',
  targetPlatform: { system: 'Linux', machine: 'x86_64' },
});

console.log(result.root);       // 의존성 트리
console.log(result.conflicts);  // 충돌 목록
console.log(result.flatList);   // 플랫 패키지 목록
```

### environment.yml 파싱
```typescript
const deps = await resolver.parseFromText(`
name: myenv
channels:
  - conda-forge
dependencies:
  - numpy>=1.20
  - pandas=1.3.0
  - pip:
    - requests
`);
// 결과의 예시 형태 (범위 조건의 version은 조회 결과에 따라 달라짐):
// { type: 'conda', name: 'numpy', version: '<선택한 버전>',
//   metadata: { repository: 'conda-forge/numpy' } }
// { type: 'conda', name: 'pandas', version: '1.3.0',
//   metadata: { repository: 'conda-forge/pandas' } }
// { type: 'pip', name: 'requests', version: 'latest' }
```

---

## MavenResolver

### 개요
- 목적: Maven/Java 아티팩트 의존성 해결
- 위치: `src/core/resolver/maven-resolver.ts`
- 큐 처리: `src/core/resolver/maven-queue-processor.ts` (분리된 모듈)
- BOM 처리: `src/core/shared/maven-bom-processor.ts`
- POM 유틸리티: `src/core/shared/maven-pom-utils.ts`
- 캐시: `src/core/shared/maven-cache.ts` 모듈 사용 (메모리 + 디스크 캐싱, 병렬 프리페치 지원)

### 모듈 구조

```
maven-resolver.ts
├── MavenResolver 클래스
│   ├── resolveDependencies() - 메인 진입점
│   ├── resolveBF() - BFS 기반 의존성 해결 (큐 프로세서 사용)
│   ├── fetchPomWithCache() - POM 가져오기 (캐싱)
│   ├── prefetchPomsParallelInternal() - POM 병렬 프리페치
│   ├── fetchPackageSizes() - 패키지 크기 조회
│   ├── shouldIncludeDependency() - 의존성 포함 여부
│   ├── createDependencyNode() - 노드 생성
│   ├── recordConflict() - 충돌 기록
│   ├── parseFromText() - pom.xml 파싱
│   └── flattenDependencies() - 플랫 리스트 변환
└── getMavenResolver() - 싱글톤 팩토리

maven-queue-processor.ts
├── MavenResolutionContext 인터페이스
├── QueueProcessorDependencies 인터페이스
└── MavenQueueProcessor 클래스
    ├── processQueue() - 큐 처리 메인 루프
    ├── processQueueItem() - 단일 아이템 처리
    ├── enqueueRootDependencies() - 루트 의존성 큐 추가
    ├── enqueueChildDependencies() - 자식 의존성 큐 추가
    └── addChildToParent() - 부모에 자식 노드 추가
```

`QueueProcessorDependencies`는 기존 `PomProject`와 `PomDependency` 타입을 사용합니다. POM 조회·부모 POM 처리·의존성 필터 경계에서 필드 검사가 이어지며, 큐 순서와 scope·충돌 처리 동작은 유지됩니다. `maven-resolver.test.ts`와 `maven-pom-resolution.test.ts`가 관련 동작을 검증합니다.

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name, version, options?: MavenResolverOptions | Promise<DependencyResolutionResult> | GAV 좌표 기반 의존성 해결 |
| `getLatestVersion` | groupId, artifactId | Promise<string> | 최신 버전 조회 |
| `setCacheOptions` / `getCacheOptions` / `clearCache` | 캐시 옵션 | void / MavenCacheOptions | 캐시 설정 및 메모리 캐시 초기화 |
| `parseFromText` | content: string | Promise<PackageInfo[]> | pom.xml 파싱 |
| `flattenDependencies` (private) | node: DependencyNode | PackageInfo[] | 트리를 플랫 리스트로 변환 |

루트 버전이 `latest`이면 POM 조회 전에 설정된 저장소의 `maven-metadata.xml`에서 `latest`, 없으면 `release`를 선택합니다. 둘 다 비어 있으면 버전 조회 실패로 처리합니다. 해결 결과의 루트·플랫 목록·파일명에는 실제 버전이 들어가며 classifier와 artifact type은 유지합니다. 명시한 버전은 메타데이터 조회 없이 사용합니다. CLI의 기본 `--no-deps`도 `latest` 요청이면 깊이 0으로 이 과정을 실행합니다.

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `fetchPomWithCache` | 설정된 Maven 저장소에서 POM 파일 가져오기 |
| `MavenBomProcessor.processDependencyManagement` | BOM (Bill of Materials) 처리 |
| `MavenQueueProcessor` | 루트/전이 POM 의존성 큐와 BOM 관리 버전 처리 |
| `resolveProperty` | ${property} 치환 (비문자열 값 자동 변환) |
| `maven-pom-utils.ts` | 속성 치환과 의존성 배열 정규화 공유 함수 |
| `getLatestVersion` | 최신 버전 조회 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'maven' |
| `repoUrl` | string | Maven Central URL |
| `parser` | XMLParser | XML 파서 인스턴스 |
| `MavenResolutionContext.nodeMap` | Map<string, DependencyNode> | 호출별 노드/방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `bomProcessor` | MavenBomProcessor | BOM·부모 POM과 버전 관리 |
| `cacheOptions` | MavenCacheOptions | 공유 캐시 옵션 (POM 캐시는 공유 모듈 사용) |

직접 호출 기본값은 최대 깊이 20, POM 프리페치 동시 수 5, cache TTL 600,000ms(10분), optional 제외입니다. `algorithm` 타입은 bf/df를 받지만 현재 진입점은 항상 `resolveBF()`를 사용합니다. `targetOS`/`targetArchitecture`는 deprecated이며 네이티브 classifier를 자동 생성하지 않습니다.

### BOM/Parent POM 지원

루트와 선택된 전이 의존성의 POM을 해석하는 데 필요한 Parent POM 및 import BOM도 다운로드 결과의 `flatList`에 포함합니다. 부모의 부모, BOM의 부모, 중첩 import BOM을 따라가며 `groupId:artifactId:version` 전체 좌표로 중복을 제거하고 `metadata.type: 'pom'`을 지정합니다. 같은 부모가 여러 경로에서 필요하면 한 번만 포함하고, 같은 GA라도 버전이 다르면 각각 유지합니다.

`root`의 실행 의존성 그래프와 `flatList`의 다운로드 대상 목록은 같지 않을 수 있습니다. 모델 POM은 `flatList`에만 추가되므로 다운로드 UI는 `root.dependencies`만 다시 펼쳐 전체 파일 목록을 만들지 않습니다. renderer는 루트별 `flatList`로 다운로드 그룹을 연결하고, 장바구니 미리보기는 그래프 밖의 POM을 별도 목록으로 보여줍니다. 이 표시를 위해 모델 POM을 실행 의존성 간선으로 추가하지 않습니다.

실제 라이브러리 의존성은 `<dependencies>`와 기존 scope·optional·최대 깊이 설정에 따라 선택합니다. `<dependencyManagement>`는 버전 관리 정보이며, 그 안의 사용하지 않는 라이브러리를 전부 펼치지 않습니다. `type=pom`, `scope=import`인 BOM 자체와 모델 해석에 필요한 부모 POM을 모으는 과정은 이 라이브러리 선택과 별개입니다. `dependencies`가 없는 BOM 루트도 자신의 POM과 필요한 모델 POM만 포함합니다.

전이 패키지의 부모/BOM 관리 맵은 루트의 관리 값을 기준으로 패키지별로 분리합니다. 버전이 생략된 의존성을 해결할 때 루트의 관리 버전은 유지하고, 한 형제 패키지의 미사용 관리 항목이 다른 형제의 부모/BOM 버전 선택을 오염시키지 않습니다. 필요한 모델 POM의 수집과 중복 제거는 요청 전체에서 공유합니다.

```typescript
// Parent POM 예시 (dependencies 없음)
const result = await resolver.resolveDependencies(
  'org.springframework.boot:spring-boot-dependencies',
  '3.2.0'
);
// → BOM 자체와 필요한 부모/import BOM의 POM을 포함
// → dependencyManagement의 사용하지 않는 라이브러리는 다운로드하지 않음
```

Parent/BOM 탐색과 다운로드 목록으로의 그래프 평탄화는 반복 방식으로 처리합니다. 깊은 체인에서 재귀 호출 스택이 증가하지 않으며, Parent/BOM의 순환 참조는 오류로 보고합니다. 필요한 Parent/BOM을 읽을 수 없거나 좌표를 해결하지 못하면 해당 루트의 의존성 해결을 실패로 처리하여 불완전한 결과를 성공으로 반환하지 않습니다.

예를 들어 `org.apache.flink:flink-streaming-java:1.20.5`에서 `flink-core → flink-core-api → flink-metrics-core`를 선택하면, 마지막 패키지의 부모인 `org.apache.flink:flink-metrics:1.20.5`도 POM 다운로드 항목에 포함합니다. 이 부모는 실행 코드가 있는 JAR 의존성으로 바뀌지 않으며 기존 compile/runtime 의존성 다운로드도 유지됩니다.

### Packaging 타입 처리

명시한 artifact type을 우선하고, type이 없을 때만 원격 POM의 `<packaging>` 태그를 사용합니다. 루트 요청은 `MavenResolverOptions.artifactType`으로 전달되며 전이 의존성은 `<dependency><type>`을 사용합니다. packaging으로 type을 보완할 때는 metadata의 파일명도 함께 갱신합니다.

`resolveAllDependencies()`는 입력의 `metadata.type`을 resolver에 전달하고, 공통 artifact key도 Maven type을 구분합니다. 따라서 같은 GAV의 명시적 JAR와 POM은 의존성 포함 다운로드에서도 별개로 유지됩니다.

이를 통해 다운로더가 올바른 파일 확장자로 다운로드할 수 있습니다 (예: pom → POM만, war → WAR 파일).

### XML 파서 설정

버전 문자열이 숫자로 변환되는 것을 방지:

```typescript
this.parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,  // '4.0' → 4 변환 방지
});
```

### pom.xml 파싱
```typescript
const deps = await resolver.parseFromText(`
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-core</artifactId>
      <version>5.3.0</version>
    </dependency>
  </dependencies>
</project>
`);
```

### 텍스트 입력의 의존성 type 보존

`MavenResolver.parseFromText()`는 각 `<dependency>`의 `<type>` 값을 다운로드 메타데이터에 보존합니다. `CartPage`의 POM 파일/텍스트 입력도 같은 artifact type을 장바구니 metadata로 유지하며, Maven의 장바구니 중복 판정은 type까지 비교합니다. 따라서 같은 GAV의 기본 JAR과 `<type>pom</type>` 의존성이 함께 있어도 둘 다 유지됩니다. Electron 다운로드 라우터는 이 metadata를 `MavenDownloader`에 전달하므로 `org.apache.flink:flink-metrics:1.20.5`처럼 POM으로 선언된 의존성은 JAR 기본값으로 바뀌지 않고 `.pom` 및 해당 체크섬 파일로 다운로드되며, 평탄화된 복사본도 `.pom` 확장자를 사용합니다.

장바구니 파서는 기존 입력 호환성을 위해 `dependencyManagement`의 BOM을 포함한 모든 `<dependency>` 선언을 수집합니다.

이 동작은 `npx vitest run src/core/resolver/maven-resolver.test.ts src/core/shared/maven-pom-resolution.test.ts src/core/shared/dependency-tree-utils.test.ts src/renderer/stores/cart-store.test.ts src/renderer/pages/cart-page/maven-pom-parser.test.ts electron/services/download-package-router.test.ts`로 검증합니다.

---

## YumResolver

YUM/APT/APK의 후보 병합은 호출별 `Set`으로 기존 패키지 키의 재검색을 없앱니다. 이름 검색 결과의 순서·중복과 providers의 첫 항목 선택은 유지합니다. APK의 `so:`/`cmd:`도 동일 provides 조회 한 번으로 처리합니다. 공통 와일드카드 검색은 패키지마다 만들던 정규식을 검색당 한 번 생성하며, 빈 목록과 잘못된 패턴의 오류 처리는 유지합니다. 검증: `src/core/resolver/os-resolvers.test.ts`, `os-resolver-utils.test.ts`.

### 개요
- 목적: YUM/RPM 패키지 의존성 해결
- 위치: `src/core/resolver/yum-resolver.ts`
- 메타데이터 파서는 `src/core/shared/yum-metadata-parser.ts` shim을 통해 참조합니다.

### 클래스 구조

실제 클래스명은 `YumDependencyResolver`이며 `YumResolver`는 호환성 alias입니다. `BaseOSDependencyResolver`를 상속하고 생성자에서 `DependencyResolverOptions`를 받습니다.

메타데이터는 모든 활성 저장소의 조회·파싱이 성공한 뒤 메모리 목록과 이름/provides 인덱스에 반영합니다. primary 누락이나 저장소 오류가 있으면 저장소 이름과 원인을 포함한 오류를 전달하며, 취소 오류는 유지합니다. 실패 시 일부 패키지가 로드 완료 상태로 남지 않아 같은 인스턴스의 재시도가 가능합니다. 파서는 각 저장소를 읽을 때 생성하며 사용하지 않는 인스턴스 맵은 보관하지 않습니다. 비활성 저장소는 조회하지 않으며 정상적인 저장소별 디스크 캐시는 재시도에서 재사용할 수 있습니다.

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `searchPackages` | query, matchType? | Promise<OSPackageSearchResult[]> | 이름별 검색 |
| `resolveDependencies` (상속) | packages: OSPackageInfo[] | Promise<OS 전용 DependencyResolutionResult> | RPM 의존성 해결 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `loadMetadata` | 활성 저장소의 repomd.xml/primary 위치를 읽고 메타데이터 캐시 재사용 |
| `findPackagesForDependency` | 이름/provides/공유 라이브러리 패턴으로 후보 병합 |
| `addToPackageCache` / `addToProvidesCache` | 이름 및 capability 인덱스 구성 |
| `fetchDependenciesFromAPI` | 현재 null 반환; 메타데이터 경로 사용 |
| `fetchDependenciesFromMetadata` | 필수/권장 의존성을 읽음 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `allPackages` | OSPackageInfo[] | 호환 아키텍처의 패키지 목록 |
| `providesMap` | Map<string, OSPackageInfo[]> | capability 제공자 인덱스 |
| `metadataCache` (상속) | PackageMetadataCache | 이름별 패키지 목록 |
| `resolvedPackages` (상속) | Set<string> | 현재 해결 호출의 처리 상태 |

OS resolver는 `parseFromText()`나 공개 `clearCache()`를 제공하지 않습니다. 생성자의 캐시 관리자 또는 새 resolver 인스턴스로 메타데이터 생명주기를 관리합니다. 설치 순서·누락·충돌 결과는 [OS 패키지 문서](./os-package-downloader.md)의 계약을 따릅니다.

---

## AptResolver

실제 클래스는 `AptDependencyResolver`이며 `AptResolver` alias와 `getAptResolver(options)` 팩토리를 제공합니다. 검색 외에 상속한 `resolveDependencies(packages)`를 사용합니다.

### 개요
- 목적: APT/DEB 패키지 의존성 해결 (Ubuntu, Debian)
- 위치: `src/core/resolver/apt-resolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `loadMetadata` (protected) | - | Promise<void> | APT 저장소 메타데이터 로드 (Packages.gz, Release) |
| `searchPackages` | query, matchType? | Promise<OSPackageSearchResult[]> | 패키지 검색 |
| `findPackagesForDependency` (protected) | dependency | Promise<OSPackageInfo[]> | 의존성에 해당하는 패키지 찾기 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `extractComponents` | URL에서 component 추출 (main, universe 등) |
| `addToPackageCache` | 패키지 캐시에 추가 |
| `addToProvidesCache` | Provides 캐시에 추가 (가상 패키지) |
| `fetchDependenciesFromAPI` | API를 통한 의존성 조회 (미지원) |
| `fetchDependenciesFromMetadata` | 메타데이터에서 의존성 조회 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `parsers` | Map<string, AptMetadataParser> | 저장소별 메타데이터 파서 |
| `allPackages` | OSPackageInfo[] | 패키지 캐시 |
| `providesMap` | Map<string, OSPackageInfo[]> | Provides 매핑 (가상 패키지) |

### 특징

- **Debian Control 파일 형식**: `Package:`, `Version:`, `Depends:` 등 파싱
- **Provides 지원**: 가상 패키지 (예: `mail-transport-agent`)
- **Component 자동 추출**: URL에서 main, universe, multiverse 등 추출
- **Release 파서 제공**: 파서는 Release 필드를 읽을 수 있으나 resolver의 loadMetadata는 Packages 인덱스를 사용하며 서명 검증을 수행하지 않음
- **메타데이터 파서 경계**: resolver는 `src/core/shared/apt-metadata-parser.ts` shim을 통해 parser를 사용합니다.

---

## ApkResolver

실제 클래스는 `ApkDependencyResolver`이며 `ApkResolver` alias와 `getApkResolver(options)` 팩토리를 제공합니다. 검색 외에 상속한 `resolveDependencies(packages)`를 사용합니다.

`so:`, `cmd:`, `pc:` 의존성은 APKINDEX `p:` provides에서 후보를 얻습니다. 버전 조건은 일치하는 제공 항목의 버전과 비교하며 제공 APK의 패키지 버전은 대신 사용하지 않습니다. 버전 조건이 없으면 같은 이름의 제공 항목으로 충족할 수 있고, 버전 조건이 있으면 제공 버전이 필요합니다. 같은 패키지에 일치하는 제공 항목이 여러 개면 하나라도 조건을 만족할 때 선택합니다. 일반 패키지 의존성의 버전 비교는 기존 공통 구현을 사용합니다.

제공자 누락은 `not_found`, 제공 버전 불일치는 `version_mismatch`로 기록하며 경고·unresolved 결과에 포함합니다. CLI의 `--no-deps`는 이 전이 탐색을 우회합니다.

서로 다른 이름의 APK 제공자는 대체 관계이므로 기존 `selectBestMatch`로 선택한 패키지 이름의 후보만 남깁니다. 이 규칙은 `/bin/sh` 같은 경로 제공자에도 적용합니다. 선택한 패키지 자체에 조건을 만족하는 여러 버전이 있을 때는 기존 버전 충돌 정책을 유지합니다. 파싱 결과 캐시는 스키마 버전을 확인하여 이전의 capability 누락 결과를 재사용하지 않습니다.

### 개요
- 목적: APK 패키지 의존성 해결 (Alpine Linux)
- 위치: `src/core/resolver/apk-resolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `loadMetadata` (protected) | - | Promise<void> | APK 저장소 메타데이터 로드 (APKINDEX.tar.gz) |
| `searchPackages` | query, matchType? | Promise<OSPackageSearchResult[]> | 패키지 검색 |
| `findPackagesForDependency` (protected) | dependency | Promise<OSPackageInfo[]> | 의존성에 해당하는 패키지 찾기 |
| `filterByVersion` (protected) | packages, dependency | OSPackageInfo[] | capability 제공 버전 또는 일반 패키지 버전으로 조건 확인 |
| `selectCandidatesForDependency` (protected) | packages, dependency | OSPackageInfo[] | 버전·아키텍처 조건을 통과한 후보에서 하나의 제공 패키지 이름 선택 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `addToPackageCache` | 패키지 캐시에 추가 |
| `addToProvidesCache` | Provides 캐시에 추가 |
| `fetchDependenciesFromAPI` | API를 통한 의존성 조회 (미지원) |
| `fetchDependenciesFromMetadata` | 메타데이터에서 의존성 조회 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `parsers` | Map<string, ApkMetadataParser> | 저장소별 메타데이터 파서 |
| `allPackages` | OSPackageInfo[] | 패키지 캐시 |
| `providesMap` | Map<string, OSPackageInfo[]> | Provides 매핑 |

### APKINDEX 형식

```
P:nginx
V:1.24.0-r6
A:x86_64
D:pcre2 zlib
p:nginx=1.24.0-r6
```

필드 매핑:
- `P`: Package name
- `V`: Version
- resolver는 `src/core/shared/apk-metadata-parser.ts` shim을 통해 parser를 참조합니다.
- `A`: Architecture
- `D`: Dependencies
- `S`: Size
- `p`: Provides
- `C`: Checksum

---

## NpmResolver

### 개요
- 목적: npm 패키지 의존성 해결 (node_modules 트리 구축)
- 위치: `src/core/resolver/npm-resolver.ts`
- 캐시: `src/core/shared/npm-cache.ts` 모듈 사용 (메모리 캐싱)

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version: string, options?: NpmResolverOptions | Promise<NpmResolutionResult> | 메인 진입점: 패키지 의존성 트리 해결 |
| `parseFromPackageJson` | content: string | Promise<Array<{ name: string; version: string }>> | package.json 파싱 |
| `getVersions` | packageName: string | Promise<string[]> | 패키지 버전 목록 조회 |
| `getPackageInfo` | name: string, version: string | Promise<NpmPackageVersion \| null> | 특정 버전 패키지 정보 조회 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `buildDeps` | 의존성 목록에서 큐 아이템 생성 |
| `processDepItem` | 단일 의존성 아이템 처리 |
| `NpmTreeManager.findPlacement` | node_modules 배치 위치 결정 (호이스팅) |
| `NpmTreeManager.addNodeToTree` | 트리에 노드 추가 |
| `enqueueDependencies` | 하위 의존성 큐에 추가 |
| `NpmVersionResolver.fetchPackument` | registry에서 packument 조회 |
| `NpmVersionResolver.resolveVersion` | semver 범위를 실제 버전으로 해결 |
| `NpmTreeManager.flattenTree` | 트리를 플랫 리스트로 변환 |
| `NpmTreeManager`의 배치 판단 | 기존 노드와 요청 범위를 비교하여 호이스팅/중첩 결정 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'npm' |
| `versionResolver` | NpmVersionResolver | 저장소 조회/해결된 버전 캐시 |
| `treeManager` | NpmTreeManager | root·배치 상태·충돌 목록 |
| `targetOS` / `targetArchitecture` | string 또는 null | 플랫폼 필터 조건 |
| `depsQueue` | DepsQueueItem[] | 처리 대기 큐 |
| `depsSeen` | Set<string> | 처리된 의존성 추적 |

### NpmResolverOptions

```typescript
interface NpmResolverOptions {
  maxDepth?: number;             // 기본 50
  includeDev?: boolean;          // 기본 false
  includeOptional?: boolean;     // 기본 false
  installPeers?: boolean;        // 기본 true
  preferDedupe?: boolean;         // 기본 false
  legacyPeerDeps?: boolean;      // 기본 false
  strictPeerDeps?: boolean;
  installStrategy?: 'hoisted' | 'nested' | 'shallow'; // 기본 hoisted
  nodeVersion?: string;
  lockfile?: NpmLockfile;
  targetOS?: 'windows' | 'macos' | 'linux';
  targetArchitecture?: 'x86_64' | 'amd64' | 'arm64' | 'aarch64';
}
```

`strictPeerDeps`, `nodeVersion`, `lockfile`는 타입에 선언되어 있지만 현재 resolver에서 읽지 않습니다. `legacyPeerDeps`는 build 옵션에 전달되지만 전용 처리 분기가 없고, `shallow`도 별도 깊이 제한 구현이 없습니다. 타입이 옵션을 허용한다는 사실과 실제 처리 범위를 구분해야 합니다.

### NpmResolutionResult

```typescript
interface NpmResolutionResult {
  root: NpmResolvedNode;
  flatList: NpmFlatPackage[];
  conflicts: NpmConflict[];
  totalSize: number;
  totalPackages: number;
  maxDepth: number; // 배치 경로로 계산한 실제 깊이
}
```

`root`는 직접 요청한 패키지이며 `flatList`에는 전이 패키지만 들어갑니다. `totalSize`와 `totalPackages`도 이 전이 목록을 기준으로 계산합니다. 공통 다운로드 목록에서는 [shared 해결기](./shared-dependency.md)가 해결된 직접 루트를 별도로 포함합니다.

### 의존성 호이스팅

npm의 node_modules 호이스팅 알고리즘 구현:

```
project/
└── node_modules/
    ├── A@1.0.0              # 호이스팅됨
    ├── B@2.0.0              # 호이스팅됨
    └── C@1.0.0/
        └── node_modules/
            └── A@2.0.0      # 충돌로 중첩됨
```

- **호이스팅 시도**: 최상위 node_modules에 배치 시도
- **충돌 감지**: 동일 이름의 다른 버전 존재 시 중첩 배치
- **버전 호환성**: 기존 버전이 요청 범위를 만족하면 재사용

### 사용 예시

```typescript
import { getNpmResolver } from './core/resolver/npm-resolver';

const resolver = getNpmResolver();

// 패키지 의존성 해결
const result = await resolver.resolveDependencies('express', '4.18.2', {
  maxDepth: 5,
  includeDev: false,
});

console.log(result.flatList.length); // 플랫 패키지 수
console.log(result.conflicts);        // 충돌 목록
console.log(result.root);             // node_modules 트리 구조
```

### package.json 파싱

```typescript
const deps = await resolver.parseFromPackageJson(`{
  "name": "my-app",
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "~4.17.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}`);
// 결과: [{ name: 'express', version: '<해결된 버전>' }, ...]
// dependencies/devDependencies/peerDependencies/optionalDependencies를 병합해
// 실제 버전을 조회한다. 원래 범위나 dependency type은 반환하지 않는다.
```

### 특징

- **호이스팅 알고리즘**: Arborist 아이디어에 기반한 node_modules 배치 구현
- **semver 지원**: semver 라이브러리로 ^, ~, >=, < 등 버전 범위 처리
- **충돌 감지**: 동일 패키지의 다른 버전 요청 추적
- **Packument 캐싱**: 중복 요청 방지
- **peerDependencies**: 선택적으로 처리 가능

---

## 공통 인터페이스

pip·Conda·Maven은 `src/types/interfaces.ts`의 `IResolver`를 구현합니다. npm은 전용 결과 타입, OS는 `OSPackageInfo[]` 입력과 별도 해결 결과를 사용합니다.

```typescript
interface IResolver {
  readonly type: PackageType;
  resolveDependencies(
    packageName: string, version: string, options?: ResolverOptions
  ): Promise<DependencyResolutionResult>;
  parseFromText?(content: string): Promise<PackageInfo[]>;
}
```

### ResolverOptions

```typescript
interface ResolverOptions {
  includeDevDependencies?: boolean;
  includeOptionalDependencies?: boolean;
  maxDepth?: number;
  skipDependencyExpansion?: boolean;
  architecture?: Architecture;
  targetPlatform?: {
    system?: 'Linux' | 'Windows' | 'Darwin';
    machine?: 'x86_64' | 'aarch64' | 'arm64';
  };
  pythonVersion?: string;
}
```

구현별 확장 옵션은 별도입니다. pip은 `indexUrl`/`extras`, Conda는 `channel`을 받으며 내부에서 `cudaVersion`도 읽습니다. Maven은 `MavenResolverOptions`, npm은 위 `NpmResolverOptions`를 사용합니다. 직접 호출 기준 최대 깊이는 pip/Conda 10, Maven 20, npm 50이며 상위 호출자가 값을 덮어쓸 수 있습니다.

### DependencyResolutionResult

```typescript
interface DependencyResolutionResult {
  root: DependencyNode;
  flatList: PackageInfo[];
  conflicts: DependencyConflict[];
  totalSize?: number;
}
```

### DependencyNode

```typescript
interface DependencyNode {
  package: PackageInfo;
  dependencies: DependencyNode[];
  optional?: boolean;
  scope?: DependencyScope;
}
```

### DependencyConflict

```typescript
interface DependencyConflict {
  type: 'version' | 'circular' | 'missing';
  packageName: string;
  versions: string[];
  resolvedVersion?: string;
}
```

---

## 의존성 해결 알고리즘

### BFS 기반

현재 의존성 확장은 BFS(너비 우선 탐색) 큐를 사용합니다. 순회 상태는 구현마다 다르므로 아래 항목은 공통 개념이며 모든 클래스가 동일한 필드나 보장 범위를 갖는다는 의미는 아닙니다.

1. **BFS 탐색**: 큐 기반 너비 우선 탐색으로 의존성 트리 구축
2. **방문 캐싱**: 동일 패키지 중복 처리 방지 (resolvedNodes Map)
3. **순환 의존성 방지**: processing Set으로 현재 처리 중인 패키지 추적
4. **부모-자식 관계 추적**: parentChildMap으로 트리 구조 구축
5. **충돌 감지**: 동일 패키지의 다른 버전 요청 시 기록
6. **버전 해결**: 제약조건에 맞는 최적 버전 선택
7. **환경 마커 평가**: 플랫폼별 조건부 의존성 필터링 (pip)
8. **가상 패키지 제외**: Conda 외부 Python 런타임과 `__` 가상 패키지만 제외

```
패키지 A
├── B >= 1.0
│   └── D >= 2.0
├── C >= 1.5
│   └── D >= 1.8  ← D >= 2.0으로 함께 만족할 수도 있음
└── E (optional)
```

버전 조건이 서로 다르다는 이유만으로 항상 충돌은 아닙니다. 각 resolver가 선택한 버전·배치·후보를 기준으로 conflict를 기록하며, 서로 다른 버전을 함께 다운로드하는 것과 하나의 환경에 동시에 설치 가능한 것은 구분됩니다.

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [Shared Utilities 문서](./shared-utilities.md)
- [테스트 구조](./testing.md)
- [pip 의존성 해결 알고리즘](./pip-dependency-resolution.md)
- [conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
