/**
 * 파일 분할기
 * 큰 압축 파일을 설정 크기로 자동 분할 및 병합
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import logger from '../../utils/logger';
import { resolvePath, getWriteOptions } from '../shared/path-utils';

export interface SplitOptions {
  maxSizeMB?: number; // 분할 크기 (MB), 기본 25MB
  onProgress?: (progress: SplitProgress) => void;
  generateMergeScripts?: boolean; // 병합 스크립트 생성 여부
}

export interface SplitProgress {
  currentPart: number;
  totalParts: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface SplitResult {
  parts: string[];
  metadata: SplitMetadata;
  mergeScripts?: {
    bash?: string;
    powershell?: string;
  };
}

export interface SplitMetadata {
  originalFileName: string;
  originalSize: number;
  partCount: number;
  partSize: number;
  checksum: string;
  createdAt: string;
}

export interface JoinProgress {
  currentPart: number;
  totalParts: number;
  processedBytes: number;
  totalBytes: number;
  percentage: number;
}

/**
 * 파일 분할기 클래스
 */
export class FileSplitter {
  private readonly DEFAULT_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB
  private readonly BUFFER_SIZE = 64 * 1024; // 64KB 버퍼

  /**
   * 파일을 지정된 크기로 분할
   * @param filePath 분할할 파일 경로
   * @param options 분할 옵션
   */
  async splitFile(
    filePath: string,
    options: SplitOptions = {}
  ): Promise<SplitResult> {
    const {
      maxSizeMB = 25,
      onProgress,
      generateMergeScripts = true,
    } = options;

    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    // 파일 존재 확인
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
    }

    // 경로를 정규화하여 크로스 플랫폼 호환성 보장
    const normalizedPath = resolvePath(filePath);
    const stat = await fs.stat(normalizedPath);
    const totalBytes = stat.size;
    const fileName = path.basename(normalizedPath);
    const fileDir = path.dirname(normalizedPath);

    // 파일이 분할 크기보다 작으면 분할하지 않음
    if (totalBytes <= maxSizeBytes) {
      logger.info('파일 크기가 분할 기준보다 작아 분할하지 않습니다.', {
        filePath,
        fileSize: totalBytes,
        maxSize: maxSizeBytes,
      });

      const checksum = await this.calculateChecksum(filePath);
      return {
        parts: [filePath],
        metadata: {
          originalFileName: fileName,
          originalSize: totalBytes,
          partCount: 1,
          partSize: totalBytes,
          checksum,
          createdAt: new Date().toISOString(),
        },
      };
    }

    // 파트 수 계산
    const totalParts = Math.ceil(totalBytes / maxSizeBytes);
    const parts: string[] = [];
    let processedBytes = 0;
    let currentPart = 0;

    // 체크섬 계산을 위한 해시
    const hash = crypto.createHash('sha256');

    // 읽기 스트림 생성
    const readStream = fs.createReadStream(filePath, {
      highWaterMark: this.BUFFER_SIZE,
    });

    let currentPartStream: fs.WriteStream | null = null;
    let currentPartBytes = 0;

    const createNewPart = async (): Promise<void> => {
      if (currentPartStream) {
        currentPartStream.end();
        await new Promise<void>((resolve) => currentPartStream!.on('finish', resolve));
      }

      currentPart++;
      const partFileName = `${fileName}.part${String(currentPart).padStart(3, '0')}`;
      const partPath = path.join(fileDir, partFileName);
      parts.push(partPath);
      currentPartStream = fs.createWriteStream(partPath);
      currentPartBytes = 0;
    };

    // 첫 번째 파트 생성
    await createNewPart();

