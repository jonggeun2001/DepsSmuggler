# 테스트

## 개요

이 저장소는 Vitest 기반 단위/통합 테스트와 Playwright 기반 기본 E2E 회귀 세트를 함께 운용합니다. CI는 GitHub Actions에서 테스트·빌드·CLI 스모크, 린트, 타입 체크, Playwright E2E, 커버리지를 별도 잡으로 실행합니다.

## 로컬 검증 명령

`package.json`에는 프로젝트 자체 `engines`가 없습니다. 현재 lockfile의 개발 도구 조건은 Vite `^20.19.0 || >=22.12.0`, jsdom `^20.19.0 || ^22.13.0 || >=24.0.0`, Vitest `^20.0.0 || ^22.0.0 || >=24.0.0`입니다. 패키징 도구의 `@electron/rebuild`와 `node-abi`는 `>=22.12.0`을 요구하므로 전체 도구 조건을 맞추려면 Node 22.13 이상인 22.x 또는 24 이상을 사용합니다. CI는 여전히 `actions/setup-node`의 Node `20`을 사용하며, 이는 패키징 도구의 선언된 최소 버전과 차이가 있습니다.

```bash
# 표준 worktree 검증 진입점
bash scripts/ensure_verify_worktree.sh "$PWD"
bash scripts/verify-worktree.sh

# 단위 테스트
npm run test

# 통합 테스트 포함
INTEGRATION_TEST=true npm run test

# 커버리지
npm run test:coverage

# 린트/타입 체크
npm run lint
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.electron.json

# 보안/의존성 점검
npm audit
```

`scripts/verify-worktree.sh`는 현재 저장소의 `scripts.test` 계약을 그대로 호출하는 얇은 래퍼이며, worktree에서 공통 검증 진입점으로 사용합니다. 현재 자동 생성 범위는 `test`만 포함하고 `lint`/`typecheck`는 별도 명령으로 유지합니다.

CLI 버전 회귀 테스트(`src/cli/version.integration.test.ts`)는 실제 하위 프로세스를 사용해 `npm run cli -- --version`과 `-v`, 빌드 후 `dist/src/cli/index.js`, 그리고 `dist/package.json`에 버전이 없는 설치 레이아웃을 확인합니다. 모든 진입점은 루트 `package.json`의 버전을 출력해야 하며, 테스트가 임시 빌드 산출물을 생성하므로 저장소의 추적 파일은 변경하지 않습니다.

`INTEGRATION_TEST=true` 표기는 POSIX shell 예시입니다. PowerShell에서는 `$env:INTEGRATION_TEST='true'`를 지정한 뒤 `npm run test`를 실행합니다. 이 환경 변수는 외부 저장소 호출을 활성화하므로 기본 mock 테스트 실행과 구분합니다.

두 TypeScript 설정 모두 `noUnusedLocals`와 `noUnusedParameters`를 활성화합니다. 죽은 코드·미사용 인수 정리 후 재유입을 검사하며, 외부 호출 규약을 유지할 인수에는 `_` 접두어를 붙입니다. `retry-utils.test.ts`는 `unknown` 오류 처리에서도 HTTP 상태 코드·타임아웃 판정과 비정형 값의 기존 결과가 유지되는지 확인합니다.

보안/의존성 유지보수 작업에서는 `npm audit`와 함께 `npm test`, `npm run test:e2e`, `npx tsc --noEmit`를 묶어 확인합니다. direct dependency를 올린 뒤 transitive 취약점이 남으면, 가능한 한 patch/minor 범위에서 lockfile 재해결이나 `overrides`로 먼저 정리합니다.

## 테스트 종류

### 1. 단위 테스트

- 설정 파일: `vitest.config.ts`
- 기본 include: `src/**/*.test.ts`, `src/**/*.test.tsx`, `electron/**/*.test.ts`, `tests/unit/**/*.test.ts`, `tests/unit/**/*.test.tsx`
- 기본 exclude: `node_modules`, `dist`, `tests/e2e/**`
- 기본 실행 환경: `node`

테스트 timeout과 hook timeout은 각각 30초이며 `forks` pool을 사용합니다. `tests/unit`은 include 패턴으로 예약되어 있지만 현재 테스트 파일은 주로 구현 옆의 `src/`와 `electron/`에 있습니다.

렌더러 훅처럼 DOM이 필요한 일부 테스트는 파일 상단 `// @vitest-environment jsdom` 주석으로 개별 override 합니다. 다운로드 페이지 controller, `use-os-download-flow`, `use-settings-form-actions` 테스트가 이 방식을 사용합니다. Electron preload API와 외부 경계는 mock하고 실제 React 훅의 상태 전이와 정리 동작을 검증합니다. 실행에는 `package.json`에 선언된 `jsdom`과 `@testing-library/react`가 필요하며, 일부 의존성이 빠진 기존 `node_modules`를 재사용한 결과를 전체 테스트 통과로 간주하지 않습니다.

대상 예시:

