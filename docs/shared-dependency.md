# 의존성 해결 유틸리티

## 개요
- 목적: 공통 의존성 해결 로직 및 버전 비교 유틸리티
- 위치: `src/core/shared/dependency-resolver.ts`, `dependency-tree-utils.ts`, `version-utils.ts`

---

## 모듈 구조

```
src/core/shared/
├── dependency-resolver.ts     # 의존성 해결 유틸리티
├── dependency-tree-utils.ts   # 의존성 트리 유틸리티
└── version-utils.ts           # 버전 비교/호환성 유틸리티
```

---

## 버전 유틸리티 (`version-utils.ts`)

버전 비교 및 호환성 체크 유틸리티 (pip/conda/maven 공용)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `compareVersions` | a: string, b: string | number | 숫자 부분 위주의 일반 비교 (a > b면 양수) |
| `comparePep440Versions` | a: string, b: string | number | epoch·pre/post/dev·local을 포함한 후보 순서 비교 |
| `isPrereleaseVersion` | version: string | boolean | prerelease/development release 판별 |
| `isVersionCompatible` | version: string, spec: string | boolean | 버전 스펙 호환성 체크 |
| `sortVersionsDescending` | versions: string[] | string[] | 버전 내림차순 정렬 |
| `sortVersionsAscending` | versions: string[] | string[] | 버전 오름차순 정렬 |
| `findLatestCompatibleVersion` | versions: string[], spec: string | string \| null | 호환되는 최신 버전 찾기 |

### 지원 버전 스펙

- `>=`, `<=`, `>`, `<` - 비교 연산자
- `==` - 정확히 일치 (와일드카드 `*` 지원)
- `!=` - 불일치 (와일드카드 지원)
- `===` - ASCII 대소문자를 무시한 문자열 동등 비교
- `~=` - 호환 릴리스 (예: `~=2.1`은 `>=2.1, ==2.*`)
- `,` - AND 연산
- `|` - OR 연산

`isVersionCompatible()`는 쉼표로 나눈 각 조건 안에서 `|` OR를 평가합니다. `==`는 정규화된 release/epoch/suffix를 비교하며, 스펙에 local label이 없으면 후보의 local label을 무시합니다. 연산자 없는 일반 버전 문자열은 정확 버전 조건으로 처리하지 않으므로 `==1.2.3`처럼 전달해야 합니다.

`compareVersions()`와 이를 사용하는 정렬/최신 버전 함수는 문자 suffix를 제거하는 단순 비교입니다. pip 후보의 PEP 440 순서에는 `comparePep440Versions()`를 사용합니다. Conda/Maven/npm의 전용 버전 해결 규칙과 동일한 함수로 취급하지 않습니다.

### 사용 예시

```typescript
import { isVersionCompatible, findLatestCompatibleVersion } from './version-utils';

// 버전 호환성 체크
isVersionCompatible('2.5.0', '>=2.0,<3.0'); // true
isVersionCompatible('1.9.0', '>=2.0,<3.0'); // false

// 호환되는 최신 버전 찾기
const versions = ['1.0.0', '2.0.0', '2.5.0', '3.0.0'];
findLatestCompatibleVersion(versions, '>=2.0,<3.0'); // '2.5.0'
```

---

## 의존성 해결 (`dependency-resolver.ts`)

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `resolveAllDependencies` | packages: DownloadPackage[], options?: DependencyResolverOptions | Promise<ResolvedPackageList> | 모든 패키지의 의존성 해결 |
| `resolveSinglePackageDependencies` | pkg: DownloadPackage, options?: DependencyResolverOptions | Promise<ResolvedPackageList> | 단일 패키지 의존성 해결 |

### 지원 패키지 타입

| 타입 | 리졸버 | 비고 |
|------|--------|------|
| `pip` | PipResolver | PyPI 의존성 |
| `conda` | CondaResolver | Conda 의존성 |
| `maven` | MavenResolver | Maven 의존성 |
| `npm` | NpmResolver | npm 의존성 |
| `yum` | YumResolver | RPM 의존성 (통합 처리) |
| `apt` | AptResolver | DEB 의존성 (통합 처리) |
| `apk` | ApkResolver | APK 의존성 (통합 처리) |
| `docker` | - | 원본만 포함 (의존성 없음) |

