import { Command } from 'commander';
import {
  clearRootCaCertificates,
  describeRootCaCertificates,
  readRootCaCertificates,
  registerRootCaFile,
} from '../../core/root-ca-store';

export function createCaCommand(): Command {
  return new Command('ca')
    .description('추가 루트 CA 인증서 등록 (CLI와 데스크톱 앱 공용)')
    .addCommand(
      new Command('set')
        .description('PEM/DER 인증서 파일 등록 또는 기존 등록 교체')
        .argument('<file>', 'CA 인증서 파일 (.pem, .crt, .cer)')
        .action(async (file: string) => {
          await registerRootCaFile(file);
          console.log(
            'CA 인증서가 등록되었습니다. 다음 CLI 실행부터 적용됩니다. 실행 중인 앱은 재시작하세요.'
          );
        })
    )
    .addCommand(
      new Command('get').description('등록된 CA 인증서의 발급자, 지문, 만료일 조회').action(() => {
        console.log(JSON.stringify(describeRootCaCertificates(readRootCaCertificates()), null, 2));
      })
    )
    .addCommand(
      new Command('clear')
        .description('추가 CA 등록 해제 (기본 신뢰 인증서는 유지)')
        .action(async () => {
          await clearRootCaCertificates();
          console.log('추가 CA 등록이 해제되었습니다. 실행 중인 앱은 재시작하세요.');
        })
    );
}