- downloader / resolver 로직
- packager / cache / config / shared 유틸리티
- Electron `services/` 오케스트레이션과 package router/helper
- 네트워크 호출을 모킹한 내부 동작
- renderer form 계약 유틸리티 (`src/renderer/pages/settings/settings-form-utils.test.ts`)
- renderer store / hook 오케스트레이션 (`cart-store`, `download-store`, `settings-store`, `use-download-page-controller`)

Phase 1 characterization 범위에서 특히 회귀 게이트로 삼는 테스트는 다음과 같습니다.

- `src/core/resolver/pip-resolver.characterization.test.ts`
  - simple / extras / conflicts / markers / wheel-tags 5개 fixture를 JSON snapshot으로 고정
- `electron/services/download-orchestrator.test.ts`
  - 패키지 매니저별 happy path 매핑, 취소 경계, concurrency limiter, 진행률 이벤트 순서를 고정
- `src/renderer/stores/cart-store.test.ts`
- `src/renderer/stores/download-store.test.ts`
- `src/renderer/stores/settings-store.test.ts`
- `src/renderer/pages/download-page/hooks/use-download-page-controller.test.tsx`

### 기능·오류·경계값 회귀 범위

기존 동작의 오류·경계값을 다음 테스트에서 검증합니다. 아래 테스트는 실제 레지스트리나 SMTP 서버에 접속하지 않습니다.

| 영역               | 테스트 위치                                                                                                                             | 주요 검증                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CLI 설정·캐시      | `src/cli/commands/{config,cache}.test.ts`                                                                                               | 값 변환, 조회·초기화, 빈 캐시, 삭제 확인 거부, 디렉토리 소실, EACCES/EPERM, 실패 후 삭제 방지                    |
| Electron 저장·조회 | `electron/{config,cache,history,version}-handlers.test.ts`                                                                              | JSON 오류, 파일 권한·용량 오류, 히스토리 상한·순서, 빈 결과, 버전 캐시와 재시도                                  |
| Electron 다운로드  | `electron/services/{dependency-resolve-service,download-progress,os-search-service,os-package-router,os-download-orchestrator}.test.ts` | 미지원 입력, 의존성·검색 실패, 진행률 제한, 취소, 패키징 실패와 임시 파일 정리                                   |
| Docker             | `src/core/downloaders/docker-{auth,blob-downloader,catalog-cache,manifest-service,search-service}.test.ts`                              | 인증 거부·토큰 만료, 빈 목록, 플랫폼별 manifest 선택, 체크섬 불일치, 파일 권한, 캐시 복구                        |
| OS 패키지          | `src/core/downloaders/os-shared/{archive-packager,dependency-tree}.test.ts`, `src/core/resolver/os-resolver-utils.test.ts`              | 압축 형식·스크립트, 누락 파일, 순환·중복 의존성, 버전·아키텍처 필터, 요청 간 상태 격리                           |
| Python             | `src/core/shared/{pip-candidate,pip-tags,pip-provider,pypi-utils}.test.ts`                                                              | ABI·플랫폼, Python/패키지 버전 제약, 철회·시험 배포, 후보 없음, 의존성·캐시·실패 후 재시도                       |
| Conda·Maven        | `src/core/shared/{conda-utils,conda-validator,maven-utils}.test.ts`                                                                     | 압축 인덱스/일반 인덱스/API fallback, noarch, Python 빌드, 채널 거부, classifier, 잘못된·빈 응답                 |
| HTTP·파일·캐시     | `src/core/shared/{axios-http-client,file-utils}.test.ts`, `src/core/shared/cache/cache-store.test.ts`                                   | 상태·오류·진행률 전달, 바이트 전송, redirect, pause/cancel 정리, TTL 경계, 동시 실패·재시도, 손상 JSON·권한 오류 |
| 메일               | `src/core/mailer/email-sender-errors.test.ts`                                                                                           | 첨부 제한과 같은 크기/초과, 인증·수신자·파일 접근 오류, 부분 발송 중단, 연결 재시도                              |
| 렌더러 훅          | `src/renderer/pages/settings/use-settings-form-actions.test.ts`, `src/renderer/pages/download-page/hooks/use-os-download-flow.test.ts`  | 입력 검증·미저장 이동 방지, SMTP·캐시 실패, OS 선택, 늦은 응답, 히스토리·장바구니 보존, 구독 해제                |

커버리지는 `npm run test:coverage`로 확인합니다. 현재 커버리지 집계 대상은 `src/core/**/*.ts`이며 테스트 파일과 index barrel은 제외합니다. 따라서 CLI, Electron, 렌더러, E2E 테스트의 검증 범위와 구분해야 합니다. text 보고서는 콘솔에, JSON/HTML 보고서는 `coverage/`에 생성되며 커버리지 최소 비율은 설정되어 있지 않습니다. 외부 레지스트리 실제 연동 및 OS별 파일시스템 동작 전체를 mock 테스트가 보장하지는 않습니다.

### CLI 캐시 설정 검증

