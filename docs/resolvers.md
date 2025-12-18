# Resolvers

## 개요
- 목적: 패키지 의존성 트리 해결 및 충돌 감지
- 위치: `src/core/resolver/`

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
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | 메인 진입점: 패키지 의존성 트리 해결 (BFS 큐 기반) |
| `parseFromText` | text: string | ParsedDependency[] | requirements.txt 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 트리를 플랫 리스트로 변환 |

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
1. 루트 패키지를 큐에 추가
2. 큐에서 패키지를 꺼내어 정보 조회
3. 이미 해결된 패키지면 부모-자식 관계만 추가하고 스킵
4. 노드 생성 및 저장
5. 하위 의존성을 큐에 추가
6. 큐가 빌 때까지 반복
7. 부모-자식 관계 맵을 이용해 트리 구축
```

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'pip' |
| `baseUrl` | string | PyPI API URL |
| `visited` | Map<string, DependencyNode> | 방문한 패키지 캐시 |
| `conflicts` | DependencyConflict[] | 감지된 충돌 목록 |
| `pythonVersion` | string | 타겟 Python 버전 (예: '3.11') |
| `targetPlatform` | TargetPlatform | 타겟 플랫폼 정보 |
| `cacheOptions` | PipCacheOptions | 공유 캐시 옵션 (메타데이터 캐시는 공유 모듈 사용) |

### 메서드 (캐시 관련)

| 메서드 | 설명 |
|--------|------|
| `setCacheOptions` | 캐시 옵션 설정 |
| `clearCache` | 캐시 초기화 (공유 캐시 초기화) |

### TargetPlatform

```typescript
interface TargetPlatform {
  os: string;           // 'linux', 'macos', 'windows'
  architecture: string; // 'x86_64', 'arm64'
  pythonVersion: string; // '3.11', '3.12'
}
```

### 환경 마커 평가

PEP 508 환경 마커를 평가하여 플랫폼별 의존성 필터링:

```typescript
// 지원되는 마커 변수
- python_version       // Python 버전 (예: '3.11')
- python_full_version  // 전체 Python 버전
- sys_platform        // 플랫폼 (예: 'linux', 'darwin', 'win32')
- platform_system     // OS 이름 (예: 'Linux', 'Darwin', 'Windows')
- platform_machine    // 아키텍처 (예: 'x86_64', 'arm64')
- os_name            // OS 종류 (예: 'posix', 'nt')
- implementation_name // 구현체 (예: 'cpython')
```

### 사용 예시
```typescript
import { getPipResolver } from './core/resolver/pip-resolver';

const resolver = getPipResolver();

// 특정 플랫폼용 의존성 해결
const result = await resolver.resolveDependencies('flask', '2.0.0', {
  pythonVersion: '3.11',
  targetOS: 'linux',
  architecture: 'x86_64',
});

console.log(result.tree);       // 의존성 트리
console.log(result.conflicts);  // 충돌 목록
console.log(result.packages);   // 플랫 패키지 목록
```

### requirements.txt 파싱
```typescript
const deps = resolver.parseFromText(`
flask>=2.0.0
requests==2.31.0
numpy>=1.20,<2.0
pywin32>=300; sys_platform == 'win32'
`);
// [
//   { name: 'flask', versionConstraint: '>=2.0.0' },
//   { name: 'requests', versionConstraint: '==2.31.0' },
//   { name: 'numpy', versionConstraint: '>=1.20,<2.0' },
//   { name: 'pywin32', versionConstraint: '>=300', marker: "sys_platform == 'win32'" },
// ]
```

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

#### DepsSmuggler 구현

PyPI JSON API를 사용하여 메타데이터 조회:

```typescript
// pip-cache.ts
const url = `https://pypi.org/pypi/${packageName}/${version}/json`;
const response = await axios.get(url);
const requiresDist = response.data.info.requires_dist;  // 의존성 목록
```

### GPU/CPU 패키지 처리

#### PEP 440 로컬 버전 식별자

PyTorch 등 GPU 패키지는 **로컬 버전(+cu118)**으로 구분되며, 의존성 매칭에서 **무시**됩니다:

```python
# PEP 440 규칙: 로컬 버전은 의존성 매칭에서 무시됨
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
| **의존성 전파** | 있음 (`__cuda` 마커) | 없음 (로컬 버전 무시) |

#### CUDA 필터링이 불필요한 이유

