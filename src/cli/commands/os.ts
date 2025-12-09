/**
 * OS 패키지 CLI 명령어
 * OS 패키지(yum, apt, apk) 다운로드를 위한 CLI 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import cliProgress from 'cli-progress';
import * as path from 'path';
import * as fs from 'fs-extra';
import {
  OSPackageDownloader,
  getDistributionById,
  getDistributionsByPackageManager,
  OS_DISTRIBUTIONS,
} from '../../core/downloaders/os';
import type {
  OSDistribution,
  OSPackageInfo,
  OutputType,
  ArchiveFormat,
  OSPackageManager,
  OSArchitecture,
  OSDownloadProgress,
  CacheMode,
} from '../../core/downloaders/os/types';

// 싱글톤 다운로더 인스턴스
let downloaderInstance: OSPackageDownloader | null = null;

function getDownloader(): OSPackageDownloader {
  if (!downloaderInstance) {
    downloaderInstance = new OSPackageDownloader();
  }
  return downloaderInstance;
}

/**
 * OS 명령어 등록
 */
export function registerOSCommands(program: Command): void {
  const osCmd = program
    .command('os')
    .description('OS 패키지 다운로드 (yum, apt, apk)');

  // 배포판 목록 조회
  osCmd
    .command('list-distros')
    .description('지원하는 OS 배포판 목록 조회')
    .option('-t, --type <type>', 'OS 패키지 관리자 타입 (yum, apt, apk)')
    .action(async (options) => {
      await listDistrosCommand(options);
    });

  // 패키지 검색
  osCmd
    .command('search <query>')
    .description('OS 패키지 검색')
    .requiredOption('-d, --distro <distro>', '배포판 ID (예: rocky-9, ubuntu-22.04, alpine-3.20)')
    .option('-a, --arch <arch>', '아키텍처', 'x86_64')
    .option('-l, --limit <num>', '검색 결과 수 제한', '20')
    .action(async (query, options) => {
      await searchCommand(query, options);
    });

  // 패키지 다운로드
  osCmd
    .command('download <packages...>')
    .description('OS 패키지 다운로드')
    .requiredOption('-d, --distro <distro>', '배포판 ID')
    .option('-a, --arch <arch>', '아키텍처', 'x86_64')
    .option('-o, --output <path>', '출력 경로', './os-packages')
    .option('--format <format>', '출력 형식 (archive, repository, both)', 'archive')
    .option('--archive-format <format>', '압축 형식 (zip, tar.gz)', 'zip')
    .option('--no-deps', '의존성 해결 안 함')
    .option('--scripts', '설치 스크립트 포함')
    .option('--concurrency <num>', '동시 다운로드 수', '3')
    .action(async (packages, options) => {
      await downloadCommand(packages, options);
    });

  // 캐시 관리
  const cacheCmd = osCmd
    .command('cache')
    .description('OS 패키지 캐시 관리');

  cacheCmd
    .command('stats')
    .description('캐시 통계 조회')
    .action(async () => {
      await cacheStatsCommand();
    });

  cacheCmd
    .command('clear')
    .description('캐시 삭제')
    .option('-f, --force', '확인 없이 삭제')
    .action(async (options) => {
      await cacheClearCommand(options);
    });
}

/**
 * 배포판 목록 조회 명령어
 */
