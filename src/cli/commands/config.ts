import chalk from 'chalk';
import Table from 'cli-table3';
import { getConfigManager } from '../../core/config';

/**
 * 설정값 조회
 */
export async function configGet(key?: string): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();

  if (key) {
    const value = (config as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      console.log(chalk.cyan(`${key}: `) + chalk.white(JSON.stringify(value)));
    } else {
      console.log(chalk.yellow(`설정 '${key}'를 찾을 수 없습니다`));
    }
  } else {
    console.log(chalk.cyan('\n현재 설정:'));
    console.log(JSON.stringify(config, null, 2));
  }
}

/**
 * 설정값 변경
 */
export async function configSet(key: string, value: string): Promise<void> {
  const configManager = getConfigManager();

  try {
    // 값 파싱 (숫자, 불리언, 문자열)
    let parsedValue: unknown = value;

    if (value === 'true') {
      parsedValue = true;
    } else if (value === 'false') {
      parsedValue = false;
    } else if (!isNaN(Number(value))) {
      parsedValue = Number(value);
    }

    configManager.set(key, parsedValue);
    console.log(chalk.green(`✓ 설정이 저장되었습니다: ${key} = ${JSON.stringify(parsedValue)}`));
  } catch (error) {
    console.error(chalk.red(`설정 저장 실패: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 모든 설정 표시
 */
export async function configList(): Promise<void> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();

  const table = new Table({
    head: [chalk.cyan('설정'), chalk.cyan('값'), chalk.cyan('설명')],
    colWidths: [25, 30, 30],
  });

  const descriptions: Record<string, string> = {
    concurrentDownloads: '동시 다운로드 수',
    cacheEnabled: '캐시 사용 여부',
    cachePath: '캐시 저장 경로',
    maxCacheSize: '최대 캐시 크기 (bytes)',
    logLevel: '로그 레벨',
  };

  for (const [key, value] of Object.entries(config)) {
    const displayValue = typeof value === 'object'
      ? JSON.stringify(value).slice(0, 25) + '...'
      : String(value);

    table.push([
      key,
      displayValue,
      descriptions[key] || '-',
    ]);
  }

  console.log(chalk.cyan('\n설정 목록:\n'));
  console.log(table.toString());
}

/**
 * 설정 초기화
 */
export async function configReset(): Promise<void> {
  const configManager = getConfigManager();

  try {
    configManager.reset();
    console.log(chalk.green('✓ 설정이 초기화되었습니다'));
  } catch (error) {
    console.error(chalk.red(`설정 초기화 실패: ${(error as Error).message}`));
    process.exit(1);
  }
}