> **참고**: OS 패키지(yum, apt, apk)는 `metadata.osPackageInfo`와 해당 배포판 설정이 필요합니다. 메타데이터가 없으면 원본만 포함하고, 메타데이터가 있는데 설정이 없거나 배포판 ID가 유효하지 않으면 해당 루트의 실패로 기록합니다.

### ResolvedPackageList

```typescript
interface ResolvedPackageList {
  originalPackages: DownloadPackage[];  // 원본 패키지 목록
  allPackages: DownloadPackage[];       // 의존성 포함 전체 목록
  dependencyTrees: DependencyResolutionResult[];  // 의존성 트리
  failedPackages: { name: string; version: string; error: string }[];  // 실패 목록
  successfulPackages?: DownloadPackage[];  // 성공한 직접 루트가 소유한 전체 패키지
}
```

`successfulPackages`는 직접 루트별 해결 성공 시점의 결과를 합친 목록입니다. CLI의 기본 best-effort 모드는 후속 직접 루트가 실패해도 이 목록의 패키지와 의존성만 다운로드합니다. `--strict` 모드는 하나라도 실패하면 다운로드를 중단합니다.

npm 전용 리졸버는 직접 루트를 `root`에, 전이 패키지만 `flatList`에 반환합니다. 공통 해결기는 둘을 합쳐 `allPackages`와 `successfulPackages`를 구성합니다. `latest`·dist-tag·버전 범위를 실제 버전으로 바꿀 때도 직접 루트를 유지하고, 요청 ID·아키텍처·추가 옵션과 메타데이터를 보존합니다. 해결된 루트의 다운로드 URL·파일명·크기·체크섬은 제공된 원격 정보로 보완합니다. 트리의 npm `flatList`와 의존성 개수는 계속 전이 패키지만 나타냅니다.

### DependencyResolverOptions

```typescript
interface DependencyResolverOptions {
  /** 의존성 포함 여부 (기본값: true) */
  includeDependencies?: boolean;
  /** 최대 의존성 탐색 깊이 (기본값: 5) */
  maxDepth?: number;
  /** 루트 아티팩트만 검증하고 자식 의존성 탐색은 생략 */
  resolveRootArtifactsOnly?: boolean;
  /** 선택적 의존성 포함 여부 (기본값: false) */
  includeOptional?: boolean;
  /** conda 채널 (기본값: 'conda-forge') */
  condaChannel?: string;
  /** yum 저장소 URL */
  yumRepoUrl?: string;
  /** 아키텍처 (기본값: 'x86_64') */
  architecture?: string;
  /** 타겟 OS (pip/conda 휠 필터링용, 폐쇄망 OS) */
  targetOS?: 'any' | 'windows' | 'macos' | 'linux';
  /** Python 버전 (pip 호환성 필터링용, 예: '3.12', '3.12.2') */
  pythonVersion?: string;
  /** CUDA 버전 (conda 패키지의 __cuda 의존성 필터링용, 예: '11.8', '12.4') */
  cudaVersion?: string | null;
  /** 진행 상황 콜백 */
  onProgress?: DependencyProgressCallback;
  /** YUM 배포판 설정 (RHEL/CentOS/Rocky/AlmaLinux) */
  yumDistribution?: OSDistributionSetting;
  /** APT 배포판 설정 (Debian/Ubuntu) */
  aptDistribution?: OSDistributionSetting;
  /** APK 배포판 설정 (Alpine) */
  apkDistribution?: OSDistributionSetting;
  /** 권장 의존성 포함 여부 (APT용) */
  includeRecommends?: boolean;
}

interface OSDistributionSetting {
  /** 배포판 ID (예: rocky-9, ubuntu-22.04, alpine-3.18) */
  id: string;
  /** 배포판에서 지원하는 아키텍처 (예: x86_64, amd64, aarch64, arm64) */
  architecture: string;
}
```