`src/cli/cache-commands.integration.test.ts`는 실제 파일·디렉터리가 섞인 캐시에서 별도 CLI 프로세스로 `cache list`를 실행합니다. 정상 디렉터리의 패키지 정보와 개수가 표시되고 일반 파일은 목록에서 제외되는지 확인합니다. `commands/cache.test.ts`는 심볼릭 링크 제외, 디렉터리가 없는 경우, manifest 유무에 따른 표시를 검증합니다.

`src/cli/cache-settings.integration.test.ts`는 격리한 사용자 디렉터리와 별도 CLI 프로세스로 설정 저장·조회가 연결되는지 확인합니다. 로컬 HTTP APK 저장소를 이용해 캐시 비활성화 시 재요청과 파일 미생성, 활성화 시 저장·재사용, 설정한 크기 한도에 따른 캐시 저장 생략도 검사합니다. 잘못된 입력의 종료 코드와 설정 파일 보존은 실제 CLI 경계에서 확인합니다.

`src/core/config.test.ts`는 저장 키와 이전 별칭의 우선순위, 비동기 API와의 호환성, 불리언·양의 안전 정수 검증을 담당합니다. OS backend 테스트는 옵션 전달을 확인하고, `cache-manager.test.ts`는 실제 임시 디렉터리에서 LRU와 한도 초과 항목의 저장 생략을 검증합니다. 저장 순서와 조회 순서를 다르게 만든 뒤 작은 용량으로 다시 열어도 최근 조회한 항목이 남는지 확인합니다. 이 테스트에는 native apt/yum/apk 실행 파일이 필요하지 않습니다.

### Conda defaults 채널 검증

- `conda-channel.test.ts`, `conda-cache.test.ts`, `conda-utils.test.ts`: 기본 `defaults`의 공식 URL, 명시적 `main`과 사용자 지정 origin 유지, repodata 요청 및 API 파일 URL 구성을 검증합니다.
- `conda.test.ts`, `conda-resolver-target.test.ts`: downloader/resolver의 메타데이터·후보 조회 경계를 모킹해 대상 subdir와 `noarch`의 다운로드 URL을 검증합니다. downloader의 API 응답 모킹으로 `main` 소유자 매핑과 논리 채널 유지, 중복 subdir 방지도 확인합니다.
- `conda-validator.test.ts`, `download-package-router.test.ts`: 채널 HEAD 검증과 Electron의 파일명 기반 URL 생성에도 같은 규칙이 적용되는지 확인합니다.

실제 네트워크 smoke는 격리한 사용자 디렉터리에서 `download -t conda -p six -V latest --no-deps --conda-channel defaults`를 실행하고 종료 코드, 요청 URL, 아카이브와 manifest를 검사합니다. `--target-os linux --arch x86_64` 및 일반 `conda-forge` 채널도 대조합니다. 이 검증은 패키지 다운로드 범위이며 생성된 스크립트로 Conda 환경을 설치하는 검증은 별도입니다.

### Maven 모델 POM 검증

`src/core/resolver/maven-resolver.test.ts`는 `latest` 메타데이터의 실제 버전으로 루트 POM과 파일명을 만드는지, release fallback·빈 버전 실패·classifier/type 보존·명시 버전의 조회 생략을 검증합니다. `src/cli/commands/download.test.ts`는 기본 Maven `--no-deps`에서 `latest`만 깊이 0의 루트 해결을 거쳐 다운로드 큐로 전달되는지 확인합니다. 실제 저장소 검증에서는 같은 좌표의 의존성 포함/제외 CLI를 실행하고 메타데이터 버전과 아카이브·manifest를 비교합니다.

Parent POM과 import BOM이 조회 캐시에만 남아 오프라인 출력에서 누락되는 문제는 다음 기본 회귀 세트로 검증합니다. `INTEGRATION_TEST` 설정 없이 실행하며 외부 Maven Central에 접속하지 않습니다.

| 테스트 | 검증 범위 |
|--------|-----------|
| `src/core/shared/maven-bom-processor.test.ts` | 전체 GAV로 모델 POM 중복 제거, 깊은 부모/BOM 체인, Parent/BOM/혼합 순환, 공유 BOM 그래프의 반복 처리 제한, 문맥별 부모 속성 상속과 import 순서, 필수 모델 누락·미해결 좌표, 호출 간 상태 초기화 |
| `src/core/resolver/maven-model-resolution.test.ts` | 전이 패키지의 BOM 버전 적용과 모델 POM 포함, 형제 간 관리 버전 격리와 루트 관리 우선순위, 같은 부모의 여러 버전, 깊이 경계의 부모 수집, POM 조회 실패, 깊은 그래프 평탄화 및 순환·공유 노드 종료, 같은 GAV의 JAR/POM 구분 |
| `src/core/shared/maven-parent-pom-download.test.ts` | Flink 전이 체인 fixture의 부모/BOM POM 및 compile/runtime JAR·부속 POM·SHA1 실제 파일, 미사용 관리 항목 631개와 optional/test 제외, JAR/POM 동시 보존, 필수 부모 404 및 모델 조회 후 POM 파일 저장 실패 |

