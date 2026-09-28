# GUI OS 다운로드 동시 실행

## 설정과 실행

`os:download:start`의 `concurrency`를 `os-download-pool.ts`의 실행 슬롯 수에 적용합니다. 기본값은 3이고 대기 패키지가 충분하면 설정한 수만큼 `BaseOSDownloader.downloadPackage()`를 동시에 실행합니다. 각 작업은 #184의 파일 스트리밍과 backpressure를 사용합니다. 비정상적인 내부 입력은 3으로 대체하고, 1 이상의 소수 입력은 내림합니다. UI 설정은 양의 정수를 사용합니다.

성공·실패·건너뛰기 결과는 완료 순서와 관계없이 입력 순서로 모읍니다. 개별 실패/건너뛰기는 다음 작업을 막지 않습니다. 성공한 파일만 패키징하며 패키징은 모든 슬롯 종료 후 시작합니다. 동일 파일명이 병렬로 처리되어도 서로의 파일을 덮어쓰거나 지우지 않도록 슬롯별 임시 하위 폴더를 사용합니다. 최종 아카이브/저장소 구조는 바뀌지 않습니다.

저수준 `BaseOSDownloader.downloadPackages()`와 CLI 동시성 구현은 이번 변경 대상이 아닙니다. GUI의 skipped/cancelled 결과와 정리 수명을 보존하는 전용 pool을 사용합니다.

## 오류 선택과 취소

- 자동 재시도와 검증은 기존 단일 패키지 downloader가 담당합니다. 재시도 횟수가 끝난 오류 창은 **세션당 하나씩** 표시합니다. 이름·버전·아키텍처를 표시하고 해당 패키지의 선택 Promise에 응답을 연결합니다.
- 재시도는 같은 작업을 다시 실행하고, 건너뛰기는 해당 항목을 skip으로 기록합니다. 나머지 슬롯의 성공·실패 기록을 섞지 않습니다.
- 취소 선택이나 `os:download:cancel`은 공유 AbortController로 모든 전송을 중단합니다. 열린 오류 창에도 signal을 전달하고 대기 중인 오류 창은 생략합니다. 선택 창 자체가 실패하면 원래 예외를 전달하고 다음 창을 열지 않습니다.
- 취소·세션 종료 예외 후에는 새 패키지를 시작하지 않으며, 이미 실행된 모든 작업의 Promise와 스트림 정리가 끝난 뒤 staging을 삭제합니다. 종료한 패키지/세션에서 늦게 도착한 진행 콜백은 무시합니다.
- 취소 전에 성공한 임시 파일도 최종 출력으로 승격하지 않고 정리합니다. 기존처럼 성공 목록을 비우고 정리 개수를 경고하며, 진행 중/미시작 항목은 skipped, 이미 기록한 실패/skip은 그대로 유지합니다.
- 동일 서비스의 중복 시작은 거부합니다. staging 정리까지 현재 세션이 유지되며 초기화·생성·정리 실패 이후에는 세션을 해제하여 명시적으로 다시 시도할 수 있습니다.

## 진행률 계약

`OSDownloadProgress`의 기존 필드를 유지하고 `completedPackages`, `activePackages`를 선택적으로 추가합니다.

| 필드/화면 | GUI 병렬 다운로드 의미 |
|-----------|------------------------|
| `completedPackages` / 전체 퍼센트 | 성공·실패·건너뛰기를 포함한 처리 완료 수 / 전체 패키지 수 |
| `activePackages` | 실행 슬롯을 사용 중인 수. 재시도/오류 선택 대기도 포함 |
| `currentPackage` / 현재 표시 패키지 | 입력 순서상 가장 앞선 활성 패키지. 다른 슬롯의 청크마다 이름을 바꾸지 않음 |
| `bytesDownloaded`, `totalBytes`, `speed` | 현재 표시 패키지의 바이트와 속도. 여러 파일의 합계가 아님 |
| `currentIndex` | 호환용 표시 인덱스. 새 UI는 완료 수가 있으면 그 값을 우선 사용 |

모든 다운로드 처리가 끝나면 완료 수는 전체 수가 되고 활성 수는 0입니다. 파일 생성은 기존 packaging 단계/`PackagingDetails`로 따로 표시합니다. 추가 필드가 없는 기존 이벤트는 이전 계산 방식을 사용합니다. 집계된 바이트 payload는 [150ms 간격으로 병합](os-progress-performance.md)하며 표시 패키지·단계·처리/활성 수 변경과 완료는 즉시 전달합니다. 취소 시 예약된 전송은 제거합니다.

## 검증과 한계

```bash
bash scripts/verify-worktree.sh \
  electron/services/os-download-concurrency.integration.test.ts \
  electron/services/os-download-orchestrator.test.ts \
  electron/services/os-package-router.test.ts \
  src/core/downloaders/os-shared/base-downloader.test.ts \
  src/core/downloaders/os-shared/base-downloader-stream.integration.test.ts \
  src/renderer/components/PackagingProgressView.test.tsx \
  src/renderer/pages/download-page/hooks/use-os-download-flow.test.ts
```

실제 orchestrator·pool·BaseOSDownloader·Web stream·파일 writer를 연결하고 fetch 응답/패키징/오류 창을 fixture로 대체합니다. 12개 파일이 각각 50ms 뒤 끝나는 입력에서 동시성 1/3/6의 최대 활성 전송이 각각 1/3/6임을 검사합니다. 스트림 취소 완료를 지연시켜 그 전에 staging이 삭제되지 않는지 확인하며, 예상 밖 reject에도 다른 슬롯 종료와 원래 예외 보존을 검증합니다. 같은 파일명 격리, 재시도/skip 응답, 늦은 콜백, 입력 순서, 현재 패키지 표시, 완료 집계도 포함합니다.

이는 외부 인터넷 다운로드 속도나 native Electron 오류 창의 OS별 수동 실행 검증이 아닙니다. 시간 임계값 대신 동시 실행 수·종료 순서·실제 파일 정리로 판정합니다. 스트리밍 메모리 측정은 [OS 스트리밍 성능](os-streaming-performance.md)을 참고하세요.
