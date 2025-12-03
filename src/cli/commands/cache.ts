import chalk from 'chalk';
import Table from 'cli-table3';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';
import { getConfigManager } from '../../core/config';

/**
 * 캐시 크기 확인
 */
export async function cacheSize(): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const cachePath = config.cachePath;

  try {
    const size = await getDirectorySize(cachePath);
    console.log(chalk.cyan('\n캐시 정보:'));
    console.log(`  경로: ${cachePath}`);
    console.log(`  크기: ${formatBytes(size)}`);
    console.log(`  최대 크기: ${formatBytes(config.maxCacheSize)}`);
    console.log(`  사용률: ${((size / config.maxCacheSize) * 100).toFixed(1)}%`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(chalk.yellow('캐시 디렉토리가 존재하지 않습니다'));
    } else {
      console.error(chalk.red(`캐시 크기 확인 실패: ${(error as Error).message}`));
    }
  }
}

/**
 * 캐시 삭제
 */
export async function cacheClear(options: { force?: boolean }): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const cachePath = config.cachePath;

  if (!options.force) {
    const confirm = await askConfirmation('정말로 캐시를 삭제하시겠습니까?');
    if (!confirm) {
      console.log(chalk.yellow('캐시 삭제가 취소되었습니다'));
      return;
    }
  }

  try {
    const size = await getDirectorySize(cachePath);
    await fs.remove(cachePath);
    console.log(chalk.green(`✓ 캐시가 삭제되었습니다 (${formatBytes(size)} 확보)`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(chalk.yellow('삭제할 캐시가 없습니다'));
    } else {
      console.error(chalk.red(`캐시 삭제 실패: ${(error as Error).message}`));
    }
  }
}

/**
 * 캐시된 패키지 목록
 */
export async function cacheList(): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const cachePath = config.cachePath;

  try {
    const exists = await fs.pathExists(cachePath);
    if (!exists) {
      console.log(chalk.yellow('캐시된 패키지가 없습니다'));
      return;
    }

    const dirs = await fs.readdir(cachePath);
    if (dirs.length === 0) {
      console.log(chalk.yellow('캐시된 패키지가 없습니다'));
      return;
    }

    const table = new Table({
      head: [chalk.cyan('패키지'), chalk.cyan('버전'), chalk.cyan('타입'), chalk.cyan('크기'), chalk.cyan('캐시 일시')],
      colWidths: [25, 15, 10, 12, 22],
    });

    for (const dir of dirs) {
      const manifestPath = path.join(cachePath, dir, 'manifest.json');
      try {
        const manifest = await fs.readJson(manifestPath);
        const stats = await fs.stat(path.join(cachePath, dir));
        const size = await getDirectorySize(path.join(cachePath, dir));

        table.push([
          manifest.name || dir,
          manifest.version || '-',
          manifest.type || '-',
          formatBytes(size),
          new Date(stats.mtime).toLocaleString('ko-KR'),
        ]);
      } catch {
        // 매니페스트가 없는 경우 디렉토리명만 표시
        const stats = await fs.stat(path.join(cachePath, dir));
        const size = await getDirectorySize(path.join(cachePath, dir));
        table.push([
          dir,
          '-',
          '-',
          formatBytes(size),
          new Date(stats.mtime).toLocaleString('ko-KR'),
        ]);
      }
    }

    console.log(chalk.cyan('\n캐시된 패키지 목록:\n'));
    console.log(table.toString());
    console.log(chalk.gray(`\n총 ${dirs.length}개 패키지`));
  } catch (error) {
    console.error(chalk.red(`캐시 목록 조회 실패: ${(error as Error).message}`));
  }
}

/**
 * 디렉토리 크기 계산
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let size = 0;

  const exists = await fs.pathExists(dirPath);
  if (!exists) return 0;

  const files = await fs.readdir(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = await fs.stat(filePath);

    if (stats.isDirectory()) {
      size += await getDirectorySize(filePath);
    } else {
      size += stats.size;
    }
  }

  return size;
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
 * 확인 프롬프트
 */
async function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
