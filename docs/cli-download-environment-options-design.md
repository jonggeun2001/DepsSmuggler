# CLI 다운로드 대상 환경 옵션 설계

## 배경

`depssmuggler download`는 현재 패키지 타입, 패키지 버전, 아키텍처, 출력 형식과 의존성 포함 여부를 받을 수 있다. 그러나 핵심 의존성 해결기는 대상 OS, Python 버전, CUDA 버전, Conda 채널을 지원하고 Maven resolver는 classifier를 지원하는데도 일반 CLI가 이 값을 노출하거나 전달하지 않는다.

그 결과 GUI에서 선택할 수 있는 대상 환경과 CLI 자동화에서 지정할 수 있는 대상 환경 사이에 차이가 있다. 특히 pip wheel, Conda 빌드와 Maven 네이티브 아티팩트는 대상 환경 정보가 없으면 사용자가 의도한 파일과 다른 결과를 고를 수 있다.

## 목표

일반 `download` 명령에 핵심 로직이 이미 지원하는 대상 환경 옵션을 노출하고, 옵션이 의존성 해결뿐 아니라 실제 다운로드 큐의 아티팩트 메타데이터까지 유지되도록 한다.

지원할 옵션은 다음과 같다.

| 옵션 | 기본값 | 적용 대상 | 역할 |
|------|--------|-----------|------|
| `--arch <arch>` | `x86_64` | 전체 | 기존 옵션을 유지하고 허용 값을 검증한다. |
| `--target-os <os>` | `any` | pip, conda, Maven | `any`, `linux`, `windows`, `macos` 중 대상 OS를 지정한다. |
| `--python-version <version>` | 없음 | pip, conda | `major.minor` 형식의 Python 버전을 지정한다. |
| `--cuda-version <version>` | 없음 | conda | `major.minor` 형식의 CUDA 호환 버전을 지정한다. |
| `--conda-channel <channel>` | `conda-forge` | conda | 패키지와 의존성을 조회할 Conda 채널을 지정한다. |
| `--classifier <classifier>` | 없음 | Maven | 네이티브 또는 변형 아티팩트 classifier를 명시한다. |

셸 환경변수 지원, GUI 변경, `depssmuggler os download` 변경, 프라이빗 저장소 인증은 범위에 포함하지 않는다.

## CLI 계약과 검증

옵션 이름은 Commander의 kebab-case 규칙을 따라 기존 `downloadCommand` 옵션 객체의 camelCase 필드로 전달한다.

- 아키텍처는 프로젝트의 `Architecture` 공개 타입에 정의된 값만 허용한다.
- 대상 OS는 `any`, `linux`, `windows`, `macos`만 허용한다.
- Python 및 CUDA 버전은 현재 resolver가 안정적으로 처리하는 `major.minor` 형식만 허용한다.
- `--python-version`은 `pip`와 `conda`에서만 허용한다.
- `--cuda-version`은 `conda`에서만 허용한다.
- `--classifier`는 `maven`에서만 허용한다.
- 잘못된 값이나 적용할 수 없는 조합은 다운로드나 파일 생성 전에 한글 오류로 실패시킨다.
- `--conda-channel`의 기본값은 다른 타입에서 무시되며, 사용자가 명시하는 별도 여부를 추적하지 않는다.

기존 옵션만 사용하는 명령은 기존 기본값과 동작을 유지한다.

## 데이터 흐름

```text
Commander download options
        |
        v
CLI 옵션 검증 및 PackageInfo 구성
        |
        +--> Maven classifier를 원본 패키지 메타데이터에 반영
        |
        v
preparePackagesForDownload
        |
        +--> architecture / targetOS / pythonVersion
        +--> cudaVersion / condaChannel
        |
        v
resolveAllDependencies
        |
        +--> resolver가 선택한 root/의존성 metadata 병합
        |    (downloadUrl, filename, subdir, classifier 등)
        |
        v
DownloadManager queue
        |
        v
패키지별 downloader가 선택된 metadata로 실제 파일 다운로드
```

의존성을 포함하지 않는 경우에도 pip, conda, Maven처럼 대상 환경이 아티팩트 선택에 영향을 주는 타입은 깊이 0으로 루트 패키지만 해결한다. 해결된 의존성은 큐에 넣지 않으며, 루트 아티팩트의 메타데이터만 사용한다. npm과 Docker는 기존 `--no-deps` 경로를 그대로 사용한다.

`resolveAllDependencies`는 이미 요청 패키지를 결과 맵에 먼저 넣으므로, 동일 키의 resolver 결과를 단순히 건너뛰지 않고 resolver가 제공한 메타데이터와 파일 정보를 기존 항목에 병합한다. 이 변경으로 Conda 루트 패키지와 Maven classifier 같은 선택 결과가 CLI 다운로드 단계까지 보존된다.

pip downloader는 전달받은 `metadata.downloadUrl`이 있으면 해당 URL과 체크섬을 우선 사용한다. URL이 없을 때만 기존 PyPI 메타데이터 조회 경로로 폴백한다. 이 동작은 resolver가 고른 wheel과 실제 다운로드 파일이 달라지는 문제를 막는다.

## 오류 처리

- 옵션 검증 오류는 네트워크 요청과 출력 디렉터리 생성 전에 발생한다.
- 깊이 0 루트 아티팩트 해결에 실패하면 기존 의존성 해결 실패와 같은 CLI 실패 경로를 사용한다.
- resolver가 다운로드 URL을 제공하지 못하면 downloader의 기존 메타데이터 조회 폴백을 유지한다.
- 기존 네트워크 오류의 재시도·실패 출력 동작은 변경하지 않는다.

## 테스트 전략

1. CLI command 테스트에서 각 환경 옵션이 `resolveAllDependencies`로 전달되는지 확인한다.
2. 잘못된 OS, 아키텍처, Python/CUDA 버전과 패키지 타입별 잘못된 조합이 다운로드 시작 전에 거부되는지 확인한다.
3. `--no-deps`에서 환경 민감 타입은 깊이 0 루트 해결만 수행하고 의존성을 큐에 추가하지 않는지 확인한다.
4. 공용 dependency resolver 테스트에서 기존 루트 패키지에 resolver의 URL, 파일명, classifier 메타데이터가 병합되는지 확인한다.
5. pip downloader 테스트에서 전달된 URL을 재조회 없이 사용하는지 확인한다.
6. 관련 단위 테스트, 저장소 표준 worktree 검증 스크립트, TypeScript 빌드를 실행한다.

## 문서 영향

- `docs/cli.md`: 옵션 표, 타입별 적용 범위, 유효 값, 예시와 검증 규칙을 추가한다.
- `README.md`: pip, conda, Maven의 대상 환경 지정 예시를 추가한다.
- API, IPC, GUI, 운영 배포 절차에는 변경이 없다.
