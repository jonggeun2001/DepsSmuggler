# 파일/경로 유틸리티

## 개요
- 목적: 파일 다운로드, 압축, 경로 처리, 스크립트 생성 유틸리티
- 위치: `src/core/shared/file-utils.ts`, `path-utils.ts`, `script-utils.ts`, `filename-utils.ts`

---

## 모듈 구조

```
src/core/shared/
├── file-utils.ts      # 파일 다운로드/압축 유틸리티
├── path-utils.ts      # 크로스 플랫폼 경로 처리
├── script-utils.ts    # 설치 스크립트 생성
└── filename-utils.ts  # Windows 호환 파일명 처리
```

---

## 파일 유틸리티 (`file-utils.ts`)

### downloadFile

파일 다운로드 (진행률 콜백 지원, 취소/일시정지 기능)

```typescript
async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
  options?: FileDownloadOptions
): Promise<void>
```

- HTTP/HTTPS 모두 지원
- 301/302의 `Location`으로 재귀 다운로드 (상대 URL은 현재 URL 기준으로 해석하며 최대 20회)
- AbortSignal을 통한 다운로드 취소
- shouldPause 콜백을 통한 일시정지/재개

현재 헬퍼는 대상 디렉토리를 생성하지 않으며 호출 중 발생한 abort 이벤트를 처리합니다. 이미 취소된 signal이면 요청을 시작하지 않습니다. 유효한 301/302 리다이렉트를 처리한 뒤, 2xx 응답만 파일 스트림에 연결하며 그 밖의 상태는 HTTP 상태 코드가 포함된 오류로 거부합니다. 오류 응답은 저장하지 않으며 대상 파일을 닫고 삭제한 뒤 실패를 반환하므로 이전 시도의 정리가 재시도한 파일을 지우지 않습니다. Location이 없는 redirect나 redirect 한도 초과도 실패입니다. 응답 스트림에서 `error`, `aborted`, `close`가 정상 완료 전에 발생하거나 Content-Length가 선언한 바이트를 받지 못하면 부분 파일을 닫고 삭제한 뒤 실패합니다. Content-Length가 없는 chunked 응답은 정상 `end`까지 도착하면 성공으로 처리합니다. `AbortSignal`에 의한 취소는 전송 중단 오류로 구분하며, 자동 재시도와 체크섬 검증은 이 함수에 포함되지 않습니다. 진행률의 total은 Content-Length가 없으면 0입니다.

### FileDownloadOptions

```typescript
interface FileDownloadOptions {
  signal?: AbortSignal;           // 취소 시그널 (AbortController.signal)
  shouldPause?: () => boolean;    // 일시정지 여부 콜백 (true면 pause)
}
```

### 일시정지/재개 동작

```typescript
// 일시정지 콜백이 true를 반환하면 스트림 pause
if (options?.shouldPause?.() && !isPaused) {
  isPaused = true;
  response.pause();

  // 100ms마다 재개 여부 체크
  pauseCheckInterval = setInterval(() => {
    if (!options?.shouldPause?.()) {
      isPaused = false;
      response.resume();
    }
  }, 100);
}
```

### 취소 처리

```typescript
// AbortSignal 등록
if (options?.signal) {
  options.signal.addEventListener('abort', () => {
    cleanup();
    request.destroy();
    file.close();
    fs.unlink(destPath, () => {});
    reject(new Error('Download aborted'));
  });
}
```

### 사용 예시

```typescript
import { downloadFile } from './file-utils';

const controller = new AbortController();
let paused = false;

const downloadPromise = downloadFile(
  'https://example.com/file.zip',
  '/path/to/file.zip',
  (downloaded, total) => {
    console.log(`${downloaded}/${total} bytes`);
  },
  {
    signal: controller.signal,
    shouldPause: () => paused,
  }
);

// 다운로드가 진행 중일 때 UI 이벤트 등에서 호출
const pause = () => { paused = true; };
const resume = () => { paused = false; };
const cancel = () => controller.abort();

await downloadPromise; // 취소하면 reject되므로 호출부에서 처리
```

### createZipArchive

ZIP 압축 파일 생성

```typescript
async function createZipArchive(
  sourceDir: string,
  outputPath: string
): Promise<void>
```

### createTarGzArchive

tar.gz 압축 파일 생성

