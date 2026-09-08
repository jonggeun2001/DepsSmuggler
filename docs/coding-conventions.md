# DepsSmuggler 코딩 컨벤션

이 문서는 DepsSmuggler 프로젝트의 코딩 컨벤션과 스타일 가이드를 정의합니다.

도구가 실제로 검사하는 규칙은 `.editorconfig`, `.prettierrc`, `.eslintrc.cjs`, `tsconfig*.json`을 기준으로 설명합니다. 아래 코드 예시는 작성 지침이며 모든 기존 파일이 같은 형태라는 뜻은 아닙니다. 파일 구조와 실행 경로는 [아키텍처 개요](./architecture-overview.md), 검증 범위는 [테스트](./testing.md)를 함께 참고합니다.

## 목차

- [도구 설정](#도구-설정)
- [TypeScript](#typescript)
- [React](#react)
- [파일 및 디렉토리](#파일-및-디렉토리)
- [Import 정렬](#import-정렬)
- [네이밍 컨벤션](#네이밍-컨벤션)
- [테스트](#테스트)
- [주석 및 문서화](#주석-및-문서화)
- [Git 컨벤션](#git-컨벤션)
- [에러 처리](#에러-처리)
- [성능 고려사항](#성능-고려사항)

---

## 도구 설정

### EditorConfig

프로젝트 루트의 `.editorconfig` 파일로 기본 에디터 설정을 관리합니다.

- **인덴트**: 2 스페이스 (`Makefile`은 탭)
- **줄 끝**: LF (Unix)
- **파일 끝 개행**: 있음
- **후행 공백**: 제거 (마크다운 제외)

### Prettier

코드 포맷팅은 Prettier를 사용합니다. `.prettierrc`의 주요 설정:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

추가로 객체 괄호 공백, 화살표 함수 인수 괄호, LF 줄 끝을 사용하며 JSX에는 큰따옴표를 사용합니다. JSON 파일에는 `printWidth: 200` override가 있습니다.

### ESLint

정적 분석은 ESLint를 사용합니다. `.eslintrc.cjs` 참조.

- `@typescript-eslint/recommended` 규칙 적용 (`strict` 타입 검사는 TypeScript 설정에서 수행)
- React Hooks 규칙 적용
- `import/order` 정렬 위반은 경고이며 `lint:fix`에서 자동 수정 가능
- 미사용 변수·명시적 `any`·non-null assertion은 경고, Hooks 호출 규칙 위반은 오류
- 특정 downloader/resolver 간 직접 의존은 `import/no-restricted-paths` 오류로 차단하고 `core/ports` 또는 shared 경계를 사용

### 명령어

```bash
npm run lint          # ESLint 검사
npm run lint:fix      # ESLint 자동 수정
npm run format        # Prettier 포맷팅
npm run format:check  # Prettier 검사만
```

현재 `format`/`format:check` 스크립트는 `src/**/*.{ts,tsx,js,jsx,json}`와 `electron/**/*.{ts,js}`만 대상으로 하므로 문서·루트 설정·`tests/e2e` 전체를 검사하는 명령은 아닙니다. `lint`는 저장소의 `.ts/.tsx/.js/.jsx`를 검사하며 CI에도 독립 잡으로 연결되어 있습니다.

---

## TypeScript

### 타입 정의

```typescript
// Good: 명시적 타입 정의
interface UserConfig {
  name: string;
  timeout: number;
  enabled: boolean;
}

// Good: 타입 추론 활용 (간단한 경우)
const count = 0;
const items = ['a', 'b', 'c'];

// Bad: any 사용
const data: any = fetchData(); // 지양

// Good: unknown 사용 후 타입 가드
const data: unknown = fetchData();
if (isUserConfig(data)) {
  // 타입 안전하게 사용
}
```

### any 타입 사용 제한

- 외부 오류처럼 형태가 정해지지 않은 값은 `unknown`과 타입 가드로 처리합니다.
- 이미 정의된 POM·다운로드 결과·플랫폼 타입을 재사용하고, 같은 구조를 별도로 선언하지 않습니다.
- 테스트 파일에서는 `any` 허용하되, 가능하면 Testable 인터페이스 패턴 사용

```typescript
// Good: 테스트에서 private 멤버 접근 시 Testable 인터페이스 사용
interface DownloadManagerTestable {
  items: Map<string, DownloadManagerItem>;
  isRunning: boolean;
  queue: PQueue;
}

const asTestable = (manager: DownloadManager): DownloadManagerTestable => {
  return manager as unknown as DownloadManagerTestable;
};

// 사용
const testable = asTestable(manager);
expect(testable.isRunning).toBe(true);
```

### Strict Mode

`tsconfig.json`에 명시된 주요 검사 옵션:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

`tsconfig.json`과 `tsconfig.electron.json` 모두 미사용 선언을 검사합니다. 사용되지 않는 내부 함수·인수는 호출부와 함께 제거하고, 공개 API나 콜백의 인수 순서를 유지해야 하는 경우에만 `_` 접두어를 사용합니다. 타입 검사와 기존 동작 테스트로 정리 전후를 확인합니다.

`noImplicitAny`와 `strictNullChecks`는 별도 키로 선언하지 않고 `strict: true`로 활성화됩니다. 기본 설정은 renderer와 Electron/core/CLI 소스를 포함하며 테스트 파일은 제외합니다. `tsconfig.electron.json`은 renderer를 제외하고 CommonJS 산출물을 만들며, 개발 CLI의 `tsconfig.cli.json`은 기본 설정에 ts-node의 CommonJS module override를 추가합니다.

### Null 체크

```typescript
// Good: 옵셔널 체이닝
const name = user?.profile?.name;

// Good: Nullish coalescing
const timeout = config.timeout ?? 3000;

// Bad: 불필요한 타입 단언
const name = user!.name; // 지양
```

---

## React

### 컴포넌트 정의

```tsx
// Good: 함수형 컴포넌트 + Props 타입 정의
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ label, onClick, disabled = false }) => {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
};
```

### Hooks 사용

```tsx
// Good: 의존성 배열 명확히 지정
useEffect(() => {
  fetchData();
}, [userId]); // userId가 변경될 때만 실행

// Good: useCallback으로 함수 메모이제이션
const handleClick = useCallback(() => {
  setCount((prev) => prev + 1);
}, []);

// Good: useMemo로 계산 결과 캐싱
const filteredItems = useMemo(() => {
  return items.filter((item) => item.active);
}, [items]);
```

### 상태 관리 (Zustand)

```typescript
// stores/example-store.ts
import { create } from 'zustand';

interface ExampleState {
  count: number;
  increment: () => void;
  reset: () => void;
}

export const useExampleStore = create<ExampleState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  reset: () => set({ count: 0 }),
}));
```

---

## 파일 및 디렉토리

### 구조

```
src/
├── renderer/           # React UI (렌더러 프로세스)
│   ├── pages/          # 페이지 컴포넌트
│   ├── components/     # 재사용 컴포넌트
│   ├── stores/         # Zustand 스토어
│   └── layouts/        # 레이아웃
├── core/               # 핵심 로직 (Node.js)
│   ├── downloaders/    # 패키지 다운로더
│   ├── resolver/       # 의존성 해결
│   ├── packager/       # 압축/패키징
│   ├── shared/         # 공유 유틸리티
│   └── mailer/         # 이메일 발송
├── cli/                # CLI 진입점
│   └── commands/       # CLI 명령어
├── types/              # 타입 정의 (barrel + 하위 canonical module)
└── utils/              # 유틸리티
electron/
├── main.ts             # Electron 메인 프로세스
└── preload.ts          # Preload 스크립트
```

### 파일 네이밍

새 일반 모듈에는 프로젝트 관례인 kebab-case를 사용하고, React 컴포넌트에는 PascalCase를 사용합니다.

| 유형 | 규칙 | 예시 |
|------|------|------|
| React 컴포넌트 | **PascalCase** | `WizardPage.tsx`, `DownloadButton.tsx` |
| 일반 모듈 | **kebab-case** | `download-runner.ts`, `cache-manager.ts` |
| Zustand 스토어 | **kebab-case** | `cart-store.ts`, `settings-store.ts` |
| 유틸리티 | **kebab-case** | `file-utils.ts`, `path-utils.ts` |
| 다운로더 | **kebab-case** | `pip.ts`, `maven.ts`, `docker-auth-client.ts` |
| 리졸버 | **kebab-case** | `pip-resolver.ts`, `npm-resolver.ts` |
| 테스트 | 원본명 + `.test` | `pip.test.ts`, `download-runner.test.ts` |
| 타입 정의 | **kebab-case** | `npm-types.ts`, `maven-types.ts` |

**예외**: 단일 단어 파일은 그대로 사용 (`pip.ts`, `maven.ts`, `factory.ts`)

기존 위자드 훅 `useWizardSearchFlow.ts`처럼 camelCase 파일도 있습니다. 컨벤션 문서 갱신만으로 기존 경로를 변경하지 않습니다. Electron의 세부 handler와 service, renderer의 page별 hook/component 디렉터리는 위 구조의 하위 계층이며 실제 목록은 아키텍처 문서에서 관리합니다.

---

## Import 정렬

ESLint `import/order`는 `builtin → external → internal → parent/sibling → index → type` 순서를 경고 수준으로 검사합니다. 각 그룹은 대소문자를 무시한 이름순이고 그룹 사이 빈 줄을 넣지 않습니다. 일반 `lint`는 검사만 하며 자동 수정은 `lint:fix`로 실행합니다.

```typescript
// 1. Node.js 내장 모듈
import * as fs from 'fs';
import * as path from 'path';
// 2. 외부 라이브러리
import axios from 'axios';
import { create } from 'zustand';
// 3. 상대 경로 모듈 (상위/같은 디렉터리는 한 그룹)
import { PackageInfo } from '../../types';
import { downloadFile } from '../shared/download-utils';
import { PipResolver } from './pip-resolver';
// 4. 타입 전용 import
import type { DownloadOptions } from '../../types';
```

상대 경로 import는 프로젝트 코드여도 `internal` 그룹이 아니라 `parent/sibling`으로 분류됩니다. 위 예시에는 별도 `internal`/`index` import가 없습니다.

---

## 네이밍 컨벤션

### 변수/함수

```typescript
// camelCase
const downloadCount = 0;
const isDownloading = false;

function fetchPackageInfo() {}
async function downloadPackage() {}
```

### 클래스/인터페이스/타입

```typescript
// PascalCase
class DockerDownloader {}
interface PackageInfo {}
type DownloadStatus = 'pending' | 'downloading' | 'completed';
```

### 상수

```typescript
// UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const DEFAULT_TIMEOUT = 30000;

// 또는 camelCase (프로젝트 내 일관성 유지)
const maxRetryCount = 3;
```

### 이벤트 핸들러

```typescript
// on + 동작 또는 handle + 명사
const onDownloadStart = () => {};
const handleButtonClick = () => {};
```

---

## 테스트

### 파일 구조

```
src/core/downloaders/
├── pip.ts
├── pip.test.ts              # 단위 테스트
└── pip.integration.test.ts  # 통합 테스트
```

### 테스트 패턴

아래는 suite와 준비/검증 블록을 보여주는 구성 예시입니다. 실제 단위 테스트에서는 downloader의 네트워크 경계를 mock하고, 검색 결과나 빈 입력의 기대값은 각 구현 계약에 맞춥니다.

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PipDownloader', () => {
  let downloader: PipDownloader;

  beforeEach(() => {
    downloader = new PipDownloader();
    vi.clearAllMocks();
  });

  describe('searchPackages', () => {
    it('검색 결과를 반환해야 함', async () => {
      const results = await downloader.searchPackages('requests');
      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });

    it('빈 쿼리에 대해 빈 배열을 반환해야 함', async () => {
      const results = await downloader.searchPackages('');
      expect(results).toEqual([]);
    });
  });
});
```

### Mock 패턴

```typescript
// Good: Mock 생성 헬퍼 함수
const createMockPackageInfo = (partial: Partial<PackageInfo>): PackageInfo => ({
  type: 'pip',
  name: 'test-package',
  version: '1.0.0',
  ...partial,
});

// 사용
const mockPackage = createMockPackageInfo({ name: 'requests', version: '2.28.0' });
```

### 통합 테스트

아래 환경 변수 패턴은 실제 외부 저장소를 호출하는 downloader 통합 테스트에 사용합니다. 내부 모듈 조합을 mock으로 검증하는 테스트는 기본 단위 테스트 실행에 포함할 수 있습니다.

```typescript
// 환경 변수로 통합 테스트 제어
const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_TEST ? describe : describe.skip;

describeIntegration('PipDownloader 통합 테스트', () => {
  // 실제 API 호출 테스트
});
```

---

## 주석 및 문서화

### JSDoc

```typescript
/**
 * 패키지를 다운로드합니다.
 *
 * @param info - 다운로드할 패키지 정보
 * @param destPath - 저장 경로
 * @param onProgress - 진행률 콜백 (선택)
 * @returns 다운로드된 파일 경로
 * @throws {Error} 네트워크 오류 또는 패키지를 찾을 수 없는 경우
 */
async downloadPackage(
  info: PackageInfo,
  destPath: string,
  onProgress?: (progress: DownloadProgressEvent) => void
): Promise<string> {
  // ...
}
```

### 인라인 주석

```typescript
// Good: 왜 이렇게 하는지 설명
// Docker Hub는 library/ 네임스페이스를 생략하므로 자동 추가
const fullName = repo.includes('/') ? repo : `library/${repo}`;

// Bad: 무엇을 하는지만 설명 (코드로 이미 명확함)
// fullName에 repo 할당
const fullName = repo;
```

### 언어

- **코드 주석**: 한국어 또는 영어 (일관성 유지)
- **문서**: 한국어 (사용자 대상)
- **커밋 메시지**: 영어 또는 한국어

---

## Git 컨벤션

### 브랜치 네이밍

```
feature/add-docker-support
fix/download-progress-bug
refactor/cleanup-utils
docs/update-readme
```

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식 권장:

```
feat: Docker Hub 이미지 다운로드 기능 추가
fix: 다운로드 진행률 표시 버그 수정
refactor: 의존성 해결 로직 개선
docs: README 업데이트
test: pip 다운로더 단위 테스트 추가
chore: 의존성 업데이트
```

### PR 규칙

- 하나의 PR은 하나의 기능/수정에 집중
- 변경에 맞는 검증 결과 포함. 동작 변경은 관련 회귀 테스트를 추가/갱신하고, 문서만 바꿀 때는 소스 대조와 문서 검사를 기록
- 관련 문서 업데이트

---

## 에러 처리

### 커스텀 에러

예외 클래스를 작성할 때의 예시입니다. 실제 공용 `DownloadError`는 `src/types/download/error.ts`의 데이터 인터페이스이므로 같은 이름의 예외 클래스로 대체하지 않습니다.

```typescript
export class PackageDownloadException extends Error {
  constructor(
    message: string,
    public readonly packageName: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PackageDownloadException';
  }
}
```

### try-catch 패턴

```typescript
try {
  await downloadPackage(info, destPath);
} catch (error) {
  if (error instanceof PackageDownloadException) {
    logger.error('다운로드 실패', { package: error.packageName });
  } else {
    logger.error('알 수 없는 오류', { error });
  }
  throw error; // 필요시 재throw
}
```

---

## 성능 고려사항

### 비동기 처리

```typescript
// Good: 병렬 처리
const results = await Promise.all(packages.map((pkg) => downloadPackage(pkg)));

// Good: 동시성 제한
import PQueue from 'p-queue';
const queue = new PQueue({ concurrency: 5 });
await Promise.all(packages.map((pkg) => queue.add(() => downloadPackage(pkg))));
```

### 메모리 관리

```typescript
// Good: 스트림 사용 (대용량 파일)
const readStream = fs.createReadStream(filePath);
const writeStream = fs.createWriteStream(destPath);
await pipeline(readStream, writeStream);

// Bad: 전체 파일을 메모리에 로드
const content = fs.readFileSync(filePath);
fs.writeFileSync(destPath, content);
```

---

## 참고 자료

- [TypeScript 공식 문서](https://www.typescriptlang.org/docs/)
- [React 공식 문서](https://react.dev/)
- [ESLint 규칙](https://eslint.org/docs/rules/)
- [Prettier 옵션](https://prettier.io/docs/en/options.html)
- [Vitest 문서](https://vitest.dev/)
