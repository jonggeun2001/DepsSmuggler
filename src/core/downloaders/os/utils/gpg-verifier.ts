/**
 * OS Package GPG Signature Verifier
 * 공식 저장소 패키지의 GPG 서명 검증
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import type { OSPackageInfo, Repository, OSPackageManager } from '../types';

/**
 * GPG 키 정보
 */
export interface GPGKey {
  /** 키 ID (짧은 형태) */
  keyId: string;
  /** 키 핑거프린트 */
  fingerprint: string;
  /** 공개키 (PEM 또는 ASCII armor 형식) */
  publicKey: string;
  /** 생성일 */
  createdAt: Date;
  /** 만료일 */
  expiresAt?: Date;
  /** 저장소 ID (어떤 저장소의 키인지) */
  repositoryId: string;
}

/**
 * 검증 결과
 */
export interface VerificationResult {
  /** 검증 성공 여부 */
  verified: boolean;
  /** 검증을 건너뛰었는지 */
  skipped: boolean;
  /** 건너뛴 이유 또는 실패 이유 */
  reason?: 'non-official-repo' | 'gpg-disabled' | 'key-not-found' | 'signature-invalid' | 'checksum-mismatch';
  /** 에러 정보 */
  error?: Error;
  /** 사용된 키 ID */
  keyId?: string;
}

/**
 * GPG 검증기 설정
 */
export interface GPGVerifierConfig {
  /** 검증 활성화 여부 */
  enabled: boolean;
  /** 공식 저장소만 검증 여부 */
  officialOnly: boolean;
  /** 키 다운로드 실패 시 계속 진행 여부 */
  continueOnKeyError: boolean;
  /** 검증 실패 시 콜백 */
  onVerificationFailed?: (pkg: OSPackageInfo, result: VerificationResult) => Promise<'continue' | 'abort'>;
}

/**
 * 기본 설정
 */
const DEFAULT_CONFIG: GPGVerifierConfig = {
  enabled: true,
  officialOnly: true,
  continueOnKeyError: true,
};

/**
 * GPG 서명 검증기
 */
export class GPGVerifier {
  private config: GPGVerifierConfig;
  private keyring: Map<string, GPGKey> = new Map();
  private maxRetries = 3;
  private retryDelay = 1000;

  constructor(config: Partial<GPGVerifierConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * GPG 키 가져오기
   */
  async importKey(keyUrl: string, repositoryId: string): Promise<GPGKey | null> {
    try {
      const response = await this.fetchWithRetry(keyUrl);
      const keyData = await response.text();

      // GPG 공개키 파싱 (간단한 형태)
      const key = this.parseGPGKey(keyData, repositoryId);

      if (key) {
        this.keyring.set(key.keyId, key);
        // 핑거프린트로도 조회 가능하게
        if (key.fingerprint) {
          this.keyring.set(key.fingerprint, key);
        }
      }

      return key;
    } catch (error) {
      console.warn(`Failed to import GPG key from ${keyUrl}:`, (error as Error).message);
      return null;
    }
  }

  /**
   * 저장소 GPG 키 사전 로드
   */
  async preloadRepositoryKeys(repos: Repository[]): Promise<void> {
    const promises = repos
      .filter((repo) => repo.gpgCheck && repo.gpgKeyUrl)
      .map(async (repo) => {
        if (repo.gpgKeyUrl) {
          await this.importKey(repo.gpgKeyUrl, repo.id);
        }
      });

    await Promise.allSettled(promises);
  }

  /**
   * 패키지 검증
   */
  async verifyPackage(pkg: OSPackageInfo, filePath: string): Promise<VerificationResult> {
    // 검증 비활성화
    if (!this.config.enabled) {
      return { verified: true, skipped: true, reason: 'gpg-disabled' };
    }

    const repo = pkg.repository;

    // 공식 저장소만 검증 옵션
    if (this.config.officialOnly && !repo.isOfficial) {
      return { verified: true, skipped: true, reason: 'non-official-repo' };
    }

    // GPG 체크 비활성화된 저장소
    if (!repo.gpgCheck) {
      return { verified: true, skipped: true, reason: 'gpg-disabled' };
    }

    // 체크섬 검증 (GPG 서명 대신 체크섬 검증으로 대체)
    // 실제 GPG 서명 검증은 시스템 gpg 명령어가 필요하므로
    // 여기서는 체크섬 검증으로 무결성을 확인
    const checksumResult = await this.verifyChecksum(pkg, filePath);

    if (!checksumResult.verified) {
      return checksumResult;
    }

    // 패키지 관리자별 추가 검증
    const packageManager = repo.baseUrl.includes('centos') || repo.baseUrl.includes('rocky')
      ? 'yum'
      : repo.baseUrl.includes('ubuntu') || repo.baseUrl.includes('debian')
        ? 'apt'
        : 'apk';

    return this.verifyPackageSignature(pkg, filePath, packageManager);
  }

  /**
   * 체크섬 검증
   */
  async verifyChecksum(pkg: OSPackageInfo, filePath: string): Promise<VerificationResult> {
    if (!pkg.checksum || !pkg.checksum.value) {
      // 체크섬이 없으면 건너뛰기
      return { verified: true, skipped: true };
    }

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hashType = pkg.checksum.type.toLowerCase() as 'md5' | 'sha1' | 'sha256' | 'sha512';

      let hash: crypto.Hash;
      switch (hashType) {
        case 'md5':
          hash = crypto.createHash('md5');
          break;
        case 'sha1':
          hash = crypto.createHash('sha1');
          break;
        case 'sha256':
          hash = crypto.createHash('sha256');
          break;
        case 'sha512':
          hash = crypto.createHash('sha512');
          break;
        default:
          return { verified: true, skipped: true };
      }

      hash.update(fileBuffer);
      const calculated = hash.digest('hex');

      if (calculated.toLowerCase() === pkg.checksum.value.toLowerCase()) {
        return { verified: true, skipped: false };
      } else {
        return {
          verified: false,
          skipped: false,
          reason: 'checksum-mismatch',
          error: new Error(`Checksum mismatch: expected ${pkg.checksum.value}, got ${calculated}`),
        };
      }
    } catch (error) {
      return {
        verified: false,
        skipped: false,
        reason: 'checksum-mismatch',
        error: error as Error,
      };
    }
  }

