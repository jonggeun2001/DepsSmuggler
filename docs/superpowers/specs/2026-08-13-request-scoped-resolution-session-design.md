# 요청 단위 의존성 탐색 재사용 설계

## 배경

`resolveAllDependencies()`는 여러 직접 패키지를 순차적으로 처리한다. 최종
다운로드 목록은 아티팩트 키로 중복 제거하지만, 각 직접 루트마다 해당 패키지
관리자의 resolver가 새 BFS 상태로 시작한다. 따라서 `A → C`, `B → C`처럼
공통 전이 의존성이 있으면 `C`의 레지스트리 조회, 버전 후보 선택, 메타데이터
해석이 반복된다. requirements.txt처럼 많은 직접 패키지를 한 번에 다운로드할 때
이 반복이 누적된다.

목표는 한 번의 다운로드 요청 안에서 이미 확인한 의존성 조회 결과를 재사용해
중복 탐색을 줄이되, 현재의 패키지 선택과 실패 처리 의미를 바꾸지 않는 것이다.

## 범위와 비범위

### 범위

- `resolveAllDependencies()`로 시작하는 한 요청에만 유효한 공유
  `ResolutionSession`을 만든다.
- 라이브러리 resolver인 pip, conda, Maven, npm에 세션을 전달한다.
- 동일한 조회 문맥의 후보 선택·아티팩트 메타데이터·의존성 manifest 조회의
  **성공 결과**를 재사용한다.
- 동일한 키의 동시 조회도 하나의 Promise를 공유한다.
- 기존의 직접 루트별 `dependencyTrees`, `successfulPackages`, best-effort 및
  `--strict` 실패 정책, 최종 다운로드 아티팩트 중복 제거를 유지한다.
- 요청 종료 시 세션을 폐기한다. 영속 캐시의 TTL, 설정 또는 캐시 삭제 동작은
  변경하지 않는다.

### 비범위

- pip resolvelib 같은 전역 버전 충돌 solver로 교체하지 않는다.
- 서로 다른 `resolveAllDependencies()` 호출 사이에 결과를 보존하지 않는다.
- yum, apt, apk와 Docker의 해결 알고리즘을 이번 변경 대상으로 포함하지 않는다.
  이들은 라이브러리 resolver와 다른 배포판·저장소 문맥을 사용한다.
- 사용자에게 새로운 CLI 옵션이나 출력 형식을 추가하지 않는다.

## 대안과 결정

1. 직접 입력이 동일할 때만 resolver 결과를 재사용하는 안은 구현 위험은 작지만
   공통 전이 의존성을 해결하지 못해 제외한다.
2. 모든 직접 입력을 한 전역 그래프로 푸는 배치 solver는 중복을 가장 많이
   줄이지만 pip extras, Maven scope/exclusion, npm peer dependency의 기존 의미와
   충돌할 위험이 커서 제외한다.
3. 요청 단위의 조회 세션을 공유하는 안을 채택한다. 아티팩트 선택과 manifest
   조회는 재사용하고, 부모별 의존성 간선 정책은 기존 각 resolver가 계속
   적용한다.

## 설계

### 공통 세션

`src/core/shared/resolution-session.ts`에 요청 수명과 같은 `ResolutionSession`을
둔다. 세션은 문자열 키와 성공 값을 위한 `Promise<T>`를 저장하는 memoizer를
제공한다.

- 최초 호출은 producer Promise를 저장하고 실행한다.
- 후속 호출은 같은 Promise를 반환한다. 완료 전 동시 호출도 중복 네트워크
  작업을 만들지 않는다.
- producer가 reject되면 캐시 항목을 즉시 제거한다. 같은 시점의 호출자는 같은
  실패를 받지만, 이후 직접 루트는 다시 조회한다. 따라서 일시적 네트워크 실패가
  뒤의 루트 성공 기회를 없애지 않는다. 각 resolver의 기존 오류 감싸기와
  `failedPackages` 기록도 그대로 유지한다.
- 세션에는 canonical snapshot만 저장하고, memoizer는 consumer마다 clone-on-read
  값을 반환한다. resolver는 매 호출마다 새 `DependencyNode`와 부모-자식 관계를
  구성하므로 한 트리의 변경이 다른 트리에 새지 않는다.
- hit/miss 횟수를 기록하고, hit이 하나 이상이면 공통 resolver가 요청 종료 시
  재사용 건수를 info 로그로 남긴다. 다운로드 결과와 CLI 출력 계약은 바꾸지
  않는다.

`resolveAllDependencies()`는 세션과 함께 **요청 전용 resolver 인스턴스 묶음**을
생성한다. 기존 `getPipResolver()` 등 singleton accessor는 다른 기존 호출 경로의
호환성을 위해 유지하되, 이 함수에서는 새 factory로 pip·conda·Maven·npm 인스턴스를
한 요청에 하나씩 만든다. 이로써 resolver 인스턴스 필드(visited, queue, conflicts,
tree manager, 대상 환경)가 동시 다운로드 요청 사이에 섞이지 않는다. 원격 metadata
cache는 기존 모듈 수준 캐시를 계속 사용한다.

세션은 이 요청 전용 인스턴스의 resolver 옵션으로만 전달하며, 외부 호출자가
세션을 전달하거나 보존할 수 없게 하여 요청 경계를 강제한다.