```typescript
async function createTarGzArchive(
  sourceDir: string,
  outputPath: string
): Promise<void>
```

---

## 스크립트 유틸리티 (`script-utils.ts`)

### generateInstallScripts

설치 스크립트 생성 (Bash + PowerShell). 출력 디렉토리는 호출 전에 준비해야 합니다.

```typescript
function generateInstallScripts(
  outputDir: string,
  packages: DownloadPackage[]
): void
```

- `install.sh` (Bash): Linux/macOS용
- `install.ps1` (PowerShell): Windows용
- `docker-load.sh` (Bash): Docker 이미지 로드용 (Docker 패키지 포함 시 자동 생성)
- `docker-load.ps1` (PowerShell): Docker 이미지 로드용 (Docker 패키지 포함 시 자동 생성)

현재 일반 설치 스크립트는 pip와 Conda 항목 모두에 `pip install --no-index`를 생성하고 Maven은 아티팩트 위치를 안내합니다. npm/OS 패키지 전용 설치 명령은 이 헬퍼가 생성하지 않습니다. Conda 네이티브 아카이브 설치까지 지원하는 것으로 해석하면 안 됩니다. Python 검색 경로에는 `packages`와 모든 하위 디렉토리를 포함합니다.

### 생성되는 스크립트 예시

생성일과 일부 출력문을 생략한 예시입니다.

**install.sh:**
```bash
#!/bin/bash
# DepsSmuggler 설치 스크립트
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

PIP_FIND_LINK_ARGS=()
while IFS= read -r -d '' directory; do
    PIP_FIND_LINK_ARGS+=(--find-links="$directory")
done < <(find "$SCRIPT_DIR/packages" -type d -print0)

# pip 패키지 설치
pip install --no-index "${PIP_FIND_LINK_ARGS[@]}" requests==2.28.0
```

**docker-load.sh:** (Docker 이미지 포함 시 자동 생성)
```bash
#!/bin/bash
# DepsSmuggler Docker 이미지 로드 스크립트
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "Error: Docker가 설치되어 있지 않습니다."
    exit 1
fi

# Docker 데몬 실행 확인
if ! docker info &> /dev/null; then
    echo "Error: Docker 데몬이 실행 중이지 않습니다."
    exit 1
fi

# 이미지 로드
echo "Loading nginx:latest..."
docker load -i "$SCRIPT_DIR/packages/nginx-latest.tar"
echo "  ✓ nginx:latest 로드 완료"
```

**docker-load.ps1:** (Windows PowerShell)
```powershell
# DepsSmuggler Docker 이미지 로드 스크립트
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Docker 설치 확인
try { docker --version | Out-Null } catch {
    Write-Host "Error: Docker가 설치되어 있지 않습니다." -ForegroundColor Red
    exit 1
}

# 이미지 로드
Write-Host "Loading nginx:latest..."
$PackagesDir = Join-Path -Path $ScriptDir -ChildPath 'packages'
$ImagePath = Join-Path -Path $PackagesDir -ChildPath 'nginx-latest.tar'
docker load -i $ImagePath
Write-Host "  [OK] nginx:latest 로드 완료" -ForegroundColor Green
```

---

## 파일명 유틸리티 (`filename-utils.ts`)

Windows 호환 파일명 처리 유틸리티

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `sanitizeFilename` | name, maxLength? | string | 파일명을 Windows/Unix 모두에서 안전하게 변환 |
| `sanitizeCacheKey` | key, maxLength? | string | 캐시 키를 파일명으로 안전하게 변환 |
| `sanitizeDockerTag` | tag | string | Docker 태그 정규화 |
| `getExtension` | filename | string | 확장자 추출 |
| `removeExtension` | filename | string | 확장자 제거 |
| `isPathLengthValid` | path, maxLength? | boolean | 경로 길이 유효성 검사 |
| `getPathLengthWarning` | path | string \| null | 경로 길이 경고 메시지 |
| `toLongPath` | path | string | Windows Long Path 형식 (\\\\?\\) 변환 |