async function listDistrosCommand(options: { type?: string }): Promise<void> {
  console.log(chalk.cyan('\n지원하는 OS 배포판 목록\n'));

  try {
    let distributions: OSDistribution[];

    if (options.type) {
      distributions = getDistributionsByPackageManager(options.type as OSPackageManager);
    } else {
      distributions = OS_DISTRIBUTIONS;
    }

    if (distributions.length === 0) {
      console.log(chalk.yellow('지원하는 배포판이 없습니다.'));
      return;
    }

    // 패키지 관리자별로 그룹화
    const grouped = groupByPackageManager(distributions);

    for (const [pm, distros] of Object.entries(grouped)) {
      const pmIcon = getPMIcon(pm as OSPackageManager);
      console.log(chalk.bold(`${pmIcon} ${pm.toUpperCase()} 기반 배포판`));
      console.log(chalk.gray('─'.repeat(50)));

      for (const distro of distros) {
        console.log(
          `  ${chalk.green(distro.id.padEnd(20))} ${distro.name} ${distro.version}`
        );
        console.log(
          chalk.gray(`    아키텍처: ${distro.architectures.join(', ')}`)
        );
      }
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 패키지 검색 명령어
 */
async function searchCommand(
  query: string,
  options: { distro: string; arch: string; limit: string }
): Promise<void> {
  console.log(chalk.cyan(`\n"${query}" 검색 중...\n`));

  try {
    const downloader = getDownloader();
    const distribution = getDistributionById(options.distro);

    if (!distribution) {
      console.log(chalk.red(`배포판 "${options.distro}"을(를) 찾을 수 없습니다.`));
      console.log(chalk.gray('사용 가능한 배포판 목록: depssmuggler os list-distros'));
      process.exit(1);
    }

    const result = await downloader.search({
      query,
      distribution,
      architecture: options.arch as OSArchitecture,
      limit: parseInt(options.limit, 10),
    });

    if (result.packages.length === 0) {
      console.log(chalk.yellow('검색 결과가 없습니다.'));
      return;
    }

    // 테이블 헤더
    const header = `${'패키지명'.padEnd(30)} ${'최신 버전'.padEnd(20)} ${'버전 수'.padEnd(10)} ${'아키텍처'.padEnd(12)} ${'크기'.padEnd(12)}`;
    console.log(chalk.bold(header));
    console.log(chalk.gray('─'.repeat(84)));

    // 결과 출력 (그룹화된 결과에서 latest 사용)
    for (const pkgResult of result.packages) {
      const name = pkgResult.name.length > 28 ? pkgResult.name.substring(0, 25) + '...' : pkgResult.name;
      const version = pkgResult.latest.version.length > 18
        ? pkgResult.latest.version.substring(0, 15) + '...'
        : pkgResult.latest.version;
      const versionCount = pkgResult.versions.length.toString();

      console.log(
        `${chalk.green(name.padEnd(30))} ${version.padEnd(20)} ${versionCount.padEnd(10)} ${pkgResult.latest.architecture.padEnd(12)} ${formatBytes(pkgResult.latest.size).padEnd(12)}`
      );
    }

    console.log(chalk.gray('─'.repeat(84)));
    console.log(chalk.gray(`총 ${result.totalCount}개 패키지 (${result.packages.length}개 표시)`));
    console.log('');
  } catch (error) {
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 패키지 다운로드 명령어
 */
async function downloadCommand(
  packageNames: string[],
  options: {
    distro: string;
    arch: string;
    output: string;
    format: OutputType;
    archiveFormat: ArchiveFormat;
    deps: boolean;
    scripts?: boolean;
    concurrency: string;
  }
): Promise<void> {
  console.log(chalk.cyan('\nOS 패키지 다운로드 준비 중...\n'));

  try {
    const downloader = getDownloader();
    const distribution = getDistributionById(options.distro);

    if (!distribution) {
      console.log(chalk.red(`배포판 "${options.distro}"을(를) 찾을 수 없습니다.`));
      console.log(chalk.gray('사용 가능한 배포판 목록: depssmuggler os list-distros'));
      process.exit(1);
    }

    const pmIcon = getPMIcon(distribution.packageManager);
    console.log(chalk.green(`${pmIcon} 배포판: ${distribution.name} ${distribution.version}`));
    console.log(chalk.gray(`  아키텍처: ${options.arch}`));
    console.log(chalk.gray(`  패키지 수: ${packageNames.length}개`));
    console.log('');

    // 패키지 정보 검색
    console.log(chalk.cyan('패키지 정보 조회 중...'));
    const packages: OSPackageInfo[] = [];
    const notFound: string[] = [];

    for (const pkgName of packageNames) {
      const result = await downloader.search({
        query: pkgName,
        distribution,
        architecture: options.arch as OSArchitecture,
        matchType: 'exact',
        limit: 1,
      });

      if (result.packages.length > 0) {
        // 그룹화된 결과에서 latest 패키지 사용
        packages.push(result.packages[0].latest);
        console.log(chalk.green(`  ✓ ${pkgName} (${result.packages[0].latest.version})`));
      } else {
        notFound.push(pkgName);
        console.log(chalk.yellow(`  ✗ ${pkgName} (찾을 수 없음)`));
      }
    }

    if (packages.length === 0) {
      console.log(chalk.red('\n다운로드할 패키지가 없습니다.'));
      process.exit(1);
    }

    if (notFound.length > 0) {
      console.log(chalk.yellow(`\n경고: ${notFound.length}개 패키지를 찾을 수 없습니다.`));
    }

    // 의존성 해결
    let allPackages = packages;
    if (options.deps !== false) {
      console.log(chalk.cyan('\n의존성 해결 중...'));

      const progressBar = new cliProgress.SingleBar(
        {
          format: '  진행률 |{bar}| {percentage}% | {message}',
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic
      );

      progressBar.start(100, 0, { message: '의존성 분석 중...' });

      const depsResult = await downloader.resolveDependencies(
        packages,
        distribution,
        options.arch as OSArchitecture,
        {
          onProgress: (message: string, current: number, total: number) => {
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            progressBar.update(percent, { message });
          },
        }
      );

      progressBar.stop();

      allPackages = depsResult.packages;
      const depsCount = allPackages.length - packages.length;

      console.log(chalk.green(`✓ 의존성 해결 완료`));
      console.log(chalk.gray(`  총 패키지: ${allPackages.length}개 (원본 ${packages.length}개 + 의존성 ${depsCount}개)`));

      if (depsResult.unresolved && depsResult.unresolved.length > 0) {
        console.log(chalk.yellow(`  경고: ${depsResult.unresolved.length}개 의존성 해결 실패`));
      }
    }

    // 출력 경로 생성
    const outputPath = path.resolve(options.output);
    await fs.ensureDir(outputPath);

    console.log(chalk.cyan(`\n출력 경로: ${outputPath}`));
    console.log(chalk.cyan(`출력 형식: ${options.format}`));
    if (options.format !== 'repository') {
      console.log(chalk.cyan(`압축 형식: ${options.archiveFormat}`));
    }
    console.log('');

    // 다운로드 시작
    console.log(chalk.cyan('다운로드 중...'));

    const multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: '  {bar} | {filename} | {percentage}% | {speed}',
      },
      cliProgress.Presets.shades_classic
    );

    const overallBar = multibar.create(100, 0, {
      filename: '전체 진행률'.padEnd(30),
      speed: 'N/A',
    });

    const downloadResult = await downloader.download({
      packages: allPackages,
      outputDir: outputPath,
      resolveDependencies: false, // 이미 해결됨
      includeOptionalDeps: false,
      concurrency: parseInt(options.concurrency, 10),
      verifyGPG: false,
      cacheMode: 'session',
      onProgress: (progress: OSDownloadProgress) => {
        const percent = progress.totalBytes > 0
          ? Math.round((progress.bytesDownloaded / progress.totalBytes) * 100)
          : Math.round((progress.currentIndex / progress.totalPackages) * 100);
        overallBar.update(percent, {
          filename: progress.currentPackage.substring(0, 30).padEnd(30),
          speed: formatSpeed(progress.speed),
        });
      },
    });

    multibar.stop();

    // 결과 출력
    console.log('\n');

    if (downloadResult.failed.length === 0) {
      console.log(chalk.green('✓ 다운로드 완료!'));
    } else {
      console.log(chalk.yellow('⚠ 다운로드 완료 (일부 실패)'));
    }

    console.log(chalk.gray(`  성공: ${downloadResult.success.length}개`));
    if (downloadResult.failed.length > 0) {
      console.log(chalk.red(`  실패: ${downloadResult.failed.length}개`));
    }
    if (downloadResult.skipped.length > 0) {
      console.log(chalk.gray(`  건너뜀: ${downloadResult.skipped.length}개`));
    }

    const totalSize = downloadResult.success.reduce((sum: number, pkg: OSPackageInfo) => sum + (pkg.size || 0), 0);
    console.log(chalk.gray(`  총 크기: ${formatBytes(totalSize)}`));
    console.log(chalk.gray(`  출력 경로: ${downloadResult.outputDir}`));

    if (downloadResult.failed.length > 0) {
      console.log(chalk.red('\n실패한 패키지:'));
      for (const item of downloadResult.failed) {
        console.log(chalk.red(`  - ${item.package.name}: ${item.error}`));
      }
    }

    console.log('');
  } catch (error) {
    console.error(chalk.red(`\n오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 캐시 통계 명령어
 */
async function cacheStatsCommand(): Promise<void> {
  console.log(chalk.cyan('\nOS 패키지 캐시 통계\n'));

  try {
    const downloader = getDownloader();
    const stats = await downloader.getCacheStats();

    console.log(`  캐시 크기: ${formatBytes(stats.totalSize)}`);
    console.log(`  엔트리 수: ${stats.entryCount}개`);
    console.log(`  히트율: ${(stats.hitRate * 100).toFixed(1)}%`);
    console.log('');
  } catch (error) {
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 캐시 삭제 명령어
 */
async function cacheClearCommand(options: { force?: boolean }): Promise<void> {
  try {
    if (!options.force) {
      console.log(chalk.yellow('\n캐시를 삭제하시겠습니까? (--force 옵션으로 확인 없이 삭제)\n'));
      return;
    }

    console.log(chalk.cyan('\nOS 패키지 캐시 삭제 중...\n'));

    const downloader = getDownloader();
    await downloader.clearCache();

    console.log(chalk.green('✓ 캐시 삭제 완료\n'));
  } catch (error) {
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

// 유틸리티 함수들

function groupByPackageManager(distributions: OSDistribution[]): Record<string, OSDistribution[]> {
  const grouped: Record<string, OSDistribution[]> = {};

  for (const distro of distributions) {
    const pm = distro.packageManager;
    if (!grouped[pm]) {
      grouped[pm] = [];
    }
    grouped[pm].push(distro);
  }

  return grouped;
}

function getPMIcon(pm: 'yum' | 'apt' | 'apk'): string {
  switch (pm) {
    case 'yum':
      return '🎩';
    case 'apt':
      return '📦';
    case 'apk':
      return '🏔️';
    default:
      return '📦';
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s';
}

export default registerOSCommands;