`resolveAllDependencies`의 `maxDepth` 기본값은 `5`이며 CLI 기본 의존성 포함 다운로드가 사용하는 값입니다. 라이브러리 리졸버에 이 값을 전달하며, OS 리졸버 생성 경로에는 이 옵션을 전달하지 않습니다. 깊이 경계의 실제 처리는 타입별 리졸버 구현에 따릅니다. pip는 경계 노드에 적용 가능한 의존성이 남아 있으면 하위 확장을 생략하고 깊이 정보를 담은 경고를 애플리케이션 로그에 기록하지만, 직접 루트를 실패로 처리하지 않습니다. `resolveRootArtifactsOnly`는 shared resolver에서 pip의 `skipDependencyExpansion`으로만 전달되는 루트 전용 처리 힌트입니다. CLI의 `--no-deps`는 이 힌트와 `maxDepth: 0`을 함께 전달하므로 pip와 Conda 모두 루트 아티팩트만 조회하며, 깊이 제한 경고 없이 조용히 종료합니다. pip `PipResolver.resolveDependencies`를 직접 호출할 때의 `maxDepth` 기본값은 `10`입니다.

`includeDependencies: false`는 원본 배열을 그대로 반환하고 원격 루트 아티팩트 조회도 수행하지 않습니다. CLI의 `--no-deps`가 사용하는 `includeDependencies: true, maxDepth: 0` 경로와 구분해야 합니다.

`includeOptional`은 일반 라이브러리 경로에 `includeOptionalDependencies`로 전달됩니다. npm 전용 리졸버는 `includeOptional` 필드를 읽으므로 이 공통 옵션으로 npm optionalDependencies가 활성화되지는 않습니다. npm의 OS/아키텍처 필터 옵션도 이 공통 호출부에서는 전달하지 않습니다. `yumRepoUrl`은 타입에는 남아 있으나 OS 분기에서는 배포판의 `defaultRepos`를 사용합니다.

### 요청 단위 원격 조회 재사용

`includeDependencies`가 활성화된 `resolveAllDependencies()` 호출은 한 번의
요청에만 살아 있는 내부 조회 세션과 pip·Conda·Maven·npm 전용 resolver를 하나씩
만듭니다. requirements.txt처럼 여러 직접 루트가 공통 전이 의존성을 가질 때,
같은 조회 문맥의 **원격 후보 선택과 metadata/manifest 조회 성공 결과**만
재사용합니다. 함수가 반환되면 세션은 폐기되므로 별도의
`resolveAllDependencies()` 호출 사이에는 결과를 보존하지 않으며, 이를 제어하는
새 CLI 옵션이나 설정도 없습니다.

| 타입 | 재사용하는 원격 조회 | 같은 조회로 판단하는 주요 문맥 |
| --- | --- | --- |
| pip | 호환 최신 버전, 정확 버전 artifact·metadata | PEP 503 정규화 이름, 버전 조건, index/base URL, 대상 Python·플랫폼, source artifact 검증 모드 |
| conda | repodata의 호환 후보, 선택된 artifact 정보 | 소문자 이름, 버전 조건/정확 버전, build, channel, subdir·아키텍처, Python·CUDA |
| Maven | 버전 metadata, 원시 POM/BOM | 실제 적용 저장소 URL, groupId:artifactId:version 좌표 |
| npm | registry packument, 선택된 버전 | 소문자 이름, 버전 조건, registry URL |

동일 키의 동시 조회는 하나의 원격 작업을 공유하고, 각 소비자에게는 복제한
snapshot을 돌려주므로 한 트리의 수정이 다른 트리에 영향을 주지 않습니다.
reject, `null`, 빈 후보처럼 유효하지 않은 결과는 남기지 않아 다음 직접 루트가
다시 조회할 수 있습니다. 완료된 재사용 hit가 있으면 애플리케이션 info 로그에
세션 hit/miss/join 통계를 남깁니다.

이 최적화는 전역 의존성 solver가 아닙니다. 직접 루트별 dependency tree,
best-effort/`--strict` 실패 처리, pip extras·marker, Maven scope·exclusion·
dependencyManagement, npm peer·hoisting, 최종 다운로드 아티팩트 중복 제거는 기존
규칙대로 각 호출 경로에서 계속 처리합니다. yum/apt/apk와 Docker는 이 세션 대상이
아닙니다. pip·Maven의 기존 cache option은 요청 시작 시 전용 resolver에 복사한
snapshot을 사용하므로, 요청 중 변경이 legacy singleton 설정으로 역전파되지
않습니다.

