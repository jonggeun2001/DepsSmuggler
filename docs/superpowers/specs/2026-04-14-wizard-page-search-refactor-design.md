# WizardPage 검색 리팩터링 설계

## 배경

`src/renderer/pages/WizardPage.tsx`는 현재 다음 책임을 한 파일에서 동시에 수행한다.

- URL query param(`type`) 해석 및 소비
- package type별 검색 전략 분기
- Electron IPC 우선, HTTP fallback 처리
- OS 패키지 검색/배포판 선택/아키텍처 분기
- 버전 조회와 Maven classifier 부가 조회
- 검색 결과 선택과 step 전이

이 구조는 검색 계약을 UI와 분리해 테스트하기 어렵고, OS 검색 경로와 일반 패키지 검색 경로의 중복도 크다.

## 목표

- `WizardPage` 본체에는 화면 조합과 props 바인딩만 남긴다.
- 검색/버전조회 계약은 테스트 가능한 함수와 훅으로 분리한다.
- package type별 검색 전략, Electron/HTTP fallback, query param 동기화, OS 검색 분기를 별도 모듈로 이동한다.
- 기존 UI 동작과 사용자 흐름은 유지한다.

## 비목표

- Wizard step 구조 자체의 재설계
- Cart/Download 흐름의 동작 변경
- Settings 저장 구조 변경
- OS 검색 전용 컴포넌트(`OSPackageSearch`)와의 광범위한 통합 리팩터링

## 제안 구조

### 1. 오케스트레이션 훅

새 훅 `src/renderer/pages/wizard-page/useWizardSearchFlow.ts`를 도입한다.

역할:

- 검색 입력 상태와 디바운스
- 검색 실행과 검색 결과 상태
- 패키지 선택 후 버전 조회
- step 전이 (`검색 -> 버전`)
- 선택 취소/검색 초기화
- 장바구니 추가에 필요한 계산값 조립

`WizardPage`는 이 훅이 반환하는 상태와 액션만 사용한다.

### 2. 검색 서비스

`src/renderer/pages/wizard-page/search-service.ts`

역할:

- package type별 검색 전략 선택
- Electron IPC 우선 사용
- IPC 미사용 시 HTTP endpoint fallback
- OS 패키지 검색 결과를 `SearchResult` UI 모델로 변환

핵심 API 예시:

```ts
searchPackagesByType(context, query): Promise<SearchResult[]>
searchSuggestionsByType(context, query): Promise<SearchResult[]>
```

서비스는 `fetch`, `electronAPI`를 외부 주입 가능하게 구성해 테스트 시 mock하기 쉽게 만든다.

### 3. 버전 조회 서비스

`src/renderer/pages/wizard-page/version-service.ts`

역할:

- package type별 버전 조회 전략 캡슐화
- Docker tag 조회, PyPI/Maven 버전 조회, Electron `search.versions` 우선 처리
- Maven classifier 관련 부가 데이터 조회
- OS 패키지는 검색 결과에 이미 포함된 버전 목록을 재사용

핵심 API 예시:

```ts
loadPackageVersions(context, record): Promise<VersionSelectionResult>
```

### 4. Query Param 모듈

`src/renderer/pages/wizard-page/query-params.ts`

역할:

- `type` query param 해석
- 유효한 `PackageType`인지 검증
- category, packageType, initialStep 계산
- 파라미터 소비 후 URL 정리 여부 결정

이 모듈은 React 없이 순수 함수로 유지한다.

### 5. OS Context 모듈

`src/renderer/pages/wizard-page/os-context.ts`

역할:

- `yum/apt/apk`별 배포판/아키텍처 선택 정보 계산
- 검색용 OS distribution payload 생성
- 장바구니용 `osContext` snapshot 생성
- package type별 effective architecture 계산

이 모듈은 기존 `WizardPage` 내부 switch들을 대체한다.

### 6. 타입 모듈

`src/renderer/pages/wizard-page/types.ts`

역할:

- `SearchResult`
- search context / version context
- classifier 조회 결과
- UI 훅과 서비스 사이의 공용 계약 정의

## 데이터 흐름

1. `WizardPage`가 settings/cart store와 router hook에서 필요한 값을 읽는다.
2. `useWizardSearchFlow`에 packageType, settings-derived context, store action을 전달한다.
3. 훅은 `search-service`를 통해 suggestion/full search를 수행한다.
4. 검색 결과 선택 시 `version-service`로 버전/부가 메타데이터를 조회한다.
5. OS package type은 `os-context`를 통해 distribution payload를 만들고 동일한 service 계약으로 실행한다.
6. query param 초기화는 `query-params`의 순수 함수 결과를 기반으로 페이지 초기 effect에서 처리한다.

## 기존 동작 유지 규칙

- package type별 검색 결과 형식은 현재 UI가 기대하는 구조를 유지한다.
- OS 검색은 여전히 배포판/아키텍처 설정을 사용한다.
- Electron IPC가 있으면 우선 사용하고, 없는 환경에서만 HTTP fallback을 탄다.
- pip custom index, docker custom registry, conda channel, Maven classifier 동작을 유지한다.
- step 흐름은 `카테고리 -> 패키지 타입 -> 검색 -> 버전`을 유지한다.

## 테스트 전략

### 단위 테스트

- `query-params.test.ts`
  - 유효한 `type` 파라미터 해석
  - 무효한 `type` 무시
  - 카테고리/step 계산

- `os-context.test.ts`
  - package type별 distribution/architecture 선택
  - 장바구니용 `osContext` 생성
  - effective architecture 계산

- `search-service.test.ts`
  - package type별 전략 선택
  - Electron IPC 우선
  - HTTP fallback
  - OS 검색 결과 매핑
  - pip/docker/conda 옵션 전달

- `version-service.test.ts`
  - Electron `search.versions` 우선
  - PyPI/Maven/Docker fallback
  - OS 버전 목록 재사용
  - Maven classifier 조회 결과 조립

### 통합 수준 검증

- `useWizardSearchFlow`는 필요한 핵심 시나리오만 얇게 검증한다.
- 복잡한 분기 대부분은 순수 함수/service 테스트로 커버한다.

## 구현 순서

1. 순수 타입/헬퍼 모듈 추가
2. query param / OS context 테스트와 구현
3. search-service 테스트 작성 후 구현
4. version-service 테스트 작성 후 구현
5. `useWizardSearchFlow`로 페이지 상태 일부 이관
6. `WizardPage.tsx`를 조합형 컴포넌트로 축소
7. 관련 문서 업데이트 및 검증

## 리스크

- 현재 `WizardPage`가 store와 UI state를 많이 직접 소유하고 있어, 훅 경계 이동 시 빠진 상태가 생길 수 있다.
- Electron/HTTP fallback 경로가 package type마다 미묘하게 달라 회귀 가능성이 있다.
- Maven classifier와 pip custom index는 일반 검색 흐름에 비해 부가 상태가 많아 누락 위험이 높다.

## 완성 기준

- `WizardPage.tsx`에서 검색/버전조회 세부 구현이 제거되고 UI 조합이 주가 된다.
- 검색과 버전조회 계약이 별도 모듈에서 테스트 가능하다.
- query param sync, OS distribution 분기, fallback 로직이 페이지 밖으로 이동한다.
- 관련 테스트가 추가되고 기존 동작이 유지된다.
