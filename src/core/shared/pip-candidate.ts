/**
 * CandidateEvaluator - 설치 후보 평가 및 정렬
 * pip의 index/package_finder.py의 CandidateEvaluator를 TypeScript로 포팅
 *
 * 참고:
 * - https://github.com/pypa/pip/blob/main/src/pip/_internal/index/package_finder.py
 * - https://pip.pypa.io/en/stable/development/architecture/package-finding/
 */

import { compareVersions } from './version-utils';
import {
  PlatformTag,
  getFullSupportedTags,
  tagsToIndexMap,
  PlatformType,
  ArchType,
} from './pip-tags';
import {
  WheelInfo,
  parseWheelFilename,
  getWheelTagPriority,
  isWheelFile,
  isSourceDist,
  BuildTag,
} from './pip-wheel';

/**
 * 설치 후보 (InstallationCandidate)
 */
export interface InstallationCandidate {
  /** 패키지 이름 (정규화됨) */
  name: string;
  /** 버전 */
  version: string;
  /** 다운로드 URL */
  url: string;
  /** 파일명 */
  filename: string;
  /** 파일 크기 */
  size?: number;
  /** 해시 (sha256) */
  hash?: string;
  /** 패키지 타입 */
  packageType: 'wheel' | 'sdist';
  /** Wheel 정보 (wheel인 경우) */
  wheelInfo?: WheelInfo;
  /** Yanked 여부 */
  isYanked?: boolean;
  /** Yanked 이유 */
  yankedReason?: string;
  /** Requires-Python */
  requiresPython?: string;
}

/**
 * 후보 정렬 키 (pip의 CandidateSortingKey와 동일)
 * 튜플 순서대로 비교됨
 */
export interface CandidateSortingKey {
  /** 허용된 해시와 일치하는지 (true가 우선) */
  hasAllowedHash: boolean;
  /** Yanked되지 않았는지 (true가 우선) */
  isNotYanked: boolean;
  /** Binary(wheel) 인지 (true가 우선, 설정에 따라 다름) */
  isBinary: boolean;
  /** 버전 (높을수록 우선) */
  version: string;
  /** 태그 우선순위 (낮을수록 우선, undefined면 가장 낮은 우선순위) */
  tagPriority?: number;
  /** 빌드 태그 */
  buildTag: BuildTag;
}

/**
 * 후보 평가 설정
 */
export interface CandidateEvaluatorConfig {
  /** 타겟 Python 버전 */
  pythonVersion: string;
  /** 타겟 플랫폼 */
  platform: PlatformType;
  /** 타겟 아키텍처 */
  arch: ArchType;
  /** Python 구현체 (기본: cp) */
  implementation?: string;
  /** Binary(wheel) 선호 여부 (기본: true) */
  preferBinary?: boolean;
  /** 허용된 해시 목록 */
  allowedHashes?: Set<string>;
  /** Yanked 버전 허용 여부 (기본: false) */
  allowYanked?: boolean;
  /** Pre-release 허용 여부 (기본: false) */
  allowPrerelease?: boolean;
}

/**
 * 최적 후보 결과
 */
export interface BestCandidateResult {
  /** 모든 후보 */
  allCandidates: InstallationCandidate[];
  /** 적용 가능한 후보 (필터링됨) */
  applicableCandidates: InstallationCandidate[];
  /** 최적 후보 */
  bestCandidate: InstallationCandidate | null;
}

/**
 * CandidateEvaluator 클래스
 * pip의 CandidateEvaluator와 동일한 로직 구현
 */
export class CandidateEvaluator {
  private readonly supportedTags: PlatformTag[];
  private readonly tagToPriority: Map<string, number>;
  private readonly config: Required<CandidateEvaluatorConfig>;

  constructor(config: CandidateEvaluatorConfig) {
    this.config = {
      pythonVersion: config.pythonVersion,
      platform: config.platform,
      arch: config.arch,
      implementation: config.implementation || 'cp',
      preferBinary: config.preferBinary ?? true,
      allowedHashes: config.allowedHashes || new Set(),
      allowYanked: config.allowYanked ?? false,
      allowPrerelease: config.allowPrerelease ?? false,
    };

    // 지원 태그 생성
    this.supportedTags = getFullSupportedTags(
      this.config.pythonVersion,
      this.config.platform,
      this.config.arch,
      this.config.implementation
    );

    // 태그 -> 우선순위 맵 생성
    this.tagToPriority = tagsToIndexMap(this.supportedTags);
  }