1. GPU/CPU가 **이미 분리된 상태**로 배포됨
2. 메타데이터에 GPU/CPU 조건 분기가 없음
3. `torch+cu118`을 명시적으로 의존하는 라이브러리 없음 (PEP 440 규칙)
4. **사용자가 직접 선택**해야 함 (index-url 또는 패키지명)

따라서 DepsSmuggler에서 pip 패키지의 CUDA 필터링은 **불필요**합니다.

---

## CondaResolver

### 개요
- 목적: Conda/Anaconda 패키지 의존성 해결
- 위치: `src/core/resolver/conda-resolver.ts`
- RepoData 처리: `src/core/resolver/conda-repodata-processor.ts` (분리된 모듈)
- 캐시: `src/core/shared/conda-cache.ts` 모듈 사용 (디스크 캐싱 전용 - 350MB+ repodata)

### 모듈 구조

```
conda-resolver.ts (501줄)
├── CondaResolver 클래스
│   ├── resolveDependencies() - 메인 진입점
│   ├── resolvePackage() - 단일 패키지 해결
│   ├── resolvePackageFallback() - Anaconda API 폴백
│   ├── parseDependencyString() - 의존성 문자열 파싱
│   ├── isSystemPackage() - 시스템 패키지 확인
│   ├── getLatestVersion() - API 폴백 버전 조회
│   ├── flattenDependencies() - 플랫 리스트 변환
│   ├── clearCache() - 캐시 초기화 (프로세서 위임)
│   └── parseFromText() - environment.yml 파싱
└── getCondaResolver() - 싱글톤 팩토리

conda-repodata-processor.ts (301줄)
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
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | Conda 패키지 의존성 해결 |
| `resolvePackage` | name: string, version: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | 단일 패키지 해결 |
| `parseFromText` | text: string | ParsedDependency[] | environment.yml 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 플랫 리스트 변환 |
| `clearCache` | - | void | repodata 캐시 초기화 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `getRepoData` | repodata.json 가져오기 (zstd 압축 지원, 캐싱) |
| `findPackageCandidates` | repodata에서 패키지 후보 검색 |
| `parseDependencyString` | Conda 의존성 문자열 파싱 |
| `getLatestVersion` | 채널별 최신 버전 조회 |
| `getLatestVersionFromRepoData` | repodata에서 최신 버전 조회 |
| `isSystemPackage` | 시스템 패키지 여부 확인 (libc 등 제외) |
| `getPythonBuildTag` | Python 버전에서 build 태그 추출 (예: '3.12' -> 'py312') |
| `isBuildCompatibleWithPython` | build 문자열이 Python 버전과 호환되는지 확인 |
| `resolvePackageFallback` | Anaconda API fallback 해결 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'conda' |
| `apiUrl` | string | Anaconda API URL |
| `condaUrl` | string | Conda 패키지 저장소 URL |
| `defaultChannel` | string | 기본 채널 (conda-forge) |
| `visited` | Map | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `repodataCache` | Map<string, RepoData> | repodata 메모리 캐시 |
| `packageIndex` | Map<string, Map<string, Array>> | 패키지 이름별 인덱스 캐시 (O(1) 조회용) |
| `targetSubdir` | string | 타겟 subdir (예: 'linux-64') |
| `pythonVersion` | string | 타겟 Python 버전 |

### 특징

- **repodata.json.zst 지원**: zstd 압축 파일 우선 사용 (대역폭 절약)
- **캐싱**: repodata 캐싱으로 중복 요청 방지
- **Python 버전 필터링**: py312, py311 등 build 태그로 Python 버전에 맞는 패키지 선택
- **noarch 지원**: 아키텍처 독립 패키지 자동 탐색
- **시스템 패키지 제외**: libc, libgcc 등 시스템 패키지 자동 제외
- **Anaconda API fallback**: RC 버전 등 특수 라벨 패키지 지원

### 성능 최적화

#### 패키지 인덱스 캐시

repodata 로드 시 패키지 이름별 인덱스를 생성하여 O(n) 전체 순회를 O(1) 해시맵 조회로 최적화합니다.

```typescript
// 인덱스 구조: Map<cacheKey, Map<packageName, Array<{filename, pkg}>>>
private packageIndex: Map<string, Map<string, Array<{ filename: string; pkg: RepoDataPackage }>>> = new Map();

// repodata 로드 시 인덱스 생성
private buildPackageIndex(cacheKey: string, repodata: RepoData): Map<...> {
  const index = new Map();
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

의존성 해결 시간과 진행 상황을 상세히 로그로 출력합니다:

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
  targetOS: 'linux',
  architecture: 'x86_64',
});

