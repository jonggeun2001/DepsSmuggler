# UI 테스트 후속 수정 프롬프트 (2026-04-14)

## 목적

`docs/ui-testing-findings-2026-04-14.md`에서 확인된 수정 필요 사항을 다음 구현 세션에서 바로 사용할 수 있도록 실행 프롬프트와 병렬 작업 분해 형태로 정리합니다.

## 실행용 프롬프트

```text
$worktree-flow UI 테스트 후속 수정 작업을 진행해라.

배경:
- 기준 문서: docs/ui-testing-findings-2026-04-14.md
- 수정 대상 finding: F-01, F-02, F-03, F-04
- 기존 동작과 store contract는 유지해라.

필수 수정:
1. Download 시작 전 화면에서 현재 출력 형식(zip / tar.gz)을 명시적으로 보여줘라.
2. 이메일 전달 선택 시 현재 수신자뿐 아니라 파일 분할 활성화 여부와 maxFileSize 기준을 사용자에게 보여줘라.
3. Settings 캐시 화면에서 cache.getStats().details 기반의 타입별 상세 통계를 보여줘라.
4. Playwright shared mock에 slow / fail / cancel 재현 모드를 추가하고, 다운로드 취소 및 재시도 회귀 테스트를 만들어라.

수정 범위:
- src/renderer/pages/download-page/components/DownloadStandardView.tsx
- 필요시 src/renderer/pages/download-page/hooks/use-download-page-controller.tsx
- src/renderer/pages/settings/CacheSettingsSection.tsx
- 필요시 src/renderer/pages/settings/use-settings-form-actions.ts
- tests/e2e/fixtures/mock-electron-app.ts
- tests/e2e/*.spec.ts
- 관련 문서

요구사항:
- Download preflight UI는 시작 전에도 사용자가 출력 형식과 전달 관련 제약을 읽을 수 있어야 한다.
- 이메일 전달 안내는 설정값을 그대로 요약해야 하며, 분할 비활성 상태도 명확히 드러내야 한다.
- 캐시 상세 통계는 최소한 pip / npm / maven / conda 수준으로 breakdown을 보여줘라.
- cancel / retry 테스트는 deterministic 해야 하며, flaky sleep 의존을 최소화해라.
- 생성한 테스트 자산과 문서를 현재 구현 수준에 맞게 동기화해라.

검증:
- npm run test:e2e -- tests/e2e/settings-regression.spec.ts tests/e2e/download-smoke.spec.ts tests/e2e/history-email-restore.spec.ts tests/e2e/os-package-download.spec.ts
- 추가한 download cancel/retry Playwright spec
- git diff --check
```

## 병렬도

```text
[Start]
   |
   +--> [A] Download preflight UI 보강
   |        - 출력 형식 표시
   |        - 이메일 전달 안내에 분할/크기 요약 추가
   |        - 주요 파일:
   |          src/renderer/pages/download-page/components/DownloadStandardView.tsx
   |          src/renderer/pages/download-page/hooks/use-download-page-controller.tsx
   |
   +--> [B] Cache 상세 통계 UI 보강
   |        - details breakdown 표시
   |        - 주요 파일:
   |          src/renderer/pages/settings/CacheSettingsSection.tsx
   |          src/renderer/pages/settings/use-settings-form-actions.ts
   |
   +--> [C] Download cancel/retry 테스트 자산 추가
            - shared mock에 slow/fail/cancel 모드 추가
            - 전용 Playwright spec 추가
            - 주요 파일:
              tests/e2e/fixtures/mock-electron-app.ts
              tests/e2e/download-cancel-retry.spec.ts

[A] -----+
         |
[B] -----+--> [D] 문서 동기화 + 전체 검증
         |
[C] -----+

병렬 실행 권장:
- A, B, C는 동시에 진행 가능
- D는 A/B/C 완료 후 수행
```

## 작업 단위 메모

### A. Download preflight UI

- finding: `F-01`, `F-02`
- 완료 기준:
  - `/download` 시작 화면에서 현재 출력 형식이 보임
  - `deliveryMethod === 'email'`일 때 현재 수신자, 파일 분할 여부, 최대 첨부 기준이 보임
  - `deliveryMethod === 'local'`일 때 이메일 관련 안내가 숨겨짐

### B. Cache 상세 통계 UI

- finding: `F-03`
- 완료 기준:
  - 총합 외에 타입별 통계가 렌더링됨
  - stats details가 비어 있을 때도 UI가 깨지지 않음
  - 캐시 삭제 후 총합 및 breakdown이 함께 갱신됨

### C. Cancel / Retry 회귀 테스트

- finding: `F-04`
- 완료 기준:
  - 느린 다운로드 상태에서 취소 버튼과 취소 후 상태 전이를 검증 가능
  - 실패 상태를 deterministic하게 만들고 재시도 버튼 동작을 검증 가능
  - overwrite 확인 대기 중 늦게 도착한 취소 completion과 전체 재시작의 delayed start failure가 이전 outcome을 덮어쓰지 않음
  - 테스트가 CI에서 안정적으로 반복 실행 가능

## 참고 문서

- `docs/ui-testing-findings-2026-04-14.md`
- `docs/ui-testing-test-cases.md`
- `docs/ui-testing-playwright-conversion.md`
