# UI 테스트 결과 (2026-04-14)

## 범위

- 기준 커밋: `8a9b8cc`
- 기준 문서:
  - `docs/ui-testing-checklist.md`
  - `docs/ui-testing-test-cases.md`
  - `docs/ui-testing-playwright-conversion.md`
- 자동화 실행:
  - `npm run test:e2e -- tests/e2e/settings-regression.spec.ts tests/e2e/download-smoke.spec.ts tests/e2e/history-email-restore.spec.ts tests/e2e/os-package-download.spec.ts`
- 반자동 확인:
  - `npm run dev:vite` 실행 후 Playwright 브라우저 세션에서 Electron mock을 주입해 UI 상태를 점검

## 결과 요약

| ID | 시나리오 | 결과 | 메모 |
| --- | --- | --- | --- |
| UI-WIZ-001 | 홈에서 패키지 타입 선택 후 위저드 진입 | 통과 | `/#/wizard?type=npm`, `/#/wizard?type=yum` 진입 시 타입 전환과 검색 입력 UI 확인 |
| UI-WIZ-002 | 일반 패키지 검색 후 장바구니 추가 | 통과 | npm `react` 검색, 버전 선택, 장바구니 반영 확인 |
| UI-DL-001 | 장바구니에서 일반 다운로드 완료 | 부분 실패 | 기본 경로와 패키지 수는 보이지만 시작 전 화면에서 출력 형식이 노출되지 않음 |
| UI-DL-002 | 전달 방식 전환 | 부분 실패 | 이메일 전달 전환과 수신자 표시는 동작하지만 분할 기준 크기/첨부 제한 안내는 없음 |
| UI-SET-001 | SMTP 설정 저장과 새로고침 복원 | 통과 | 기존 Playwright 회귀 테스트 통과 |
| UI-SET-002 | SMTP 연결 테스트 | 통과 | 빈 host/port에서는 호출 차단, 정상 입력 시 호출 및 성공 상태 확인 |
| UI-HIS-001 | 이메일 히스토리 재다운로드 | 통과 | 기존 Playwright 회귀 테스트 통과 |
| UI-OS-001 | OS 패키지 전용 다운로드 흐름 | 통과 | 기존 Playwright 회귀 테스트 통과 |
| UI-DL-003 | 빈 장바구니 상태에서 다운로드 페이지 진입 | 통과 | 장바구니 비우기 후 빈 상태와 복귀 액션 노출 확인 |
| UI-DL-004 | 다운로드 취소 및 재시도 | 미완료 | 현재 shared mock이 너무 빨리 완료되어 중간 상태를 안정적으로 고정하기 어려움 |
| UI-CFG-001 | 캐시 통계 조회와 캐시 정리 | 부분 실패 | 총 크기/엔트리 수 갱신은 동작하지만 패키지 타입별 상세 통계 UI는 없음 |
| UI-ROUTE-001 | 주요 화면 왕복 이동과 새로고침 | 통과 | `/#/settings` 새로고침 후 라우트와 SMTP 값 유지 확인 |

## 수정 필요 사항

### F-01 다운로드 시작 전 화면에 출력 형식 요약이 없음

- 관련 케이스: `UI-DL-001`
- 실제 결과:
  - `defaultOutputFormat`을 `tar.gz`로 seed해도 `/download` 시작 화면에는 다운로드 폴더와 전달 방식만 보이고 `TAR.GZ` 또는 `ZIP` 표기가 없습니다.
  - 출력 형식은 완료 화면에만 표시됩니다.
- 기대 결과:
  - 테스트 케이스대로 시작 전 화면에서 기본 경로, 출력 형식, 패키지 수를 함께 확인할 수 있어야 합니다.
- 재현 메모:
  - `/download` 진입 후 main 텍스트 검사 시 `hasOutputFormat: false` 확인
- 수정 방향:
  - `DownloadStandardView`에 현재 출력 형식 요약을 추가하거나, 읽기 전용 출력 형식 행을 노출합니다.

### F-02 이메일 전달 안내에 분할 기준 크기와 첨부 제한 정보가 빠져 있음

