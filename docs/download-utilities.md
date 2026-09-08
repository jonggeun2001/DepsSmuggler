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
| `addSample` | speed: number | boolean | bytes/sec 샘플 추가, 간격 제한으로 생략하면 false |
| `addSampleForced` | speed: number | void | bytes/sec 샘플 강제 추가 (스로틀링 무시) |
| `getCurrentSpeed` | - | number | 현재 속도 (bytes/sec) |
| `getAverageSpeed` | - | number | 평균 속도 (bytes/sec) |
| `getEstimatedTimeRemaining` | remainingBytes: number | number | 예상 남은 시간 (초) |
| `getStats` | remainingBytes?: number | SpeedStats | 속도 통계 객체 |
| `sampleCount` | - | number | 현재 샘플 개수 |
| `getSamples` | - | readonly number[] | 내부 샘플 배열의 읽기 전용 참조 |
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
  estimatedTimeRemaining: number; // 예상 남은 시간 (초)
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
function onProgress(speedBytesPerSecond: number, bytesDownloaded: number, totalBytes: number) {
  calculator.addSample(speedBytesPerSecond);

  const stats = calculator.getStats(totalBytes - bytesDownloaded);
  const remaining = calculator.getEstimatedTimeRemaining(totalBytes - bytesDownloaded);

  console.log(`속도: ${stats.currentSpeed} bytes/sec`);
  console.log(`남은 시간: ${remaining}초`);
}

// 다운로드 완료 후 리셋
calculator.reset();
```

누적 다운로드 바이트를 전달하는 API가 아닙니다. 호출자가 계산한 구간 속도를 샘플로 전달하며, 평균은 보관 중인 최근 샘플의 산술평균입니다. 속도나 남은 바이트가 0 이하이면 남은 시간은 0입니다.

---

## DownloadErrorHandler

### 개요
- 목적: 다운로드 에러 분류 및 재시도 로직 처리
- 위치: `src/core/download-error-handler.ts`

### ErrorCategory

```typescript
type ErrorCategory = 'network' | 'timeout' | 'notFound' | 'serverError' | 'unknown';
```

### RetryPolicy

```typescript
interface RetryPolicy {
  maxRetries: number;       // 최대 재시도 횟수 (기본: 3)
  baseDelayMs: number;      // 기본 대기 시간 ms (기본: 1000)
  maxDelayMs: number;       // 최대 대기 시간 ms (기본: 30000)
  backoffMultiplier: number; // 지수 백오프 승수 (기본: 1.5)
}

// 기본 정책
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5
};
```

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `categorizeError` | error: Error | ErrorCategory | 에러 분류 |
| `isRetryable` | error: Error | boolean | 재시도 가능 여부 |
| `shouldRetry` | currentRetryCount: number, error?: Error | boolean | 재시도 필요 여부 |
| `getRetryDelay` | attempt: number | number | 재시도 대기 시간 (ms) |
| `handleError` | error: Error, currentRetryCount: number | ErrorHandleResult | 에러 처리 결과 |
| `getPolicy` | - | Readonly<RetryPolicy> | 현재 정책 조회 |

### ErrorHandleResult

```typescript
interface ErrorHandleResult {
  action: 'retry' | 'fail' | 'skip'; // 현재 구현의 반환은 retry 또는 fail
  message: string;
  retryAfterMs?: number;           // retry일 때만 존재 (ms)
  retryCount: number;              // 다음 재시도 횟수 또는 최종 횟수
}
```

### 재시도 가능한 에러 카테고리

| 카테고리 | 재시도 | 설명 |
|----------|--------|------|
| network | O | 메시지의 connection/network/ECONNREFUSED/ENOTFOUND |
| timeout | O | timeout/ETIMEDOUT |
| notFound | X | 404/not found/찾을 수 없 |
| serverError | O | 500/502/503 |
| unknown | O | 위 문자열에 해당하지 않는 오류 |

분류는 `Error.message`의 문자열 검사입니다. 일반적인 모든 4xx, 파일시스템 오류, 체크섬 실패를 별도 범주로 판별하지 않습니다. `shouldRetry()`는 현재 재시도 횟수가 한도 미만이고 `notFound`가 아닐 때 true입니다.

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
import { createErrorHandler } from './core/download-error-handler';

const handler = createErrorHandler();

// operation에는 실제 다운로드 함수를 전달한다.
async function downloadWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  let retryCount = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const result = handler.handleError(error as Error, retryCount);
      console.log(result.message);
      if (result.action !== 'retry') throw error;
      retryCount = result.retryCount;
      await new Promise(resolve => setTimeout(resolve, result.retryAfterMs ?? 0));
    }
  }
}
```

### 지수 백오프

```typescript
// 클래스 메서드의 계산을 독립 함수로 표현: 0부터 시작, 지터 없음
function getRetryDelay(attemptNumber: number, policy: RetryPolicy): number {
  const delay = policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attemptNumber);
  return Math.min(delay, policy.maxDelayMs);
}

// 기본 정책: 최초 시도 외 최대 3회 재시도
// retryCount 0: 1000ms
// retryCount 1: 1500ms
// retryCount 2: 2250ms
```

---

## 관련 문서
- [다운로드 아키텍처](./architecture-overview.md)
- [공유 유틸리티](./shared-utilities.md)
