# 의존성 트리 표시와 성능

## 표시 계약

`DependencyTree`는 resolver의 `root`와 다운로드 대상인 `flatList`를 변경하지 않습니다. 여러 부모가 같은 의존성을 가리키는 관계, Maven의 모든 버전·POM 수집, type/classifier 구분은 그대로 유지합니다.

`dependency-tree-model.ts`는 원본 객체를 반복문으로 한 번씩 방문하여 artifact별 인접 관계를 인덱싱합니다. 같은 artifact라도 서로 다른 원본 객체가 가진 자식 관계는 합칩니다. 표시용 트리는 너비 우선으로 만들며, 처음 만난 artifact만 자식을 펼치고 재방문은 점선 테두리와 `↗ 참조`가 있는 말단 노드로 표시합니다. 따라서 모든 부모 관계를 확인할 수 있고 순환 그래프도 유한하게 끝납니다. 참조 노드의 하위 관계는 해당 artifact가 처음 펼쳐진 위치에서 확인합니다.

표시 노드를 클릭하거나 키보드 Enter/Space로 선택하면 별도 lookup에서 그 관계의 원본 노드를 찾아 상세를 엽니다. 버전·Maven type·classifier는 노드 라벨/툴팁과 상세에서 확인할 수 있습니다. `react-d3-tree`가 복사하는 데이터에는 원본 하위 그래프를 넣지 않습니다.

## 단계적 표시와 저장 범위

- 처음에는 루트와 참조 노드를 포함해 최대 200개를 표시합니다. `200개 더 표시`를 누르면 한도가 늘어나고, 새 해결 결과를 받으면 200개로 초기화합니다.
- `표시 항목 n/전체개`의 전체는 고유 artifact 간 관계 수 + 루트 1개입니다. 고유 패키지 수와 다르며 현재 화면 밖에 배치된 노드도 포함합니다.
- 확대·축소와 드래그로 화면 밖 노드를 살펴볼 수 있습니다. 단계적 표시가 다운로드 대상을 줄이지는 않습니다.
- PNG/SVG는 **현재 확대·이동 상태의 500px 높이 표시 영역**을 저장합니다. 참조 표식과 표시 개수 안내를 포함하지만 화면 밖 노드, 아직 추가하지 않은 항목, 상세 창, 별도 `함께 다운로드할 POM` 목록은 포함하지 않습니다. 전체 그래프/전체 다운로드 목록 내보내기가 아닙니다.

전체 원본을 인덱싱하는 비용은 원본 객체와 그 관계 수에 비례합니다. 200개 한도는 초기 SVG/복사 대상에 적용되며 모든 입력 처리를 200개로 제한하지 않습니다. 사용자가 계속 추가하면 표시 비용도 증가합니다. 새로운 DAG 라이브러리나 가상화, 자동 전체 맞춤 배치는 도입하지 않았습니다.

## 재현과 측정

```bash
bash scripts/verify-worktree.sh \
  src/renderer/components/dependency-tree-model.test.ts \
  src/renderer/components/DependencyTree.test.tsx \
  src/core/shared/dependency-tree-utils.test.ts
node scripts/profile-dependency-tree.mjs a54f96c /tmp/dependency-tree-profile
```

지원 Node 22.13+/24와 프로젝트 의존성, Playwright Chromium이 있는 환경에서 실행합니다. 프로파일 스크립트는 실제 컴포넌트와 비교 커밋의 컴포넌트를 각각 독립 fixture로 메모리 안에서만 번들링합니다. 앱 빌드·설치나 외부 패키지 조회는 하지 않습니다. 결과 JSON, 화면 캡처, 실제 버튼으로 저장한 PNG/SVG를 지정한 폴더에 남깁니다.

fixture는 10층마다 두 artifact가 다음 층의 두 객체를 공유합니다. 루트를 포함한 고유 artifact는 21개, 관계는 38개입니다. 비교 기준 `a54f96c`는 경로별로 2,047개를 펼치지만 수정 후에는 **39개(참조 18개)**를 표시합니다. 전체 DOM은 12,365개에서 382개로 줄었습니다.

2026-09-28 macOS/Apple M4 arm64, Chromium 143.0.7499.4, React production fixture, 1280×900의 새 페이지에서 각 3회 측정했습니다. `flushSync` 첫 render/commit만 측정하며 layout 및 기존 300ms 애니메이션은 별도입니다. 첫 render/commit은 기존 **1,842.6 / 1,756.4 / 1,748.7ms**, 수정 후 **47.1 / 41.3 / 41.0ms**였고 별도 layout은 기존 2.0ms, 수정 후 0.3–0.4ms였습니다. 합성 공유 그래프의 비교이며 특정 실제 Maven 프로젝트나 전체 앱의 평균 지연으로 일반화하지 않습니다.

테스트는 모든 부모 관계, 같은 artifact의 서로 다른 문맥에서 발견한 자식, 버전/type/classifier 구분, 원본 불변성, 순환, 깊이 10,000의 입력, 초기/추가 표시 한도, 참조 상세와 키보드, PNG/SVG 저장 대상 DOM을 확인합니다. 브라우저 스크립트는 실제 저장 파일 형식과 SVG의 참조·범위 안내도 검사합니다.