console.log(result.tree);       // 의존성 트리
console.log(result.conflicts);  // 충돌 목록
console.log(result.packages);   // 플랫 패키지 목록
```

### environment.yml 파싱
```typescript
const deps = resolver.parseFromText(`
name: myenv
channels:
  - conda-forge
dependencies:
  - numpy>=1.20
  - pandas=1.3.0
  - pip:
    - requests
`);
// [
//   { name: 'numpy', versionConstraint: '>=1.20', type: 'conda' },
//   { name: 'pandas', versionConstraint: '=1.3.0', type: 'conda' },
//   { name: 'requests', type: 'pip' },  // pip 의존성으로 마킹
// ]
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
maven-resolver.ts (589줄)
├── MavenResolver 클래스
│   ├── resolveDependencies() - 메인 진입점
│   ├── resolveBF() - BFS 기반 의존성 해결 (큐 프로세서 사용)
│   ├── fetchPomWithCache() - POM 가져오기 (캐싱)
│   ├── prefetchPomsParallel() - POM 병렬 프리페치
│   ├── fetchPackageSizes() - 패키지 크기 조회
│   ├── shouldIncludeDependency() - 의존성 포함 여부
│   ├── createDependencyNode() - 노드 생성
│   ├── recordConflict() - 충돌 기록
│   ├── parseFromText() - pom.xml 파싱
│   └── flattenDependencies() - 플랫 리스트 변환
└── getMavenResolver() - 싱글톤 팩토리

maven-queue-processor.ts (302줄)
├── MavenResolutionContext 인터페이스
├── QueueProcessorDependencies 인터페이스
└── MavenQueueProcessor 클래스
    ├── processQueue() - 큐 처리 메인 루프
    ├── processQueueItem() - 단일 아이템 처리
    ├── enqueueRootDependencies() - 루트 의존성 큐 추가
    ├── enqueueChildDependencies() - 자식 의존성 큐 추가
    └── addChildToParent() - 부모에 자식 노드 추가
```

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | GAV 좌표 기반 의존성 해결 |
| `resolvePackage` | artifact: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | POM 기반 의존성 재귀 해결 |
| `parseFromText` | text: string | ParsedDependency[] | pom.xml 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 트리를 플랫 리스트로 변환 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `fetchPom` | Maven Central에서 POM 파일 가져오기 |
| `processDependencyManagement` | BOM (Bill of Materials) 처리 |
| `extractDependencies` | POM에서 의존성 목록 추출 (BOM/Parent POM 지원) |
| `resolveProperty` | ${property} 치환 (비문자열 값 자동 변환) |
| `normalizeDependencies` | 의존성 배열 정규화 |
| `getLatestVersion` | 최신 버전 조회 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'maven' |
| `repoUrl` | string | Maven Central URL |
| `parser` | XMLParser | XML 파서 인스턴스 |
| `visited` | Map<string, DependencyNode> | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `dependencyManagement` | Map<string, string> | BOM 버전 관리 |
| `cacheOptions` | MavenCacheOptions | 공유 캐시 옵션 (POM 캐시는 공유 모듈 사용) |

### BOM/Parent POM 지원

`dependencies` 섹션이 없는 Parent POM이나 BOM(Bill of Materials) 타입의 POM을 처리할 수 있습니다:

1. **dependencies가 없는 루트 패키지**: `dependencyManagement`에서 의존성 목록 추출
2. **import scope BOM 제외**: BOM import 자체는 의존성에서 제외
3. **상속된 dependencyManagement**: parent로부터 상속받은 버전 관리 정보 활용

```typescript
// Parent POM 예시 (dependencies 없음)
const result = await resolver.resolveDependencies(
  'org.springframework.boot:spring-boot-dependencies',
  '3.2.0'
);
// → dependencyManagement의 모든 의존성이 해결됨
```

### Packaging 타입 처리

POM의 `<packaging>` 태그를 읽어 각 의존성의 타입을 설정합니다:

```typescript
// POM에서 packaging 타입 추출 후 metadata에 저장
if (pom.packaging) {
  node.package.metadata = {
    ...node.package.metadata,
    type: pom.packaging,  // 'jar', 'pom', 'war', 'maven-plugin' 등
  };
}
```

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
const deps = resolver.parseFromText(`
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

---

## YumResolver

