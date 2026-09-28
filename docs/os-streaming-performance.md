# OS 패키지 다운로드 스트리밍

## 변경 범위

#184의 APT/YUM/APK 공용 `BaseOSDownloader.downloadFile()`을 전체 응답 버퍼링에서 파일 스트리밍으로 변경했다. `Readable.fromWeb()` → 공용 다운로드 gate → 파일 writer를 `pipeline()`으로 연결한다. 파일이 느리게 기록되면 backpressure가 다음 읽기를 제한한다. 전체 청크 배열, 청크별 복사와 마지막 `Buffer.concat`/`writeFileSync`는 사용하지 않는다.

스트림이 닫힌 뒤 주입된 verifier를 호출하고 성공 결과를 반환한다. 네트워크/쓰기 오류·취소 시 pipeline 종료 후 이번 시도에서 연 부분 파일을 삭제한다. 파일 열기 자체가 실패하면 기존 대상 파일/디렉터리를 삭제하지 않는다. 검증 실패 또는 검증 중 취소에서도 완성 파일을 지우며 다음 재시도는 새 파일에서 시작한다. 삭제가 권한·잠금 오류로 실패하면 원래 원인을 `cause`, 정리 실패를 `cleanupError`로 보존하고 기존 재시도·오류 콜백·취소 결과를 유지한다. 이 경우 파일은 남을 수 있으며 상위 staging 정리도 실패를 보고할 수 있다. verifier가 없는 CLI 경로에 검증을 새로 추가하지 않는다.

진행률 callback의 바이트·속도·단계 의미는 유지한다. 청크별 IPC 빈도(#189)는 별도 이슈다. GUI의 동시성 설정 반영(#188)은 [후속 변경](os-download-concurrency.md)에서 다루며 아래 스트리밍 단독 측정과 구분한다. 이번 변경은 공개 API, 저장 형식, UI 옵션을 바꾸지 않는다.

## 재현

기존 의존성이 준비된 저장소에서 다음을 실행한다. 앱 빌드나 외부 네트워크는 필요하지 않다.

```bash
node scripts/profile-os-streaming.mjs 693b151
```

스크립트는 기준 커밋의 `base-downloader.ts`와 현재 파일을 같은 TypeScript·Node 런타임에서 메모리로 변환해 실행한다. 64MiB/256MiB 응답을 64KiB 청크의 실제 Web ReadableStream으로 생성하고 실제 임시 파일에 기록한다. 각 조건은 독립 프로세스에서 실행하며 임시 파일은 종료 시 삭제한다. 다른 모듈과 의존성은 현재 설치본을 공유하므로 기준 커밋과의 전체 앱 비교가 아닌 전송 함수 비교다.

측정 구간은 모듈 로딩과 명시적 GC 이후다. 매 청크·concat·동기 쓰기·1ms 타이머에서 RSS와 external 메모리를 관측하고 파일 크기 및 성공 여부를 확인한다. 새 구현의 동기 쓰기가 0회인지도 검사한다. `external`은 V8의 외부 메모리 계측이며 Electron에서 0으로 보고되는 경우가 있는 `arrayBuffers`와 구분한다.

## 2026-09-28 측정

macOS 26.3 / Apple M4 arm64 / Electron 44.3.0의 Node 24.20.0(`ELECTRON_RUN_AS_NODE=1`), 기준 `693b151`. 각 조건 1회 측정이다.

| 입력   | 구현     | 완료(ms) | CPU(ms) | 최대 타이머 간격(ms) | RSS 증가(MiB) | external 증가(MiB) | 동기 파일 쓰기 |
| ------ | -------- | -------: | ------: | -------------------: | ------------: | -----------------: | -------------: |
| 64MiB  | 기준     |     86.0 |    78.6 |                 37.9 |         198.8 |              193.4 |              1 |
| 64MiB  | 스트리밍 |     39.8 |    59.0 |                 14.6 |          47.5 |               45.7 |              0 |
| 256MiB | 기준     |    278.0 |   233.4 |                179.3 |         778.8 |              769.4 |              1 |
| 256MiB | 스트리밍 |    118.3 |   188.5 |                 15.7 |          75.7 |               71.7 |              0 |

입력이 4배일 때 기존 external 증가량도 약 4배였지만 스트리밍은 약 1.6배였다. GC 이전에 남은 할당과 런타임 버퍼가 포함되므로 RSS/external이 고정 상수라는 뜻은 아니다. 느린 writer의 첫 쓰기를 막는 별도 테스트에서는 4MiB 전체 입력 중 1MiB 미만만 선행 소비하는지 확인한다.

진행 이벤트는 전후 모두 64MiB에서 1,024회, 256MiB에서 4,096회였다. 실제 네트워크, Electron IPC 직렬화, renderer 렌더링, 검증·패키징 비용은 이 수치에 포함하지 않는다. 1ms 계측의 오버헤드와 OS/GC 변동이 있으므로 실제 사용자 평균·전체 앱 CPU·모든 OS의 개선율로 일반화하지 않는다.

## 회귀 검증

```bash
bash scripts/verify-worktree.sh \
  src/core/downloaders/os-shared/base-downloader.test.ts \
  src/core/downloaders/os-shared/base-downloader-stream.integration.test.ts \
  src/core/downloaders/os-shared/cli-backend.test.ts \
  electron/services/os-download-orchestrator.test.ts
```

스트리밍 테스트는 실제 Web stream과 파일 시스템을 사용한다. 느린 writer의 backpressure, 파일 닫힘 후 검증, pending read 중 취소, 응답 오류 후 재시도, writer 오류, 대상 디렉터리 보존, 검증 실패/검증 중 취소, HTTP 오류 응답 취소와 정리 실패 후 재시도/취소 결과 보존을 확인한다. CLI 테스트는 실제 staging 디렉터리를 만들고 실패 결과·예외 후 삭제와 패키징 생략을 확인한다. GUI 서비스 테스트는 downloader 경계를 대체하여 성공/실패/skip·취소·예외 후 staging 정리를 검사한다. 이 테스트들이 전체 배포 앱의 E2E 다운로드나 OS별 파일 권한 차이까지 검증하는 것은 아니다.
