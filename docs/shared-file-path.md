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
- 리다이렉트 자동 처리
- AbortSignal을 통한 다운로드 취소
- shouldPause 콜백을 통한 일시정지/재개

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

await downloadFile(
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

// 일시정지
paused = true;

// 재개
paused = false;

// 취소
controller.abort();
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

설치 스크립트 생성 (Bash + PowerShell)

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

### 생성되는 스크립트 예시

**install.sh:**
```bash
#!/bin/bash
# DepsSmuggler 설치 스크립트
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# pip 패키지 설치
pip install --no-index --find-links="$SCRIPT_DIR/packages" requests==2.28.0
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
docker load -i "$ScriptDir\packages\nginx-latest.tar"
Write-Host "  [OK] nginx:latest 로드 완료" -ForegroundColor Green
```

---

## 파일명 유틸리티 (`filename-utils.ts`)

Windows 호환 파일명 처리 유틸리티

### 주요 함수

| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `sanitizeFilename` | name, maxLength? | string | 파일명을 Windows/Unix 모두에서 안전하게 변환 |
| `sanitizeCacheKey` | key | string | 캐시 키를 파일명으로 안전하게 변환 |
| `sanitizeDockerTag` | tag | string | Docker 태그 정규화 |
| `getExtension` | filename | string | 확장자 추출 |
| `removeExtension` | filename | string | 확장자 제거 |
| `isPathLengthValid` | path, os? | boolean | 경로 길이 유효성 검사 |
| `getPathLengthWarning` | path, os? | string \| null | 경로 길이 경고 메시지 |
| `toLongPath` | path | string | Windows Long Path 형식 (\\\\?\\) 변환 |

### Windows 제약사항

```typescript
// 금지된 문자
const WINDOWS_FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

// 예약된 파일명
const WINDOWS_RESERVED_NAMES = [
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1'...'COM9', 'LPT1'...'LPT9'
];
```

### 사용 예시

```typescript
import { sanitizeFilename, sanitizeCacheKey } from './filename-utils';

sanitizeFilename('file<>:name');      // 'file___name'
sanitizeFilename('CON');              // '_CON'
sanitizeFilename('@types/node');      // '_types_node'

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
| `getFileMode` | options | number | 파일 권한 모드 |
| `getWriteOptions` | options | object | 파일 쓰기 옵션 |

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