다운로드 회귀는 Axios adapter의 HTTP 응답만 XML/JAR/SHA1 fixture로 대체합니다. `resolveAllDependencies()`부터 실제 resolver·POM 파싱·캐시·`MavenDownloader`와 임시 디렉터리 파일 쓰기를 실행합니다. Electron 라우터의 같은 GAV 직렬화와 최상위 복사본은 기존 `electron/services/download-package-router.test.ts`에서 별도로 검증합니다.

```bash
bash scripts/verify-worktree.sh \
  src/core/shared/maven-bom-processor.test.ts \
  src/core/resolver/maven-model-resolution.test.ts \
  src/core/shared/maven-parent-pom-download.test.ts \
  electron/services/download-package-router.test.ts
```

이 fixture 검증은 실제 Maven Central의 현재 파일 존재 여부나 외부 Maven 실행의 오프라인 성공을 보장하지 않습니다. 외부 저장소 검증에는 아래 통합 테스트를 별도로 사용하고, 실행 명령·대상 좌표·파일 확인 결과를 해당 작업의 검증 기록에 남깁니다.

### 빈 `--file` 입력 검증

`src/cli/empty-package-file.integration.test.ts`는 빈 파일·공백만 있는 파일·주석만 있는 파일을 별도 Node.js 프로세스에서 실행합니다. 테스트 전용 user directory와 경로에 공백이 있는 출력 디렉터리를 사용하며, 입력 오류가 종료 코드 `1`을 반환하고 archive와 설치 스크립트를 만들지 않는지 확인합니다. 단위 테스트는 parser 결과가 비어 있을 때 resolver, 출력 디렉터리, 다운로드 큐, archive, script generator가 호출되지 않는 순서를 검증합니다.

### YUM 메타데이터와 검색 오류 검증

`src/core/downloaders/os-metadata-parsers.test.ts`는 실제 gzip XML 파서에 1,001개의 표준 엔티티를 전달해 정상 디코딩을 확인하고, 100,000회 한도 초과 및 취소 오류 전달을 검증합니다. `src/core/resolver/os-resolvers.test.ts`는 primary 누락, 비활성 저장소 제외, 뒤쪽 저장소 실패 후 일부 목록이 남지 않는지와 동일 resolver 재시도를 확인합니다.

`src/cli/yum-metadata-failure.integration.test.ts`는 로컬 HTTP 서버의 repomd/primary XML을 실제 자식 CLI로 읽습니다. XML 제한 초과 시 저장소·원인과 종료 코드 `1`이 전달되고 빈 검색 성공으로 바뀌지 않아야 합니다. 이 세 파일은 외부 저장소 없이 기본 테스트에서 실행합니다.

`src/core/downloaders/yum.integration.test.ts`는 현재 OS backend API로 실제 Rocky Linux 9 저장소의 `zlib` 검색(limit 3)과 의존성 없는 RPM ZIP 다운로드를 검증합니다. 오래된 다운로더 API와 조용한 조기 성공 처리를 제거했으며, 아래 명령으로 명시적으로 실행합니다. 외부 네트워크를 사용하고 임시 캐시·출력을 정리합니다. 네이티브 Yum/RPM 설치 트랜잭션을 수행하는 테스트는 아닙니다.

```bash
INTEGRATION_TEST=true bash scripts/verify-worktree.sh src/core/downloaders/yum.integration.test.ts
```

### APK capability 의존성 검증

`src/core/downloaders/os-metadata-parsers.test.ts`는 APKINDEX의 `so:`, `cmd:`, `pc:` 의존성과 provides를 보존하는지 확인합니다. `src/core/resolver/os-resolvers.test.ts`는 제공 APK의 패키지 버전과 capability 버전을 다르게 둔 fixture로 버전 조건·아키텍처·전이 목록·미해결 경고를 검증합니다. 일반 패키지 조건과 `--no-deps`의 루트 전용 다운로드도 기존 backend 회귀에서 확인합니다.

대체 제공자 선택은 `so:`, `cmd:`, `pc:`, `/bin/sh` fixture로 검증하며, 같은 제공 패키지의 여러 버전은 기존 충돌로 남는지도 확인합니다. 기본 테스트에 포함되는 `src/cli/apk-cached-capability.integration.test.ts`는 격리된 실제 캐시 파일에 이전 형식의 결과를 저장하고, 별도 CLI 프로세스가 로컬 HTTP 서버의 APKINDEX를 다시 파싱하는지 검사합니다. 이어지는 다운로드 프로세스는 새 캐시를 재사용하면서 루트와 제공 APK를 모두 아카이브에 넣어야 합니다. 이 로컬 회귀의 APK 응답은 다운로드 경로 검사용 fixture이며, 실제 APK 내용은 아래 네트워크 테스트로 확인합니다.

`src/core/downloaders/apk.integration.test.ts`는 현재 OS backend API로 실제 Alpine 3.20의 `zlib`와 제공 패키지를 내려받고 APK 내부 `.PKGINFO` 및 TAR.GZ의 파일 목록을 비교합니다. 기본 의존성 포함 경로와 `--no-deps`를 구분하며, 오래된 다운로더 API 호출과 조용한 조기 성공 처리를 사용하지 않습니다. 임시 캐시·출력을 정리하며 네이티브 `apk` 설치는 수행하지 않습니다.