### 개요
- 목적: YUM/RPM 패키지 의존성 해결
- 위치: `src/core/resolver/yumResolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveDependencies` | name: string, version?: string, options?: ResolverOptions | Promise<DependencyResolutionResult> | RPM 패키지 의존성 해결 |
| `resolvePackage` | name: string, version: string, depth: number, parentPath: string[] | Promise<DependencyNode \| null> | 단일 패키지 해결 |
| `parseFromText` | text: string | ParsedDependency[] | 패키지 목록 파싱 |
| `flattenDependencies` | node: DependencyNode | PackageInfo[] | 플랫 리스트 변환 |
| `clearCache` | - | void | 메타데이터 캐시 초기화 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `loadMetadata` | YUM 저장소 메타데이터 로드 (repomd.xml, primary.xml) |
| `findPackage` | 이름으로 패키지 검색 |
| `findProvider` | Capability 제공자 검색 (예: libssl.so) |
| `isSystemDependency` | 시스템 의존성 여부 확인 |
| `formatVersion` | EVR (Epoch:Version-Release) 포맷 |
| `normalizeEntries` | requires/provides 엔트리 정규화 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'yum' |
| `parser` | XMLParser | XML 파서 |
| `visited` | Map | 방문 캐시 |
| `conflicts` | DependencyConflict[] | 충돌 목록 |
| `packagesByName` | Map<string, PrimaryPackage[]> | 패키지 인덱스 |
| `providerCache` | Map<string, PrimaryPackage \| null> | Capability 캐시 |
| `metadataLoaded` | boolean | 메타데이터 로드 상태 |
| `currentRepoUrl` | string | 현재 저장소 URL |

---

## AptResolver

### 개요
- 목적: APT/DEB 패키지 의존성 해결 (Ubuntu, Debian)
- 위치: `src/core/resolver/apt-resolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `loadMetadata` | repos, architecture | Promise<void> | APT 저장소 메타데이터 로드 (Packages.gz, Release) |
| `searchPackages` | query | OSPackageInfo[] | 패키지 검색 |
| `findPackagesForDependency` | dependency, arch | Promise<OSPackageInfo[]> | 의존성에 해당하는 패키지 찾기 |

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
| `allPackages` | Map<string, OSPackageInfo[]> | 패키지 캐시 |
| `providesMap` | Map<string, OSPackageInfo[]> | Provides 매핑 (가상 패키지) |

### 특징

- **Debian Control 파일 형식**: `Package:`, `Version:`, `Depends:` 등 파싱
- **Provides 지원**: 가상 패키지 (예: `mail-transport-agent`)
- **Component 자동 추출**: URL에서 main, universe, multiverse 등 추출
- **Release 파일 파싱**: 저장소 메타데이터 검증

---

## ApkResolver

### 개요
- 목적: APK 패키지 의존성 해결 (Alpine Linux)
- 위치: `src/core/resolver/apk-resolver.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `loadMetadata` | repos, architecture | Promise<void> | APK 저장소 메타데이터 로드 (APKINDEX.tar.gz) |
| `searchPackages` | query | OSPackageInfo[] | 패키지 검색 |
| `findPackagesForDependency` | dependency, arch | Promise<OSPackageInfo[]> | 의존성에 해당하는 패키지 찾기 |

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
| `allPackages` | Map<string, OSPackageInfo[]> | 패키지 캐시 |
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
| `resolveDependencies` | name: string, version?: string, options?: NpmResolverOptions | Promise<NpmResolutionResult> | 메인 진입점: 패키지 의존성 트리 해결 |
| `parseFromPackageJson` | packageJsonContent: string | ParsedDependency[] | package.json 파싱 |
| `getVersions` | packageName: string | Promise<string[]> | 패키지 버전 목록 조회 |
| `getPackageInfo` | name: string, version: string | Promise<NpmPackageVersion> | 특정 버전 패키지 정보 조회 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `buildDeps` | 의존성 목록에서 큐 아이템 생성 |
| `processDepItem` | 단일 의존성 아이템 처리 |
| `findPlacement` | node_modules 배치 위치 결정 (호이스팅) |
| `addNodeToTree` | 트리에 노드 추가 |
| `enqueueDependencies` | 하위 의존성 큐에 추가 |
| `fetchPackument` | registry에서 packument 조회 |
| `resolveVersion` | semver 범위를 실제 버전으로 해결 |
| `flattenTree` | 트리를 플랫 리스트로 변환 |
| `isVersionCompatibleWithExisting` | 기존 버전과 호환성 검사 |

