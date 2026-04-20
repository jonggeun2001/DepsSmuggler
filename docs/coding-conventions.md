# DepsSmuggler 코딩 컨벤션

이 문서는 DepsSmuggler 프로젝트의 코딩 컨벤션과 스타일 가이드를 정의합니다.

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

---

## 도구 설정

### EditorConfig

프로젝트 루트의 `.editorconfig` 파일로 기본 에디터 설정을 관리합니다.

- **인덴트**: 2 스페이스
- **줄 끝**: LF (Unix)
- **파일 끝 개행**: 있음
- **후행 공백**: 제거 (마크다운 제외)

### Prettier

코드 포맷팅은 Prettier를 사용합니다. `.prettierrc` 설정:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### ESLint

정적 분석은 ESLint를 사용합니다. `.eslintrc.cjs` 참조.

- TypeScript strict 규칙 적용
- React Hooks 규칙 적용
- Import 정렬 자동화

### 명령어

```bash
npm run lint          # ESLint 검사
npm run lint:fix      # ESLint 자동 수정
npm run typecheck     # TypeScript 타입 검사
npm run guardrails:check  # 아키텍처/strict baseline 가드 검사
npm run format        # Prettier 포맷팅
npm run format:check  # Prettier 검사만
```

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

- 소스 코드에서 `any` 타입 사용 최소화 (50개 미만 목표)
- 테스트 파일에서는 `any` 허용하되, 가능하면 Testable 인터페이스 패턴 사용

```typescript
// Good: 테스트에서 private 멤버 접근 시 Testable 인터페이스 사용
interface DownloadManagerTestable {
  items: Map<string, DownloadItem>;
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

`tsconfig.json`에서 strict 모드 활성화:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

추가 가드:

- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`는 `tsconfig.strict-baseline.json`과 baseline 체크로 점진 적용

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
├── types/              # 타입 정의
└── utils/              # 유틸리티
electron/
├── main.ts             # Electron 메인 프로세스
└── preload.ts          # Preload 스크립트
```

### 파일 네이밍

**글로벌 표준 준수**: Node.js 프로젝트 표준에 맞게 kebab-case를 사용합니다.

| 유형           | 규칙             | 예시                                          |
| -------------- | ---------------- | --------------------------------------------- |
| React 컴포넌트 | **PascalCase**   | `WizardPage.tsx`, `DownloadButton.tsx`        |
| 일반 모듈      | **kebab-case**   | `download-manager.ts`, `cache-manager.ts`     |
| Zustand 스토어 | **kebab-case**   | `cart-store.ts`, `settings-store.ts`          |
| 유틸리티       | **kebab-case**   | `file-utils.ts`, `path-utils.ts`              |
| 다운로더       | **kebab-case**   | `pip.ts`, `maven.ts`, `docker-auth-client.ts` |
| 리졸버         | **kebab-case**   | `pip-resolver.ts`, `npm-resolver.ts`          |
| 테스트         | 원본명 + `.test` | `pip.test.ts`, `download-manager.test.ts`     |
| 타입 정의      | **kebab-case**   | `npm-types.ts`, `maven-types.ts`              |

**예외**: 단일 단어 파일은 그대로 사용 (`pip.ts`, `maven.ts`, `factory.ts`)

---

## Import 정렬

ESLint `import/order` 규칙에 따라 자동 정렬됩니다.

```typescript
// 1. Node.js 내장 모듈
import * as fs from 'fs';
import * as path from 'path';

// 2. 외부 라이브러리
import axios from 'axios';
import { create } from 'zustand';

// 3. 프로젝트 내부 모듈
import { PackageInfo } from '../../types';
import { downloadFile } from '../shared/download-utils';

// 4. 상대 경로 모듈 (같은 디렉토리)
import { PipResolver } from './pip-resolver';

// 5. 타입 전용 import
import type { DownloadOptions } from '../../types';
```

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
- 테스트 포함 필수
- 관련 문서 업데이트

### Guardrails

- renderer에서는 `window.electronAPI` 직접 호출을 새로 추가하지 않습니다. 가능한 경우 preload 계약이나 `renderer-data-client` 같은 게이트웨이를 사용합니다.
- `src/core/downloaders/**`와 `src/core/resolver/**` 사이의 직접 import는 금지하고, 이후 단계에서 `src/core/ports/**`를 통해 연결합니다.
- 아키텍처 관련 ESLint 규칙과 강화 strict 타입체크는 baseline 파일로 기존 부채를 고정하고, `npm run guardrails:check`와 CI Guardrails job에서 새 위반만 차단합니다.
- 커밋 전에는 `lint-staged`가 변경된 TS/JS 파일에 대해 eslint, 관련 Vitest, TS 파일 타입체크를 실행합니다.

---

## 에러 처리

### 커스텀 에러

```typescript
export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly packageName: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}
```

### try-catch 패턴

```typescript
try {
  await downloadPackage(info, destPath);
} catch (error) {
  if (error instanceof DownloadError) {
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
