# UI Playwright 전환 시나리오

## 목적

수동 UI 테스트 케이스를 Playwright 회귀 세트로 옮길 때 필요한 우선순위, 대상 파일, mock 전략을 정리합니다.

## 현재 자동화된 회귀 범위

| 수동 케이스 | 현재 Playwright 파일 | 검증 포인트 |
| --- | --- | --- |
| `UI-DL-001` | `tests/e2e/download-smoke.spec.ts` | 장바구니에서 일반 다운로드 완료 화면까지, 로컬 저장 옵션 전달 |
| `UI-SET-001`, `UI-SET-002` | `tests/e2e/settings-regression.spec.ts` | SMTP 값 입력, 연결 테스트 호출, 저장 후 새로고침 복원 |
| `UI-HIS-001` | `tests/e2e/history-email-restore.spec.ts` | 이메일 히스토리 재다운로드, 저장된 수신자 복원, 전역 설정 보존 |
| `UI-OS-001` | `tests/e2e/os-package-download.spec.ts` | OS 패키지 검색, 전용 다운로드 화면, 출력 옵션 결과 반영 |

현재 회귀 세트는 `tests/e2e/fixtures/mock-electron-app.ts`와 `window.electronAPI` stub을 이용해 preload/IPC를 브라우저 쪽에서 모킹합니다.

## 다음 자동화 우선순위

### 1. `UI-WIZ-001` 홈에서 패키지 타입 진입

- 이유: 라우팅과 초기 store reset 회귀를 가장 빨리 잡을 수 있음
- 권장 파일: `tests/e2e/home-wizard-entry.spec.ts`
- 핵심 assert:
  - 홈에서 타입 카드 클릭 후 `/#/wizard` 이동
  - 선택한 타입에 맞는 제목 또는 단계 표시
  - 타입 전환 시 이전 선택 상태 미노출
- mock 전략:
  - 외부 네트워크 호출 없이 `search` stub만 최소 구성
  - 필요하면 localStorage 초기 상태를 비운 뒤 시작

### 2. `UI-WIZ-002` 일반 패키지 검색 후 장바구니 추가

- 이유: 검색 결과 렌더링과 장바구니 store 연결은 사용자 진입점 회귀 위험이 큼
- 권장 파일: `tests/e2e/wizard-cart-flow.spec.ts`
- 핵심 assert:
  - 검색 결과 노출
  - 버전 선택 가능
  - 장바구니 항목의 이름/버전/타입 일치
- mock 전략:
  - `search.packages`, `search.versions`를 deterministic mock으로 구성
  - 장바구니 상태는 fixture에서 읽어 검증

### 3. `UI-DL-002` 전달 방식 전환

- 이유: 다운로드 페이지 리팩터링 이후 전달 옵션 회귀 가능성이 높음
- 권장 파일: `tests/e2e/download-delivery-options.spec.ts`
- 핵심 assert:
  - `local`과 `email` 전환 시 노출 UI 변화
  - SMTP 수신자, 파일 분할 관련 안내 노출
  - 다운로드 호출 옵션의 `deliveryMethod`와 `email.to` 반영
- mock 전략:
  - `setupMockElectronApp`로 SMTP 기본 설정 주입
  - `runtime.downloadCalls`를 읽어 호출 payload 검증

## 수동 우선 유지 대상

다음 항목은 자동화 가능하더라도 플랫폼 특성 또는 비용 때문에 수동 확인 비중을 더 크게 둡니다.

| 수동 케이스 | 수동 우선 이유 |
| --- | --- |
| `UI-DL-004` | 취소/실패 재현이 mock만으로는 실제 체감과 차이가 날 수 있음 |
| `UI-CFG-001` | 캐시 크기와 정리 결과는 로컬 파일 상태에 따라 달라질 수 있음 |
| `UI-CHK-12` | 새로고침, 창 크기 변경, 라우트 왕복은 조합이 많고 탐색적 확인 가치가 큼 |

## Playwright 작성 원칙

- 실제 네트워크 호출 대신 mock preload API를 사용해 결정적 실행을 유지합니다.
- 저장/복원 시나리오는 localStorage 초기 상태와 fixture runtime state 둘 다 검증합니다.
- 다운로드 검증은 UI 제목만 보지 말고 `runtime.downloadCalls` payload까지 확인합니다.
- OS 패키지 시나리오는 일반 다운로드와 별도 파일로 유지해 분기 가독성을 지킵니다.

## 신규 스펙 템플릿

```ts
import { expect, test } from '@playwright/test';
import { readMockElectronAppState, setupMockElectronApp } from './fixtures/mock-electron-app';

test('시나리오 이름', async ({ page }) => {
  await setupMockElectronApp(page, {
    config: {
      defaultDownloadPath: '/tmp/depssmuggler-e2e',
    },
  });

  await page.goto('/#/target-route');

  // 사용자 액션
  // await page.getByRole(...).click();

  // UI assert
  // await expect(page.getByText('...')).toBeVisible();

  const mockState = await readMockElectronAppState(page);
  expect(mockState.runtime).toBeTruthy();
});
```

## 전환 순서 권장안

1. `UI-WIZ-001`을 자동화해 홈 진입과 위저드 초기화 회귀를 먼저 고정합니다.
2. `UI-WIZ-002`로 검색과 장바구니 연결을 커버합니다.
3. `UI-DL-002`로 전달 옵션 분기를 보강합니다.
4. 이후 필요 시 `UI-DL-003`, `UI-DL-004` 중 재현 비용이 낮은 항목만 선택적으로 자동화합니다.
