export interface RootCaCertificateInfo {
  fingerprint: string;
  subject: string;
  issuer: string;
  validTo: string;
}

export interface RootCaStatus {
  certificates: RootCaCertificateInfo[];
  restartRequired: boolean;
}

export type RootCaResult =
  | { success: true; status: RootCaStatus; canceled?: boolean }
  | { success: false; error: string };
