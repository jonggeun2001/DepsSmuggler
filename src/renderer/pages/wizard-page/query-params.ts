import type { PackageType } from '../../stores/cart-store';
import { PACKAGE_TYPE_TO_CATEGORY, isPackageType } from './types';

export interface WizardTypeParamState {
  category: (typeof PACKAGE_TYPE_TO_CATEGORY)[PackageType];
  packageType: PackageType;
  currentStep: 2;
}

export function resolveWizardTypeParam(
  searchParams: URLSearchParams
): WizardTypeParamState | null {
  const typeParam = searchParams.get('type');
  if (!typeParam || !isPackageType(typeParam)) {
    return null;
  }

  return {
    category: PACKAGE_TYPE_TO_CATEGORY[typeParam],
    packageType: typeParam,
    currentStep: 2,
  };
}

export function stripWizardTypeParam(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete('type');
  return next;
}
