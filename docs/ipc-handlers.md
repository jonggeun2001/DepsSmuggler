# IPC 핸들러 모듈

## 개요
- 목적: Electron 메인 프로세스의 IPC 핸들러를 기능별로 모듈화
- 위치: `electron/`

---

## 모듈 구조

기존 `electron/main.ts`에 있던 IPC 핸들러들이 기능별로 분리됨:

```
electron/
├── main.ts                # 메인 프로세스 진입점 (핸들러 등록 호출)
├── preload.ts             # 프리로드 스크립트
├── cache-handlers.ts      # 캐시 관련 IPC 핸들러
├── config-handlers.ts     # 설정 관련 IPC 핸들러
├── download-handlers.ts   # 다운로드 관련 IPC 핸들러
├── history-handlers.ts    # 히스토리 관련 IPC 핸들러
├── search-handlers.ts     # 검색/의존성 해결 IPC 핸들러
└── os-package-handlers.ts # OS 패키지 관련 IPC 핸들러
```

---

## cache-handlers.ts

### 개요
캐시 통계 조회, 캐시 삭제, Docker 카탈로그 캐시 관리

### 함수

| 함수 | 설명 |
|------|------|
| `registerCacheHandlers()` | 캐시 관련 IPC 핸들러 등록 |

### 등록되는 IPC 채널

| 채널 | 설명 |
|------|------|
| `cache:stats` | 전체 캐시 통계 조회 (pip, npm, maven, conda) |
| `cache:clear` | 모든 캐시 삭제 |
| `docker:cache:refresh` | Docker 카탈로그 캐시 갱신 |
| `docker:cache:status` | Docker 카탈로그 캐시 상태 조회 |
| `docker:cache:clear` | Docker 카탈로그 캐시 삭제 |

### 반환 타입

#### cache:stats
```typescript
{
  totalSize: number;      // 전체 캐시 크기 (바이트)
  entryCount: number;     // 전체 캐시 항목 수
  details: {
    pip: CacheStats;
    npm: CacheStats;
    maven: CacheStats;
    conda: CacheStats;
  };
}
```

---

## config-handlers.ts

### 개요
애플리케이션 설정 로드, 저장, 초기화

### 함수

| 함수 | 설명 |
|------|------|
| `registerConfigHandlers()` | 설정 관련 IPC 핸들러 등록 |

### 등록되는 IPC 채널

| 채널 | 파라미터 | 설명 |
|------|----------|------|
| `config:get` | - | 설정 파일 로드 |
| `config:set` | config: unknown | 설정 저장 |
| `config:reset` | - | 설정 초기화 (파일 삭제) |
| `config:getPath` | - | 설정 파일 경로 반환 |

### 설정 파일 위치
- macOS: `~/Library/Application Support/depssmuggler/settings.json`
- Windows: `%APPDATA%/depssmuggler/settings.json`
- Linux: `~/.config/depssmuggler/settings.json`

---

## download-handlers.ts

### 개요
패키지 다운로드 시작, 일시정지, 재개, 취소 및 출력 경로 관리

### 함수

| 함수 | 파라미터 | 설명 |
|------|----------|------|
| `registerDownloadHandlers(windowGetter)` | `() => BrowserWindow \| null` | 다운로드 핸들러 등록 |

### 등록되는 IPC 채널

| 채널 | 파라미터 | 설명 |
|------|----------|------|
| `download:start` | `{ packages, options }` | 다운로드 시작 (동시 다운로드 지원) |
| `download:pause` | - | 다운로드 일시정지 |
| `download:resume` | - | 다운로드 재개 |
| `download:cancel` | - | 다운로드 취소 |
| `download:check-path` | outputDir: string | 출력 폴더 상태 확인 |
| `download:clear-path` | outputDir: string | 출력 폴더 비우기 |

### 다운로드 옵션

```typescript
interface DownloadOptions {
  outputDir: string;                       // 출력 디렉토리
  outputFormat: 'zip' | 'tar.gz' | 'mirror'; // 출력 형식
  includeScripts: boolean;                 // 설치 스크립트 포함
  targetOS?: string;                       // 타겟 OS
  architecture?: string;                   // 타겟 아키텍처
  pythonVersion?: string;                  // Python 버전
  concurrency?: number;                    // 동시 다운로드 수 (기본: 3)
}
```

### 이벤트 (렌더러로 전송)

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `download:status` | `{ phase, message }` | 다운로드 상태 변경 |
| `download:progress` | `{ packageId, status, progress, ... }` | 개별 패키지 진행률 |
| `download:all-complete` | `{ success, outputPath, results }` | 전체 다운로드 완료 |

### 지원 패키지 타입별 처리

