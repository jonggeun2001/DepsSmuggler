# 테스트 구조

## 개요
- 목적: 프로젝트의 테스트 전략 및 구조 문서화
- 프레임워크: Vitest
- E2E 테스트: Playwright

---

## 테스트 분류

### 단위 테스트 (Unit Tests)
네트워크 호출 없이 핵심 로직만 테스트합니다.

| 파일 | 테스트 대상 | 테스트 수 |
|------|------------|----------|
| `downloadManager.test.ts` | 다운로드 큐 관리 | 30 |
| `cacheManager.test.ts` | 캐시 관리 | 38 |
| `mavenResolver.test.ts` | Maven 의존성 해결 로직 | 44 |
| `npmResolver.test.ts` | NPM 의존성 해결 로직 | 28 |
| `pipResolver.test.ts` | Pip 의존성 해결 로직 | 38 |
| `pip.test.ts` | Pip 다운로더 | 39 |
| `npm.test.ts` | NPM 다운로더 | - |
| `maven.test.ts` | Maven 다운로더 | - |
| `conda.test.ts` | Conda 다운로더 | 43 |
| `docker.test.ts` | Docker 다운로더 | - |
| `yum.test.ts` | Yum 다운로더 | 34 |
| `packager.test.ts` | 패키징 | 45 |
| `filename-utils.test.ts` | 파일명 유틸리티 | 32 |
| `path-utils.test.ts` | 경로 유틸리티 | 37 |

### 통합 테스트 (Integration Tests)
실제 네트워크 호출을 포함하여 전체 플로우를 테스트합니다.

| 파일 | 테스트 대상 | 테스트 수 |
|------|------------|----------|
| `maven.integration.test.ts` | Maven 다운로드 전체 플로우 | 48 |
| `npm.integration.test.ts` | NPM 다운로드 전체 플로우 | 16 |
| `pip.integration.test.ts` | Pip 다운로드 전체 플로우 | 18 |
| `conda.integration.test.ts` | Conda 다운로드 전체 플로우 | 13 |
| `docker.integration.test.ts` | Docker 이미지 다운로드 | 16 |
| `yum.integration.test.ts` | Yum 패키지 다운로드 | 11 |
| `apt.integration.test.ts` | APT 패키지 다운로드 | 17 |
| `apk.integration.test.ts` | APK 패키지 다운로드 | 17 |
| `os.integration.test.ts` | OS 패키지 공통 기능 | 17 |

---

## 테스트 실행

### 단위 테스트만 실행
```bash
npm test
```

### 통합 테스트 포함 실행
```bash
INTEGRATION_TEST=true npm test
```

### 커버리지 포함 실행
```bash
npm run test:coverage

# 통합 테스트 포함
INTEGRATION_TEST=true npm run test:coverage
```

### 특정 파일 테스트
```bash
npx vitest run src/core/resolver/mavenResolver.test.ts
```

### 감시 모드
```bash
npm run test:watch
```

---

## 통합 테스트 스킵 메커니즘

통합 테스트는 `INTEGRATION_TEST` 환경 변수로 제어됩니다:

```typescript
// 통합 테스트 파일 상단
const isIntegrationTest = process.env.INTEGRATION_TEST === 'true';

describe.skipIf(!isIntegrationTest)('통합 테스트', () => {
  // 테스트 케이스
});
```

**이유**:
- 단위 테스트는 빠르게 실행 (네트워크 없음)
- 통합 테스트는 실제 레지스트리 호출로 느림
- CI/CD에서 선택적 실행 가능

---

## 테스트 패턴

### Private 메서드 테스트
리플렉션을 사용하여 private 메서드를 테스트합니다:

```typescript
const callPrivateMethod = (instance: MyClass, arg: string): any => {
  return (instance as any).privateMethod(arg);
};

it('private 메서드 테스트', () => {
  const result = callPrivateMethod(instance, 'test');
  expect(result).toBe('expected');
});
```

### 모킹
Vitest의 `vi` 모듈을 사용합니다:

```typescript
import { vi } from 'vitest';

// 함수 모킹
const mockFn = vi.fn();

// 모듈 모킹
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));
```

### 내부 상태 접근
테스트에서 내부 상태에 접근할 때는 타입 캐스팅을 사용합니다:

```typescript
// Map 내부 접근
const items = (manager as any).items as Map<string, DownloadItem>;
const itemsArray = Array.from(items.values());

// private 속성 설정
(resolver as any).targetPlatform = { system: 'Linux', machine: 'x86_64' };
```

---

## GitHub Actions CI

### 워크플로우 구조

```yaml
jobs:
  test:
    # Ubuntu, Windows, macOS에서 실행
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    steps:
      - name: Run unit tests
        run: npm test

      - name: Run integration tests
        run: npm test
        env:
          INTEGRATION_TEST: true

  coverage:
    # 커버리지 측정 (통합 테스트 포함)
    steps:
      - name: Run tests with coverage
        run: npm run test:coverage
        env:
          INTEGRATION_TEST: true
```

### 트리거 조건
- `main`, `develop` 브랜치 push
- `main` 브랜치로의 Pull Request

---

## 테스트 작성 가이드

### 단위 테스트 작성 시
1. 네트워크 호출 금지 - 모킹 사용
2. 파일 I/O 최소화 - 임시 디렉토리 사용
3. 독립적 실행 가능하도록 작성
4. `beforeEach`에서 인스턴스 초기화

### 통합 테스트 작성 시
1. `*.integration.test.ts` 파일명 사용
2. `describe.skipIf(!isIntegrationTest)` 패턴 적용
3. 실제 레지스트리 호출 허용
4. 타임아웃 충분히 설정 (30초 이상)

### 테스트 명명 규칙
```typescript
describe('클래스명 테스트', () => {
  describe('메서드명', () => {
    it('조건 - 예상 결과', () => {
      // 테스트
    });
  });
});
```

예시:
```typescript
describe('MavenResolver 단위 테스트', () => {
  describe('resolveProperty', () => {
    it('단순 속성 치환', () => { ... });
    it('중첩 속성 치환', () => { ... });
    it('존재하지 않는 속성은 그대로 반환', () => { ... });
  });
});
```

---

## 관련 문서

- [아키텍처 개요](./architecture-overview.md)
- [Resolvers](./resolvers.md)
- [Downloaders](./downloaders.md)
