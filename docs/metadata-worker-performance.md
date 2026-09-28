# Conda/YUM 메타데이터 Worker (#185)

Conda repodata의 읽기·zstd 해제·JSON 파싱·저장·이름 인덱싱과 YUM primary의 gzip 해제·XML 파싱·패키지 변환을 `worker_threads`로 옮겼습니다. 큰 원본 객체를 메인 프로세스로 복사하지 않습니다. Worker는 CPU 작업을 분리하며 전체 작업량 자체를 없애지는 않습니다. [Node Worker 문서](https://nodejs.org/api/worker_threads.html)

## 경계와 유지되는 동작

- Conda의 `fetchRepodata()`는 원본 대신 `RepodataReference`와 캐시 메타데이터를 반환합니다. `queryRepodata(reference, name)`으로 해당 이름의 `packages`/`packages.conda`만 받습니다. resolver, downloader, URL 헬퍼가 같은 경로를 사용합니다. 일반 이름 검색은 기존 Anaconda API 경로입니다.
- HTTP는 호출 프로세스의 axios로 수행합니다. 기존 인증서 신뢰·axios 기본 설정·조건부 헤더·타임아웃을 유지하고 `arraybuffer` 응답을 Worker로 전달하므로 axios의 대용량 JSON 파싱도 메인에서 실행되지 않습니다. 전달할 독립 ArrayBuffer를 만들 때는 바이트 복사 비용이 남습니다. Worker 로그는 기존 메인 로거의 마스킹·파일 저장을 사용하고, 길이를 아는 HTTP 응답의 20%p 진행 로그도 유지합니다.
- TTL은 `max(서버 max-age, 24시간)`이며 강제 갱신, ETag/Last-Modified와 304, 손상된 디스크 JSON의 네트워크 재시도, zstd → current JSON → full JSON 순서를 유지합니다. 같은 옵션의 진행 중인 로드는 하나로 합치고 완료 후 Promise를 제거합니다.
- 데이터/메타 파일의 inode·mtime·크기를 확인하여 외부 교체·정리 뒤에는 인덱스도 다시 만듭니다. 새로고침이나 Worker 종료 이후에도 참조로 다시 조회할 수 있습니다. 참조는 고정된 과거 스냅샷이 아니며, 갱신된 디스크 데이터의 인덱스를 사용합니다.
- 플랫폼·noarch·Python·CUDA·build 필터와 정렬은 기존 processor가 수행합니다. downloader의 정확한 버전·최고 build 선택, URL 헬퍼의 Python 선호와 API fallback도 유지합니다. 두 선택 정책을 합치지 않습니다.
- YUM의 작은 `repomd.xml`은 기존 경로이며 큰 primary만 Worker에서 처리합니다. 메인에는 resolver/저장소 생성에 필요한 `OSPackageInfo[]`를 한 번 전달합니다. 버전 문자열, 의존성, provides, primary 파일과 XML 엔티티 제한을 보존합니다. 비압축 primary 바이트도 UTF-8로 읽습니다.
- YUM 취소는 실행 중인 Worker를 종료한 뒤 `AbortError`로 전달합니다. 실패한 작업의 뒤에 대기 중인 작업은 새 Worker에서 계속할 수 있습니다. 파싱 오류는 정상 빈 목록으로 바꾸지 않습니다.

## 메모리와 수명

Conda/YUM에 각각 최대 한 개의 활성 Worker를 사용하고 종류별 요청을 직렬 처리합니다. Conda 인덱스는 최대 2개, 합계 원본 JSON 256 MiB를 기준으로 제한합니다. 기존 인덱스가 2개이거나 원본 합계가 128 MiB를 넘으면 다음 파싱 전에 해제합니다. 256 MiB를 넘는 단일 데이터는 현재 조회에만 쓰고 보관하지 않으므로 후속 조회 때 재파싱할 수 있습니다. 원본 전체를 중복 보관하는 전역 캐시는 없습니다.

각 Worker는 30초 동안 요청이 없으면 종료하고 유휴 중에는 프로세스 종료를 막지 않습니다. 명시적 `closeRepodataWorker()`/`closeYumMetadataWorker()`도 제공합니다. 필요하면 참조의 디스크 위치 또는 HTTP 옵션으로 다시 로드합니다. `useCache: false`는 디스크를 쓰지 않으며 종료 후에는 다시 HTTP를 요청합니다.

Worker V8 old-generation 한도는 1,024 MiB입니다. 이는 프로세스 RSS나 압축 해제 버퍼의 절대 상한이 아닙니다. 원본 크기 기준 인덱스 예산도 실제 객체 메모리 크기와 같지 않습니다. 파싱 중 원문·파싱 결과·인덱스가 잠시 공존할 수 있고, 종료 후 할당자가 반환한 메모리가 OS RSS에 즉시 반영된다는 보장은 없습니다. Worker 오류/비정상 종료는 호출자에게 전달하고 다음 요청에서 새 Worker를 생성합니다.

## 재현과 측정

```bash
node scripts/profile-metadata-workers.mjs 325d52a
# 같은 실데이터 파일로 전후 비교 (네트워크 사용 없음)
REPODATA_FIXTURE=/path/to/repodata.json node scripts/profile-metadata-workers.mjs 325d52a
```

스크립트는 source를 메모리에서 변환하므로 앱 빌드를 하지 않습니다. baseline의 cache/processor/YUM 코드를 git에서 읽고 나머지 의존성은 같은 환경을 사용합니다. Conda 기본 fixture는 100,000개 합성 항목, YUM은 20,000개 합성 패키지입니다. 조건별 새 프로세스에서 한 번 실행하며 10ms heartbeat, 전체 프로세스 CPU·RSS와 메인 isolate heap을 측정합니다. RSS에는 Worker가 포함됩니다. Conda 반환 후보 순서와 YUM 개수·버전 보존도 검증합니다.

2026-09-28, macOS 26.3 / Apple M4 arm64, Electron 44.3.0의 Node 24.20.0에서 측정했습니다. Conda는 동일한 conda-forge noarch 168,395,329-byte 파일을 사용했습니다. YUM은 동일한 16,737,801-byte XML을 gzip으로 전달했습니다.

| 경로 | 상태 | 첫 조회 ms | CPU ms | 최대 heartbeat 간격 ms | 최대 RSS 증가 MiB | 메인 heap 증가 MiB |
|---|---|---:|---:|---:|---:|---:|
| Conda 읽기+인덱스+six 후보 | 이전 | 594.5 | 745.7 | 594.5 | 430.5 | 378.6 |
| Conda 읽기+인덱스+six 후보 | Worker | 723.7 | 992.9 | 12.1 | 485.2 | 0.4 |
| YUM primary 20,000개 | 이전 | 305.5 | 421.1 | 305.6 | 141.3 | 63.1 |
| YUM primary 20,000개 | Worker | 454.8 | 670.6 | 17.6 | 200.6 | 21.0 |

Conda의 `six` 후보 6개와 정렬 순서는 같고 Worker 응답은 2,225 bytes였습니다. 첫 Worker 시작 시 source용 ts-node 로더 비용도 포함됩니다. 메인 응답성은 개선되지만 이 측정에서는 첫 조회 시간·CPU·전체 RSS가 늘었습니다. 패키징된 앱의 평균 응답시간, 모든 채널의 메모리 감소, 네트워크 속도 개선으로 일반화하지 않습니다. YUM 정규화 목록의 메인 수신·후속 resolver 인덱싱과 별도 OS 캐시 JSON 읽기는 남아 있습니다.

## 검증과 배포

`conda-cache.test.ts`, `conda-utils.test.ts`, `conda-resolver-target.test.ts`, `conda.test.ts`에서 실제 Worker와 바이트 fixture 또는 기존 선택 fixture를 사용합니다. `worker-client.test.ts`는 작업 직렬화·유휴 종료·취소·Worker 실패·HTTP 전달 계약을 검사합니다. `os-metadata-parsers.test.ts`와 YUM 전달물 통합 테스트는 실제 Worker 변환 뒤 버전·엔티티 제한·provides·파일 정보를 확인합니다.

컴파일된 앱은 `dist/src/core/shared/metadata/*-worker.js`를 사용하며 기존 `tsconfig.electron.json`/패키지 `dist/**/*` 포함 규칙이 적용됩니다. 소스 CLI/테스트만 기존 개발 의존성 ts-node를 사용합니다. 새로운 설치 단계나 사용자 설정·IPC 계약·디스크 캐시 스키마 변경은 없습니다.
