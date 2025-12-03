#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';

// 버전 정보
const VERSION = '1.0.0';

// 메인 프로그램
const program = new Command();

program
  .name('depssmuggler')
  .description(chalk.cyan('DepsSmuggler - 폐쇄망을 위한 패키지 의존성 다운로더'))
  .version(VERSION, '-v, --version', '버전 정보 표시')
  .helpOption('-h, --help', '도움말 표시');

// download 명령어
program
  .command('download')
  .description('패키지 다운로드')
  .option('-t, --type <type>', '패키지 타입 (pip, conda, maven, yum, docker)', 'pip')
  .option('-p, --package <name>', '패키지명')
  .option('-V, --pkg-version <version>', '패키지 버전', 'latest')
  .option('-a, --arch <arch>', '아키텍처 (x86_64, arm64 등)', 'x86_64')
  .option('-o, --output <path>', '출력 경로', './output')
  .option('-f, --format <format>', '출력 형식 (zip, tar.gz, mirror)', 'zip')
  .option('--file <file>', '패키지 목록 파일 (requirements.txt, pom.xml 등)')
  .option('--no-deps', '의존성 포함하지 않음')
  .option('--concurrency <num>', '동시 다운로드 수', '3')
  .action(async (options) => {
    const { downloadCommand } = await import('./commands/download');
    await downloadCommand(options);
  });

// config 명령어
program
  .command('config')
  .description('설정 관리')
  .addCommand(
    new Command('get')
      .description('설정값 조회')
      .argument('[key]', '설정 키')
      .action(async (key) => {
        const { configGet } = await import('./commands/config');
        await configGet(key);
      })
  )
  .addCommand(
    new Command('set')
      .description('설정값 변경')
      .argument('<key>', '설정 키')
      .argument('<value>', '설정값')
      .action(async (key, value) => {
        const { configSet } = await import('./commands/config');
        await configSet(key, value);
      })
  )
  .addCommand(
    new Command('list')
      .description('모든 설정 표시')
      .action(async () => {
        const { configList } = await import('./commands/config');
        await configList();
      })
  )
  .addCommand(
    new Command('reset')
      .description('설정 초기화')
      .action(async () => {
        const { configReset } = await import('./commands/config');
        await configReset();
      })
  );

// cache 명령어
program
  .command('cache')
  .description('캐시 관리')
  .addCommand(
    new Command('size')
      .description('캐시 크기 확인')
      .action(async () => {
        const { cacheSize } = await import('./commands/cache');
        await cacheSize();
      })
  )
  .addCommand(
    new Command('clear')
      .description('캐시 삭제')
      .option('-f, --force', '확인 없이 삭제')
      .action(async (options) => {
        const { cacheClear } = await import('./commands/cache');
        await cacheClear(options);
      })
  )
  .addCommand(
    new Command('list')
      .description('캐시된 패키지 목록')
      .action(async () => {
        const { cacheList } = await import('./commands/cache');
        await cacheList();
      })
  );

// search 명령어
program
  .command('search')
  .description('패키지 검색')
  .argument('<query>', '검색어')
  .option('-t, --type <type>', '패키지 타입', 'pip')
  .option('-l, --limit <num>', '결과 수 제한', '20')
  .action(async (query, options) => {
    const { searchCommand } = await import('./commands/search');
    await searchCommand(query, options);
  });

// 에러 핸들링
program.exitOverride((err) => {
  if (err.code === 'commander.help') {
    process.exit(0);
  }
  console.error(chalk.red(`오류: ${err.message}`));
  process.exit(1);
});

// 파싱 및 실행
program.parse(process.argv);

// 명령어가 없으면 도움말 표시
if (process.argv.length <= 2) {
  console.log(chalk.cyan('\n  DepsSmuggler - 폐쇄망을 위한 패키지 의존성 다운로더\n'));
  console.log('  사용법: depssmuggler <명령어> [옵션]\n');
  console.log('  명령어:');
  console.log('    download    패키지 다운로드');
  console.log('    search      패키지 검색');
  console.log('    config      설정 관리');
  console.log('    cache       캐시 관리');
  console.log('\n  예시:');
  console.log(chalk.gray('    depssmuggler download -t pip -p requests -V 2.28.0'));
  console.log(chalk.gray('    depssmuggler download -t maven -p org.springframework:spring-core -V 5.3.0'));
  console.log(chalk.gray('    depssmuggler download -t docker -p nginx -V latest'));
  console.log(chalk.gray('    depssmuggler search requests -t pip'));
  console.log('\n  자세한 내용: depssmuggler --help\n');
}
