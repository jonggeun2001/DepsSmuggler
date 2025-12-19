/**
 * OS 패키지 CLI 명령어
 * OS 패키지(yum, apt, apk) 다운로드를 위한 CLI 명령어
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  getDistributionById,
  getDistributionsByPackageManager,
  OS_DISTRIBUTIONS,
} from '../../core/downloaders/os-shared/repositories';
import type {
  OSDistribution,
  OSPackageManager,
  OSPackageInfo,
  OSArchitecture,
  OSPackageSearchResult,
} from '../../core/downloaders/os-shared/types';
import { YumMetadataParser } from '../../core/downloaders/yum';
import { AptMetadataParser } from '../../core/downloaders/apt';
import { ApkMetadataParser } from '../../core/downloaders/apk';

// 검색 기능은 CLI에서 직접 지원
// 다운로드 기능은 Electron GUI의 os:* IPC 핸들러를 통해 사용

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
async function searchCommand(
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
    // 검색 결과를 통일된 형식으로 저장 (패키지명, 버전, 저장소명, 설명)
    const searchResults: Array<{ name: string; version: string; repoName: string; summary?: string }> = [];
    const repos = [...distro.defaultRepos, ...distro.extendedRepos].filter(r => r.enabled);

    for (const repo of repos) {
      try {
        switch (distro.packageManager) {
          case 'yum': {
            const parser = new YumMetadataParser(repo, arch);
            const packages = await parser.searchPackages(query, 'partial');
            for (const pkg of packages) {
              searchResults.push({
                name: pkg.name,
                version: pkg.version,
                repoName: repo.name,
                summary: pkg.summary,
              });
            }
            break;
          }
          case 'apt': {
            // apt는 component가 필요 (기본 'main' 사용)
            const parser = new AptMetadataParser(repo, 'main', arch);
            const results = await parser.searchPackages(query, 'partial');
            for (const result of results) {
              searchResults.push({
                name: result.name,
                version: result.latest.version,
                repoName: repo.name,
                summary: result.latest.summary,
              });
            }
            break;
          }
          case 'apk': {
            const parser = new ApkMetadataParser(repo, arch);
            const results = await parser.searchPackages(query, 'partial');
            for (const result of results) {
              searchResults.push({
                name: result.name,
                version: result.latest.version,
                repoName: repo.name,
                summary: result.latest.summary,
              });
            }
            break;
          }
        }
      } catch (repoError) {
        // 개별 저장소 오류는 경고만 출력
        console.log(chalk.gray(`  저장소 '${repo.name}' 검색 건너뜀: ${(repoError as Error).message}`));
      }
    }

    // 중복 제거 (이름 + 버전 기준)
    const uniqueResults = Array.from(
      new Map(searchResults.map(p => [`${p.name}-${p.version}`, p])).values()
    );

    // 결과 제한
    const limit = parseInt(options.limit, 10);
    const finalResults = uniqueResults.slice(0, limit);

    if (finalResults.length === 0) {
      console.log(chalk.yellow('검색 결과가 없습니다.'));
      return;
    }

    console.log(chalk.green(`${finalResults.length}개의 패키지를 찾았습니다:\n`));
    console.log(chalk.gray('─'.repeat(80)));

    for (const pkg of finalResults) {
      const versionStr = String(pkg.version || 'unknown');
      console.log(
        `${chalk.bold(pkg.name.padEnd(30))} ${chalk.blue(versionStr.padEnd(20))} ${chalk.gray(pkg.repoName)}`
      );
      if (pkg.summary) {
        console.log(chalk.gray(`  ${pkg.summary.slice(0, 70)}${pkg.summary.length > 70 ? '...' : ''}`));
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
async function downloadCommand(
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
  console.log(chalk.yellow('\n⚠️  OS 패키지 CLI 명령어는 현재 재구현 중입니다.'));
  console.log(chalk.cyan('Electron GUI를 사용하여 OS 패키지를 다운로드하세요.\n'));
  process.exit(0);
}

/**
 * 캐시 통계 명령어
 */
async function cacheStatsCommand(): Promise<void> {
  console.log(chalk.yellow('\n⚠️  OS 패키지 CLI 명령어는 현재 재구현 중입니다.'));
  console.log(chalk.cyan('Electron GUI를 사용하여 OS 패키지를 관리하세요.\n'));
  process.exit(0);
}

/**
 * 캐시 삭제 명령어
 */
async function cacheClearCommand(options: { force?: boolean }): Promise<void> {
  console.log(chalk.yellow('\n⚠️  OS 패키지 CLI 명령어는 현재 재구현 중입니다.'));
  console.log(chalk.cyan('Electron GUI를 사용하여 OS 패키지를 관리하세요.\n'));
  process.exit(0);
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
