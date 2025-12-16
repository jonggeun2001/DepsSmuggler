# 다운로드 유틸리티

## 개요
- 목적: 다운로드 속도 계산 및 에러 처리를 위한 유틸리티 모듈
- 위치: `src/core/`

---

## SpeedCalculator

### 개요
- 목적: 다운로드 속도 계산 및 예상 남은 시간 산출
- 위치: `src/core/speed-calculator.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `addSample` | bytes: number | void | 다운로드 샘플 추가 (스로틀링 적용) |
| `addSampleForced` | bytes: number | void | 다운로드 샘플 강제 추가 (스로틀링 무시) |
| `getCurrentSpeed` | - | number | 현재 속도 (bytes/sec) |
| `getAverageSpeed` | - | number | 평균 속도 (bytes/sec) |
| `getEstimatedTimeRemaining` | remainingBytes: number | number | 예상 남은 시간 (ms) |
| `getStats` | - | SpeedStats | 속도 통계 객체 |
| `sampleCount` | - | number | 현재 샘플 개수 |
| `getSamples` | - | number[] | 샘플 배열 복사본 |
| `reset` | - | void | 통계 초기화 |

### 옵션

```typescript
interface SpeedCalculatorOptions {
  sampleSize?: number;        // 샘플 개수 (기본: 10)
  sampleIntervalMs?: number;  // 샘플 간격 ms (기본: 500)
}
```

### SpeedStats

```typescript
interface SpeedStats {
  currentSpeed: number;      // 현재 속도 (bytes/sec)
  averageSpeed: number;      // 평균 속도 (bytes/sec)
  sampleCount: number;       // 샘플 개수
}
```

### 팩토리 함수

```typescript
import { createSpeedCalculator } from './core/speed-calculator';

const calculator = createSpeedCalculator({
  sampleSize: 20,       // 최근 20개 샘플 유지
  sampleIntervalMs: 250 // 250ms 간격으로 샘플링
});
```

### 사용 예시

```typescript
import { createSpeedCalculator } from './core/speed-calculator';

const calculator = createSpeedCalculator();

// 다운로드 진행 중 호출
function onProgress(bytesDownloaded: number, totalBytes: number) {
  calculator.addSample(bytesDownloaded);

  const stats = calculator.getStats();
  const remaining = calculator.getEstimatedTimeRemaining(totalBytes - bytesDownloaded);

  console.log(`속도: ${formatBytes(stats.currentSpeed)}/s`);
  console.log(`남은 시간: ${formatTime(remaining)}`);
}

// 다운로드 완료 후 리셋
calculator.reset();
```

---

## DownloadErrorHandler

### 개요
- 목적: 다운로드 에러 분류 및 재시도 로직 처리
- 위치: `src/core/download-error-handler.ts`

### ErrorCategory

```typescript
enum ErrorCategory {
  NETWORK = 'network',           // 네트워크 오류 (연결 실패, 타임아웃)
  SERVER = 'server',             // 서버 오류 (5xx)
  CLIENT = 'client',             // 클라이언트 오류 (4xx)
  VALIDATION = 'validation',     // 검증 오류 (체크섬 불일치)
  FILESYSTEM = 'filesystem',     // 파일시스템 오류
  UNKNOWN = 'unknown'            // 알 수 없는 오류
}
```

### RetryPolicy

```typescript
interface RetryPolicy {
  maxRetries: number;       // 최대 재시도 횟수 (기본: 3)
  baseDelayMs: number;      // 기본 대기 시간 ms (기본: 1000)
  maxDelayMs: number;       // 최대 대기 시간 ms (기본: 30000)
  backoffMultiplier: number; // 지수 백오프 승수 (기본: 2)
}

// 기본 정책
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};
```

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `categorizeError` | error: Error | ErrorCategory | 에러 분류 |
| `isRetryable` | category: ErrorCategory | boolean | 재시도 가능 여부 |
| `shouldRetry` | category: ErrorCategory, attempt: number | boolean | 재시도 필요 여부 |
| `getRetryDelay` | attempt: number | number | 재시도 대기 시간 (ms) |
| `handleError` | error: Error, attempt: number | ErrorHandleResult | 에러 처리 결과 |
| `getPolicy` | - | RetryPolicy | 현재 정책 조회 |

### ErrorHandleResult

```typescript
interface ErrorHandleResult {
  category: ErrorCategory;   // 에러 분류
  isRetryable: boolean;      // 재시도 가능 여부
  shouldRetry: boolean;      // 재시도 권장 여부
  retryDelay: number;        // 권장 대기 시간 (ms)
  message: string;           // 사용자 친화적 메시지
}
```

### 재시도 가능한 에러 카테고리

| 카테고리 | 재시도 | 설명 |
|----------|--------|------|
| NETWORK | O | 일시적 네트워크 오류 |
| SERVER | O | 서버 과부하/일시 장애 |
| CLIENT | X | 잘못된 요청 (4xx) |
| VALIDATION | X | 체크섬 불일치 |
| FILESYSTEM | X | 디스크 오류 |
| UNKNOWN | X | 알 수 없는 오류 |

### 팩토리 함수

```typescript
import { createErrorHandler } from './core/download-error-handler';

const handler = createErrorHandler({
  maxRetries: 5,
  baseDelayMs: 2000,
  backoffMultiplier: 1.5
});
```

### 사용 예시

```typescript
import { createErrorHandler, ErrorCategory } from './core/download-error-handler';

const handler = createErrorHandler();

async function downloadWithRetry(url: string, destPath: string) {
  let attempt = 0;

  while (attempt < handler.getPolicy().maxRetries) {
    try {
      await downloadFile(url, destPath);
      return; // 성공
    } catch (error) {
      attempt++;
      const result = handler.handleError(error as Error, attempt);

      console.log(`오류: ${result.message}`);
      console.log(`카테고리: ${result.category}`);

      if (!result.shouldRetry) {
        throw error;
      }

      console.log(`${result.retryDelay}ms 후 재시도... (${attempt}/${handler.getPolicy().maxRetries})`);
      await sleep(result.retryDelay);
    }
  }

  throw new Error('최대 재시도 횟수 초과');
}
```

### 지수 백오프

```typescript
// 재시도 대기 시간 계산 (지수 백오프 + 지터)
getRetryDelay(attempt: number): number {
  const delay = this.policy.baseDelayMs * Math.pow(this.policy.backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.3 * delay; // 30% 지터
  return Math.min(delay + jitter, this.policy.maxDelayMs);
}

// 예시 (기본 정책):
// 1회차: 1000ms + jitter
// 2회차: 2000ms + jitter
// 3회차: 4000ms + jitter (최대 30000ms)
```

---

## 관련 문서
- [DownloadManager](./download-manager.md)
- [공유 유틸리티](./shared-utilities.md)
