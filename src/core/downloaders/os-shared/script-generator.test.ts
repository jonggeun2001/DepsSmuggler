import { describe, expect, it } from 'vitest';
import { OSScriptGenerator } from './script-generator';
import type { OSPackageInfo } from './types';

describe('OSScriptGenerator', () => {
  it('YUM 설치 스크립트는 release가 포함된 RPM 파일명을 사용한다', () => {
    const generator = new OSScriptGenerator();
    const packages: OSPackageInfo[] = [
      {
        name: 'httpd',
        version: '2.4.57',
        release: '3.el9',
        architecture: 'x86_64',
        size: 1024,
        checksum: {
          type: 'sha256',
          value: 'checksum-httpd',
        },
        location: 'Packages/httpd-2.4.57-3.el9.x86_64.rpm',
        repository: {
          id: 'baseos',
          name: 'BaseOS',
          baseUrl: 'https://example.test/baseos',
          enabled: true,
          gpgCheck: false,
          isOfficial: true,
        },
        dependencies: [],
      },
    ];

    const scripts = generator.generateDependencyOrderScript(packages, 'yum', {
      packageDir: './Packages',
    });

    expect(scripts.bash).toContain('httpd-2.4.57-3.el9.x86_64.rpm');
  });
});
