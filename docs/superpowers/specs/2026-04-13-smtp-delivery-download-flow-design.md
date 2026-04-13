# SMTP Delivery Download Flow Design

## 배경

현재 다운로드 플로우는 패키징이 끝나면 로컬 산출물 경로만 반환하고 종료한다. 설정 화면에는 SMTP 서버 정보와 파일 분할 크기 설정이 있지만, SMTP 연결 테스트 IPC는 실제 구현되어 있지 않고 다운로드 완료 후 실제 메일 전달도 수행되지 않는다. 이 때문에 "메일 전달"은 UI와 타입에는 존재하지만 실제 사용자 플로우에는 연결되지 않은 상태다.

## 목표

- 설정 화면에서 SMTP 발신 설정과 수신자 주소를 저장하고, `testSmtpConnection`을 실제 IPC로 연결한다.
- 다운로드 화면에서 전달 방식 `local | email`을 선택할 수 있게 하고, 선택값을 실제 다운로드 완료 흐름에 반영한다.
- 이메일 전달 시 첨부 크기 초과를 감지해 `FileSplitter.splitFile()`로 실제 산출물을 분할한다.
- 완료 이벤트와 히스토리가 실제 전달 산출물 경로와 전달 결과를 반영하도록 정리한다.
- 변경 범위는 Electron preload/main/download handler, 설정/다운로드 화면, mailer/file-splitter, 관련 타입/테스트와 문서로 제한한다.

## 비목표

- SMTP OAuth, 템플릿 편집, 주소록 관리 같은 메일 기능 확장은 이번 범위에 포함하지 않는다.
- 분할 파일 병합 UX를 다운로드 화면에 새로 추가하지 않는다. 기존 splitter가 생성하는 메타데이터/병합 스크립트를 그대로 사용한다.
- 히스토리 재전송 기능은 이번 작업 범위에 포함하지 않는다. 현재 다운로드 세션의 완료 단계만 연결한다.

## 접근 옵션

### 옵션 1. 다운로드 핸들러가 패키징 후 전달까지 오케스트레이션

- `download:start`가 다운로드, 패키징, 전달(local/email)을 순차 수행한다.
- 완료 이벤트는 최종 전달 결과와 실제 산출물 목록을 포함한다.
- 추천한다. 실제 산출물 경로를 알고 있는 메인 프로세스가 파일 분할과 메일 전송까지 이어서 처리하면 상태 정합성이 가장 좋다.

### 옵션 2. 패키징 후 렌더러가 별도 `deliver` IPC 호출

- 메인 프로세스는 패키징까지만 담당하고, 완료 후 렌더러가 전달 방식을 보고 추가 IPC를 호출한다.
- UI가 단계별로 세분화되지만, 완료 이벤트와 히스토리 저장 타이밍이 이중화되고 실패 복구도 복잡해진다.

### 옵션 3. 로컬 저장만 완료하고 히스토리에서 메일 전송

- 구현은 가장 단순하지만 "현재 다운로드 플로우에 연결" 요구를 만족하지 못한다.
- 즉시 전달 UX가 아니므로 제외한다.

## 선택 설계

옵션 1을 채택한다. 다운로드 화면에서 전달 방식을 미리 선택하고, 메인 프로세스의 다운로드 핸들러가 패키징 직후 `local` 또는 `email` 전달을 수행한다.

## 설계

### 1. 설정 모델

- `SettingsState`에 `smtpTo`를 추가한다.
- `SettingsPage`는 발신자(`smtpFrom`)와 별도로 수신자(`smtpTo`)를 입력받는다.
- SMTP 테스트는 현재 폼 값을 그대로 사용한다. 즉 저장 전 임시 값으로도 테스트 가능해야 한다.
- 첨부 제한은 기존 `enableFileSplit`, `maxFileSize`를 그대로 사용한다. 단위는 MB로 유지한다.

### 2. 다운로드 화면 계약

- `DownloadPage`에 전달 방식 상태 `deliveryMethod: 'local' | 'email'`를 추가한다.
- 시작 전에 `deliveryMethod === 'email'`이면 SMTP 필수 항목(`smtpHost`, `smtpPort`, `smtpTo`, 인증 필요 시 `smtpUser`, `smtpPassword`)을 검사한다.
- 다운로드 시작 시 전달 방식과 메일 설정 스냅샷을 함께 넘긴다.
- 완료 화면과 히스토리는 전달 결과를 표시할 수 있어야 하므로 실제 산출물 목록과 전달 방식 정보를 소비한다.

### 3. IPC 계약

- `electron/preload.ts`와 `src/types/electron.d.ts`에 아래 계약을 추가한다.
- `testSmtpConnection(config)`:
  - 입력: `host`, `port`, `user`, `password`, `from`
  - 출력: `{ success: boolean, error?: string }`
- `download:start` options 확장:
  - `deliveryMethod: 'local' | 'email'`
  - `email?: { to: string; from?: string; subject?: string }`
  - `fileSplit?: { enabled: boolean; maxSizeMB: number }`
- `download:all-complete` payload 확장:
  - `outputPath`: 대표 산출물 경로
  - `artifactPaths`: 실제 전달 산출물 경로 목록
  - `deliveryMethod`
  - `deliveryResult?: { emailSent: boolean; emailsSent?: number; splitApplied?: boolean; error?: string }`

