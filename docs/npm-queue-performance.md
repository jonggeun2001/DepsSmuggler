# npm 의존성 큐 순서와 성능

`NpmResolver.buildDeps`는 매 항목마다 남은 배열 전체를 정렬하고 `shift()`하던 대기 큐를 `NpmDependencyQueue` 최소 힙으로 관리합니다. 삽입·소비는 각각 O(log n)이며, 원본 항목과 삽입 순번을 큐에 보관합니다. resolver를 다시 호출할 때 대기 항목과 순번을 초기화합니다.

## 순서와 결과 보존

비교 순서는 depth 오름차순, `path.localeCompare`, 동일 우선순위의 삽입 순서입니다. 여기서 path는 enqueue 시점의 **parentPath**이며 패키지명이나 최종 설치 경로가 아닙니다. 같은 부모의 `z-child`, `a-child` 입력은 이 순서로 처리합니다. prod/dev/optional/peer를 큐에 넣는 기존 순서도 유지합니다.

큐 순서는 KEEP/REPLACE/충돌·중첩 배치에 영향을 줍니다. 단순 FIFO나 패키지명 정렬로 바꾸지 않습니다. 기존 `depsSeen`의 name/spec/depth 키, 최대 깊이·플랫폼·optional 실패 처리, 버전 선택과 tree manager의 hoisting 정책은 유지합니다. 서로 다른 부모에서 같은 방문 키가 나오는 처리도 이번 수정에서 바꾸지 않습니다.

## 검증

```bash
bash scripts/verify-worktree.sh src/core/resolver/npm-resolver.test.ts src/core/resolver/npm-dependency-queue.test.ts src/core/resolver/npm-queue-equivalence.test.ts
node scripts/profile-npm-queue.mjs 93c25d6
```

큐 테스트는 삽입·소비 교차, Unicode/동순위 부모 경로, 같은 부모의 이름과 무관한 순서, 빈 큐·단일 항목·초기화 및 10,000개 비교 횟수를 확인합니다. 시간 임계값으로 테스트를 판정하지 않습니다.

동등성 테스트는 실제 공개 resolver와 버전/트리 서비스를 사용하며 원격 packument만 고정 응답으로 대체합니다. 변경 전의 stable sort+shift 큐를 비교 기준으로 주입해 실제 처리 순서와 전체 결과(root/flatList/버전/hoistedPath/충돌)를 대조합니다. dev/optional/peer·누락된 optional, preferDedupe, nested 전략, 최대 깊이와 동일 resolver 재사용을 포함합니다.

## 규모별 측정

스크립트는 production 소스를 메모리에서 로드하고 공개 `resolveDependencies`를 실행합니다. 네트워크/버전 서비스만 고정 응답으로 대체하며 실제 tree manager를 실행합니다. 각 크기·변경본마다 새 프로세스를 사용하고, 큐 비교 횟수·전체 처리 시간·CPU 시간·직전 예약한 0ms 타이머 지연을 기록합니다. 결과 전체의 digest와 패키지 수·순서·버전·설치 경로·충돌을 전후 비교합니다. 앱 빌드·설치나 외부 네트워크는 필요하지 않습니다.

2026-09-28, macOS 26.3 / Apple M4 arm64 / Electron 44.3.0의 Node 24.20.0, 크기별 전후 각 1회:

| 형제 수 | 비교 횟수 기준 → 변경 | 처리 시간 기준 → 변경 | 0ms 타이머 지연 기준 → 변경 | CPU 시간 기준 → 변경 |
|---:|---:|---:|---:|---:|
| 100 | 5,064 → 944 | 4.12 → 4.54ms | 4.14 → 4.55ms | 7.23 → 8.86ms |
| 1,000 | 499,500 → 15,965 | 9.65 → 5.64ms | 9.68 → 5.66ms | 14.39 → 10.13ms |
| 10,000 | 49,995,000 → 226,682 | 381.51 → 16.42ms | 381.54 → 16.45ms | 391.46 → 29.74ms |

전체 큐 정렬 호출은 각각 100/1,000/10,000회에서 모두 0회가 됩니다. 비교 계측 비용과 resolver의 객체 생성·비동기 처리도 포함합니다. V8 최적화 상태에 따라 작은 배열의 정렬 비교 횟수에는 추가 비교가 생길 수 있습니다.

10,000개 직접 의존성은 이차 증가를 드러내는 stress fixture이며 일반 프로젝트의 평균 구성이 아닙니다. 작은 100개 입력의 시간/CPU는 개선되지 않았으며 단일 측정으로 일반화하지 않습니다. 실제 네트워크·전체 앱 CPU·모든 OS 성능을 측정한 결과가 아니고, 메인 루프의 모든 작업을 비동기화하는 변경도 아닙니다. P3 규모 개선으로 다룹니다.