### DependencyProgressCallback

직접 루트 처리의 시작·완료·오류를 전달하는 콜백입니다. `current`/`total`은 전체 전이 노드가 아닌 입력 루트 기준입니다. 현재 `dependencyCount`는 라이브러리에서는 `flatList.length`(루트 포함), OS에서는 결과 개수에서 1을 뺀 값으로 전달됩니다.

```typescript
interface DependencyProgressCallback {
  (info: {
    current: number;       // 현재 처리 중인 패키지 인덱스 (1부터 시작)
    total: number;         // 전체 패키지 수
    packageName: string;   // 패키지명
    packageType: string;   // 패키지 타입 (pip, conda, maven 등)
    status: 'start' | 'success' | 'error';  // 상태
    dependencyCount?: number;  // 해결된 의존성 수 (success 시)
    error?: string;        // 에러 메시지 (error 시)
  }): void;
}
```

### 진행 상황 콜백 사용 예시

```typescript
const result = await resolveAllDependencies(packages, {
  onProgress: (info) => {
    if (info.status === 'start') {
      console.log(`[${info.current}/${info.total}] 의존성 해결 시작: ${info.packageType}/${info.packageName}`);
    } else if (info.status === 'success') {
      console.log(`[${info.current}/${info.total}] 완료: ${info.packageName} (${info.dependencyCount}개 의존성)`);
    } else if (info.status === 'error') {
      console.error(`[${info.current}/${info.total}] 실패: ${info.packageName}`, info.error);
    }
  },
});
```

### 사용 예시

```typescript
import { resolveAllDependencies, DownloadPackage } from '../shared';

const packages: DownloadPackage[] = [
  { id: '1', type: 'pip', name: 'requests', version: '2.28.0' },
  { id: '2', type: 'maven', name: 'org.springframework:spring-core', version: '5.3.0' },
];

const result = await resolveAllDependencies(packages, {
  maxDepth: 3,
  includeOptional: false,
  pythonVersion: '3.11',
  targetOS: 'linux',
  architecture: 'x86_64',
});

console.log(`총 ${result.allPackages.length}개 패키지 (의존성 포함)`);
```

---

## OS 패키지 의존성 해결

`resolveAllDependencies`에서 OS 패키지(yum, apt, apk) 의존성을 직접 해결합니다.

### 처리 흐름

```
resolveAllDependencies()
    │
    ├── 일반 패키지 (pip, conda, maven, npm)
    │   └── 타입별 리졸버 호출
    │
    └── OS 패키지 (yum, apt, apk)
        │
        ├── osPackageInfo 메타데이터 확인
        │   └── 없으면: 원본만 포함하고 스킵
        │
        ├── 배포판 설정 조회 (yumDistribution, aptDistribution, apkDistribution)
        │
        ├── OS 리졸버 생성 (YumResolver, AptResolver, ApkResolver)
        │
        ├── 의존성 해결 수행
        │   └── 타입별 OS 리졸버가 패키지/충돌/미해결 목록 반환
        │
        ├── 결과를 DownloadPackage로 변환
        │   └── downloadUrl, filename, location 설정
        │
        └── 루트 아래 나머지 패키지를 한 단계로 붙여 dependencyTrees에 추가 (UI 표시용)
```

### 사용 예시

```typescript
import { resolveAllDependencies } from '../shared';
import type { DownloadPackage } from '../shared';
import type { OSPackageInfo } from '../downloaders/os-shared/types';

// 같은 배포판의 OS 검색/조회에서 얻은 완전한 메타데이터를 전달합니다.
async function resolveHttpd(osPackageInfo: OSPackageInfo) {
  const packages: DownloadPackage[] = [{
    id: '1',
    type: 'yum',
    name: osPackageInfo.name,
    version: osPackageInfo.version,
    architecture: osPackageInfo.architecture,
    metadata: { osPackageInfo },
  }];
  return resolveAllDependencies(packages, {
    includeOptional: false,
    yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  });
}
```

