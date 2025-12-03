import chalk from 'chalk';
import Table from 'cli-table3';
import { PackageType } from '../../types';
import { getPipDownloader } from '../../core/downloaders/pip';
import { getCondaDownloader } from '../../core/downloaders/conda';
import { getMavenDownloader } from '../../core/downloaders/maven';
import { getYumDownloader } from '../../core/downloaders/yum';
import { getDockerDownloader } from '../../core/downloaders/docker';

// 검색 옵션
interface SearchOptions {
  type: PackageType;
  limit: string;
}

/**
 * search 명령어 핸들러
 */
export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  console.log(chalk.cyan(`'${query}' 검색 중...`));

  try {
    let results: Array<{ name: string; version: string; description?: string }> = [];

    // 타입별 다운로더 호출
    switch (options.type) {
      case 'pip':
        const pipDownloader = getPipDownloader();
        const pipResults = await pipDownloader.searchPackages(query);
        results = pipResults.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description as string,
        }));
        break;

      case 'conda':
        const condaDownloader = getCondaDownloader();
        const condaResults = await condaDownloader.searchPackages(query);
        results = condaResults.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description as string,
        }));
        break;

      case 'maven':
        const mavenDownloader = getMavenDownloader();
        const mavenResults = await mavenDownloader.searchPackages(query);
        results = mavenResults.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description as string,
        }));
        break;

      case 'yum':
        const yumDownloader = getYumDownloader();
        const yumResults = await yumDownloader.searchPackages(query);
        results = yumResults.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description as string,
        }));
        break;

      case 'docker':
        const dockerDownloader = getDockerDownloader();
        const dockerResults = await dockerDownloader.searchPackages(query);
        results = dockerResults.map((pkg) => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description as string,
        }));
        break;

      default:
        console.log(chalk.red(`지원하지 않는 패키지 타입: ${options.type}`));
        process.exit(1);
    }

    // 결과 제한
    const limit = parseInt(options.limit, 10);
    if (results.length > limit) {
      results = results.slice(0, limit);
    }

    console.log(chalk.green(`✓ ${results.length}개 결과 찾음`));

    if (results.length === 0) {
      console.log(chalk.yellow('\n검색 결과가 없습니다'));
      return;
    }

    // 테이블 출력
    const table = new Table({
      head: [chalk.cyan('패키지명'), chalk.cyan('버전'), chalk.cyan('설명')],
      colWidths: [30, 15, 50],
      wordWrap: true,
    });

    for (const result of results) {
      table.push([
        result.name,
        result.version,
        (result.description || '-').slice(0, 100),
      ]);
    }

    console.log(chalk.cyan(`\n[${options.type.toUpperCase()}] 검색 결과:\n`));
    console.log(table.toString());

    console.log(chalk.gray(`\n다운로드 예시:`));
    if (results[0]) {
      console.log(
        chalk.gray(
          `  depssmuggler download -t ${options.type} -p ${results[0].name} -V ${results[0].version}`
        )
      );
    }
  } catch (error) {
    console.log(chalk.red('✗ 검색 실패'));
    console.error(chalk.red(`오류: ${(error as Error).message}`));
    process.exit(1);
  }
}