| 타입 | 처리 방식 |
|------|----------|
| pip | PyPI에서 wheel/sdist 다운로드 |
| conda | Anaconda 채널에서 .conda/.tar.bz2 다운로드 |
| npm | npm registry에서 tarball 다운로드 |
| maven | jar, pom, sha1 파일 다운로드 (.m2 구조 + flat 구조) |
| docker | 레이어별 다운로드 후 tar 생성 |
| yum/apt/apk | OS 패키지 저장소에서 rpm/deb/apk 다운로드 |

---

## history-handlers.ts

### 개요
다운로드 히스토리 관리 (CRUD)

### 함수

| 함수 | 설명 |
|------|------|
| `registerHistoryHandlers()` | 히스토리 관련 IPC 핸들러 등록 |

### 등록되는 IPC 채널

| 채널 | 파라미터 | 설명 |
|------|----------|------|
| `history:load` | - | 히스토리 목록 로드 |
| `history:save` | histories: unknown[] | 히스토리 전체 저장 |
| `history:add` | history: unknown | 히스토리 항목 추가 (최대 100개 유지) |
| `history:delete` | id: string | 특정 히스토리 삭제 |
| `history:clear` | - | 전체 히스토리 삭제 |

### 히스토리 파일 위치
- `~/.depssmuggler/history/history.json`

---

## search-handlers.ts

### 개요
패키지 검색, 버전 조회, 자동완성 제안, 의존성 해결

### 함수

| 함수 | 설명 |
|------|------|
| `registerSearchHandlers()` | 검색 관련 IPC 핸들러 등록 |

### 등록되는 IPC 채널

| 채널 | 파라미터 | 설명 |
|------|----------|------|
| `search:packages` | type, query, options? | 패키지 검색 |
| `search:versions` | type, packageName, options? | 버전 목록 조회 |
| `search:suggest` | type, query, options? | 자동완성 제안 (2자 이상) |
| `dependency:resolve` | `{ packages, options }` | 의존성 해결 |

`dependency:resolve`의 `options.includeDependencies`가 `false`이면 메인 프로세스는 원본 패키지 목록만 반환합니다. 렌더러는 이를 이용해 의존성 포함 다운로드를 끈 상태에서도 동일한 IPC 계약을 유지할 수 있습니다.

### 지원 패키지 타입

- `pip`: PyPI 검색 (Simple API + JSON API)
- `conda`: Anaconda 채널 검색 (conda-forge, anaconda, bioconda, pytorch)
- `maven`: Maven Central 검색 (groupId, artifactId, popularityCount 포함)
- `npm`: npm Registry 검색
- `docker`: Docker Hub 검색 (레지스트리 지정 가능)
- `yum`: YUM 저장소 검색

### Maven 네이티브 라이브러리 관련 IPC

| 채널 | 파라미터 | 반환값 | 설명 |
|------|----------|--------|------|
| `maven:isNativeArtifact` | `groupId, artifactId, version?` | `boolean` | 네이티브 아티팩트 여부 확인 (Maven Central API) |
| `maven:getAvailableClassifiers` | `groupId, artifactId, version?` | `string[]` | 사용 가능한 classifier 목록 조회 |

### Maven 검색 결과 필드

```typescript
interface MavenSearchResult {
  name: string;              // "groupId:artifactId" 형식
  version: string;
  description: string;
  popularityCount?: number;  // 인기도 (다운로드 수)
  groupId: string;           // Maven groupId
  artifactId: string;        // Maven artifactId
}
```

### 검색 결과 정렬
검색 결과는 관련성 점수로 정렬됨 (search-utils.ts의 `sortByRelevance` 사용)

### 자동완성 캐싱
- 캐시 TTL: 5분
- 검색 타임아웃: 3초
- 최대 제안 수: 10개

### 의존성 해결 이벤트

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `dependency:progress` | progress 객체 | 의존성 해결 진행 상황 |

---

## 사용 예시

### main.ts에서 핸들러 등록

```typescript
import { registerCacheHandlers } from './cache-handlers';
import { registerConfigHandlers } from './config-handlers';
import { registerDownloadHandlers } from './download-handlers';
import { registerHistoryHandlers } from './history-handlers';
import { registerSearchHandlers } from './search-handlers';
import { registerOsPackageHandlers } from './os-package-handlers';

function createWindow() {
  const mainWindow = new BrowserWindow({ ... });

  // IPC 핸들러 등록
  registerCacheHandlers();
  registerConfigHandlers();
  registerDownloadHandlers(() => mainWindow);
  registerHistoryHandlers();
  registerSearchHandlers();
  registerOsPackageHandlers();
}
```

### 렌더러에서 IPC 호출

```typescript
// preload.ts에서 노출된 API 사용
const stats = await window.electronAPI.cache.getStats();
const settings = await window.electronAPI.config.get();
await window.electronAPI.download.start({ packages, options });
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Electron & Renderer 문서](./electron-renderer.md)
- [Shared Utilities](./shared-utilities.md)