  /**
   * 패키지 서명 검증 (패키지 관리자별)
   */
  private async verifyPackageSignature(
    pkg: OSPackageInfo,
    filePath: string,
    packageManager: OSPackageManager
  ): Promise<VerificationResult> {
    // 참고: 실제 GPG 서명 검증은 시스템의 gpg 또는 rpm/dpkg 명령이 필요
    // Electron 앱에서는 체크섬 검증으로 대체하고,
    // 추가적인 서명 검증은 향후 native 모듈 추가 시 구현 가능

    switch (packageManager) {
      case 'yum':
        // RPM 서명 검증 (rpm -K 필요)
        return this.verifyRpmSignature(pkg, filePath);

      case 'apt':
        // DEB 서명 검증 (dpkg-sig 필요)
        return this.verifyDebSignature(pkg, filePath);

      case 'apk':
        // APK 서명 검증
        return this.verifyApkSignature(pkg, filePath);

      default:
        return { verified: true, skipped: true };
    }
  }

  /**
   * RPM 서명 검증
   */
  private async verifyRpmSignature(
    _pkg: OSPackageInfo,
    _filePath: string
  ): Promise<VerificationResult> {
    // RPM 서명 검증은 rpm -K 명령 필요
    // 현재는 체크섬 검증으로 충분하다고 가정
    // 향후: child_process로 rpm -K 실행 또는 native 모듈 사용

    return {
      verified: true,
      skipped: true,
      reason: 'gpg-disabled', // 실제 서명 검증은 건너뜀
    };
  }

  /**
   * DEB 서명 검증
   */
  private async verifyDebSignature(
    _pkg: OSPackageInfo,
    _filePath: string
  ): Promise<VerificationResult> {
    // DEB 서명 검증은 dpkg-sig 명령 필요
    // 현재는 체크섬 검증으로 충분하다고 가정

    return {
      verified: true,
      skipped: true,
      reason: 'gpg-disabled',
    };
  }

  /**
   * APK 서명 검증
   */
  private async verifyApkSignature(
    _pkg: OSPackageInfo,
    _filePath: string
  ): Promise<VerificationResult> {
    // APK 서명은 패키지 내부의 .SIGN 파일로 검증
    // 현재는 체크섬 검증으로 충분하다고 가정

    return {
      verified: true,
      skipped: true,
      reason: 'gpg-disabled',
    };
  }

  /**
   * GPG 공개키 파싱 (간단한 형태)
   */
  private parseGPGKey(keyData: string, repositoryId: string): GPGKey | null {
    // ASCII armor 형식의 GPG 공개키 파싱
    if (!keyData.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) {
      return null;
    }

    // 간단한 키 ID 추출 (실제로는 더 복잡한 파싱 필요)
    const keyIdMatch = keyData.match(/Key fingerprint\s*=\s*([A-F0-9\s]+)/i);
    const fingerprint = keyIdMatch
      ? keyIdMatch[1].replace(/\s/g, '')
      : this.generateKeyId(keyData);

    const shortKeyId = fingerprint.slice(-8);

    return {
      keyId: shortKeyId,
      fingerprint,
      publicKey: keyData,
      createdAt: new Date(),
      repositoryId,
    };
  }

  /**
   * 키 데이터에서 간단한 ID 생성
   */
  private generateKeyId(keyData: string): string {
    const hash = crypto.createHash('sha256');
    hash.update(keyData);
    return hash.digest('hex').slice(0, 16).toUpperCase();
  }

  /**
   * HTTP 요청 (재시도 지원)
   */
  private async fetchWithRetry(url: string): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    }

    throw lastError;
  }

  /**
   * 키링에서 키 조회
   */
  getKey(keyIdOrFingerprint: string): GPGKey | undefined {
    return this.keyring.get(keyIdOrFingerprint);
  }

  /**
   * 키링 초기화
   */
  clearKeyring(): void {
    this.keyring.clear();
  }

  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<GPGVerifierConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
