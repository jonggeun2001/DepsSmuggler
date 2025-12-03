import cliProgress from 'cli-progress';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs-extra';
import { PackageInfo, PackageType, Architecture } from '../../types';
import { getDownloadManager, OverallProgress } from '../../core/downloadManager';
import { getArchivePackager, ArchiveFormat } from '../../core/packager/archivePackager';
import { getMirrorPackager } from '../../core/packager/mirrorPackager';
import { getScriptGenerator } from '../../core/packager/scriptGenerator';

// 다운로드 옵션
interface DownloadOptions {
  type: PackageType;
  package?: string;
  pkgVersion: string;
  arch: Architecture;
  output: string;
  format: ArchiveFormat | 'mirror';
  file?: string;
  deps: boolean;
  concurrency: string;
}

/**
 * download 명령어 핸들러
 */
export async function downloadCommand(options: DownloadOptions): Promise<void> {
  console.log(chalk.cyan('다운로드 준비 중...'));

  try {
    // 패키지 목록 생성
    let packages: PackageInfo[] = [];

    if (options.file) {
      // 파일에서 패키지 목록 읽기
      packages = await parsePackageFile(options.file, options.type);
      console.log(chalk.green(`${packages.length}개 패키지를 파일에서 로드했습니다`));
    } else if (options.package) {
      // 단일 패키지
      packages = [
        {
          type: options.type,
          name: options.package,
          version: options.pkgVersion,
          arch: options.arch,
        },
      ];
    } else {
      console.log(chalk.red('패키지명(-p) 또는 파일(--file)을 지정하세요'));
      process.exit(1);
    }

    console.log(chalk.green(`✓ ${packages.length}개 패키지 준비 완료`));

    // 출력 경로 생성
    const outputPath = path.resolve(options.output);
    await fs.ensureDir(outputPath);

    console.log(chalk.cyan(`\n출력 경로: ${outputPath}`));
    console.log(chalk.cyan(`출력 형식: ${options.format}`));
    console.log(chalk.cyan(`동시 다운로드: ${options.concurrency}개\n`));

    // 다운로드 매니저 설정
    const downloadManager = getDownloadManager();
    downloadManager.reset();
    downloadManager.addToQueue(packages);

    // 진행률 바 생성
    const multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: ' {bar} | {filename} | {percentage}% | {speed}',
      },
      cliProgress.Presets.shades_classic
    );

    const overallBar = multibar.create(100, 0, {
      filename: '전체 진행률',
      speed: 'N/A',
    });

    // 진행률 업데이트 이벤트
    downloadManager.on('progress', (item, overall: OverallProgress) => {
      overallBar.update(Math.round(overall.overallProgress), {
        filename: '전체 진행률',
        speed: formatSpeed(overall.currentSpeed),
      });
    });

    // 아이템 완료 이벤트
    downloadManager.on('itemComplete', (item) => {
      console.log(chalk.green(`\n✓ ${item.package.name}@${item.package.version} 완료`));
    });

    // 아이템 실패 이벤트
    downloadManager.on('itemFailed', (item, error) => {
      console.log(chalk.red(`\n✗ ${item.package.name}@${item.package.version} 실패: ${error.message}`));
    });

    // 다운로드 시작
    const result = await downloadManager.startDownload({
      outputPath,
      concurrency: parseInt(options.concurrency, 10),
      maxRetries: 3,
    });

    multibar.stop();

    // 결과 출력
    console.log('\n');

    if (result.success) {
      console.log(chalk.green('✓ 다운로드 완료!'));
      console.log(chalk.gray(`  총 크기: ${formatBytes(result.totalSize)}`));
      console.log(chalk.gray(`  소요 시간: ${formatDuration(result.duration)}`));

      // 패키징 처리
      const files = result.items
        .filter((item) => item.status === 'completed' && item.filePath)
        .map((item) => item.filePath!);

      if (options.format === 'mirror') {
        // 미러 구조 생성
        console.log(chalk.cyan('\n미러 저장소 구조 생성 중...'));

        const mirrorPackager = getMirrorPackager();
        const mirrorPath = path.join(outputPath, 'mirror');

        const mirrorResult = await mirrorPackager.createMirror(files, packages, mirrorPath, {
          includeReadme: true,
          onProgress: (progress) => {
            process.stdout.write(`\r  진행: ${progress.percentage.toFixed(1)}%`);
          },
        });

        console.log(chalk.green(`\n✓ 미러 저장소 생성 완료: ${mirrorPath}`));
        console.log(chalk.gray(`  파일 수: ${mirrorResult.totalFiles}개`));
        console.log(chalk.gray(`  총 크기: ${formatBytes(mirrorResult.totalSize)}`));

        // 설치 스크립트 생성
        console.log(chalk.cyan('\n설치 스크립트 생성 중...'));
        const scriptGenerator = getScriptGenerator();
        await scriptGenerator.generateAllScripts(packages, mirrorPath);
        console.log(chalk.green('✓ 설치 스크립트 생성 완료'));
      } else {
        // 압축 파일 생성
        console.log(chalk.cyan('\n압축 파일 생성 중...'));

        const archivePackager = getArchivePackager();
        const archiveName = `packages-${Date.now()}.${options.format === 'zip' ? 'zip' : 'tar.gz'}`;
        const archivePath = path.join(outputPath, archiveName);

        await archivePackager.createArchive(files, archivePath, packages, {
          format: options.format as ArchiveFormat,
          includeManifest: true,
          includeReadme: true,
        });

        console.log(chalk.green(`✓ 압축 파일 생성 완료: ${archivePath}`));
      }
    } else {
      console.log(chalk.yellow('⚠ 다운로드 완료 (일부 실패)'));

      const failed = result.items.filter((item) => item.status === 'failed');
      if (failed.length > 0) {
        console.log(chalk.red(`\n실패한 패키지 (${failed.length}개):`));
        for (const item of failed) {
          console.log(chalk.red(`  - ${item.package.name}@${item.package.version}: ${item.error}`));
        }
      }
    }
  } catch (error) {
    console.log(chalk.red('✗ 다운로드 실패'));
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 패키지 파일 파싱
 */
async function parsePackageFile(filePath: string, type: PackageType): Promise<PackageInfo[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const packages: PackageInfo[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (type === 'pip') {
      // requirements.txt 형식
      const match = trimmed.match(/^([a-zA-Z0-9._-]+)(?:[=<>!~]+(.+))?$/);
      if (match) {
        packages.push({
          type: 'pip',
          name: match[1],
          version: match[2] || 'latest',
        });
      }
    } else if (type === 'maven') {
      // groupId:artifactId:version 형식
      const parts = trimmed.split(':');
      if (parts.length >= 2) {
        packages.push({
          type: 'maven',
          name: `${parts[0]}:${parts[1]}`,
          version: parts[2] || 'latest',
          metadata: {
            groupId: parts[0],
            artifactId: parts[1],
          },
        });
      }
    } else {
      // 일반 형식: name@version 또는 name
      const [name, version] = trimmed.split('@');
      packages.push({
        type,
        name,
        version: version || 'latest',
      });
    }
  }

  return packages;
}

/**
 * 바이트 포맷
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 속도 포맷
 */
function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

/**
 * 시간 포맷
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}분 ${remainingSeconds}초`;
  }
  return `${seconds}초`;
}
