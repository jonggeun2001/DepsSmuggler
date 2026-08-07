# pip source artifact 정책 설계

## 배경

대상 Python·OS·아키텍처에 맞는 wheel이 없는 경우, 폐쇄망 반입물에는 해당 환경에서 빌드할 수 있는 source distribution(sdist)이 필요하다. 하지만 일부 PyPI 릴리스는 특정 CPython ABI wheel만 제공하고 sdist를 제공하지 않는다. 예를 들어 `dhn_med_py`는 CPython 3.13 대상에 호환되는 wheel과 sdist가 모두 없다.

## 결정

1. 대상 환경과 호환되는 wheel이 있으면 wheel을 선택한다.
2. 호환 wheel이 없고 대상 Python의 `Requires-Python` 조건을 만족하는 sdist가 있으면 sdist를 선택해 반입한다.
3. wheel과 sdist 모두 없으면 외부 소스 저장소를 추정하거나 clone하지 않는다. 해당 직접 루트를 해결 실패로 처리한다.
4. 기본 CLI 모드에서는 실패한 직접 루트만 건너뛰고 다른 루트의 다운로드를 계속한다. `--strict`에서는 기존 정책대로 전체 명령을 실패시킨다.
5. DepsSmuggler는 sdist를 다운로드·패키징할 뿐 대상 환경에서 wheel을 빌드하지 않는다. 빌드는 폐쇄망의 Python/컴파일러/빌드 의존성으로 수행한다.

## 구현 범위

`PipResolver`의 PyPI JSON API 및 Simple API 후보 선택 경로에서 후보가 없을 때 다음 정보를 포함한 진단 오류를 만든다.

- 패키지명과 버전
- 대상 Python·OS·아키텍처
- 호환 wheel 부재
- Python 요구 조건을 만족하는 sdist 부재

이 오류는 현재의 직접 루트 실패 수집 경로로 전달한다. 수집·다운로드 흐름, 외부 VCS 접근, source build, 새로운 설정 값은 추가하지 않는다.

## 테스트

- Python 3.13 대상에서 `cp312` Linux wheel만 있는 릴리스는 sdist 부재 진단과 함께 직접 루트 실패가 된다.
- 동일 조건에서 `tar.gz`, `zip`, `tar.bz2`, `tar.xz` sdist가 있으면 해당 source artifact를 선택한다.
- 여러 루트 CLI 실행에서 이 실패는 기본 모드에선 해당 루트만 제외하고, `--strict`에선 전체 실패로 이어진다.
- 기존 호환 wheel 선택 및 checksum 보존 동작은 유지한다.

## 문서 영향

- `docs/cli.md`: 대상 환경에 맞는 wheel이 없을 때의 sdist 반입 및 부재 시 skip/strict 정책을 명시한다.
- `docs/resolvers.md`: pip 후보 선택 순서와 sdist가 없을 때의 fail-closed 동작을 명시한다.

## 검증

- 관련 pip resolver 및 CLI 단위 테스트
- 전체 `scripts/verify-worktree.sh`
- lint 및 TypeScript build