`sanitizeFilename()` 기본 최대 길이는 200, `sanitizeCacheKey()`는 100입니다. 연속된 밑줄은 하나로 합치고 앞뒤 밑줄을 제거합니다. `isPathLengthValid()`는 기본 260자와 문자열 길이만 비교하며 OS를 조회하지 않습니다. `getPathLengthWarning()`은 200자 초과 시 안내, 260자 초과 시 제한 안내를 반환합니다. `toLongPath()`는 현재 실행 OS가 Windows이고 260자를 넘는 드라이브 경로에만 접두사를 붙입니다.

### Windows 제약사항

아래는 금지 문자·예약어를 설명하는 개념 코드입니다. 실제 구현은 문자 `Set`과 제어 문자 코드 검사를 사용합니다.

```typescript
// 금지된 문자
const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

// 예약된 파일명
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
];
```

### 사용 예시

```typescript
import { sanitizeFilename, sanitizeCacheKey } from './filename-utils';

sanitizeFilename('file<>:name');      // 'file_name'
sanitizeFilename('CON');              // '_CON'
sanitizeFilename('@types/node');      // '@types_node'

sanitizeCacheKey('org.springframework:spring-core:5.3.0');
// 'org.springframework_spring-core_5.3.0'
```

---

## 경로 유틸리티 (`path-utils.ts`)

크로스 플랫폼 경로 처리 유틸리티

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `normalizePath` | path | string | 경로 정규화 (forward slash 통일) |
| `toWindowsPath` | path | string | Windows 스타일 (백슬래시) |
| `toUnixPath` | path | string | Unix 스타일 (슬래시) |
| `toBashPath` | path | string | Bash 스크립트용 경로 |
| `toPowerShellPath` | path | string | PowerShell 스크립트용 경로 |
| `toScriptPath` | path, scriptType | string | 스크립트 타입에 맞는 경로 |
| `ensureForwardSlashForArchive` | path | string | ZIP 아카이브용 (forward slash) |
| `getRelativePath` | fullPath, baseDir | string | 상대 경로 추출 |
| `joinAndNormalize` | ...paths | string | 경로 결합 후 정규화 |
| `joinPath` | ...paths | string | 플랫폼 네이티브 경로 결합 |
| `isAbsolutePath` | path | boolean | 절대 경로 여부 |
| `resolvePath` | ...paths | string | 경로 정규화 (native) |
| `stripLeadingDotSlash` | path | string | 선행 './' 제거 |
| `psJoinPath` | base, child | string | PowerShell Join-Path 구문 |
| `psQuotePath` | path | string | PowerShell 경로 이스케이프 |
| `getFileMode` | executable: boolean | number \| undefined | Unix는 0755/0644, Windows는 undefined |
| `getWriteOptions` | executable: boolean | { encoding; mode? } | utf-8 및 선택적 권한 |
| `sanitizePath` | input, allowedChars? | string | 경로 요소의 구분자·연속 점·특수문자 정리 |
| `isPathWithinBase` | basePath, targetPath | boolean | 정규화한 문자열 경로가 기준 경로 안인지 확인 |

`normalizePath`, `getRelativePath`, `joinPath`, `isAbsolutePath`, `resolvePath`는 실행 OS의 Node `path` 규칙을 사용합니다. 슬래시 변환은 다른 OS의 경로 의미까지 해석하지 않으며 `toBashPath()`/`toPowerShellPath()`도 따옴표를 붙이지 않습니다. PowerShell 리터럴 인용은 `psQuotePath()`를 사용합니다. `isPathWithinBase()`는 심볼릭 링크를 해석하지 않는 문자열 검사입니다.

### 플랫폼 상수

```typescript
const isWindows: boolean;     // Windows 환경 여부
const isMac: boolean;         // macOS 환경 여부
const isLinux: boolean;       // Linux 환경 여부
const pathSeparator: string;  // 플랫폼별 경로 구분자
```

### 사용 예시

```typescript
import { toUnixPath, toWindowsPath, ensureForwardSlashForArchive } from './path-utils';

// 크로스 플랫폼 경로 변환
toUnixPath('C:\\Users\\name\\file.txt');
// 'C:/Users/name/file.txt'

toWindowsPath('/home/user/file.txt');
// '\\home\\user\\file.txt'

// ZIP 아카이브 내부 경로
ensureForwardSlashForArchive('packages\\requests\\file.whl');
// 'packages/requests/file.whl'
```

---

## 관련 문서

- [Shared Utilities 개요](./shared-utilities.md)
- [다운로드 유틸리티](./download-utilities.md)