  /**
   * 후보가 적용 가능한지 확인
   */
  isApplicable(candidate: InstallationCandidate): boolean {
    // Yanked 체크
    if (candidate.isYanked && !this.config.allowYanked) {
      return false;
    }

    // Pre-release 체크
    if (!this.config.allowPrerelease && this.isPrerelease(candidate.version)) {
      return false;
    }

    // Wheel인 경우 태그 호환성 체크
    if (candidate.packageType === 'wheel' && candidate.wheelInfo) {
      const priority = getWheelTagPriority(candidate.wheelInfo, this.tagToPriority);
      if (priority === -1) {
        return false;
      }
    }

    // Requires-Python 체크
    if (candidate.requiresPython) {
      if (!this.checkRequiresPython(candidate.requiresPython)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Pre-release 버전인지 확인
   */
  private isPrerelease(version: string): boolean {
    return /[a-zA-Z]/.test(version) &&
           (version.includes('a') || version.includes('b') ||
            version.includes('rc') || version.includes('dev') ||
            version.includes('alpha') || version.includes('beta'));
  }

  /**
   * Requires-Python 조건 확인
   */
  private checkRequiresPython(requiresPython: string): boolean {
    const [targetMajor, targetMinor] = this.config.pythonVersion.split('.').map(Number);
    const targetVersion = targetMajor * 100 + targetMinor;

    // 간단한 버전 비교 (>=, <=, ==, !=, >, <)
    const specs = requiresPython.split(',').map(s => s.trim());

    for (const spec of specs) {
      const match = spec.match(/^([<>=!]+)?\s*(\d+)\.?(\d+)?\.?(\d+)?$/);
      if (!match) continue;

      const [, op = '>=', major, minor = '0'] = match;
      const specVersion = parseInt(major) * 100 + parseInt(minor);

      switch (op) {
        case '>=':
          if (targetVersion < specVersion) return false;
          break;
        case '>':
          if (targetVersion <= specVersion) return false;
          break;
        case '<=':
          if (targetVersion > specVersion) return false;
          break;
        case '<':
          if (targetVersion >= specVersion) return false;
          break;
        case '==':
          if (targetVersion !== specVersion) return false;
          break;
        case '!=':
          if (targetVersion === specVersion) return false;
          break;
      }
    }

    return true;
  }

  /**
   * 후보의 정렬 키 생성
   */
  getSortingKey(candidate: InstallationCandidate): CandidateSortingKey {
    // 해시 일치 여부
    const hasAllowedHash =
      this.config.allowedHashes.size === 0 ||
      (candidate.hash !== undefined && this.config.allowedHashes.has(candidate.hash));

    // Yanked 여부
    const isNotYanked = !candidate.isYanked;

    // Binary 여부
    const isBinary = candidate.packageType === 'wheel';

    // 태그 우선순위
    let tagPriority: number | undefined;
    if (candidate.wheelInfo) {
      const priority = getWheelTagPriority(candidate.wheelInfo, this.tagToPriority);
      tagPriority = priority === -1 ? undefined : priority;
    }

    // 빌드 태그
    const buildTag: BuildTag = candidate.wheelInfo?.buildTag || [];

    return {
      hasAllowedHash,
      isNotYanked,
      isBinary,
      version: candidate.version,
      tagPriority,
      buildTag,
    };
  }

  /**
   * 두 정렬 키 비교
   * 음수: a가 더 우선, 양수: b가 더 우선, 0: 동일
   */
  compareSortingKeys(a: CandidateSortingKey, b: CandidateSortingKey): number {
    // 1. 해시 일치 (true가 우선)
    if (a.hasAllowedHash !== b.hasAllowedHash) {
      return a.hasAllowedHash ? -1 : 1;
    }

    // 2. Yanked 여부 (not yanked가 우선)
    if (a.isNotYanked !== b.isNotYanked) {
      return a.isNotYanked ? -1 : 1;
    }

    // 3. Binary 선호 (설정에 따라)
    if (this.config.preferBinary && a.isBinary !== b.isBinary) {
      return a.isBinary ? -1 : 1;
    }

    // 4. 버전 (높을수록 우선)
    const versionCompare = compareVersions(b.version, a.version);
    if (versionCompare !== 0) {
      return versionCompare;
    }

    // 5. 태그 우선순위 (낮을수록 우선)
    if (a.tagPriority !== undefined && b.tagPriority !== undefined) {
      if (a.tagPriority !== b.tagPriority) {
        return a.tagPriority - b.tagPriority;
      }
    } else if (a.tagPriority !== undefined) {
      return -1;
    } else if (b.tagPriority !== undefined) {
      return 1;
    }

    // 6. 빌드 태그 (높을수록 우선)
    if (a.buildTag.length > 0 && b.buildTag.length > 0) {
      const aBuildNum = a.buildTag[0] as number;
      const bBuildNum = b.buildTag[0] as number;
      if (aBuildNum !== bBuildNum) {
        return bBuildNum - aBuildNum;
      }
    }

    return 0;
  }

  /**
   * 적용 가능한 후보 필터링 및 정렬
   */
  getApplicableCandidates(candidates: InstallationCandidate[]): InstallationCandidate[] {
    // 필터링
    const applicable = candidates.filter((c) => this.isApplicable(c));

    // 정렬
    return applicable.sort((a, b) => {
      const keyA = this.getSortingKey(a);
      const keyB = this.getSortingKey(b);
      return this.compareSortingKeys(keyA, keyB);
    });
  }

  /**
   * 최적 후보 선택
   */
  sortBestCandidate(candidates: InstallationCandidate[]): InstallationCandidate | null {
    const applicable = this.getApplicableCandidates(candidates);
    return applicable.length > 0 ? applicable[0] : null;
  }

  /**
   * 전체 평가 수행
   */
  computeBestCandidate(candidates: InstallationCandidate[]): BestCandidateResult {
    const applicableCandidates = this.getApplicableCandidates(candidates);
    const bestCandidate = applicableCandidates.length > 0 ? applicableCandidates[0] : null;

    return {
      allCandidates: candidates,
      applicableCandidates,
      bestCandidate,
    };
  }
}

/**
 * PyPI 릴리스 정보에서 InstallationCandidate 생성
 */
export interface PyPIReleaseInfo {
  filename: string;
  url: string;
  size: number;
  digests: { sha256: string; md5?: string };
  packagetype: string;
  python_version: string;
  requires_python?: string | null;
  yanked?: boolean;
  yanked_reason?: string;
}

export function createCandidateFromRelease(
  name: string,
  version: string,
  release: PyPIReleaseInfo
): InstallationCandidate {
  const isWheel = isWheelFile(release.filename);
  const wheelInfo = isWheel ? parseWheelFilename(release.filename) : undefined;

  return {
    name: name.toLowerCase().replace(/-/g, '_'),
    version,
    url: release.url,
    filename: release.filename,
    size: release.size,
    hash: release.digests.sha256,
    packageType: isWheel ? 'wheel' : 'sdist',
    wheelInfo: wheelInfo || undefined,
    isYanked: release.yanked,
    yankedReason: release.yanked_reason,
    requiresPython: release.requires_python || undefined,
  };
}

/**
 * 버전별 릴리스에서 최적 후보 선택
 */
export function selectBestCandidateFromReleases(
  name: string,
  version: string,
  releases: PyPIReleaseInfo[],
  config: CandidateEvaluatorConfig
): InstallationCandidate | null {
  const candidates = releases.map((r) => createCandidateFromRelease(name, version, r));
  const evaluator = new CandidateEvaluator(config);
  return evaluator.sortBestCandidate(candidates);
}

/**
 * 모든 버전에서 최적 후보 선택
 */
export function selectBestCandidateFromAllVersions(
  name: string,
  releasesByVersion: Record<string, PyPIReleaseInfo[]>,
  config: CandidateEvaluatorConfig,
  versionSpec?: string
): InstallationCandidate | null {
  const allCandidates: InstallationCandidate[] = [];

  for (const [version, releases] of Object.entries(releasesByVersion)) {
    // 빈 릴리스 스킵
    if (releases.length === 0) continue;

    // 버전 스펙 필터링 (있는 경우)
    // TODO: 버전 스펙 파싱 및 필터링 구현

    for (const release of releases) {
      allCandidates.push(createCandidateFromRelease(name, version, release));
    }
  }

  const evaluator = new CandidateEvaluator(config);
  return evaluator.sortBestCandidate(allCandidates);
}
