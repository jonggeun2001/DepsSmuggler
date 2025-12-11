# Packagers

## 개요
- 목적: 다운로드된 패키지를 다양한 출력 형태로 패키징
- 위치: `src/core/packager/`

---

## ArchivePackager

### 개요
- 목적: ZIP/tar.gz 압축 파일 생성
- 위치: `src/core/packager/archivePackager.ts`

### 클래스 구조

| 메서드 | 파라미터 | 반환값 | 설명 |
|--------|----------|--------|------|
| `createArchive` | options: ArchiveOptions | Promise<PackagingResult> | 압축 파일 생성 |
| `getArchiveInfo` | archivePath: string | Promise<ArchiveInfo> | 압축 파일 정보 조회 |
| `verifyArchive` | archivePath: string | Promise<boolean> | 압축 파일 무결성 검증 |

### 내부 메서드

| 메서드 | 설명 |
|--------|------|
| `createZip` | ZIP 파일 생성 |
| `createTarGz` | tar.gz 파일 생성 |
| `createManifest` | manifest.json 생성 |
| `createReadme` | README.txt 생성 |

### 타입 정의

```typescript
const ArchiveFormat = {
  ZIP: 'zip',
  TAR_GZ: 'tar.gz'
} as const;

interface ArchiveOptions {
  sourceDir: string;           // 소스 디렉토리
  outputPath: string;          // 출력 파일 경로
  format: ArchiveFormat;       // 압축 형식
  packages: PackageInfo[];     // 포함된 패키지 목록
  includeReadme?: boolean;     // README 포함 여부
  includeManifest?: boolean;   // manifest.json 포함 여부
  onProgress?: (progress: ArchiveProgress) => void;
}

interface ArchiveProgress {
  phase: 'preparing' | 'compressing' | 'finalizing';
  current: number;
  total: number;
  currentFile?: string;
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
import { getArchivePackager } from './core/packager/archivePackager';

const packager = getArchivePackager();
const result = await packager.createArchive({
  sourceDir: '/tmp/downloads',
  outputPath: '/tmp/output/packages.zip',
  format: 'zip',
  packages: downloadedPackages,
  includeReadme: true,
  includeManifest: true
});
```

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

이 패턴은 `archivePackager.ts`와 `file-utils.ts` 모두에 적용됨.

---

## ScriptGenerator

### 개요
- 목적: 설치 스크립트 생성 (Bash/PowerShell)
- 위치: `src/core/packager/scriptGenerator.ts`

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
import { getScriptGenerator } from './core/packager/scriptGenerator';

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
- 위치: `src/core/packager/fileSplitter.ts`

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
  inputPath: string;           // 원본 파일 경로
  outputDir: string;           // 분할 파일 출력 디렉토리
  chunkSize?: number;          // 분할 크기 (바이트)
  onProgress?: (progress: SplitProgress) => void;
}

interface SplitProgress {
  current: number;             // 현재 파트 번호
  total: number;               // 총 파트 수
  bytesWritten: number;        // 기록된 바이트
  totalBytes: number;          // 총 바이트
}

interface SplitResult {
  success: boolean;
  parts: string[];             // 분할된 파일 경로 목록
  metadata: SplitMetadata;
  metadataPath: string;
  mergeScriptBash: string;     // Bash 병합 스크립트 경로
  mergeScriptPowerShell: string; // PowerShell 병합 스크립트 경로
}

interface SplitMetadata {
  originalName: string;
  originalSize: number;
  checksum: string;
  chunkSize: number;
  partCount: number;
  parts: Array<{
    index: number;
    filename: string;
    size: number;
    checksum: string;
  }>;
  createdAt: string;
}
```

### 생성되는 파일 구조

```
split/
├── packages.zip.part.001
├── packages.zip.part.002
├── packages.zip.part.003
├── packages.zip.metadata.json
├── merge.sh
└── merge.ps1
```

### 사용 예시
```typescript
import { getFileSplitter } from './core/packager/fileSplitter';

const splitter = getFileSplitter();

// 분할
const result = await splitter.splitFile({
  inputPath: '/tmp/large-file.zip',
  outputDir: '/tmp/split',
  chunkSize: 10 * 1024 * 1024, // 10MB
  onProgress: (p) => console.log(`Part ${p.current}/${p.total}`)
});

// 병합
const joinedPath = await splitter.joinFiles(
  result.metadataPath,
  '/tmp/restored-file.zip'
);
```

---

## 관련 문서
- [아키텍처 개요](./architecture-overview.md)
- [Downloaders 문서](./downloaders.md)
- [DownloadManager 문서](./download-manager.md)
