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
| `compareVersions` | a: string, b: string | number | 버전 비교 (a > b면 양수) |
| `isVersionCompatible` | version: string, spec: string | boolean | 버전 스펙 호환성 체크 |
| `sortVersionsDescending` | versions: string[] | string[] | 버전 내림차순 정렬 |
| `sortVersionsAscending` | versions: string[] | string[] | 버전 오름차순 정렬 |
| `findLatestCompatibleVersion` | versions: string[], spec: string | string \| null | 호환되는 최신 버전 찾기 |

### 지원 버전 스펙

- `>=`, `<=`, `>`, `<` - 비교 연산자
- `==` - 정확히 일치 (와일드카드 `*` 지원)
- `!=` - 불일치
- `~=` - 호환 릴리스 (예: `~=2.1`은 `>=2.1, ==2.*`)
- `,` - AND 연산
- `|` - OR 연산

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
| `yum` | YumResolver | RPM 의존성 |

> **참고**: apt, apk 리졸버는 인터페이스가 달라 별도 어댑터 필요

### ResolvedPackageList

```typescript
interface ResolvedPackageList {
  originalPackages: DownloadPackage[];  // 원본 패키지 목록
  allPackages: DownloadPackage[];       // 의존성 포함 전체 목록
  dependencyTrees: DependencyResolutionResult[];  // 의존성 트리
  failedPackages: { name: string; version: string; error: string }[];  // 실패 목록
}
```

### DependencyResolverOptions

```typescript
interface DependencyResolverOptions {
  maxDepth?: number;        // 최대 탐색 깊이 (기본: 5)
  includeOptional?: boolean; // 선택적 의존성 포함 (기본: false)
  condaChannel?: string;    // conda 채널 (기본: 'conda-forge')
  yumRepoUrl?: string;      // yum 저장소 URL
  architecture?: string;    // 아키텍처 (기본: 'x86_64')
  pythonVersion?: string;   // Python 버전 (예: '3.12')
  targetOS?: string;        // 타겟 OS (예: 'linux')
  onProgress?: DependencyProgressCallback;  // 진행 상황 콜백
}
```

### DependencyProgressCallback

의존성 해결 진행 상황을 실시간으로 전달하는 콜백

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

## 의존성 트리 유틸리티 (`dependency-tree-utils.ts`)

의존성 트리 조작을 위한 유틸리티 함수 모음입니다.

**알고리즘**: 모든 함수가 반복문(스택/BFS) 기반으로 구현되어 깊은 트리에서도 call stack overflow가 발생하지 않습니다.

### 함수 목록

| 함수 | 설명 | 알고리즘 |
|------|------|----------|
| `flattenDependencyTree(node)` | 트리를 플랫 리스트로 변환 | 스택 기반 DFS |
| `flattenMultipleDependencyTrees(nodes)` | 여러 트리를 중복 제거하며 병합 | 스택 기반 DFS |
| `getDependencyTreeDepth(node)` | 트리의 최대 깊이 계산 | 큐 기반 BFS |
| `getDependencyTreeSize(node)` | 트리의 총 노드 개수 | 스택 기반 DFS |

### 구현 특징

- **순환 참조 방지**: `visited` Set으로 객체 참조 추적
- **중복 제거**: `name@version` 키로 중복 패키지 필터링
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

### 사용 예시

```typescript
import {
  flattenDependencyTree,
  getDependencyTreeDepth
} from './shared/dependency-tree-utils';

const tree = await resolver.resolveDependencies('flask', '2.0.0');

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