- 관련 케이스: `UI-DL-002`
- 실제 결과:
  - 이메일 전달 선택 시 다음 정보만 보입니다.
    - `설정 화면의 SMTP 발신자/수신자와 파일 분할 값을 사용합니다.`
    - `현재 수신자: offline@example.com`
  - `25`, `MB`, `첨부 제한` 같은 구체적인 분할 기준/첨부 크기 안내는 표시되지 않습니다.
- 기대 결과:
  - 현재 수신자뿐 아니라 파일 분할 활성화 여부와 `maxFileSize` 기준이 사용자에게 드러나야 합니다.
- 재현 메모:
  - 이메일 전달 선택 후 main 텍스트 검사 시 `hasMaxSizeValue: false`, `hasMB: false`, `hasAttachmentGuide: false`
- 수정 방향:
  - 전달 안내 Alert에 `25MB 초과 시 자동 분할` 같은 요약을 추가하고, 분할 비활성 시에는 해당 사실을 명시합니다.

### F-03 캐시 화면이 타입별 상세 통계를 보여주지 않음

- 관련 케이스: `UI-CFG-001`
- 실제 결과:
  - 캐시 섹션은 `디스크 크기`, `캐시 항목`만 보여주고, `cache.getStats().details`에 해당하는 패키지 타입별 상세 값은 렌더링하지 않습니다.
  - 캐시 삭제 후 총합 수치가 `0 B`, `0개`로 갱신되는 동작 자체는 정상입니다.
- 기대 결과:
  - 테스트 케이스대로 총합과 함께 타입별 상세 값이 표시되거나, 최소한 사용자가 breakdown을 확인할 수 있어야 합니다.
- 재현 메모:
  - mock에서 `details.pip/npm/maven` 값을 seed했지만 화면에는 총합만 노출
- 수정 방향:
  - `CacheSettingsSection`에 package manager별 chip/list/table을 추가해 `details`를 노출하거나, 이 기능이 의도 범위 밖이면 테스트 케이스와 체크리스트를 현재 구현 수준으로 낮춰야 합니다.

### F-04 취소/재시도 시나리오를 안정적으로 검증할 shared mock이 없음

- 관련 케이스: `UI-DL-004`
- 실제 결과:
  - 현재 shared mock은 다운로드를 매우 짧은 시간 안에 완료시키므로, 중간 진행 상태에서 `취소`와 실패 후 `재시도`를 안정적으로 재현하기 어렵습니다.
  - 문서에는 취소/재시도 수동 검증이 포함되어 있지만, 자동화/반자동 재현을 위한 결정적 fixture가 부족합니다.
- 기대 결과:
  - 느린 다운로드, 실패, 취소 상태를 deterministic하게 만들 수 있어야 `UI-DL-004`를 회귀 테스트로 고정할 수 있습니다.
- 수정 방향:
  - `tests/e2e/fixtures/mock-electron-app.ts`에 slow/fail/cancel 모드를 추가하고, `download-cancel-retry.spec.ts` 같은 전용 Playwright 회귀를 만드는 것이 적절합니다.
- 후속 반영:
  - `tests/e2e/fixtures/mock-electron-app.ts`에 `downloadScenario` 기반 `slow`/`fail-once`/cancel 제어와 취소 후 늦은 완료 이벤트 재현 옵션을 추가했습니다.
  - `tests/e2e/download-cancel-retry.spec.ts`에서 느린 다운로드 취소 유지와 실패 후 개별 재시도 성공 경로를 Playwright 회귀로 고정했습니다.
  - `use-download-page-controller.tsx`와 Electron download event payload에 `sessionId` 경계를 추가해 취소 이후 stale progress/status/completion 이벤트가 새 세션에 섞이지 않도록 보강했습니다.

## 관찰 메모

- 브라우저 세션 콘솔에서 다음 저우선순위 이슈가 반복 확인되었습니다.
  - Ant Design `Space`의 deprecated `direction` prop 경고
  - `/favicon.ico` 404
- 이번 문서는 UI 흐름과 테스트 자산 정렬에 집중하므로 별도 수정 항목으로 승격하지는 않았습니다.

## 후속 작업 문서

- 바로 다음 구현 세션에 넣을 실행 프롬프트와 병렬 작업 분해도는 `docs/ui-testing-fix-prompt-2026-04-14.md`에 정리했습니다.
