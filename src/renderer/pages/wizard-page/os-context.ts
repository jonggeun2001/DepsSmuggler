import type { Architecture, PackageType } from '../../stores/cart-store';
import type {
  DefaultArchitecture,
  DockerArchitecture,
  OSDistributionSetting,
} from '../../stores/settings-store';
import {
  LIBRARY_PACKAGE_TYPES,
  type OSCartContextSnapshot,
} from './types';

type OSPackageType = OSCartContextSnapshot['packageManager'];

export interface WizardOSContextSettings {
  defaultArchitecture: DefaultArchitecture;
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
  dockerArchitecture: DockerArchitecture;
}

export interface WizardOSDistributionSettings {
  yumDistribution: OSDistributionSetting;
  aptDistribution: OSDistributionSetting;
  apkDistribution: OSDistributionSetting;
}

export interface WizardOSDistributionInfo {
  id: string;
  name: string;
  osType: 'linux';
  packageManager: OSPackageType;
  architecture: string;
}

function getDistributionSetting(
  packageType: PackageType,
  settings: WizardOSDistributionSettings
): { packageManager: OSPackageType; distribution: OSDistributionSetting } | null {
  switch (packageType) {
    case 'yum':
      return { packageManager: 'yum', distribution: settings.yumDistribution };
    case 'apt':
      return { packageManager: 'apt', distribution: settings.aptDistribution };
    case 'apk':
      return { packageManager: 'apk', distribution: settings.apkDistribution };
    default:
      return null;
  }
}

export function getOSDistributionInfo(
  packageType: PackageType,
  settings: WizardOSDistributionSettings
): WizardOSDistributionInfo | null {
  const match = getDistributionSetting(packageType, settings);
  if (!match) {
    return null;
  }

  return {
    id: match.distribution.id,
    name: match.distribution.id,
    osType: 'linux',
    packageManager: match.packageManager,
    architecture: match.distribution.architecture,
  };
}

export function getEffectiveArchitecture(
  packageType: PackageType,
  settings: WizardOSContextSettings,
  manualArchitecture: Architecture
): Architecture {
  if (LIBRARY_PACKAGE_TYPES.includes(packageType)) {
    return settings.defaultArchitecture as Architecture;
  }

  const osDistribution = getOSDistributionInfo(packageType, settings);
  if (osDistribution) {
    return osDistribution.architecture as Architecture;
  }

  if (packageType === 'docker') {
    return settings.dockerArchitecture as Architecture;
  }

  return manualArchitecture;
}

export function buildOSCartContext(
  packageType: PackageType,
  settings: WizardOSContextSettings,
  architecture: Architecture
): OSCartContextSnapshot | null {
  const distribution = getOSDistributionInfo(packageType, settings);
  if (!distribution) {
    return null;
  }

  return {
    distributionId: distribution.id,
    architecture,
    packageManager: distribution.packageManager,
  };
}

export function getOSCartContextSnapshot(
  metadata: Record<string, unknown> | undefined
): OSCartContextSnapshot | null {
  const raw = metadata?.osContext;
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const { distributionId, architecture, packageManager } = raw as Partial<OSCartContextSnapshot>;
  if (
    typeof distributionId !== 'string' ||
    typeof architecture !== 'string' ||
    (packageManager !== 'yum' && packageManager !== 'apt' && packageManager !== 'apk')
  ) {
    return null;
  }

  return {
    distributionId,
    architecture: architecture as Architecture,
    packageManager,
  };
}
