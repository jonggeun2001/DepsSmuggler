import { describe, expect, it } from 'vitest';
import type { PackageType, Architecture } from '../../stores/cart-store';
import type {
  DefaultArchitecture,
  DockerArchitecture,
  OSDistributionSetting,
  TargetOS,
} from '../../stores/settings-store';
import {
  buildOSCartContext,
  getEffectiveArchitecture,
  getOSDistributionInfo,
} from './os-context';

interface SettingsFixture {
  defaultArchitecture: DefaultArchitecture;
  defaultTargetOS: TargetOS;
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
  dockerArchitecture: DockerArchitecture;
}

const settings: SettingsFixture = {
  defaultArchitecture: 'arm64',
  defaultTargetOS: 'linux',
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.20', architecture: 'aarch64' },
  dockerArchitecture: '386',
};

describe('os-context', () => {
  it('OS 패키지 타입별 distribution 정보를 계산한다', () => {
    expect(getOSDistributionInfo('yum', settings)).toEqual({
      id: 'rocky-9',
      name: 'rocky-9',
      osType: 'linux',
      packageManager: 'yum',
      architecture: 'x86_64',
    });

    expect(getOSDistributionInfo('apt', settings)).toEqual({
      id: 'ubuntu-24.04',
      name: 'ubuntu-24.04',
      osType: 'linux',
      packageManager: 'apt',
      architecture: 'amd64',
    });
  });

  it('effective architecture는 package type별 기본 규칙을 따른다', () => {
    expect(getEffectiveArchitecture('pip', settings, 'i386')).toBe('arm64');
    expect(getEffectiveArchitecture('yum', settings, 'i386')).toBe('x86_64');
    expect(getEffectiveArchitecture('docker', settings, 'i386')).toBe('386');
    expect(getEffectiveArchitecture('maven', settings, 'i386')).toBe('arm64');
  });

  it('OS 패키지 타입은 장바구니용 osContext를 생성한다', () => {
    expect(buildOSCartContext('apk', settings, 'aarch64')).toEqual({
      distributionId: 'alpine-3.20',
      architecture: 'aarch64',
      packageManager: 'apk',
    });

    expect(buildOSCartContext('pip', settings, 'arm64')).toBeNull();
  });
});