### 속성

| 속성 | 타입 | 설명 |
|------|------|------|
| `type` | PackageType | 'npm' |
| `registryUrl` | string | npm Registry URL |
| `resolvedCache` | Map<string, string> | 해결된 버전 캐시 (packument 캐시는 공유 모듈 사용) |
| `tree` | NpmNode | 의존성 트리 루트 |
| `conflicts` | NpmConflict[] | 감지된 충돌 목록 |
| `depsQueue` | DepsQueueItem[] | 처리 대기 큐 |
| `depsSeen` | Set<string> | 처리된 의존성 추적 |

### NpmResolverOptions

```typescript
interface NpmResolverOptions {
  maxDepth?: number;             // 최대 탐색 깊이 (기본: 10)
  includeDevDependencies?: boolean;  // devDependencies 포함
  includePeerDependencies?: boolean; // peerDependencies 포함
  includeOptionalDependencies?: boolean; // optionalDependencies 포함
}
```

### NpmResolutionResult

```typescript
interface NpmResolutionResult {
  packages: NpmFlatPackage[];  // 플랫 패키지 목록
  conflicts: NpmConflict[];    // 충돌 목록
  tree: NpmNode;               // 의존성 트리 (node_modules 구조)
}
```

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
  includeDevDependencies: false,
});

console.log(result.packages.length); // 플랫 패키지 수
console.log(result.conflicts);        // 충돌 목록
console.log(result.tree);             // node_modules 트리 구조
```

### package.json 파싱

```typescript
const deps = resolver.parseFromPackageJson(`{
  "name": "my-app",
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "~4.17.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}`);
// [
//   { name: 'express', versionConstraint: '^4.18.0', type: 'dependency' },
//   { name: 'lodash', versionConstraint: '~4.17.0', type: 'dependency' },
//   { name: 'typescript', versionConstraint: '^5.0.0', type: 'devDependency' }
// ]
```

### 특징

- **호이스팅 알고리즘**: npm의 node_modules 구조 재현
- **semver 지원**: ^, ~, >=, < 등 모든 범위 문법 지원
- **충돌 감지**: 동일 패키지의 다른 버전 요청 추적
- **Packument 캐싱**: 중복 요청 방지
- **peerDependencies**: 선택적으로 처리 가능

---

## 공통 인터페이스

모든 Resolver는 `IResolver` 인터페이스를 구현:

```typescript
interface IResolver {
  type: PackageType;
  resolveDependencies(name: string, version?: string, options?: ResolverOptions): Promise<DependencyResolutionResult>;
  parseFromText(text: string): { name: string; version?: string }[];
}
```

### ResolverOptions

```typescript
interface ResolverOptions {
  maxDepth?: number;        // 최대 탐색 깊이 (기본: 10)
  channel?: string;         // Conda 채널
  pythonVersion?: string;   // Python 버전 (예: '3.11')
  targetOS?: string;        // 타겟 OS (예: 'linux')
  architecture?: string;    // 타겟 아키텍처 (예: 'x86_64')
}
```

### DependencyResolutionResult

```typescript
interface DependencyResolutionResult {
  tree: DependencyNode;
  packages: PackageInfo[];
  conflicts: DependencyConflict[];
}
```

### DependencyNode

```typescript
interface DependencyNode {
  name: string;
  version: string;
  type: PackageType;
  dependencies: DependencyNode[];
  optional?: boolean;
  scope?: DependencyScope;
}
```

### DependencyConflict

```typescript
interface DependencyConflict {
  packageName: string;
  type: ConflictType;
  versions: string[];
  requestedBy: string[];
}
```

---

## 의존성 해결 알고리즘

1. **DFS 탐색**: 깊이 우선 탐색으로 의존성 트리 구축
2. **방문 캐싱**: 동일 패키지 중복 처리 방지
3. **충돌 감지**: 동일 패키지의 다른 버전 요청 시 기록
4. **버전 해결**: 제약조건에 맞는 최적 버전 선택
5. **환경 마커 평가**: 플랫폼별 조건부 의존성 필터링 (pip)
6. **시스템 패키지 제외**: libc 등 시스템 패키지 자동 제외 (conda)

```
패키지 A
├── B >= 1.0
│   └── D >= 2.0
├── C >= 1.5
│   └── D >= 1.8  ← 충돌: D의 다른 버전 요청
└── E (optional)
```

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