    return new Promise((resolve, reject) => {
      readStream.on('data', async (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);

        let offset = 0;
        while (offset < buffer.length) {
          const remainingInPart = maxSizeBytes - currentPartBytes;
          const bytesToWrite = Math.min(remainingInPart, buffer.length - offset);
          const slice = buffer.slice(offset, offset + bytesToWrite);

          currentPartStream!.write(slice);
          currentPartBytes += bytesToWrite;
          processedBytes += bytesToWrite;
          offset += bytesToWrite;

          // 진행률 콜백
          if (onProgress) {
            onProgress({
              currentPart,
              totalParts,
              processedBytes,
              totalBytes,
              percentage: (processedBytes / totalBytes) * 100,
            });
          }

          // 현재 파트가 가득 찼으면 새 파트 생성
          if (currentPartBytes >= maxSizeBytes && processedBytes < totalBytes) {
            readStream.pause();
            await createNewPart();
            readStream.resume();
          }
        }
      });

      readStream.on('end', async () => {
        // 마지막 스트림 닫기
        if (currentPartStream) {
          currentPartStream.end();
          await new Promise<void>((resolve) => currentPartStream!.on('finish', resolve));
        }

        const checksum = hash.digest('hex');

        // 메타데이터 생성
        const metadata: SplitMetadata = {
          originalFileName: fileName,
          originalSize: totalBytes,
          partCount: parts.length,
          partSize: maxSizeBytes,
          checksum,
          createdAt: new Date().toISOString(),
        };

        // 메타데이터 파일 저장
        const metadataPath = path.join(fileDir, `${fileName}.meta.json`);
        await fs.writeJson(metadataPath, metadata, { spaces: 2 });

        const result: SplitResult = {
          parts,
          metadata,
        };

        // 병합 스크립트 생성
        if (generateMergeScripts) {
          result.mergeScripts = {
            bash: await this.generateBashMergeScript(fileDir, fileName, parts.length),
            powershell: await this.generatePowerShellMergeScript(fileDir, fileName, parts.length),
          };
        }

        logger.info('파일 분할 완료', {
          filePath,
          parts: parts.length,
          totalBytes,
          checksum,
        });

        resolve(result);
      });

      readStream.on('error', (err) => {
        if (currentPartStream) {
          currentPartStream.end();
        }
        reject(err);
      });
    });
  }

  /**
   * 분할된 파일들을 하나로 병합
   * @param parts 분할 파일 경로 목록 또는 메타데이터 파일 경로
   * @param outputPath 출력 파일 경로
   * @param onProgress 진행률 콜백
   */
  async joinFiles(
    parts: string[] | string,
    outputPath: string,
    onProgress?: (progress: JoinProgress) => void
  ): Promise<string> {
    let partFiles: string[];
    let metadata: SplitMetadata | null = null;

    // 메타데이터 파일인 경우
    if (typeof parts === 'string' && parts.endsWith('.meta.json')) {
      const loadedMetadata: SplitMetadata = await fs.readJson(parts);
      metadata = loadedMetadata;
      const dir = path.dirname(parts);
      partFiles = [];
      for (let i = 1; i <= loadedMetadata.partCount; i++) {
        partFiles.push(path.join(dir, `${loadedMetadata.originalFileName}.part${String(i).padStart(3, '0')}`));
      }
    } else if (typeof parts === 'string') {
      throw new Error('parts는 파일 배열이거나 메타데이터 파일 경로여야 합니다.');
    } else {
      partFiles = parts.sort(); // 파트 순서대로 정렬
    }

    // 파트 파일 존재 확인
    for (const part of partFiles) {
      if (!(await fs.pathExists(part))) {
        throw new Error(`분할 파일을 찾을 수 없습니다: ${part}`);
      }
    }

    // 총 크기 계산
    let totalBytes = 0;
    for (const part of partFiles) {
      const stat = await fs.stat(part);
      totalBytes += stat.size;
    }

    // 출력 디렉토리 확인
    await fs.ensureDir(path.dirname(outputPath));

    // 병합 시작
    const writeStream = fs.createWriteStream(outputPath);
    const hash = crypto.createHash('sha256');
    let processedBytes = 0;

    for (let i = 0; i < partFiles.length; i++) {
      const partPath = partFiles[i];
      const partData = await fs.readFile(partPath);

      hash.update(partData);
      writeStream.write(partData);

      processedBytes += partData.length;

      if (onProgress) {
        onProgress({
          currentPart: i + 1,
          totalParts: partFiles.length,
          processedBytes,
          totalBytes,
          percentage: (processedBytes / totalBytes) * 100,
        });
      }
    }

    writeStream.end();
    await new Promise<void>((resolve) => writeStream.on('finish', resolve));

    const checksum = hash.digest('hex');

    // 체크섬 검증
    if (metadata && metadata.checksum !== checksum) {
      logger.warn('체크섬 불일치! 파일이 손상되었을 수 있습니다.', {
        expected: metadata.checksum,
        actual: checksum,
      });
    }

    logger.info('파일 병합 완료', {
      outputPath,
      parts: partFiles.length,
      totalBytes,
      checksum,
    });

    return outputPath;
  }

  /**
   * 파일 체크섬 계산
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Bash 병합 스크립트 생성
   */
  private async generateBashMergeScript(
    outputDir: string,
    originalFileName: string,
    partCount: number
  ): Promise<string> {
    const scriptPath = path.join(outputDir, 'merge.sh');
    const lines: string[] = [
      '#!/bin/bash',
      '',
      '#===============================================================================',
      '# DepsSmuggler 파일 병합 스크립트',
      '# 생성 일시: ' + new Date().toLocaleString('ko-KR'),
      '#',
      '# 사용법: chmod +x merge.sh && ./merge.sh',
      '#===============================================================================',
      '',
      '# 색상 정의',
      'GREEN="\\033[0;32m"',
      'RED="\\033[0;31m"',
      'NC="\\033[0m"',
      '',
      'echo -e "${GREEN}[INFO]${NC} 파일 병합을 시작합니다..."',
      '',
      'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      'cd "$SCRIPT_DIR"',
      '',
      `OUTPUT_FILE="${originalFileName}"`,
      `PART_COUNT=${partCount}`,
      '',
      '# 파트 파일 확인',
      'for i in $(seq -w 1 $PART_COUNT); do',
      '    PART_FILE="${OUTPUT_FILE}.part${i}"',
      '    if [[ ! -f "$PART_FILE" ]]; then',
      '        echo -e "${RED}[ERROR]${NC} 파트 파일을 찾을 수 없습니다: $PART_FILE"',
      '        exit 1',
      '    fi',
      'done',
      '',
      '# 파일 병합',
      'echo -e "${GREEN}[INFO]${NC} ${PART_COUNT}개의 파트를 병합합니다..."',
      'cat "${OUTPUT_FILE}".part* > "$OUTPUT_FILE"',
      '',
      '# 결과 확인',
      'if [[ -f "$OUTPUT_FILE" ]]; then',
      '    SIZE=$(ls -lh "$OUTPUT_FILE" | awk \'{print $5}\')',
      '    echo -e "${GREEN}[INFO]${NC} 병합 완료: $OUTPUT_FILE ($SIZE)"',
      '',
      '    # 메타데이터로 체크섬 검증',
      '    if [[ -f "${OUTPUT_FILE}.meta.json" ]]; then',
      '        EXPECTED_CHECKSUM=$(grep -o \'"checksum": "[^"]*"\' "${OUTPUT_FILE}.meta.json" | cut -d\'"\' -f4)',
      '        ACTUAL_CHECKSUM=$(sha256sum "$OUTPUT_FILE" | cut -d\' \' -f1)',
      '        if [[ "$EXPECTED_CHECKSUM" == "$ACTUAL_CHECKSUM" ]]; then',
      '            echo -e "${GREEN}[INFO]${NC} 체크섬 검증 성공!"',
      '        else',
      '            echo -e "${RED}[WARN]${NC} 체크섬 불일치! 파일이 손상되었을 수 있습니다."',
      '        fi',
      '    fi',
      'else',
      '    echo -e "${RED}[ERROR]${NC} 병합 실패"',
      '    exit 1',
      'fi',
    ];

    const content = lines.join('\n');
    // 플랫폼에 따른 파일 권한 처리 - Windows에서는 mode 무시됨
    await fs.writeFile(scriptPath, content, getWriteOptions(true));

    return scriptPath;
  }

  /**
   * PowerShell 병합 스크립트 생성
   */
  private async generatePowerShellMergeScript(
    outputDir: string,
    originalFileName: string,
    partCount: number
  ): Promise<string> {
    const scriptPath = path.join(outputDir, 'merge.ps1');
    const lines: string[] = [
      '#===============================================================================',
      '# DepsSmuggler 파일 병합 스크립트 (PowerShell)',
      '# 생성 일시: ' + new Date().toLocaleString('ko-KR'),
      '#',
      '# 사용법: powershell -ExecutionPolicy Bypass -File merge.ps1',
      '#===============================================================================',
      '',
      'function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Green }',
      'function Write-Err { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }',
      '',
      'Write-Info "파일 병합을 시작합니다..."',
      '',
      '$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
      'Set-Location $ScriptDir',
      '',
      `$OutputFile = "${originalFileName}"`,
      `$PartCount = ${partCount}`,
      '',
      '# 파트 파일 확인',
      'for ($i = 1; $i -le $PartCount; $i++) {',
      '    $PartFile = "$OutputFile.part$($i.ToString().PadLeft(3, \'0\'))"',
      '    if (-not (Test-Path $PartFile)) {',
      '        Write-Err "파트 파일을 찾을 수 없습니다: $PartFile"',
      '        exit 1',
      '    }',
      '}',
      '',
      '# 파일 병합',
      'Write-Info "$PartCount 개의 파트를 병합합니다..."',
      '',
      '# 출력 파일 생성 - Join-Path를 사용하여 크로스 플랫폼 호환성 보장',
      '$OutputPath = Join-Path -Path $ScriptDir -ChildPath $OutputFile',
      '$OutStream = [System.IO.File]::Create($OutputPath)',
      '',
      'for ($i = 1; $i -le $PartCount; $i++) {',
      '    $PartFile = "$OutputFile.part$($i.ToString().PadLeft(3, \'0\'))"',
      '    $PartPath = Join-Path -Path $ScriptDir -ChildPath $PartFile',
      '    Write-Host "  파트 $i / $PartCount 병합 중..." -NoNewline',
      '    $Bytes = [System.IO.File]::ReadAllBytes($PartPath)',
      '    $OutStream.Write($Bytes, 0, $Bytes.Length)',
      '    Write-Host " 완료"',
      '}',
      '',
      '$OutStream.Close()',
      '',
      '# 결과 확인',
      'if (Test-Path $OutputFile) {',
      '    $Size = (Get-Item $OutputFile).Length',
      '    $SizeMB = [math]::Round($Size / 1MB, 2)',
      '    Write-Info "병합 완료: $OutputFile ($SizeMB MB)"',
      '',
      '    # 메타데이터로 체크섬 검증',
      '    $MetaFile = "$OutputFile.meta.json"',
      '    if (Test-Path $MetaFile) {',
      '        $Meta = Get-Content $MetaFile | ConvertFrom-Json',
      '        $ExpectedChecksum = $Meta.checksum',
      '        $ActualChecksum = (Get-FileHash $OutputFile -Algorithm SHA256).Hash.ToLower()',
      '        if ($ExpectedChecksum -eq $ActualChecksum) {',
      '            Write-Info "체크섬 검증 성공!"',
      '        } else {',
      '            Write-Host "[WARN] 체크섬 불일치! 파일이 손상되었을 수 있습니다." -ForegroundColor Yellow',
      '        }',
      '    }',
      '} else {',
      '    Write-Err "병합 실패"',
      '    exit 1',
      '}',
    ];

    const content = lines.join('\r\n');
    await fs.writeFile(scriptPath, content, 'utf-8');

    return scriptPath;
  }

  /**
   * 파일이 분할이 필요한지 확인
   */
  async needsSplit(filePath: string, maxSizeMB: number = 25): Promise<boolean> {
    const stat = await fs.stat(filePath);
    return stat.size > maxSizeMB * 1024 * 1024;
  }

  /**
   * 예상 파트 수 계산
   */
  async estimatePartCount(filePath: string, maxSizeMB: number = 25): Promise<number> {
    const stat = await fs.stat(filePath);
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    return Math.ceil(stat.size / maxSizeBytes);
  }
}

// 싱글톤 인스턴스
let fileSplitterInstance: FileSplitter | null = null;

export function getFileSplitter(): FileSplitter {
  if (!fileSplitterInstance) {
    fileSplitterInstance = new FileSplitter();
  }
  return fileSplitterInstance;
}
