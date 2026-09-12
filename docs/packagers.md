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
| `createArchive` | files, outputPath, packages, options | Promise<string> | 파일 목록을 `packages/` 아래로 묶고 `options.rootFiles`를 아카이브 root에 추가 |
| `createArchiveFromDirectory` | sourceDir, outputPath, packages, options | Promise<string> | 준비된 디렉터리 구조를 유지한 채 압축 |
| `getArchiveInfo` | archivePath: string | Promise<{ format, size, fileCount }> | 압축 파일 정보 조회 |
| `verifyArchive` | archivePath: string | Promise<boolean> | 파일 존재 및 크기 > 0 확인 |

`createArchive()`와 `createArchiveFromDirectory()`는 런타임에도 `options.format`이 `zip` 또는 `tar.gz`인지 검사합니다. 지원하지 않는 값은 입력 파일 조사와 출력 경로 생성 전에 오류로 거부합니다. 공개 함수 `assertArchiveFormat(value)`를 CLI의 사전 검증에서도 재사용하며, 알 수 없는 값을 tar.gz로 대체하지 않습니다.

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
  rootFiles?: string[];        // createArchive 전용: 최상위에 파일명으로 포함할 파일
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

manifest는 완료된 다운로드 항목의 `PackageInfo`를 기록합니다. npm의 `latest` 같은 버전 선택자는 다운로드 성공 시 실제 버전으로 갱신되므로, CLI `--no-deps` 아카이브에도 tarball과 일치하는 버전이 들어갑니다.

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

CLI는 완료된 다운로드 항목이 반환한 파일 목록으로 `createArchive(...)`를 호출하고, 생성한 `install.sh`·`install.ps1`을 `options.rootFiles`로 명시해 아카이브 최상위에 추가합니다. Maven 항목은 주 아티팩트와 부속 POM, 저장에 성공한 체크섬을 모두 포함하며 중복 경로는 제거합니다. 출력 디렉터리를 통째로 검색하지 않으므로 이전 압축물이나 다른 파일은 추가하지 않습니다. ZIP과 TAR.GZ 모두 동일한 목록과 Maven 상대 경로를 사용합니다. `rootFiles`의 파일 누락·디렉터리 입력·중복 이름·기본 메타데이터 경로 충돌은 압축 생성 전에 거부합니다.

Maven에서 발견된 여러 버전의 JAR 등 아티팩트, 부속 POM 및 하위 의존성은 모두 반출 대상입니다. 압축기와 설치 스크립트는 각 type/classifier의 원본 경로와 체크섬을 보존합니다. 빌드에 사용할 버전을 하나로 줄여 파일 목록을 재구성하지 않습니다.

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

Electron GUI의 shared `generateInstallScripts`도 비동기 생성기이며, npm 또는 Conda 패키지가 포함된 경우 공통 `ScriptGenerator`의 해당 설치 section을 재사용합니다. delivery pipeline은 실제 다운로드가 끝난 뒤 생성기를 기다린 다음 아카이브를 만듭니다. 성공 결과의 실제 파일 경로를 Conda·npm mapping으로 전달하므로 metadata filename이나 다른 패키지의 파일을 추측하지 않습니다. 두 패키지 타입이 없는 GUI 묶음은 기존 non-npm 설치기 분기를 계속 사용합니다.

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
  npmPackageFiles?: { filePath: string; relativePath: string }[];
  npmRootPackages?: PackageInfo[]; // 직접 요청한 npm 패키지의 해결된 버전
  condaPackageFiles?: { relativePath: string }[]; // packages/ 안의 실제 Conda 파일 경로
}