### 결과 구조

OS 패키지 의존성 해결 결과는 다음과 같이 반환됩니다:

```typescript
// allPackages 내 OS 패키지의 구조 예시 (값·중첩 메타데이터 일부 생략)
{
  id: 'generated-id',
  type: 'yum',
  name: 'apr',
  version: '1.4.8-7.el7',
  architecture: 'x86_64',
  size: 103456,
  downloadUrl: 'http://mirror.../Packages/apr-1.4.8-7.el7.x86_64.rpm',
  repository: { baseUrl: 'http://mirror...', name: 'base' },
  location: 'Packages/apr-1.4.8-7.el7.x86_64.rpm',
  filename: 'apr-1.4.8-7.el7.x86_64.rpm',
  metadata: { osPackageInfo: { ... } }
}
```

---

## 의존성 트리 유틸리티 (`dependency-tree-utils.ts`)

의존성 트리 조작을 위한 유틸리티 함수 모음입니다.

**알고리즘**: 순회 함수는 반복문(스택/BFS) 기반으로 구현하여 깊이에 따른 재귀 호출 스택 증가를 피합니다.

### 함수 목록

| 함수 | 설명 | 알고리즘 |
|------|------|----------|
| `flattenDependencyTree(node)` | 트리를 플랫 리스트로 변환 | 스택 기반 DFS |
| `flattenMultipleDependencyTrees(nodes)` | 여러 트리를 중복 제거하며 병합 | 스택 기반 DFS |
| `getDependencyTreeDepth(node)` | 트리의 최대 깊이 계산 | 큐 기반 BFS |
| `getDependencyTreeSize(node)` | 서로 다른 노드 객체 개수 | 스택 기반 DFS |
| `getPackageArtifactKey(packageInfo)` | 패키지와 아티팩트 메타데이터의 식별 키 | 문자열 조합 |

### 구현 특징

- **순환 참조 방지**: `visited` Set으로 객체 참조 추적
- **중복 제거**: 평탄화 함수는 `type:소문자이름@version`에 filename, 다운로드 URL, repository/index URL, classifier, checksum, Maven type 정보를 결합한 아티팩트 키로 중복을 제거합니다. 같은 이름·버전의 서로 다른 wheel/classifier를 유지합니다.
- **메모리 효율**: 스택/큐 구조로 재귀 호출 스택 대체

```typescript
// 내부 구현 예시 (flattenDependencyTree)
const stack: DependencyNode[] = [node];
const visited: Set<DependencyNode> = new Set();

while (stack.length > 0) {
  const current = stack.pop()!;
  if (visited.has(current)) continue;
  visited.add(current);

  // 처리 로직...
  for (const child of current.dependencies) {
    if (!visited.has(child)) stack.push(child);
  }
}
```

`getDependencyTreeDepth()`는 루트만 있으면 1을 반환합니다. 객체가 여러 경로에서 공유된 그래프에서는 BFS의 첫 방문 깊이를 사용하며 모든 가능한 경로의 최장 길이를 탐색하지 않습니다. `getDependencyTreeSize()`의 객체 수는 아티팩트 중복 제거 후 패키지 수와 다를 수 있습니다.

### 사용 예시

```typescript
import {
  flattenDependencyTree,
  getDependencyTreeDepth
} from './shared/dependency-tree-utils';

// resolver는 PipResolver처럼 DependencyResolutionResult를 반환하는 인스턴스
const resolution = await resolver.resolveDependencies('flask', '2.0.0');
const tree = resolution.root;

// 플랫 리스트로 변환
const packages = flattenDependencyTree(tree);
console.log(`총 ${packages.length}개 패키지`);

// 트리 깊이 확인
const depth = getDependencyTreeDepth(tree);
console.log(`의존성 깊이: ${depth}`);
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [pip 의존성 해결 알고리즘](./pip-dependency-resolution.md)
- [Conda 의존성 해결 알고리즘](./conda-dependency-resolution.md)
- [Maven 의존성 해결 알고리즘](./maven-dependency-resolution.md)
- [npm 의존성 해결 알고리즘](./npm-dependency-resolution.md)
- [Resolvers 문서](./resolvers.md)
