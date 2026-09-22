# 검색 오류와 재시도

패키지 검색 실패를 정상적인 결과 0건과 구분합니다. 위자드에서 두 글자 이상 입력하면 300ms 뒤 자동 검색하고, Enter로 즉시 검색할 수 있습니다.

- **검색 결과 없음**: 요청이 정상 완료됐지만 후보가 없을 때 표시합니다.
- **패키지 검색 실패**: 검색창 아래에 오류 원인과 **다시 시도** 버튼을 표시합니다. 입력을 바꾸면 이전 오류는 지워지며 알림이 쌓이지 않습니다.
- **버전 목록 조회 실패**: 선택 화면에 경고와 재시도 버튼을 표시합니다. 검색 결과에 이미 포함된 버전은 계속 선택할 수 있지만 ‘최신’이라고 표시하지 않습니다. 재시도가 성공하면 경고를 지우고 조회한 목록을 사용합니다. Maven은 버전 목록 실패와 별개로 네이티브 classifier 정보를 조회하므로 대체 버전을 사용할 때도 classifier를 선택할 수 있습니다.

인증서 오류에는 **CA 설정 열기** 링크를 제공합니다. 회사 IT에서 제공한 CA를 [추가 루트 CA 설정](root-ca.md)에 등록한 뒤 앱을 완전히 종료하고 다시 실행하세요. 다른 오류는 연결 상태를 확인하고 다시 시도하며, 반복되면 `~/.depssmuggler/logs/`의 `Search error for ...` 또는 `Version fetch error for ...` 기록을 확인합니다.

## 오류 전달 계약

Electron의 `search:packages`와 `search:versions`는 성공 시 각각 `{ results }`, `{ versions }`를 반환합니다. 실패 시 빈 배열과 **명시적인 `error` 필드**를 함께 반환합니다. 기존 배열 필드는 유지하지만 소비자는 반드시 `error`를 먼저 확인해야 합니다.

```ts
interface QueryFailure {
  code: 'TLS_CERTIFICATE' | 'TIMEOUT' | 'HTTP' | 'NETWORK'
    | 'INVALID_RESPONSE' | 'UNAVAILABLE' | 'UNKNOWN';
  message: string;
  status?: number; // HTTP 400~599
}
```

`src/utils/query-error.ts`는 오류 코드·원인 체인을 분류해 안전한 한국어 안내로 바꿉니다. 원본 URL·인증 정보·스택은 UI 메시지에 포함하지 않습니다. `renderer-data-client.ts`는 IPC 실패를 `QueryRequestError`로 전달하며 HTTP 재조회로 숨기지 않습니다. 기존 `search:suggest` 채널은 문자열 목록 계약을 유지하고, 실제 위자드의 자동 검색은 `search:packages`를 사용합니다.

브라우저 HTTP 경로도 4xx/5xx, 연결 실패, 잘못된 JSON/응답 구조를 오류로 전달합니다. 요청과 본문 읽기는 15초 제한으로 중단합니다. Vite 개발 화면의 `/api/maven/*` 등에는 별도 백엔드가 없으므로 HTML이 반환되면 응답 형식 오류로 표시합니다. 이 변경은 HTTP 백엔드나 프록시를 추가하지 않습니다. OS 검색은 Electron IPC가 없으면 사용 불가 안내를 표시합니다.

PyPI의 Electron 정확 이름 조회에서 404는 해당 패키지 부재이므로 정상 0건입니다. 단, 캐시의 접두어 후보 조회가 모두 네트워크 오류 등으로 실패했다면 뒤의 정확 조회 404로 그 실패를 숨기지 않습니다. Maven metadata가 XML이 아닌 응답을 반환하면 기존 보조 API를 사용하고, 두 경로가 모두 실패하면 버전 오류를 전달합니다.

## 화면 상태와 검증

검색·버전 조회는 요청 순번과 검색 환경으로 최신 응답만 반영합니다. 새 입력, 초기화, 패키지 타입/채널/인덱스/배포판 변경, 화면 종료 이후 도착한 응답은 무시합니다. Enter·재시도는 대기 중인 자동 검색을 취소하고 한 번만 실행합니다. 입력창의 지연된 blur 타이머도 재시도 시 취소해 빠르게 반환된 후보가 뒤늦게 닫히지 않도록 합니다.

```bash
bash scripts/verify-worktree.sh src/utils/query-error.test.ts \
  src/renderer/lib/query-failure.test.ts electron/search-handlers.test.ts \
  electron/services/search-orchestrator.test.ts src/renderer/pages/wizard-page
npm run test:e2e -- tests/e2e/search-errors.spec.ts
```

단위 테스트는 오류 분류, IPC 실제 핸들러→facade 전달, HTTP 실패/타임아웃, 요청 순서 역전과 버전 대체 목록을 검증합니다. Playwright는 실제 위자드 입력→자동 검색→오류 안내→재시도와 버전 복구를 검사하며 Electron API와 외부 HTTP는 대체합니다. 실제 회사망의 CA/방화벽 상태를 검증하는 테스트는 아닙니다.
