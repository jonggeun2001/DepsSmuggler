# Python/CUDA 버전 조회 공유

`fetchPythonVersions()`와 `fetchCudaVersions()`는 종류별 진행 중 Promise를 공유합니다. `registerVersionHandlers()`의 시작 조회, `preloadAllVersions()` 및 첫 응답 전 `versions:python`/`versions:cuda` IPC가 겹쳐도 같은 fetcher 작업을 기다립니다. CUDA의 비동기 파일 캐시 읽기부터 공유하므로 파일 읽기 중 들어온 호출도 새 네트워크 작업을 시작하지 않습니다.

두 함수는 인수가 없고 종류별 같은 endpoint를 사용합니다. 공유 범위는 같은 프로세스의 모듈 인스턴스이며, 서로 다른 프로세스나 Python/CUDA 사이의 공유가 아닙니다. 정상 응답, fallback resolve, 예상 밖 reject 모두 `finally`에서 pending을 해제합니다.

## 유지하는 캐시와 실패 정책

- Python 24시간, CUDA 7일 TTL과 기존 메모리·저장 캐시 규칙을 유지합니다. 성공 후 후속 호출은 기존 캐시에 적중하며 TTL이 지나면 새 요청을 공유합니다.
- 네트워크 실패 시 만료 캐시를 먼저 사용하고 없으면 하드코딩 목록으로 resolve합니다. 이 fallback을 fetcher의 새 성공 캐시로 저장하지 않으므로 후속 직접 호출은 기존 규칙에 따라 다시 조회할 수 있습니다.
- handler는 IPC 세션 캐시, preloader는 상태 집계와 자체 캐시 역할을 유지합니다. fallback으로 resolve해도 preloader 상태는 기존대로 success이며 원격 조회 성공을 뜻하지 않습니다.
- handler는 fallback 목록도 세션 캐시에 보관합니다. 이후 네트워크가 회복되어 fetcher 직접 호출이 새 목록을 얻어도 IPC는 기존 fallback을 반환할 수 있습니다. 이번 변경은 IPC fallback 자동 회복을 도입하지 않습니다.
- 새 취소 API/AbortSignal, 상위 서비스 통합, Java/Node 조회 정책, cache 관리 IPC 범위 변경은 없습니다.

## 검증과 재현

```bash
bash scripts/verify-worktree.sh electron/version-startup-sharing.integration.test.ts electron/version-handlers.test.ts src/core/shared/version-fetcher.test.ts src/core/shared/version-preloader.test.ts
node scripts/profile-version-preload.mjs 9559d52
```

통합 테스트는 실제 handler 등록·preloader·fetcher와 임시 디렉터리의 파일 캐시를 사용합니다. Electron IPC 등록, logger, HTTP transport와 홈 경로를 경계에서 대체하고, 응답을 보류해 두 시작 경로와 조기 IPC를 겹칩니다. 동일 종류의 Promise/transport 공유, 성공 목록·완료 캐시·TTL 만료·유효 파일 캐시 읽기 1회를 확인합니다.

실제처럼 fallback으로 resolve하는 하드코딩/만료 캐시 사례에서 후속 fetcher 조회가 회복되고 IPC 세션 정책은 그대로인지 검사합니다. logger 경계의 예외로 reject 경로도 유도해 후속 호출이 이전 실패 Promise에 묶이지 않는지 확인합니다. 기존 fetcher/preloader/handler 테스트도 함께 실행합니다.

재현 스크립트는 production 소스를 메모리에서 로드하고 같은 세 경로를 기준 커밋과 변경본의 새 프로세스에서 실행합니다. 외부 요청은 보내지 않고 transport Promise를 보류하며, Python/CUDA 응답을 완료한 뒤 목록·상태·warm cache 요청 횟수를 확인합니다. 앱 빌드·설치는 필요하지 않습니다.

2026-09-28, macOS 26.3 / Apple M4 arm64 / Electron 44.3.0 내 Node 24.20.0:

| 시점 | 기준 `9559d52` Python / CUDA | 변경본 Python / CUDA |
|---|---:|---:|
| 두 시작 경로, 응답 보류 | 2 / 2 | 1 / 1 |
| 조기 IPC 추가, 응답 보류 | 3 / 3 | 1 / 1 |
| 완료 후 재호출, 누적 횟수 | 3 / 3 | 1 / 1 |

양쪽 모두 같은 fixture 목록(Python `3.14`, CUDA `13.0`)과 success 상태를 반환합니다. 이 값은 테스트 응답이며 최신 버전 목록이라는 뜻이 아닙니다. 측정 대상은 겹치는 cold 요청 수이며 실제 외부 서비스 부하·지연·앱 전체 CPU를 측정한 값이 아닙니다. 첫 요청이 빨리 끝나거나 유효 캐시가 있으면 기존 코드에서도 항상 중복 요청이 발생하는 것은 아닙니다.