### 키 격리

캐시 키에는 결과에 영향을 주는 문맥을 모두 넣는다. 다른 저장소나 대상 환경의
응답을 재사용하지 않는 것이 중복 제거보다 우선한다.

| 유형 | 세션 키 문맥 |
| --- | --- |
| pip | 정규화 이름, 요청 버전 조건, index URL, 대상 OS/아키텍처, Python 버전, source artifact 검증 모드 |
| conda | 정규화 이름, 버전 조건·build, channel, subdir/아키텍처, Python·CUDA 버전 |
| Maven | 원시 POM/BOM에는 group:artifact:version 좌표와 저장소 URL |
| npm | 정규화 이름, 버전 조건, 현재 resolver가 실제로 받는 registry/host 환경 입력 |

extras, Maven scope/exclusion, npm peer/optional/dev 플래그처럼 **부모에서
나오는 간선**을 바꾸는 값은 manifest 캐시 키가 아니라 각 resolver의 기존
간선 평가 단계에 남긴다. 따라서 같은 패키지 metadata를 재사용하면서도
부모별 선택 규칙은 보존된다.

### resolver별 적용 지점

- **pip**: `getLatestVersion()`과 `fetchPackageInfo()`의 후보 선택, Core
  Metadata/JSON·Simple API 조회 결과를 세션으로 감싼다. 이후 extras 및 PEP 508
  marker 평가는 현재 BFS 호출별로 수행한다.
- **conda**: `getLatestVersionFromRepoData()`와 `fetchPackageInfoBFS()`의
  repodata 후보 선택 결과를 세션으로 감싼다. build와 target subdir을 키에
  포함한다.
- **Maven**: 좌표의 원시 POM/BOM 조회·파싱과 version range 선택을 세션으로
  감싼다. classifier/type 기반 아티팩트 선택, scope, exclusion, dependency
  management 적용은 호출별 queue processor가 수행한다.
- **npm**: registry manifest와 선택된 버전 조회를 세션으로 감싼다. hoisting과
  peer dependency 배치는 기존 root별 tree manager가 구성한다. 공통 resolver가
  npm에 `targetOS`/`architecture`를 새로 매핑하지는 않으며, 현재 host 기반 선택
  동작을 변경하지 않는다.

각 적용 지점은 세션이 없을 때 기존 producer를 그대로 실행하도록 해 단일
resolver의 공개 사용 경로와 기존 테스트를 유지한다.

## 처리 흐름

```text
직접 루트 A, B
  → resolveAllDependencies가 요청 세션 생성
  → A가 C의 조회 키를 최초 요청: Promise 생성·후보 선택·manifest 조회
  → B가 같은 C 조회 키를 요청: 기존 Promise/snapshot 재사용
  → A/B 각각의 extras·scope·peer 규칙으로 간선을 별도 구성
  → 기존 결과 병합 및 아티팩트 중복 제거
  → 요청 종료 시 세션 폐기
```

## 오류 처리와 호환성

- 서로 다른 키의 조회는 절대 재사용하지 않는다.
- 동일 키의 동시 실패는 동일 Promise로 전달하되, 실패 뒤 캐시를 제거한다. 뒤의
  루트는 기존처럼 재시도하고, 각 경로의 기존 오류 메시지와 `failedPackages`
  항목을 유지한다.
- `--no-deps`의 pip source artifact 검증 모드는 키에 포함해, 허용 범위가
  넓은 조회 결과가 일반 의존성 모드로 새지 않게 한다.
- 기존 resolver 내부의 순환 의존성, 최대 깊이, 충돌 기록, 최종 패키지 병합
  정책은 변경하지 않는다.

## 검증 계획

1. `ResolutionSession` 단위 테스트로 success, in-flight 공유, reject 후 재시도,
   clone-on-read, 서로 다른 키 분리를 검증한다.
2. pip·conda·Maven·npm resolver 테스트에서 두 직접 루트가 공통 전이
   의존성을 가질 때 `getLatestVersion`을 포함한 공통 metadata/candidate producer가
   한 번만 호출되는지 검증한다.
3. pip index/대상 환경, conda channel/subdir, Maven 좌표·classifier 경계가 다른
   경우 재사용하지 않거나 원시 POM만 재사용하는 회귀 테스트를 추가한다. npm은
   현재 전달되는 입력만 키에 반영하는 테스트를 추가한다.
4. 공통 의존성의 일시적 실패가 다음 직접 루트에서 재시도되고, 각 직접 루트의
   best-effort/`--strict` 정책 및 오류 문맥을 유지하는지 검증한다.
5. 서로 다른 환경 옵션으로 동시에 두 `resolveAllDependencies()`를 실행해
   요청별 resolver 인스턴스와 세션 상태가 섞이지 않는지 검증한다.
6. 전체 test, lint, typecheck, build와 PR CI를 실행한다.

## 영향 문서

- `docs/shared-dependency.md`: 요청 단위 재사용, 키 격리, 로그 동작을 문서화한다.
- `docs/resolvers.md`: 라이브러리 resolver 공통 동작과 비범위를 문서화한다.
- 각 패키지 관리자 문서(pip, conda, Maven, npm): 자기 resolver의 재사용 경계와
  부모 문맥 보존을 문서화한다.