### 4. 메인 프로세스 오케스트레이션

- `electron/main.ts`에서 SMTP 테스트 IPC를 등록한다. 구현은 `EmailSender.testConnection()`을 직접 사용한다.
- 전달 오케스트레이션은 별도 핸들러로 분리하지 않고 `electron/download-handlers.ts`에서 수행한다.
- 흐름은 아래 순서를 따른다.
  1. 패키지 다운로드
  2. 필요 시 설치 스크립트 생성
  3. `zip | tar.gz` 패키징
  4. `deliveryMethod === 'local'`이면 종료
  5. `deliveryMethod === 'email'`이면 첨부 가능한 산출물 목록 준비
  6. 필요 시 `splitFile()` 실행
  7. `EmailSender.sendEmail()` 호출
  8. 완료 이벤트 전송

### 5. 이메일 전달 규칙

- 이메일 첨부의 기준 입력은 패키징 산출물 1개다. 즉 `.zip` 또는 `.tar.gz` 파일을 기본 첨부 대상으로 사용한다.
- `enableFileSplit === true`이고 산출물 크기가 `maxFileSize`를 넘으면 `splitFile()`을 호출한다.
- `splitFile()` 결과에서는 아래 파일들을 첨부 대상으로 포함한다.
  - 분할 파트들
  - 메타데이터 JSON
  - 생성된 병합 스크립트들(있으면)
- `EmailSender`는 전달 받은 파일 목록을 그대로 첨부 대상으로 사용한다.
- 분할 후에도 전체 첨부 크기가 한 번에 제한을 넘으면 `EmailSender`의 기존 다중 메일 전송 로직으로 묶음 분할을 수행한다.
- `enableFileSplit === false`이고 산출물 크기가 제한을 넘으면 파일 분할을 수행하지 않고 메일 전달 실패로 처리한다. 사용자는 설정을 켜거나 로컬 전달을 선택해야 한다.

### 6. Mailer 정리

- `EmailSender`는 "메일 묶음 분할"과 "파일 분할"을 명확히 구분해야 한다.
- 파일 분할은 외부에서 수행하고, mailer는 전달 받은 첨부 파일 배열을 메일 단위로 나누는 역할만 맡는다.
- 반환 타입은 최소한 아래 정보를 제공해야 한다.
  - `success`
  - `messageId`
  - `emailsSent`
  - `attachmentsSent`
  - `splitApplied`
  - `error`

### 7. 히스토리/완료 이벤트

- 히스토리에는 기존 `outputPath` 외에 `artifactPaths`, `deliveryMethod`, `deliveryResult`를 저장한다.
- `outputPath`는 대표 경로로 유지한다.
  - 로컬 전달: 아카이브 파일 경로
  - 이메일 전달 + 분할 없음: 아카이브 파일 경로
  - 이메일 전달 + 분할 있음: 첫 번째 분할 산출물 경로
- `HistoryPage`의 기존 "폴더 열기" 동작은 대표 경로 기준으로 유지한다.

## 오류 처리

- SMTP 테스트 실패는 저장과 별개로 즉시 에러 메시지를 반환한다.
- 이메일 전달 선택 시 SMTP 설정이 불완전하면 다운로드 시작 전에 차단한다.
- 패키징 성공 후 메일 전달이 실패하면 전체 작업은 실패로 간주한다.
  - 이유: 사용자가 선택한 전달 방식이 완료되지 않았기 때문이다.
  - 단, 로컬 아카이브 자체는 이미 생성되어 있으므로 `artifactPaths`와 `outputPath`는 반환해 사용자가 수동 복구할 수 있게 한다.
- 분할 도중 실패하면 메일 전송을 시도하지 않는다.

## 테스트 전략

### 우선 실패시킬 테스트

- `electron/download-handlers.test.ts`
  - `deliveryMethod=local`이면 기존처럼 메일러/분할기를 호출하지 않는다.
  - `deliveryMethod=email`이면 SMTP 설정으로 메일러를 초기화하고 발송한다.
  - 파일 크기 초과 + 파일 분할 활성화 시 `splitFile()`이 호출되고 분할 산출물이 완료 이벤트에 반영된다.
  - 파일 크기 초과 + 파일 분할 비활성화 시 실패 이벤트를 보낸다.
- `src/core/mailer/email-sender.test.ts`
  - `testConnection()`의 성공/실패 결과를 IPC 소비에 맞는 구조로 유지한다.
  - 전달된 첨부 파일 목록 기준으로 `attachmentsSent`, `splitApplied`, `emailsSent`가 반환된다.
- `src/core/packager/file-splitter.test.ts`
  - 분할 결과가 대표 파일 외 메타데이터/병합 스크립트까지 소비 가능하도록 검증한다.

### 검증

- 저장소 표준 테스트 엔트리(`scripts/verify-worktree.sh`)로 전체 단위 테스트를 실행한다.
- 로컬 의존성이 없으면 CI 결과를 최종 근거로 사용한다.

## 문서 영향

- `docs/ipc-handlers.md`
- `docs/electron-renderer.md`
- `docs/download-history.md`
- `docs/packagers.md`
- 필요 시 설정 화면/메일 전달 관련 운영 문서