interface GeneratedScript {
  type: 'bash' | 'powershell';
  content: string;
  path: string;
}
```

### 생성되는 스크립트

공통 `ScriptGenerator`의 Bash·PowerShell 출력은 설치 실패를 누적해 최종 목록과 종료 코드로 보고합니다. pip·Docker와 Bash의 YUM은 개별 실패 항목의 이름·버전을 기록합니다. Conda·Maven·npm처럼 묶음으로 실행되는 작업이 실패하면 해당 그룹과 대상 패키지 목록을 기록하고 이후 그룹을 시도합니다. 실패한 그룹의 완료 문구와 전체 성공 배너는 출력하지 않으며, 마지막에 실패가 있으면 종료 코드 `1`, 없으면 `0`을 반환합니다. `includeErrorHandling: false`여도 이 계약은 유지됩니다.

**Bash (install.sh)의 Python 설치 부분 (핵심 흐름)**
```bash
# PIP_FIND_LINK_ARGS에는 탐색에 성공한 패키지 폴더들이 들어갑니다.
if pip install --no-index "${PIP_FIND_LINK_ARGS[@]}" requests==2.31.0; then
  :
else
  record_failure 'requests==2.31.0'
  pip_failed=1
fi
```

**PowerShell (install.ps1)의 Python 설치 부분 (핵심 흐름)**

생성되는 `install.ps1`은 Windows PowerShell 5.1에서 한글 오류 메시지를 올바르게 읽도록 UTF-8 BOM을 포함합니다.
```powershell
# $PipFindLinkArgs는 Get-ChildItem -ErrorAction Stop으로 준비합니다.
try {
    & pip install --no-index @PipFindLinkArgs requests==2.31.0
    $pipExitCode = $LASTEXITCODE
    if ($pipExitCode -ne 0) {
        Add-FailedPackage 'requests==2.31.0'
        $pipFailed = $true
    }
} catch {
    Add-FailedPackage 'requests==2.31.0'
    $pipFailed = $true
}
```

위 예시는 타입별 설치 함수 내부의 일부입니다. 실제 Bash 출력은 `find -print0`의 결과를 임시 파일로 받아 명령·읽기 오류를 검사한 뒤 경로 배열을 만듭니다. 공백이나 개행이 있는 하위 폴더도 하나의 `--find-links` 인자로 유지합니다. PowerShell은 디렉터리 탐색 오류와 native 명령의 종료 코드를 확인합니다. 개별 명령에서 모은 실패는 모든 설치 그룹을 시도한 뒤 한 번 요약합니다.

실제 파일은 헤더, 패키지 디렉터리와 실행 도구 확인, 로그 함수와 타입별 설치 함수를 포함합니다. pip은 하위 디렉터리마다 `--find-links`를 추가합니다. Maven은 패키지 메타데이터의 GAV 좌표로 canonical 저장소 경로를 선택해 `packages/<group>/<artifact>/<version>/`를 `MAVEN_REPO_LOCAL` 또는 기본 `~/.m2/repository`에 그대로 복사합니다. GUI 출력의 `packages/m2repo/` 구조도 지원하며, 같은 GAV 디렉터리의 원본 POM, parent/BOM POM, POM-only 항목, classifier와 checksum을 보존합니다. Bash와 PowerShell 모두 Maven 플러그인이나 네트워크를 호출하지 않고, 좌표 디렉터리가 없거나 복사에 실패하면 오류로 종료합니다. Bash는 pip·Conda·npm·Maven·YUM·Docker 블록을, PowerShell은 pip·Conda·npm·Maven·Docker 블록을 생성하며 YUM 설치 블록은 없습니다.

Maven의 `_remote.repositories`는 대상 저장소의 기존 내용을 보존하며 복사한 아티팩트에만 `파일명>=` 로컬 설치 기록을 추가합니다. `.demo`처럼 점으로 시작하는 아티팩트의 POM·JAR·체크섬도 복사합니다. 체크섬과 대상에만 존재하는 파일은 등록하지 않고, 원본에 있는 추적 파일로 대상 기록을 덮어쓰지도 않습니다. 재실행해도 로컬 기록은 중복되지 않습니다. 기록 저장에 실패하거나 좌표 디렉터리에 아티팩트가 없으면 오류로 종료합니다. 생성된 PowerShell 파일은 Windows PowerShell 5의 한글 해석을 위해 UTF-8 BOM을 포함합니다.

`MAVEN_REPO_LOCAL` 상대 경로는 스크립트 폴더를 기준으로 해석합니다. PowerShell에서는 이를 파일시스템 절대 경로로 변환하여 파일 복사 cmdlet과 .NET 추적 기록 저장이 같은 위치를 사용하도록 합니다. Maven `settings.xml`의 사용자 지정 `localRepository`는 자동 조회하지 않으므로 이 환경 변수로 같은 위치를 지정합니다.

CLI와 GUI 저장소 구조는 전체 GAV 목록이 하나의 원본 저장소 루트에 모두 존재하는지로 구분합니다. `example`과 `m2repo.example` 그룹이 함께 있어도 같은 원본 구조에서 각각의 파일을 선택합니다. 두 구조가 모두 조건을 만족하거나 어느 구조에도 전체 목록이 없으면 복사 전에 오류로 종료합니다.

npm은 스크립트 생성 시 원본 `.tgz`의 `package.json`에서 이름·버전을 읽어 파일 경로와 함께 Bash·PowerShell 안에 기록합니다. CLI와 GUI 모두 실제 다운로드 destination과 아카이브 `packages/` 안의 상대 경로를 `npmPackageFiles`로 전달할 수 있으며, GUI router는 추측한 파일명이 아니라 실제 저장한 `filePath`를 반환합니다. 이 옵션이 없으면 생성 시점의 `packageDir` 아래에서 `.tgz`를 탐색하므로 패키지 파일이 먼저 준비되어 있어야 합니다. 원본 tarball은 수정하거나 추출하지 않습니다. scoped 패키지와 공백이 포함된 경로를 지원합니다.

실행 시 포함된 Node.js 코드가 스크립트 폴더의 `npm-project/package.json`에 실제 루트만 로컬 `file:` 의존성으로 등록합니다. 전이 패키지는 이를 요구하는 상위 패키지별 `overrides`로 연결해 같은 이름의 여러 버전과 서로 다른 peer 의존성 배치를 보존합니다. 이는 npm 10에서 전역 버전별 override를 로컬 파일로 바꾼 후 다시 해석할 때 첫 버전으로 합쳐지는 문제도 피합니다. tarball과 설치 대상은 실제 경로로 통일하고, `npm install --offline`으로 `npm-project/node_modules`에 설치합니다. Bash는 이 경로를 `--prefix`로 전달합니다. PowerShell은 생성 프로젝트로 잠시 이동해 `--prefix` 없이 설치한 뒤 성공·실패에 관계없이 위치를 복원합니다. Windows npm 10은 명시한 prefix가 로컬·전역 설치 위치에 함께 적용되면 현재 폴더를 추가 패키지로 읽을 수 있으므로 이 호출 방식을 사용합니다. bundle 루트에 사용자 `package.json`이 없어도 설치할 수 있습니다.

CLI와 GUI는 `npmRootPackages`에 직접 요청 목록과 해결된 확정 버전을 전달합니다. API 호출에서 이 옵션을 생략하면 이름별 가장 높은 전달 버전을 직접 루트로 취급하므로, 전이 목록을 함께 넘기는 호출자는 실제 루트를 지정해야 합니다. 동일 이름의 서로 다른 직접 버전 요청은 스크립트 생성 오류입니다. 원본 manifest의 일반·선택·peer 의존성을 읽어 전달된 호환 버전에 연결하며, 설치 범위에서 이미 선택한 호환 버전을 우선합니다. 순환 재방문은 반복문으로 처리하고, 계획 깊이 128 또는 규칙 100,000개를 초과하면 스크립트 생성 단계에서 명시적으로 실패합니다.

상위 폴더의 사용자 `package.json`은 변경하지 않습니다. `npm-project`는 비어 있거나 이 스크립트가 생성한 프로젝트여야 하며, 소유 표시가 없는 기존 프로젝트나 심볼릭 링크 대상은 오류로 처리합니다. 설치용 manifest는 유지하지만 프로젝트 루트의 lockfile은 생성하지 않으며 npm 자체 업데이트 확인도 끕니다. Node.js와 npm이 필요하며, 도구 부재·빈 파일 목록·의존성 누락·손상된 tarball·설치 명령 실패는 오류 종료로 이어집니다. npm의 일반 설치 lifecycle은 유지합니다. 이 스크립트는 의존성을 전달된 파일에 연결하며, OS·아키텍처 간 네이티브 패키지 변환이나 설치 lifecycle의 외부 다운로드 대체는 수행하지 않습니다.

Conda는 pip와 별도의 설치 블록을 생성합니다. CLI와 GUI는 완료된 Conda 다운로드 항목의 실제 파일 경로를 `condaPackageFiles`로 전달하므로 `--no-deps` 입력의 메타데이터에 파일명이 없어도 다운로드한 파일을 참조합니다. 이 옵션을 생략한 API 호출은 각 Conda 항목의 정확한 `metadata.filename`을 사용합니다. 파일명 누락·빈 명시 목록·잘못된 상대 경로·지원하지 않는 확장자는 생성 오류이며, 다른 패키지의 `.tar.bz2`를 함께 설치하지 않도록 폴더 전체를 확장자로 탐색하지 않습니다. 실행 시에는 선언된 파일의 존재를 확인합니다.

Conda 블록은 [명시적 로컬 아카이브 설치](https://docs.conda.io/projects/conda/en/stable/commands/install.html)를 사용합니다. 기본 대상 `SCRIPT_DIR/conda-env`가 없으면 `conda create --offline --yes --no-default-packages --prefix ...`를, 기존 Conda 환경이면 `conda install --offline --yes --prefix ...`를 실행합니다. `DEPS_SMUGGLER_CONDA_PREFIX`로 대상을 지정할 수 있고 상대 경로는 스크립트 폴더 기준입니다. 일반 파일·디렉터리를 기존 환경으로 덮어쓰지 않으며, 필수 파일이나 Conda가 없거나 명령이 실패하면 Bash·PowerShell 모두 non-zero로 종료합니다. `includeErrorHandling: false`여도 Conda 실패를 성공으로 처리하지 않습니다.

명시적 파일 설치는 전달된 파일 집합을 설치하며 의존성·버전·아키텍처 호환성을 다시 해결하지 않습니다. Python noarch 패키지는 대상 환경에 호환되는 Python이 필요하므로, `--no-deps` 묶음은 기존 환경을 지정하거나 런타임을 별도로 준비해야 합니다. 기본 환경 경로는 `SCRIPT_DIR/conda-env`이고 `DEPS_SMUGGLER_CONDA_PREFIX`에 절대 경로나 스크립트 기준 상대 경로를 지정할 수 있습니다. GUI와 CLI는 npm·Conda 설치 section을 공유하며, Conda가 포함된 묶음은 Conda 명령이 성공해야 전체 성공으로 처리합니다.

일반 `ScriptGenerator`에는 APT·APK 전용 설치 블록이 없습니다. OS 다운로드 전용 스크립트는 별도의 `OSScriptGenerator`가 제공합니다. `includeVerification`/`mirrorPath` 옵션은 이 클래스에 없습니다.

Docker 설치 블록은 다운로더와 같은 `buildDockerArchiveFilename()`을 사용해 `packages/<repo>-<tag>.tar`를 로드합니다. namespace·registry 제거와 파일명 정규화도 동일하게 적용하므로 `busybox:1.36`은 `busybox-1.36.tar`를 참조합니다. Bash와 PowerShell 모두 파일명을 인용해 공백이 포함된 추출 경로에서도 하나의 `docker load -i` 인자로 전달합니다. 아키텍처나 ZIP·tar.gz 선택은 내부 이미지 tar 이름에 영향을 주지 않습니다.

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
