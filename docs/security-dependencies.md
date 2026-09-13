# 보안 의존성 유지보수

## 2026-09-13 갱신 · 이슈 #157

앱이 사용하는 archive·HTTP·업데이트·메일 의존성과 개발/패키징 도구의 Critical/High 항목을 갱신했습니다. 모든 버전을 반입하는 의존성 해결 정책과 사용자 설정 형식은 유지합니다.

| 직접 의존성 | 이전 | 갱신 기준 |
|---|---|---|
| tar | 7.5.13 | 7.5.22 |
| axios | 1.15.0 | 1.20.0 |
| electron-updater | 6.8.3 | 6.8.9 |
| electron-builder | 26.8.1 | 26.15.3 |
| Electron | 39.8.7 | 44.3.0 |
| nodemailer | 8.0.5 | 10.0.9 |
| sharp | 0.34.5 | 0.35.4 |
| Vitest / coverage-v8 | 4.0.15 | 4.1.11 |
| concurrently | 9.2.1 | 9.2.4 |
| js-yaml | 4.1.1 | 4.3.2 |
| react-router-dom | 7.14.1 | 7.18.3 |
| Vite | 7.3.2 | 7.3.6 |

package.json의 최소 버전과 lockfile을 함께 갱신했습니다. 두 Vitest 패키지는 peer 계약에 맞춰 같은 버전을 사용합니다. 이전 Electron 설치기의 전이 패키지에 암묵적으로 의존하던 ZIP 검사 테스트는 `yauzl`과 타입을 devDependency로 명시했습니다. Axios의 응답 헤더 타입 확장에 맞춰 두 content-length 파싱 지점은 기존 숫자 변환을 명시적 `String` 변환으로 표현합니다. 전이 의존성은 상위 패키지 갱신과 기존 semver 범위 내 lockfile 재해결로 정리했습니다. 추가 override는 다음 두 범위에만 적용합니다.

- `minimatch@10 → brace-expansion ^5.0.9`: 기존 `^5.0.5` 범위 안에서 자원 고갈 패치를 포함하는 최소 버전을 보장합니다. 이전 minimatch major의 brace-expansion API는 바꾸지 않습니다.
- `undici@7 → ^7.29.0`: jsdom의 `^7.24.5` 범위 안에서 HTTP/TLS·캐시 처리 패치를 반영합니다. node-gyp가 사용하는 undici 6에는 적용하지 않습니다.

Electron 39.8.10은 일부 런타임 advisory를 해결해도 `extract-zip`의 High 항목을 남깁니다. Electron 44는 유지보수되는 `@electron-internal/extract-zip`을 사용하므로 런타임과 설치기를 함께 갱신했습니다. Electron 44 설치기의 Node 최소 요구사항은 22.12이므로 테스트·릴리스 CI도 Node 24로 변경했습니다. Electron 44의 최소 macOS는 13입니다. 앱 번들에는 `minimumSystemVersion: 13.0.0`을 설정합니다. `postpackage:mac`은 `scripts/macos-update-policy.json`에 정의한 `22.0.0`(Darwin 커널)을 생성된 모든 `*-mac.yml`의 `minimumSystemVersion`에 기록하고 검증합니다. electron-builder의 ReleaseInfo 스키마는 이 필드를 받지 않으므로 지원하지 않는 설정을 주입하지 않습니다. `scripts/package-macos.mjs`는 반복된 `--publish never` 인자를 하나로 정리합니다. 빌더가 중복 값을 배열로 읽어 게시 모드로 오인하는 것을 막으며, macOS 패키징은 `--publish never`로 생성하고 검증된 파일만 릴리스 workflow에서 게시합니다. 직접 electron-builder를 호출해 다른 출력 경로를 사용했다면 prepare/verify 스크립트에 해당 디렉터리를 전달해야 합니다. 기존 updater도 커널 버전으로 피드를 검사하므로 macOS 12 사용자에게 호환되지 않는 업데이트가 제공되는 것을 막습니다. 생성 피드 검증과 실제 AppUpdater의 OS 지원 판정 회귀를 함께 둡니다. [공식 macOS 12 지원 종료 안내](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support)

CLI 최소 버전·타입·packageManager 계약은 [이슈 #158](https://github.com/jonggeun2001/DepsSmuggler/issues/158)에서 이어서 관리합니다. [Electron 지원 일정](https://releases.electronjs.org/schedule)

## 확인 방법과 잔여 항목

```bash
npm ci
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
bash scripts/verify-worktree.sh
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.electron.json
npm run lint
npm run test:e2e
```

갱신 후 audit 스냅샷은 전체 **Critical 0 / High 0 / Moderate 3 / Low 2**, production은 **Critical 0 / High 0 / Moderate 3 / Low 0**입니다. 영향 패키지 항목 수이며 독립 CVE 수나 실제 악용 건수가 아닙니다. Electron은 devDependency여도 배포 앱 런타임이므로 production audit만으로 판단하지 않습니다. audit 종료 코드가 0이어도 `--audit-level=high` 아래의 항목은 남을 수 있습니다.

잔여 범위는 `fast-xml-parser`, `react-d3-tree` 및 전이 `uuid`의 Moderate, `@babel/core`와 `esbuild`의 Low입니다. 이번 High 이상 처리 범위에서 제외했으며 모든 취약점을 제거했다고 보고하지 않습니다. 수정 시점에 registry를 다시 조회해 최신 advisory와 적용 가능 버전을 확인해야 합니다.

기존 archive/APK/npm 설치 생성물, HTTP TLS·redirect·취소, updater IPC·메타데이터 회귀를 함께 실행합니다. `tests/unit/security-dependencies.test.ts`는 외부 발송 없이 실제 Nodemailer MIME 생성과 첨부 파일, 실제 Sharp의 SVG→PNG 변환을 검증합니다. 모킹한 SMTP 결과만으로 major 버전 호환성을 판단하지 않습니다. 실제 업데이트 설치·재시작 검증과 브라우저 E2E는 별개의 범위입니다.

향후 갱신도 상위 패키지의 패치/마이너 재해결을 우선하고, major 변경과 override는 API·runtime 요구사항을 확인한 뒤 적용합니다. `npm audit fix --force`를 일괄 적용하지 않습니다. Critical/High 예외가 필요하면 영향 경로·사유·후속 이슈·재검토 기한을 기록합니다.
