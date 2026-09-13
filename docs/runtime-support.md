# 런타임 지원 정책

## 현재 계약

2026-09-13 기준 소스·CLI·개발 도구의 지원 범위입니다. 다운로드할 패키지의 대상 OS·아키텍처와 이 앱을 실행하는 환경은 별개입니다.

| 대상 | 계약 | 검증 |
|------|------|------|
| 독립 CLI·소스 개발 | Node `^22.13.0 || ^24.0.0` | 최소 22.13.0의 실제 CLI, Node 24의 3개 OS 테스트·빌드 |
| 패키지 관리자 | npm `11.8.0` | `packageManager` 선언과 CI 명시 설치 |
| Node 타입 | `@types/node` 22 계열 | renderer 포함 설정과 Electron/CJS 설정 모두 타입 검사 |
| 배포 GUI | Electron 44 계열의 내장 Chromium·Node | 바이너리 확인, 패키징된 앱 실행·IPC·업데이트 다운로드 |
| macOS GUI | macOS 13 이상 | 번들 `13.0.0`, 업데이트 피드 Darwin `22.0.0` |

Node 22와 24는 점검일 기준 지원 중인 LTS이며, Node 20·23·25는 EOL입니다. 새 환경에는 Node 24의 최신 보안 패치를 사용합니다. 22.13.0은 호환성 하한 검사 버전이며 운영 환경에 오래된 패치를 권장하는 의미는 아닙니다. 새 major를 검증하기 전에는 engines 범위를 확장하지 않습니다. [Node 공식 릴리스 상태](https://nodejs.org/en/about/previous-releases)

Node 22.13.0은 jsdom의 22 계열 최소 조건과 Electron 설치기·Vite·패키징 도구의 22.12 이상 조건을 함께 충족합니다. 빌드 CLI는 CommonJS이고 chalk·ora 같은 ESM 의존성을 불러옵니다. Node 22.12부터 별도 플래그 없이 동기 ESM을 `require()`할 수 있으며 22.13부터 기본 실험 경고가 제거됐습니다. 이 경계를 실제 하위 프로세스로 검사합니다. [Node 22.13의 CommonJS/ESM 문서](https://nodejs.org/download/release/v22.13.0/docs/api/modules.html#loading-ecmascript-modules-using-require)

루트 `package.json`은 `type: module`이며 Vite renderer와 `.mjs` 운영 스크립트가 이 경계를 사용합니다. `tsconfig.electron.json`은 main·preload·core·CLI를 CommonJS로 출력하고 빌드가 `dist/package.json`에 `type: commonjs`를 기록합니다. 패키징 앱에도 `extraMetadata.type: commonjs`를 적용합니다. Electron의 내장 Node는 시스템 Node와 별개이므로 GUI 사용자는 Node를 따로 설치할 필요가 없습니다.

## 최소 환경 검증

선택한 Node 22.13.0 환경에서 다음을 실행합니다. CI의 `runtime-contract` 잡도 같은 테스트를 사용합니다.

```bash
node --version
npm --version # 11.8.0
npm ci --engine-strict
bash scripts/verify-worktree.sh src/cli/version.integration.test.ts tests/unit/macos-release-artifacts.test.ts tests/unit/macos-update-support.test.ts tests/unit/macos-package-command.test.ts
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.electron.json
```

CLI 테스트는 소스 실행, 빌드, 배포와 같은 디렉터리 구조에서 실제 명령을 실행하고 버전을 대조합니다. 프로필·설정·출력은 임시 폴더에 격리합니다. macOS 스크립트 테스트는 실제 Node ESM 프로세스를 실행하지만 DMG 생성이나 업데이트 설치는 수행하지 않습니다. Node 24의 Ubuntu·Windows·macOS 잡이 전체 테스트와 renderer/CJS 빌드를 담당합니다.

## Electron major 갱신 검증

Electron의 최신 3개 안정 major 지원 정책과 [공식 일정](https://releases.electronjs.org/schedule)을 확인합니다. 39는 지원이 종료돼 44로 전환했으며 보안 의존성 변경과 최소 macOS 조건은 [갱신 기록](security-dependencies.md)에 남겼습니다.

1. lockfile을 새로 설치하고 각 OS에서 `ELECTRON_RUN_AS_NODE=1`을 해당 확인 단계에만 지정하고 Electron의 `process.versions.electron`을 설치 패키지 버전과 대조합니다. 내장 Node 버전도 기록합니다. Linux runner의 SUID sandbox 설정에 의존하지 않고 실제 바이너리를 실행하기 위한 모드이며 GUI 실행 확인은 아래 별도 smoke로 수행합니다. [Electron 환경 변수](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node) Electron 설치 패키지의 lazy download 때문에 `npm ci` 성공만으로 바이너리 준비를 판정하지 않습니다.
2. 3개 OS 테스트·빌드와 두 TypeScript 설정 검사를 통과시킵니다. Electron·Node 변경으로 추가된 타입 오류를 단언이나 테스트 제외로 숨기지 않습니다.
3. macOS에서 `npm run package:mac`으로 DMG·ZIP·피드를 만들고 자동 posthook의 크기·SHA512·최소 OS 검증을 통과시킵니다. Windows/Linux도 해당 runner의 빌드 결과를 확인합니다.
4. 실제 packaged 앱을 별도 `userData`와 테스트용 홈 디렉터리로 실행합니다. preload의 앱 버전·히스토리 IPC, 창 로딩을 확인합니다.
5. updater를 loopback HTTP feed로 연결하고 더 높은 버전의 ZIP fixture를 확인·다운로드합니다. 실제 다운로드 크기·SHA512를 feed와 대조합니다. `autoDownload`, `autoInstallOnAppQuit`, `autoRunAppAfterInstall`을 모두 끄고 설치·재시작을 호출하지 않습니다. 임시 updater 서버와 앱을 종료합니다.

이 smoke는 업데이트 확인·다운로드와 IPC의 호환성 근거입니다. 서명된 배포 앱의 설치·재시작이나 모든 GUI 기능의 검증은 별도로 수행합니다.

## 갱신 주기

유지보수자는 매월과 릴리스 준비 시 Node 지원 표와 Electron 일정을 확인합니다. 다음 릴리스 전에 지원이 끝날 major는 업그레이드 이슈를 등록하고, 새 버전의 최소 OS·설치기 Node 요구사항을 먼저 확인합니다. engines·Node 타입·npm 버전·lockfile·두 workflow·이 문서를 한 PR에서 맞추고 위 검증 결과를 남깁니다. 보안 패치는 `npm audit --audit-level=high` 및 production audit과 함께 [보안 의존성 절차](security-dependencies.md)를 따릅니다.
