# CLI npm Search Design

## 배경

CLI `search` 명령은 `pip`, `conda`, `maven`, `docker`만 직접 검색하고 있었지만, npm downloader에는 이미 `searchPackages()` 구현이 존재한다. 이 불일치 때문에 README와 CLI 문서도 npm search를 미지원으로 설명하고 있다.

## 목표

- `depssmuggler search <query> -t npm`를 기존 검색 타입과 같은 출력 형식으로 지원한다.
- 성공, 빈 결과, 실패 처리 메시지를 기존 `search` 명령의 패턴과 동일하게 유지한다.
- 변경 범위는 CLI search 명령, 관련 테스트, 그리고 영향받는 문서로 제한한다.

## 설계

### 접근

- `src/cli/commands/search.ts`에 `npm` 분기를 추가한다.
- 구현은 기존 `getNpmDownloader().searchPackages(query)`를 그대로 재사용한다.
- 결과 매핑은 다른 타입과 동일하게 `{ name, version, description }` 구조로 변환한다.
- 기존 `limit` 절단, 테이블 출력, 다운로드 예시 출력, 실패 처리 코드는 공통 흐름을 그대로 사용한다.

### 테스트

- 새 CLI 단위 테스트에서 npm 검색 성공, 빈 결과, 실패를 고정한다.
- downloader 자체 검색 구현은 이미 별도 테스트가 있으므로 CLI에서는 분기 연결과 출력/종료 동작만 검증한다.

### 문서

- `docs/cli.md`와 `README.md`에서 npm CLI search 지원 여부를 실제 구현 기준으로 갱신한다.
