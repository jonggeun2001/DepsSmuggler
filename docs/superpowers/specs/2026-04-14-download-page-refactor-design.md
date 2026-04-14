# DownloadPage Refactor Design

## 배경

`src/renderer/pages/DownloadPage.tsx`가 일반 다운로드 상태 머신, 전달 옵션 조립, OS 전용 흐름, 완료 후 처리, 결과/로그 렌더링까지 한 파일에 모두 담고 있다. 이 구조는 변경 시 회귀 범위를 넓히고, 기능 추가 시 페이지 파일이 계속 비대해지는 문제를 만든다.

## 목표

- `DownloadPage` 본체를 라우팅과 화면 분기 중심 orchestration 수준으로 줄인다.
- 기존 store contract와 IPC contract는 유지한다.
- 다음 책임을 별도 파일로 분리한다.
  - 일반 다운로드 상태 머신 및 이벤트 바인딩
  - 전달 옵션 조립
  - OS 전용 흐름
  - 완료/실패 결과 표시용 계산
- 분리된 순수 로직에 회귀 테스트를 추가한다.

## 설계

### 구조

- `src/renderer/pages/download-page/types.ts`
  - DownloadPage 내부 전용 타입 정의
- `src/renderer/pages/download-page/utils.ts`
  - pending item 생성, OS cart snapshot 파생, 크기/그룹 상태 계산 같은 순수 유틸
- `src/renderer/pages/download-page/view-state.ts`
  - 페이지 모드와 완료/진행 카운트 계산
- `src/renderer/pages/download-page/hooks/use-download-page-controller.tsx`
  - 일반 다운로드 상태 머신, IPC 이벤트 구독, 완료 후 히스토리 저장
- `src/renderer/pages/download-page/hooks/use-os-download-flow.ts`
  - OS 전용 분기, 배포판 로드, OS 다운로드 시작/취소/결과 저장
- `src/renderer/pages/download-page/components/*.tsx`
  - 로그 카드, 결과 화면, 진행/목록 카드, OS 전용 화면

### 테스트

- `download-delivery-utils.test.ts`는 일반 다운로드 요청 옵션 조립 회귀를 검증한다.
- `download-page/view-state.test.ts`는 화면 모드 판정과 카운트/복구 가능 산출물 판정을 검증한다.
- `download-page/utils.test.ts`는 pending item 생성과 그룹 상태 계산을 검증한다.

### 제약

- `useDownloadStore`, `useCartStore`, `useSettingsStore`, `useHistoryStore`의 API는 변경하지 않는다.
- `window.electronAPI.download.*`, `window.electronAPI.os.download.*` 호출 shape는 유지한다.
- 기능 변경이 아닌 구조 분리가 목적이므로 결과 화면 문구와 성공/실패 처리 기준은 그대로 유지한다.
