/**
 * OS 패키지 CLI 명령어
 * OS 패키지(yum, apt, apk) 다운로드를 위한 CLI 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as readline from 'readline';
import {
  getDistributionById,
  getDistributionsByPackageManager,
  OS_DISTRIBUTIONS,
} from '../../core/downloaders/os-shared/repositories';
import type {
  OSDistribution,
  OSPackageManager,
  OSArchitecture,
  OutputType,
  ArchiveFormat,
} from '../../core/downloaders/os-shared/types';
import {
  clearOSPackageCache,
  downloadOSPackages,
  getOSPackageCacheStats,
  searchOSPackages,
} from '../../core/downloaders/os-shared/cli-backend';
import { getConfigManager } from '../../core/config';

/**
 * OS 명령어 등록
 */
export function registerOSCommands(program: Command): void {
  const osCmd = program
    .command('os')
    .description('OS 패키지 검색 및 다운로드 (yum, apt, apk)');

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
export async function searchCommand(
  query: string,
  options: { distro: string; arch: string; limit: string }
): Promise<void> {
  const distro = getDistributionById(options.distro);
  if (!distro) {
    console.error(chalk.red(`\n오류: 알 수 없는 배포판 '${options.distro}'`));
    console.log(chalk.cyan('지원하는 배포판 목록을 보려면: depssmuggler os list-distros'));
    process.exit(1);
  }

  const arch = options.arch as OSArchitecture;
  if (!distro.architectures.includes(arch)) {
    console.error(chalk.red(`\n오류: 배포판 '${distro.name}'은 아키텍처 '${arch}'를 지원하지 않습니다.`));
    console.log(chalk.cyan(`지원되는 아키텍처: ${distro.architectures.join(', ')}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n'${query}' 검색 중... (${distro.name}, ${arch})\n`));

  try {
    const config = getConfigManager().getConfig();
    const cacheDirectory = path.join(config.cachePath, 'os-packages');
    const limit = parseInt(options.limit, 10);
    const groupedResults = await searchOSPackages({
      distribution: distro,
      architecture: arch,
      query,
      cacheDirectory,
      cacheEnabled: config.cacheEnabled,
    });
    const finalResults = groupedResults
      .flatMap((result) =>
        result.versions.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          repoName: pkg.repository.name,
          summary: pkg.summary,
        }))
      )
      .reduce<Array<{ name: string; version: string; repoName: string; summary?: string }>>(
        (uniqueResults, result) => {
          if (
            uniqueResults.some(
              (existing) =>
                existing.name === result.name && existing.version === result.version
            )
          ) {
            return uniqueResults;
          }
          uniqueResults.push(result);
          return uniqueResults;
        },
        []
      )
      .slice(0, Number.isFinite(limit) && limit > 0 ? limit : groupedResults.length);

    if (finalResults.length === 0) {
      console.log(chalk.yellow('검색 결과가 없습니다.'));
      return;
    }

    console.log(chalk.green(`${finalResults.length}개의 패키지를 찾았습니다:\n`));
    console.log(chalk.gray('─'.repeat(80)));

    for (const result of finalResults) {
      const versionStr = String(result.version || 'unknown');
      console.log(
        `${chalk.bold(result.name.padEnd(30))} ${chalk.blue(versionStr.padEnd(20))} ${chalk.gray(result.repoName)}`
      );
      if (result.summary) {
        console.log(
          chalk.gray(
            `  ${result.summary.slice(0, 70)}${result.summary.length > 70 ? '...' : ''}`
          )
        );
      }
    }

    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.cyan(`\n다운로드: depssmuggler os download <패키지명> -d ${options.distro}\n`));
  } catch (error) {
    console.error(chalk.red(`\n검색 오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 패키지 다운로드 명령어
 */
export async function downloadCommand(
  packageNames: string[],
  options: {
    distro: string;
    arch: string;
    output: string;
    format: string;
    archiveFormat: string;
    deps: boolean;
    scripts?: boolean;
    concurrency: string;
  }
): Promise<void> {
  const distro = getDistributionById(options.distro);
  if (!distro) {
    console.error(chalk.red(`\n오류: 알 수 없는 배포판 '${options.distro}'`));
    process.exit(1);
  }

  const arch = options.arch as OSArchitecture;
  if (!distro.architectures.includes(arch)) {
    console.error(chalk.red(`\n오류: 배포판 '${distro.name}'은 아키텍처 '${arch}'를 지원하지 않습니다.`));
    console.log(chalk.cyan(`지원되는 아키텍처: ${distro.architectures.join(', ')}`));
    process.exit(1);
  }

  const outputType = options.format as OutputType;
  if (!['archive', 'repository', 'both'].includes(outputType)) {
    console.error(chalk.red(`\n오류: 지원하지 않는 출력 형식 '${options.format}'`));
    process.exit(1);
  }

  const archiveFormat = options.archiveFormat as ArchiveFormat;
  if (!['zip', 'tar.gz'].includes(archiveFormat)) {
    console.error(chalk.red(`\n오류: 지원하지 않는 압축 형식 '${options.archiveFormat}'`));
    process.exit(1);
  }

  const config = getConfigManager().getConfig();
  const cacheDirectory = path.join(config.cachePath, 'os-packages');
  const concurrency = parseInt(options.concurrency, 10);

  console.log(chalk.cyan(`\nOS 패키지 다운로드를 시작합니다... (${distro.name}, ${arch})\n`));

  try {
    const result = await downloadOSPackages({
      distribution: distro,
      architecture: arch,
      packageNames,
      outputPath: options.output,
      outputType,
      archiveFormat,
      resolveDependencies: options.deps,
      includeScripts: Boolean(options.scripts),
      concurrency: Number.isFinite(concurrency) && concurrency > 0
        ? concurrency
        : config.concurrentDownloads,
      cacheDirectory,
      cacheEnabled: config.cacheEnabled,
    });

    console.log(chalk.green('다운로드가 완료되었습니다.\n'));
    console.log(`요청 패키지: ${result.requestedPackages.length}개`);
    console.log(`실제 다운로드: ${result.packages.length}개`);

    for (const artifact of result.artifacts) {
      console.log(`${artifact.type === 'archive' ? '아카이브' : '로컬 저장소'}: ${artifact.path}`);
    }

    if (result.unresolved.length > 0) {
      console.log(chalk.yellow(`\n미해결 의존성: ${result.unresolved.length}개`));
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow('\n경고:'));
      for (const warning of result.warnings) {
        console.log(`- ${warning}`);
      }
    }
    console.log('');
  } catch (error) {
    console.error(chalk.red(`\n다운로드 오류: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 캐시 통계 명령어
 */
export async function cacheStatsCommand(): Promise<void> {
  const config = getConfigManager().getConfig();
  const cacheDirectory = path.join(config.cachePath, 'os-packages');

  try {
    const stats = await getOSPackageCacheStats(cacheDirectory);
    console.log(chalk.cyan('\nOS 패키지 메타데이터 캐시 통계\n'));
    console.log(`경로: ${stats.directory}`);
    console.log(`항목 수: ${stats.entryCount}`);
    console.log(`크기: ${formatBytes(stats.totalSize)}\n`);
  } catch (error) {
    console.error(chalk.red(`캐시 통계 조회 실패: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 캐시 삭제 명령어
 */
export async function cacheClearCommand(options: { force?: boolean }): Promise<void> {
  const config = getConfigManager().getConfig();
  const cacheDirectory = path.join(config.cachePath, 'os-packages');

  if (!options.force) {
    const confirmed = await askConfirmation('정말로 OS 메타데이터 캐시를 삭제하시겠습니까?');
    if (!confirmed) {
      console.log(chalk.yellow('캐시 삭제가 취소되었습니다.\n'));
      return;
    }
  }

  try {
    const result = await clearOSPackageCache(cacheDirectory);
    if (result.clearedEntries === 0) {
      console.log(chalk.yellow('삭제할 OS 메타데이터 캐시가 없습니다.\n'));
      return;
    }

    console.log(
      chalk.green(
        `OS 메타데이터 캐시를 삭제했습니다 (${result.clearedEntries}개, ${formatBytes(result.clearedSize)}).\n`
      )
    );
  } catch (error) {
    console.error(chalk.red(`캐시 삭제 실패: ${(error as Error).message}`));
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

async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

export default registerOSCommands;