```bash
INTEGRATION_TEST=true bash scripts/verify-worktree.sh src/core/downloaders/apk.integration.test.ts
```

### APK 저장소 인덱스 구조 검증

`src/core/downloaders/os-shared/repo-packager.test.ts`는 생성한 `APKINDEX.tar.gz`가 인덱스 항목 하나를 담은 tar인지 확인하고, 아카이브 생성 실패 시 기존 파일 보존과 임시 디렉터리 정리를 검사합니다. `src/core/downloaders/os-shared/apk-repository-consumer.test.ts`는 생성한 아카이브를 로컬 HTTP 서버에서 제공해 실제 `ApkMetadataParser.parseIndex()`가 읽는지 검증합니다. 두 테스트는 기본 테스트에 포함되며 외부 저장소나 네이티브 Alpine 도구가 필요하지 않습니다.

이 검사는 아카이브 구조와 앱 파서의 소비 경로를 다룹니다. 실제 Alpine 저장소 업데이트·검색 검증은 [#97의 메타데이터 필드 보존 문제](https://github.com/jonggeun2001/DepsSmuggler/issues/97)를 해결한 뒤 함께 수행해야 합니다.

```bash
bash scripts/verify-worktree.sh \
  src/core/downloaders/os-shared/repo-packager.test.ts \
  src/core/downloaders/os-shared/apk-repository-consumer.test.ts
```

### CLI 다운로드 실패 종료 코드 검증

`src/cli/download-failure-exit.integration.test.ts`는 별도 Node.js 프로세스에서 실제 CLI 엔트리포인트와 Commander 인자를 실행합니다. 부모 프로세스의 로컬 HTTP 서버가 404를 반환하고, 자식의 테스트 전용 설정이 실제 `MavenDownloader`의 저장소 주소만 이 서버로 연결합니다. 실제 다운로드 매니저가 실패 결과를 반환한 뒤 CLI가 종료 코드 `1`과 실패 원인을 남기고, 새 아카이브와 설치 스크립트를 생성하지 않는지 확인합니다. 설정·로그·출력은 임시 디렉터리로 격리하며 외부 레지스트리에 연결하지 않습니다.

`src/cli/commands/download.test.ts`는 전체·일부 항목 실패 분기를 빠르게 검증합니다. 다운로드 전 의존성 해결의 기본 건너뛰기 정책은 별도 동작으로 유지합니다. 실제 레지스트리 검증에는 존재하지 않는 Maven classifier와 Docker 태그의 HTTP 404, 정상 패키지 다운로드의 종료 코드와 산출물을 함께 기록합니다.

```bash
bash scripts/verify-worktree.sh \
  src/cli/download-failure-exit.integration.test.ts \
  src/cli/commands/download.test.ts
```

### Docker 설치 스크립트 파일명과 실제 로드 검증

`src/core/downloaders/docker-download.test.ts`는 이미지 이름·태그 정규화와 아키텍처별 실제 반환 파일명을 확인합니다. `src/core/packager/docker-install-script.integration.test.ts`는 같은 파일명 fixture를 준비하고, 공백이 있는 폴더와 외부 작업 디렉터리에서 생성 스크립트를 실행합니다. macOS·Linux에서는 Bash, Windows에서는 PowerShell을 사용하며 Docker 기록용 대체 명령이 받은 `load -i` 인자와 실제 파일 경로를 검사합니다. 이 검증은 Docker 엔진의 이미지 로드를 대신하지 않습니다.

경로 비교에는 Node.js의 `realpathSync.native()`를 사용합니다. Windows 임시 폴더의 8.3 짧은 이름(`RUNNER~1`)과 PowerShell이 전달하는 긴 이름이 같은 실제 파일을 가리키는 경우도 동일하게 판정합니다.

Docker 엔진이 실행 중인 환경에서는 아래 명령으로 실제 로드 테스트를 실행합니다. 테스트가 만든 고유 태그의 로컬 이미지 tar를 생성 스크립트로 로드하고, Docker에서 이미지 ID를 확인한 뒤 해당 태그만 정리합니다. 외부 레지스트리 다운로드는 필요하지 않습니다. 명시적으로 활성화한 상태에서 Docker에 연결할 수 없으면 테스트가 실패하며, 기본 단위 테스트에서는 이 사례를 건너뜁니다. Ubuntu CI는 별도 단계에서 이 검증을 활성화합니다.

```bash
DEPS_SMUGGLER_NATIVE_DOCKER=1 bash scripts/verify-worktree.sh \
  src/core/packager/docker-install-script.integration.test.ts -t 'native Docker'
```

실제 CLI 다운로드 검증은 `busybox:1.36`의 `--arch amd64 --format zip`과 `--arch arm64 --format tar.gz` 출력에서 `packages/busybox-1.36.tar`, tar 내부 manifest와 config 아키텍처, 원본 설치 스크립트의 참조 경로를 함께 확인합니다. Docker가 없는 환경의 파일·스크립트 검사와 엔진을 사용한 로드 결과는 구분해 기록합니다.

### npm 설치 스크립트 오프라인 검증

`src/core/packager/npm-install-script.integration.test.ts`는 레지스트리에 연결하지 않고 로컬 tarball fixture로 생성 스크립트를 실제 실행합니다. macOS·Linux에서는 Bash, Windows에서는 `powershell.exe`와 해당 환경의 npm을 사용합니다. 빈 npm 캐시와 별도 설정·설치 경로를 사용하며, 공백이 포함된 경로와 scoped 전이 의존성을 설치한 뒤 Node.js에서 실제 모듈을 불러와 검사합니다. 같은 패키지의 1.x·2.x를 요구하는 두 루트가 각각 올바른 버전을 불러오는지, 명시적으로 선택한 직접 버전이 유지되는지도 검증합니다. 서로 다른 peer 버전을 요구하는 전이 플러그인과 순환 의존성도 실제 npm 설치 및 모듈 로딩으로 확인합니다. 설치 대상은 `npm-project/node_modules`이며 상위 사용자 manifest 보존과 기존 사용자 프로젝트 덮어쓰기 방지를 확인합니다. 패키지 파일 또는 필요한 의존성이 없거나 tarball이 손상된 경우에는 오류 종료와 성공 문구 부재를 확인합니다. macOS 임시 디렉터리의 `/var`→`/private/var` 경로 차이에서도 여러 버전을 설치할 수 있어야 합니다. Windows의 `NODE_OPTIONS` preload 경로는 `JSON.stringify`로 인코딩해 역슬래시가 손실되지 않도록 합니다.

### Maven 설치 스크립트 canonical 저장소 검증

`src/core/packager/script-generator.test.ts`의 canonical tree 회귀는 Maven 없이도 실행할 수 있습니다. 공백이 포함된 임시 추출 경로에서 실제 Bash subprocess(Windows에서는 native PowerShell)를 생성·실행하고, CLI `packages/<m2path>`와 GUI `packages/m2repo/<m2path>`의 JAR-only·companion POM·parent/BOM POM-only·classifier·checksum을 `MAVEN_REPO_LOCAL`에 경로·바이트 그대로 복사하는지 검사합니다. pip 파일과 flat 파일은 대상 저장소에 복사되지 않습니다. Maven native offline consumer 검증과 macOS에서 PowerShell이 없는 경우는 별도 환경 제한으로 기록합니다.

`src/core/packager/maven-install-script.integration.test.ts`는 실제 생성 스크립트를 실행해 기존 Maven 추적 기록 보존, 원본 파일에 한정한 로컬 설치 등록, 마지막 개행이 없는 기록 병합, 반복 실행과 기록 쓰기 실패를 검증합니다. Windows CI에서는 `powershell.exe`를 사용하며, 로컬에 PowerShell이 없는 경우의 Bash 성공과 구분합니다.

스크립트 폴더 밖에서 상대 `MAVEN_REPO_LOCAL`을 지정하는 경우에도 아티팩트와 추적 기록이 같은 대상에 저장되는지 검사합니다. Windows PowerShell 프로세스의 시작 지연을 고려해 subprocess 제한과 여러 번 실행하는 테스트의 전체 제한을 별도로 둡니다.

`m2repo.example` 그룹 단독 및 `example` 그룹과 함께 있는 CLI·GUI 경로도 실제 스크립트로 검증하여 그룹 이름을 GUI 저장소 폴더로 오인하거나 다른 그룹의 파일을 설치하는 회귀를 방지합니다. 모호하거나 두 구조에 분산된 원본은 설치 전에 실패하는지도 확인합니다. `.demo`처럼 점으로 시작하는 아티팩트도 파일 복사와 로컬 설치 기록에서 누락되지 않는지 검사합니다.

### Maven 다운로드 목록과 미리보기 검증

모델 POM이 `flatList`에는 있지만 `root` 실행 의존성 그래프에는 없는 응답을 사용해 화면 표시를 검증합니다. 다음 회귀는 renderer 변환과 상태·DOM을 검사하며, 실제 resolver 조회나 파일 다운로드를 실행하지 않습니다.

| 테스트 | 검증 범위 |
|--------|-----------|
| `src/renderer/pages/download-page/resolved-items.test.ts` | flatList의 부모/BOM POM 연결, 실제 원본 ID와 다운로드 메타데이터 보존, GAV·type·classifier별 그룹, 공유 POM 중복 표시 방지, 이전 응답의 순환 트리 처리, 미연결 행 표시 |
| `src/renderer/pages/download-page/hooks/use-download-page-controller.test.tsx` | 수동 의존성 확인과 `onDepsResolved` 이벤트 양쪽에서 71개 fixture 항목과 모델 POM의 그룹·ID·파일 정보 보존 |
| `src/renderer/components/DependencyTree.test.tsx` | 그래프 밖 POM 목록 펼치기와 파일 상세, 중복·기존 그래프 POM 제외, 같은 GAV의 JAR/POM/classifier 구분, 원본 실행 그래프 유지 |
| `tests/e2e/maven-pom-preview.spec.ts` | Chromium의 실제 의존성 확인 화면에서 전체 71개·하위 70개·POM 35개 표시, `flink-metrics-1.20.5.pom` 가시성 확인 |

71개 fixture의 개수는 화면 회귀를 위한 고정 데이터이며 Maven Central의 실시간 의존성 개수가 아닙니다. 훅과 컴포넌트 테스트는 jsdom에서 Electron bridge 또는 트리 렌더링 경계를 모킹합니다. 그룹 상태 집계와 목록 스캔은 기존 `download-page/utils.test.ts`도 함께 확인합니다.

```bash
bash scripts/verify-worktree.sh \
  src/renderer/pages/download-page/resolved-items.test.ts \
  src/renderer/pages/download-page/utils.test.ts \
  src/renderer/pages/download-page/hooks/use-download-page-controller.test.tsx \
  src/renderer/components/DependencyTree.test.tsx
```

Playwright 회귀는 Electron bridge의 `dependency.resolve` 응답을 fixture로 대체하고 실제 Chromium에서 의존성 확인 버튼과 다운로드 목록을 검사합니다. 외부 Maven Central 호출과 파일 다운로드는 이 화면 검증에 포함하지 않습니다.

```bash
npx playwright test tests/e2e/maven-pom-preview.spec.ts --project=chromium
```

### 2. 통합 테스트

- 파일명 관례: `*.integration.test.ts`
- 실제 외부 저장소/레지스트리를 호출하는 흐름을 검증합니다.
- 보통 `INTEGRATION_TEST=true`일 때만 실행되도록 테스트 코드에서 gating 합니다.

현재 코드베이스에는 다음과 같은 통합 테스트가 포함되어 있습니다.

- `src/core/downloaders/pip.integration.test.ts`
- `src/core/downloaders/conda.integration.test.ts`
- `src/core/downloaders/maven.integration.test.ts`
- `src/core/downloaders/npm.integration.test.ts`
- `src/core/downloaders/docker.integration.test.ts`
- `src/core/downloaders/yum.integration.test.ts`
- `src/core/downloaders/apt.integration.test.ts`
- `src/core/downloaders/apk.integration.test.ts`
- `src/core/downloaders/os.integration.test.ts`

이 중 `os.integration.test.ts`는 제거된 통합 `OSPackageDownloader`를 참조하는 과거 테스트로 최상위 suite가 `describe.skip`입니다. `INTEGRATION_TEST=true`로도 실행되지 않으며, 현재 OS 실연동 검증은 개별 `yum/apt/apk.integration.test.ts`를 사용합니다. 반면 `src/cli/commands/download-session-integration.test.ts`는 내부 요청 세션 조합을 mock으로 검증하므로 환경 변수 없이 기본 테스트에 포함됩니다.

### 3. E2E 회귀 세트

- 설정 파일: `playwright.config.ts`
- 설정상 테스트 디렉터리: `tests/e2e`
- 브라우저 프로젝트: `chromium`
- 로컬 web server: `npm run dev:vite`
- 공통 mock fixture: `tests/e2e/fixtures/mock-electron-app.ts`

현재 포함 시나리오:

- `tests/e2e/settings-regression.spec.ts`: 설정 저장, SMTP 연결 테스트 호출, 새로고침 후 값 유지
- `tests/e2e/settings-cache-breakdown.spec.ts`: 패키지 타입별 캐시 통계와 비우기 후 갱신
- `tests/e2e/download-smoke.spec.ts`: 장바구니에서 일반 다운로드 완료 화면까지의 smoke flow
- `tests/e2e/history-email-restore.spec.ts`: 이메일 전달 히스토리 재다운로드 시 수신자 복원과 전역 설정 보존
- `tests/e2e/os-package-download.spec.ts`: OS 패키지 전용 검색/다운로드 흐름
- `tests/e2e/cart-input-regression.spec.ts`: 빈 장바구니·입력, requirements 중복·주석·파일 업로드, 최신 버전 조회 실패, package.json 오류·scoped/dev 의존성, Maven JAR/POM 구분과 저장 복원
- `tests/e2e/maven-pom-preview.spec.ts`: 의존성 해결 응답을 대체한 Chromium 화면에서 부모 POM을 포함한 전체 다운로드 목록·그룹 개수·파일명 표시
- `tests/e2e/download-cancel-retry.spec.ts`: 실제 시작·패키지 완료 상태를 기다린 뒤 취소와 새 세션 재시도를 검증

빈 다운로드 화면의 `UI-DL-003`은 `cart-input-regression.spec.ts`에서 이미 검증합니다. 홈 진입·일반 위자드 검색과 전달 방식 왕복 전환은 전용 E2E의 추가 후보이며, 기존 완료/히스토리 테스트가 일부 상태만 검증합니다.

구성 동작:

- 실제 Electron 프로세스를 실행하지 않고 Vite 렌더러에서 preload/API와 외부 응답을 browser-side mock/stub으로 대체합니다. 공통 fixture 외에 `os-package-download.spec.ts`는 별도 inline OS stub을 사용합니다. 실제 SMTP 접속, 압축 파일 내용, OS 설치 결과는 이 E2E 범위가 아닙니다.
- `CI`와 로컬 모두 worker `1`로 직렬 실행하며, `CI`에서는 retry `2`를 사용합니다.
- 로컬에서는 기존 `http://localhost:3000` 서버 재사용 가능
- 실패 시 screenshot, 첫 재시도에 trace 수집

설정 화면 관련 참고:

- `settings-form-utils.test.ts`는 SettingsPage 리팩터링 과정에서 form 값과 store 저장 shape 변환, SMTP 테스트 경로 분류(`ipc | browser-simulated | missing-ipc`)를 고정합니다.

로컬 준비:

- 최초 1회는 `npx playwright install chromium`으로 브라우저 바이너리를 설치해야 합니다.
- 이후 `npm run test:e2e`로 전체 회귀 세트를 실행할 수 있습니다.

## UI 수동 테스트 자산

UI 수동 검증과 E2E 전환 계획은 별도 문서로 관리합니다.

- [UI 테스트 체크리스트](./ui-testing-checklist.md): 릴리즈 전 smoke와 탐색적 QA에 바로 사용할 최소 확인 목록
- [UI 상세 테스트 케이스](./ui-testing-test-cases.md): 테스트 ID, 사전 조건, 절차, 기대 결과, 실패 기준
- [UI Playwright 전환 시나리오](./ui-testing-playwright-conversion.md): 현재 자동화 범위와 신규 E2E 후보, mock 전략
- [UI 테스트 결과 2026-04-14](./ui-testing-findings-2026-04-14.md): 당시 실행 결과와 후속 수정 이력. 최신 소스 대조 결과를 별도로 표시
- [UI 테스트 후속 수정 프롬프트 2026-04-14](./ui-testing-fix-prompt-2026-04-14.md): 해결 전 작성한 실행 프롬프트와 ASCII-art 병렬도를 보존한 역사 문서

## GitHub Actions

### `test.yml`

트리거:

- `push` to `main`, `develop`
- `pull_request` to `main`

주요 잡:

- `test`: Ubuntu/Windows/macOS + Node 20에서 `npm ci`, `npm test`, `npm run build`, CLI `--version`, `--help`
- `lint`: `npm run lint`로 ESLint 실행
- `typecheck`: `npx tsc --noEmit`
- `e2e`: Chromium 설치 후 `npm run test:e2e`, 실패 시 Playwright 보고서와 결과 artifact 업로드
- `coverage`: `npm run test:coverage` 후 Codecov 업로드 시도

현재 coverage 잡은 `./coverage/lcov.info`를 지정하지만 Vitest reporter에는 `lcov`가 없습니다. 기본 설정만으로 해당 파일은 생성되지 않으므로, 이 워크플로 정의를 Codecov 업로드 성공의 근거로 사용하지 않습니다. 업로드 실패는 `fail_ci_if_error: false`로 설정되어 있습니다.

### `release.yml`

릴리즈 워크플로우는 패키징 전에 다시 다음 검증을 수행합니다.

- `npm test`
- `npx tsc --noEmit`

그 후 Windows/macOS/Linux 패키징과 draft release 생성이 이어집니다.

## 테스트 작성 원칙

- 단위 테스트는 네트워크/파일 시스템 부작용을 가능한 한 모킹합니다.
- 통합 테스트는 실제 외부 저장소 호출이 필요한 경우에만 추가합니다.
- 새 기능을 추가할 때는 구현 파일 옆에 테스트를 두는 현재 관례를 따릅니다.
- CLI/Electron 경계는 thin handler wiring 테스트와 service/helper 단위 테스트를 분리해 검증합니다.
- Electron handler 테스트는 IPC 채널 등록과 service 위임만 확인하고, package type 분기/패키징/OS 전용 흐름은 `electron/services/*.test.ts`에서 검증합니다.
- renderer 다운로드 흐름처럼 상태 전이가 많은 코드는 page 컴포넌트 전체보다 store/hook 단위 characterization test를 우선 추가합니다.
- 권한 오류는 `chmod`나 실행 사용자의 권한에 의존하지 않고 파일/전송 경계에서 재현하며, 거절 이후 불필요한 저장·삭제·발송이 발생하지 않는지도 확인합니다.
- 타이머는 fake clock 또는 명시적 완료 신호로 제어합니다. E2E 취소 테스트는 취소 버튼 표시뿐 아니라 시나리오에 필요한 다운로드 시작·완료 상태를 먼저 확인합니다.
- 실패한 테스트를 통과시키기 위해 서비스 검증을 제거하거나 테스트의 최종 결과 검증을 약화하지 않습니다.

## 현재 문서화 포인트

- 테스트 수나 개별 케이스 개수는 자주 변하므로 이 문서에서는 고정값을 관리하지 않습니다.
- 정확한 범위는 `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/*.yml`을 기준으로 확인합니다.

## 관련 문서

- [아키텍처 개요](./architecture-overview.md)
- [Electron / Renderer](./electron-renderer.md)
- [IPC 핸들러](./ipc-handlers.md)
