import * as tls from 'node:tls';
import { describeRootCaCertificates, readRootCaCertificates } from './root-ca-store';
import type { RootCaStatus } from '../types/root-ca';

// Capture the applied set separately from the saved set: registration takes effect on restart.
let appliedFingerprints: string[] = [];

export function supportsRuntimeRootCa(): boolean {
  return typeof tls.setDefaultCACertificates === 'function';
}

export function initializeRootCaTrust(): void {
  const certificates = readRootCaCertificates();
  if (certificates.length > 0) {
    if (!supportsRuntimeRootCa()) {
      throw new Error('이 런타임은 CA 초기화 후 다시 시작해야 합니다.');
    }
    // Preserve bundled, system and NODE_EXTRA_CA_CERTS certificates already selected by Node.
    tls.setDefaultCACertificates([
      ...tls.getCACertificates('default'),
      ...certificates.map((certificate) => certificate.toString()),
    ]);
  }
  appliedFingerprints = certificates.map((certificate) => certificate.fingerprint256).sort();
}

export function getRootCaStatus(): RootCaStatus {
  const certificates = readRootCaCertificates();
  const savedFingerprints = certificates.map((certificate) => certificate.fingerprint256).sort();
  return {
    certificates: describeRootCaCertificates(certificates),
    restartRequired: JSON.stringify(savedFingerprints) !== JSON.stringify(appliedFingerprints),
  };
}
