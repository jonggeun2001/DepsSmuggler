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
| `verifyArchive` | archivePath: string | Promise<boolean> | 압축 파일 무결성 검증 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `createZipFromDirectory` / `createZipFromFileEntries` | ZIP 파일 생성 |
| `createTarGzFromDirectory` / `createTarGzFromFileEntries` | tar.gz 파일 생성 |
| `createManifest` | manifest.json 생성 |
| `createReadme` | README.txt 생성 |

### 타입 정의

```typescript
const ArchiveFormat = {
  ZIP: 'zip',
  TAR_GZ: 'tar.gz'
} as const;

interface ArchiveOptions {
  format: ArchiveFormat;       // 압축 형식
  compressionLevel?: number;   // 압축 레벨 (0-9)
  includeReadme?: boolean;     // README 포함 여부
  includeManifest?: boolean;   // manifest.json 포함 여부
  onProgress?: (progress: ArchiveProgress) => void;
}

interface ArchiveProgress {
  processedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
}

interface PackageManifest {
  version: string;
  createdAt: string;
  packages: PackageInfo[];
  totalSize: number;
  fileCount: number;
}
```

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
| `generateBashScript` | options: ScriptOptions | Promise<GeneratedScript> | Bash 스크립트 생성 |
| `generatePowerShellScript` | options: ScriptOptions | Promise<GeneratedScript> | PowerShell 스크립트 생성 |
| `generateAllScripts` | options: ScriptOptions | Promise<GeneratedScript[]> | 모든 형식 스크립트 생성 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `groupPackagesByType` | 패키지를 타입별로 그룹화하여 설치 순서 결정 |

### 타입 정의

```typescript
interface ScriptOptions {
  packages: PackageInfo[];     // 설치할 패키지 목록
  outputDir: string;           // 스크립트 출력 디렉토리
  mirrorPath?: string;         // 미러 경로 (옵션)
  includeVerification?: boolean; // 체크섬 검증 포함
}

interface GeneratedScript {
  type: 'bash' | 'powershell';
  filename: string;
  content: string;
  path: string;
}
```

### 생성되는 스크립트

**Bash (install.sh)**
```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIRROR_DIR="${SCRIPT_DIR}/mirror"

echo "Installing Python packages..."
pip install --no-index --find-links "${MIRROR_DIR}/pip/simple" requests flask

echo "Installing Maven artifacts..."
# Maven 설치 명령어...

echo "Installation completed!"
```

**PowerShell (install.ps1)**
```powershell
#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MirrorDir = Join-Path $ScriptDir "mirror"

Write-Host "Installing Python packages..."
pip install --no-index --find-links "$MirrorDir\pip\simple" requests flask

Write-Host "Installation completed!"
```

### 사용 예시
```typescript
import { getScriptGenerator } from './core/packager/script-generator';

const generator = getScriptGenerator();
const scripts = await generator.generateAllScripts({
  packages: downloadedPackages,
  outputDir: '/tmp/output',
  mirrorPath: './mirror',
  includeVerification: true
});
```

---

## FileSplitter

### 개요
- 목적: 대용량 파일 분할 및 병합
- 위치: `src/core/packager/file-splitter.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `splitFile` | options: SplitOptions | Promise<SplitResult> | 파일 분할 |
| `joinFiles` | metadataPath: string, outputPath: string, onProgress? | Promise<string> | 분할된 파일 병합 |
| `needsSplit` | filePath: string, maxSize: number | Promise<boolean> | 분할 필요 여부 확인 |
| `estimatePartCount` | filePath: string, chunkSize: number | Promise<number> | 예상 파트 수 계산 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `calculateChecksum` | SHA256 체크섬 계산 |
| `generateBashMergeScript` | Bash 병합 스크립트 생성 |
| `generatePowerShellMergeScript` | PowerShell 병합 스크립트 생성 |

### 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| `DEFAULT_CHUNK_SIZE` | 25MB | 기본 분할 크기 |
| `BUFFER_SIZE` | 64KB | 읽기/쓰기 버퍼 크기 |

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
split/
├── packages.zip.part.001
├── packages.zip.part.002
├── packages.zip.part.003
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

// 병합
const joinedPath = await splitter.joinFiles(
  result.metadataPath!,
  '/tmp/restored-file.zip'
);
```

현재 일반 다운로드 이메일 전달 플로우는 첨부 크기 초과 시 `splitFile()`을 호출해 생성된 파트, 메타데이터 JSON, 병합 스크립트를 그대로 메일 첨부 대상으로 사용합니다.

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [DownloadManager 문서](./download-manager.md)
