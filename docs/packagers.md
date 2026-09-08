# Packagers

## 개요
- 목적: 다운로드된 패키지를 다양한 출력 형태로 패키징
- 위치: `src/core/packager/`

---

## ArchivePackager

### 개요
- 목적: ZIP/tar.gz 압축 파일 생성
- 위치: `src/core/packager/archive-packager.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `createArchive` | files, outputPath, packages, options | Promise<string> | 파일 목록을 `packages/` 아래로 묶어 압축 |
| `createArchiveFromDirectory` | sourceDir, outputPath, packages, options | Promise<string> | 준비된 디렉터리 구조를 유지한 채 압축 |
| `getArchiveInfo` | archivePath: string | Promise<{ format, size, fileCount }> | 압축 파일 정보 조회 |
| `verifyArchive` | archivePath: string | Promise<boolean> | 파일 존재 및 크기 > 0 확인 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `createZipFromDirectory` / `createZipFromFileEntries` | ZIP 파일 생성 |
| `createTarGzFromDirectory` / `createTarGzFromFileEntries` | tar.gz 파일 생성 |
| `createManifest` | manifest.json 생성 |
| `createReadme` | README.txt 생성 |

### 타입 정의

```typescript
type ArchiveFormat = 'zip' | 'tar.gz'; // ArchiveType을 재사용

interface ArchiveOptions {
  format: ArchiveFormat;       // 압축 형식
  compressionLevel?: number;   // 압축 레벨 (0-9, 기본 6)
  includeReadme?: boolean;     // README 포함 여부 (기본 true)
  includeManifest?: boolean;   // manifest.json 포함 여부 (기본 true)
  onProgress?: (progress: ArchiveProgress) => void;
}

interface ArchiveProgress {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
}

interface ArchivePackageManifest {
  version: string;
  createdAt: string;
  packages: PackageInfo[];
  totalSize: number;
  fileCount: number;
}
```

archive 전용 canonical 정의는 `src/types/manifest/package-manifest.ts`의 `ArchivePackageManifest`에 두고, `archive-packager.ts`는 해당 타입을 재사용합니다.
`src/types`의 공개 `PackageManifest`는 기존 packaging contract를 유지하는 compatibility surface입니다.

### 사용 예시
```typescript
import { getArchivePackager } from './core/packager/archive-packager';

const packager = getArchivePackager();
const result = await packager.createArchiveFromDirectory(
  '/tmp/downloads',
  '/tmp/output/packages.zip',
  downloadedPackages,
  {
    format: 'zip',
    includeReadme: true,
    includeManifest: true,
  }
);
```

GUI 다운로드 경로에서는 `electron/download-handlers.ts`가 `createArchiveFromDirectory(...)`를 사용합니다. 그래서 `outputDir` 아래에 만들어 둔 `packages/`, `install.sh`, `install.ps1` 같은 파일이 그대로 아카이브에 포함되고, 최종 완료 이벤트는 실제 `.zip` 또는 `.tar.gz` 파일 경로를 반환합니다.

`getArchiveInfo()`는 확장자로 형식을 판별하고 파일 크기를 조회합니다. `fileCount`는 항상 0이며, `verifyArchive()`는 압축 해제나 내부 CRC 검사를 수행하지 않습니다. `onProgress`는 입력 파일 크기를 조사하는 준비 단계의 진행률이며 압축 스트림의 진행률이 아닙니다.

현재 구현은 다운로드 산출물을 별도 staging 디렉터리로 한 번 더 복사하지 않고, 원본 디렉터리/파일 엔트리를 아카이브 스트림에 직접 추가한 뒤 `manifest.json`, `README.txt`만 추가 entry로 주입합니다.

### 기술적 주의사항

#### archiver 모듈 ESM 호환성

Vite 번들링 환경에서 `archiver` 패키지는 네임스페이스 import가 아닌 기본 import를 사용해야 함:

```typescript
// ❌ 오류 발생: archiver.create is not a function
import * as archiver from 'archiver';
const archive = archiver.create('zip', { zlib: { level: 9 } });

// ✅ 정상 동작
import archiver from 'archiver';
const archive = archiver('zip', { zlib: { level: 9 } });
```

이 패턴은 `archive-packager.ts`와 `file-utils.ts` 모두에 적용됨.

---

## ScriptGenerator

### 개요
- 목적: 설치 스크립트 생성 (Bash/PowerShell)
- 위치: `src/core/packager/script-generator.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `generateBashScript` | packages, outputPath, options? | Promise<string> | Bash 스크립트 생성 |
| `generatePowerShellScript` | packages, outputPath, options? | Promise<string> | PowerShell 스크립트 생성 |
| `generateAllScripts` | packages, outputDir, options? | Promise<GeneratedScript[]> | 모든 형식 스크립트 생성 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `groupPackagesByType` | 패키지를 타입별로 그룹화 (의존성 위상 정렬은 하지 않음) |

### 타입 정의

```typescript
interface ScriptOptions {
  includeHeader?: boolean;        // 기본 true
  includeErrorHandling?: boolean; // 기본 true
  packageDir?: string;            // 기본 './packages'
}

interface GeneratedScript {
  type: 'bash' | 'powershell';
  content: string;
  path: string;
}
```

### 생성되는 스크립트

**Bash (install.sh)의 Python 설치 부분 (핵심 흐름)**
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
PACKAGE_DIR="./packages"
PIP_FIND_LINK_ARGS=()
while IFS= read -r -d '' directory; do
  PIP_FIND_LINK_ARGS+=(--find-links="$directory")
