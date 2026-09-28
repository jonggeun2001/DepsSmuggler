# 장바구니 일괄 추가

파일/텍스트 가져오기와 다운로드 이력 복원은 `useCartStore.getState().addItems(items)`를 사용합니다. 기존 항목과 입력의 동일성 키를 Set으로 비교하고 새 항목이 있을 때만 상태를 한 번 갱신합니다. Zustand persist의 전체 JSON 직렬화와 동기 localStorage 저장도 한 번입니다. 반환값은 실제 추가 개수이며, 빈 입력과 전부 중복인 입력은 상태 갱신·저장 없이 `0`을 반환합니다. 단일 `addItem`은 이 동작을 사용하며 기존 `void` 반환을 유지합니다.

## 보존하는 동작

- 동일성은 `type`, 대소문자를 구분하는 `name`, `version`이며 Maven만 `metadata.type`을 추가로 비교합니다. type이 없거나 문자열이 아니거나 빈/공백 문자열이면 `jar`입니다. 비어 있지 않은 문자열은 원문 그대로 비교하므로 `pom`과 ` pom `은 다릅니다. 같은 좌표의 JAR/POM을 각각 보관합니다.
- classifier·아키텍처·언어 버전·extras·repository·indexUrl 등은 동일성 조건에 추가하지 않습니다. 다운로드용 `getPackageArtifactKey`와 목적이 다릅니다.
- 기존 항목이 우선하며 입력에서는 처음 항목이 우선합니다. 기존 객체·ID·addedAt과 채택된 항목의 옵션·순서를 보존하고 뒤 옵션을 병합하지 않습니다. ID와 addedAt은 신규 항목에만 생성합니다.
- latest 조회와 실패 시 `latest` 유지, 파일별 파싱 결과를 유지합니다. 여러 파일은 성공한 각 파일당 한 번 저장하며 실패 파일 때문에 성공 파일을 취소하지 않습니다.
- 이력의 type/name/version/arch/languageVersion/metadata 복원과 설정·수신자·OS 출력 옵션·화면 이동은 유지합니다. 성공 안내는 실제 신규 개수를 표시합니다.

## 검증과 측정

```bash
bash scripts/verify-worktree.sh src/renderer/stores/cart-store.test.ts src/renderer/stores/cart-bulk-add.test.ts
npx playwright test tests/e2e/cart-bulk-add.spec.ts tests/e2e/cart-input-regression.spec.ts tests/e2e/history-email-restore.spec.ts
node scripts/profile-cart-bulk-add.mjs 7657543
```

단위 테스트는 2,000개 입력의 구독 알림·persist 1회, 빈/중복 입력의 0회, 실제 추가 수, 동일성 경계와 옵션 보존을 검사합니다. E2E는 40개 파일 추가·재입력, 성공/실패 파일 혼합, 이력의 기존 항목 우선·39개 신규 안내와 저장 1회를 확인합니다. 이력 계측에서는 공통 mock의 설정 저장이 cart까지 다시 쓰는 간섭을 제외합니다. 실제 설정 IPC는 renderer cart에 쓰지 않습니다. 기존 이메일 설정 복원 E2E도 함께 실행합니다.

스크립트는 실제 production store를 메모리에서 fixture로 묶어 Chromium localStorage에 고정 버전 npm 항목 2,000개를 넣습니다. 기준은 항목별 `addItem`, 변경본은 `addItems`이며 초기화 후 동기 실행 시간을 측정합니다. 매 회 새 페이지에서 순서·개수·중복 입력 저장 0회도 확인합니다. 앱 빌드·설치와 외부 네트워크는 필요하지 않습니다.

2026-09-28, macOS 26.3 / Apple M4 arm64 / Chromium 143.0.7499.4, 3회 비교:

| 측정 | 기준 `7657543` | 변경본 |
|---|---:|---:|
| 2,000개 동기 추가 | 465.7~487.2ms | 1.7~1.9ms |
| localStorage 저장 호출 | 2,000회 | 1회 |
| 전달 문자열 길이 누계 | 218,459,137~218,460,495자 | 218,920~218,923자 |
| 최종 저장 문자열 길이 | 218,922~218,923자 | 218,920~218,923자 |

ID의 난수 부분 때문에 최종 길이는 조금 다릅니다. 문자열 길이 누계는 직렬화/저장 요청량이며 실제 디스크 쓰기 바이트가 아닙니다. React 구독·렌더링과 네트워크는 제외하므로 앱 전체 CPU나 사용자 평균 성능으로 일반화하지 않습니다. 최종 배열·JSON 생성 비용은 남으며 localStorage를 비동기 저장소로 바꾸는 수정은 아닙니다.