done < <(find "$PACKAGE_DIR" -type d -print0)
pip install --no-index "${PIP_FIND_LINK_ARGS[@]}" requests==2.31.0
```

**PowerShell (install.ps1)의 Python 설치 부분 (핵심 흐름)**
```powershell
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Join-Path $ScriptDir "packages"
$FindLinkArgs = @("--find-links=$PackageDir")
Get-ChildItem -Path $PackageDir -Directory -Recurse | ForEach-Object {
    $FindLinkArgs += "--find-links=$($_.FullName)"
}
pip install --no-index @FindLinkArgs requests==2.31.0
```

실제 파일은 헤더, 패키지 디렉터리와 실행 도구 확인, 로그 함수와 타입별 설치 함수를 포함합니다. Python은 하위 디렉터리마다 `--find-links`를 추가하며, Maven은 JAR 파일을 재귀 탐색합니다. Bash는 pip/conda·Maven·YUM·Docker 블록을, PowerShell은 pip/conda·Maven·Docker 블록을 생성하며 YUM 설치 블록은 없습니다.

일반 `ScriptGenerator`에는 npm·APT·APK 전용 설치 블록이 없고, Conda 항목도 pip 설치 블록으로 묶입니다. `.conda` 파일을 설치하는 Conda 전용 스크립트로 간주하면 안 됩니다. OS 다운로드 전용 스크립트는 별도의 `OSScriptGenerator`가 제공합니다. `includeVerification`/`mirrorPath` 옵션은 이 클래스에 없습니다.

### 사용 예시
```typescript
import { getScriptGenerator } from './core/packager/script-generator';

const generator = getScriptGenerator();
const scripts = await generator.generateAllScripts(
  downloadedPackages,
  '/tmp/output',
  { packageDir: './packages', includeErrorHandling: true }
);
```

---

## FileSplitter

### 개요
- 목적: 대용량 파일 분할 및 병합
- 위치: `src/core/packager/file-splitter.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `splitFile` | filePath: string, options?: SplitOptions | Promise<SplitResult> | 파일 분할 |
| `joinFiles` | parts: string[] 또는 metadataPath: string, outputPath, onProgress? | Promise<string> | 분할된 파일 병합 |
| `needsSplit` | filePath: string, maxSizeMB?: number | Promise<boolean> | 분할 필요 여부 확인 |
| `estimatePartCount` | filePath: string, maxSizeMB?: number | Promise<number> | 예상 파트 수 계산 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `calculateChecksum` | SHA256 체크섬 계산 |
| `generateBashMergeScript` | Bash 병합 스크립트 생성 |
| `generatePowerShellMergeScript` | PowerShell 병합 스크립트 생성 |

### 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `BUFFER_SIZE` | 64KB | 읽기/쓰기 버퍼 크기 |

분할 크기 기본값은 `maxSizeMB = 25`이고 1MB를 1024 × 1024바이트로 계산합니다. `generateMergeScripts` 기본값은 true입니다. 실제 분할·병합 동작은 `file-splitter.test.ts`에서 검증합니다.

### 타입 정의

```typescript
interface SplitOptions {
  maxSizeMB?: number;          // 분할 기준 크기 (MB)
  onProgress?: (progress: SplitProgress) => void;
  generateMergeScripts?: boolean;
}

interface SplitProgress {
  currentPart: number;         // 현재 파트 번호
  totalParts: number;          // 총 파트 수
  processedBytes: number;      // 처리된 바이트
  totalBytes: number;          // 총 바이트
  percentage: number;
}

interface SplitResult {
  parts: string[];             // 분할된 파일 경로 목록
  metadata: SplitMetadata;
  metadataPath?: string;       // 생성된 메타데이터 JSON 경로
  mergeScripts?: {
    bash?: string;             // Bash 병합 스크립트 경로
    powershell?: string;       // PowerShell 병합 스크립트 경로
  };
}

interface SplitMetadata {
  originalFileName: string;
  originalSize: number;
  checksum: string;
  partCount: number;
  partSize: number;
  createdAt: string;
}
```

### 생성되는 파일 구조

```
원본 파일이 있는 디렉터리/
├── packages.zip.part001
├── packages.zip.part002
├── packages.zip.part003
├── packages.zip.meta.json
├── merge.sh
└── merge.ps1
```

### 사용 예시
```typescript
import { getFileSplitter } from './core/packager/file-splitter';

const splitter = getFileSplitter();

// 분할
const result = await splitter.splitFile('/tmp/large-file.zip', {
  maxSizeMB: 10,
  onProgress: (p) => console.log(`Part ${p.currentPart}/${p.totalParts}`)
});

// 실제로 분할됐을 때만 메타데이터 파일이 생성된다.
const joinedPath = result.metadataPath
  ? await splitter.joinFiles(result.metadataPath, '/tmp/restored-file.zip')
  : result.parts[0];
```

파일 크기가 기준 이하면 원본 경로 하나만 반환하고 메타데이터 파일·병합 스크립트를 만들지 않습니다. `joinFiles()`는 `.meta.json` 경로나 파트 배열을 받으며, 메타데이터의 SHA256과 병합 결과가 다르면 경고를 기록하지만 반환 자체를 실패시키지는 않습니다.

현재 일반 다운로드 이메일 전달 플로우는 첨부 크기 초과 시 `splitFile()`을 호출해 생성된 파트, 메타데이터 JSON, 병합 스크립트를 그대로 메일 첨부 대상으로 사용합니다.

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [다운로드 아키텍처](./architecture-overview.md)
