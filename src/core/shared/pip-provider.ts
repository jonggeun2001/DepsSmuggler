/**
 * PipProvider - resolvelib 스타일 의존성 해결 Provider
 * pip의 resolution/resolvelib/provider.py를 TypeScript로 포팅
 *
 * 참고:
 * - https://github.com/pypa/pip/blob/main/src/pip/_internal/resolution/resolvelib/provider.py
 * - https://github.com/sarugaku/resolvelib
 */

import {
  CandidateEvaluator,
  CandidateEvaluatorConfig,
  InstallationCandidate,
  PyPIReleaseInfo,
  createCandidateFromRelease,
} from './pip-candidate';
import { PlatformType, ArchType } from './pip-tags';
import { compareVersions, isVersionCompatible } from './version-utils';

/**
 * 요구사항 (Requirement)
 */
export interface Requirement {
  /** 패키지 이름 (정규화됨) */
  name: string;
  /** 버전 스펙 (예: ">=1.0,<2.0") */
  versionSpec?: string;
  /** extras (예: ["dev", "test"]) */
  extras?: string[];
  /** 환경 마커 (예: "python_version >= '3.8'") */
  marker?: string;
  /** Direct URL (직접 참조) */
  url?: string;
  /** 사용자가 명시적으로 요청했는지 */
  isUserRequested?: boolean;
}

/**
 * 후보 (Candidate) - 해결된 패키지
 */
export interface Candidate {
  /** 패키지 이름 */
  name: string;
  /** 버전 */
  version: string;
  /** 의존성 목록 */
  dependencies: Requirement[];
  /** 설치 후보 정보 */
  installationCandidate: InstallationCandidate;
  /** extras */
  extras?: string[];
}

/**
 * 제약조건 (Constraint)
 */
export interface Constraint {
  /** 버전 스펙 */
  versionSpec?: string;
  /** 허용된 해시 */
  hashes?: Set<string>;
}

/**
 * Provider 설정
 */
export interface ProviderConfig {
  /** 타겟 Python 버전 */
  pythonVersion: string;
  /** 타겟 플랫폼 */
  platform: PlatformType;
  /** 타겟 아키텍처 */
  arch: ArchType;
  /** Python 구현체 */
  implementation?: string;
  /** 의존성 무시 여부 */
  ignoreDependencies?: boolean;
  /** 업그레이드 전략 */
  upgradeStrategy?: 'eager' | 'only-if-needed' | 'to-satisfy-only';
  /** 사용자 요청 패키지 목록 */
  userRequested?: Map<string, number>;
  /** 제약조건 */
  constraints?: Map<string, Constraint>;
  /** Pre-release 허용 */
  allowPrerelease?: boolean;
}

/**
 * 요구사항 정보 (resolvelib의 RequirementInformation)
 */
export interface RequirementInformation {
  requirement: Requirement;
  parent: Candidate | null;
}

/**
 * 우선순위 (Preference) 튜플
 * pip의 get_preference() 반환값과 동일
 */
export type Preference = [
  boolean, // not direct
  boolean, // not pinned
  boolean, // not upper_bounded
  number,  // requested_order
  boolean, // not unfree
  string,  // identifier (알파벳 순)
];

/**
 * PyPI 패키지 정보 조회 함수 타입
 */
export type PackageInfoFetcher = (name: string) => Promise<{
  info: { name: string; version: string; requires_dist?: string[] };
  releases: Record<string, PyPIReleaseInfo[]>;
}>;

/**
 * PipProvider 클래스
 * resolvelib의 AbstractProvider 인터페이스 구현
 */
export class PipProvider {
  private readonly config: Required<ProviderConfig>;
  private readonly candidateEvaluator: CandidateEvaluator;
  private readonly fetchPackageInfo: PackageInfoFetcher;

  // 캐시
  private readonly candidateCache: Map<string, Candidate[]> = new Map();
  private readonly dependencyCache: Map<string, Requirement[]> = new Map();

  constructor(
    config: ProviderConfig,
    fetchPackageInfo: PackageInfoFetcher
  ) {
    this.config = {
      pythonVersion: config.pythonVersion,
      platform: config.platform,
      arch: config.arch,
      implementation: config.implementation || 'cp',
      ignoreDependencies: config.ignoreDependencies ?? false,
      upgradeStrategy: config.upgradeStrategy || 'only-if-needed',
      userRequested: config.userRequested || new Map(),
      constraints: config.constraints || new Map(),
      allowPrerelease: config.allowPrerelease ?? false,
    };

    this.candidateEvaluator = new CandidateEvaluator({
      pythonVersion: this.config.pythonVersion,
      platform: this.config.platform,
      arch: this.config.arch,
      implementation: this.config.implementation,
      allowPrerelease: this.config.allowPrerelease,
    });

    this.fetchPackageInfo = fetchPackageInfo;
  }

  /**
   * 요구사항/후보의 식별자 반환
   */
  identify(requirementOrCandidate: Requirement | Candidate): string {
    return requirementOrCandidate.name.toLowerCase().replace(/-/g, '_');
  }

  /**
   * 백트래킹 시 우선 처리할 식별자 선택
   * pip의 narrow_requirement_selection() 구현
   */
  narrowRequirementSelection(
    identifiers: string[],
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Candidate[]>,
    information: Map<string, RequirementInformation[]>,
    backtrackCauses: RequirementInformation[]
  ): string[] {
    // Requires-Python 우선 처리
    const requiresPythonId = '_python_requires';
    if (identifiers.includes(requiresPythonId)) {
      return [requiresPythonId];
    }

    // 백트래킹 원인 식별자 수집
    const backtrackIdentifiers = new Set<string>();
    for (const info of backtrackCauses) {
      backtrackIdentifiers.add(info.requirement.name);
      if (info.parent) {
        backtrackIdentifiers.add(info.parent.name);
      }
    }

    // 백트래킹 원인에 해당하는 식별자 우선 반환
    const currentBacktrackCauses = identifiers.filter(
      (id) => backtrackIdentifiers.has(id)
    );

    if (currentBacktrackCauses.length > 0) {
      return currentBacktrackCauses;
    }

    return identifiers;
  }

  /**
   * 요구사항 우선순위 계산
   * pip의 get_preference() 구현
   */
  getPreference(
    identifier: string,
    resolutions: Map<string, Candidate>,
    candidates: Map<string, Candidate[]>,
    information: Map<string, RequirementInformation[]>,
    backtrackCauses: RequirementInformation[]
  ): Preference {
    const infos = information.get(identifier) || [];
    const hasInformation = infos.length > 0;

    if (!hasInformation) {
      return [true, true, true, Infinity, true, identifier];
    }

    // Direct URL 체크
    const direct = infos.some((info) => info.requirement.url !== undefined);

    // 연산자 추출
    const operators: [string, string][] = [];
    for (const info of infos) {
      if (info.requirement.versionSpec) {
        const specs = this.parseVersionSpec(info.requirement.versionSpec);
        operators.push(...specs);
      }
    }

    // Pinned 체크 (== 또는 === 연산자)
    const pinned = operators.some(
      ([op, ver]) => (op === '==' || op === '===') && !ver.includes('*')
    );

    // Upper bounded 체크 (<, <=, ~=, == with wildcard)
    const upperBounded = operators.some(
      ([op, ver]) =>
        op === '<' || op === '<=' || op === '~=' ||
        (op === '==' && ver.includes('*'))
    );

    // Unfree 체크 (어떤 연산자든 있는지)
    const unfree = operators.length > 0;

    // 사용자 요청 순서
    const requestedOrder = this.config.userRequested.get(identifier) ?? Infinity;

    return [
      !direct,
      !pinned,
      !upperBounded,
      requestedOrder,
      !unfree,
      identifier,
    ];
  }

  /**
   * 버전 스펙 파싱
   */
  private parseVersionSpec(versionSpec: string): [string, string][] {
    const result: [string, string][] = [];
    const specs = versionSpec.split(',').map((s) => s.trim());

    for (const spec of specs) {
      const match = spec.match(/^(>=|<=|==|!=|~=|>|<|===)(.+)$/);
      if (match) {
        result.push([match[1], match[2]]);
      }
    }

    return result;
  }

  /**
   * 요구사항에 맞는 후보 찾기
   * pip의 find_matches() 구현
   */
  async findMatches(
    identifier: string,
    requirements: Map<string, Requirement[]>,
    incompatibilities: Map<string, Candidate[]>
  ): Promise<Candidate[]> {
    // 캐시 확인
    const cacheKey = identifier;
    if (this.candidateCache.has(cacheKey)) {
      return this.filterCandidates(
        this.candidateCache.get(cacheKey)!,
        requirements.get(identifier) || [],
        incompatibilities.get(identifier) || []
      );
    }

    // PyPI에서 패키지 정보 조회
    try {
      const packageInfo = await this.fetchPackageInfo(identifier);
      const candidates: Candidate[] = [];

      for (const [version, releases] of Object.entries(packageInfo.releases)) {
        if (releases.length === 0) continue;

        // 각 릴리스에서 InstallationCandidate 생성
        const installCandidates = releases.map((r) =>
          createCandidateFromRelease(identifier, version, r)
        );

        // 최적 후보 선택
        const bestCandidate = this.candidateEvaluator.sortBestCandidate(installCandidates);
        if (!bestCandidate) continue;

        candidates.push({
          name: identifier,
          version,
          dependencies: [], // 나중에 getDependencies에서 채움
          installationCandidate: bestCandidate,
        });
      }

      // 버전 내림차순 정렬 (최신 버전 우선)
      candidates.sort((a, b) => compareVersions(b.version, a.version));

      // 캐시 저장
      this.candidateCache.set(cacheKey, candidates);

      return this.filterCandidates(
        candidates,
        requirements.get(identifier) || [],
        incompatibilities.get(identifier) || []
      );
    } catch (error) {
      console.error(`패키지 정보 조회 실패: ${identifier}`, error);
      return [];
    }
  }

  /**
   * 후보 필터링
   */
  private filterCandidates(
    candidates: Candidate[],
    requirements: Requirement[],
    incompatibilities: Candidate[]
  ): Candidate[] {
    const incompatibleVersions = new Set(incompatibilities.map((c) => c.version));

    return candidates.filter((candidate) => {
      // 비호환 후보 제외
      if (incompatibleVersions.has(candidate.version)) {
        return false;
      }

      // 모든 요구사항 만족 확인
      for (const req of requirements) {
        if (req.versionSpec && !isVersionCompatible(candidate.version, req.versionSpec)) {
          return false;
        }
      }

      // 제약조건 확인
      const constraint = this.config.constraints.get(candidate.name);
      if (constraint?.versionSpec) {
        if (!isVersionCompatible(candidate.version, constraint.versionSpec)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * 요구사항이 후보에 의해 만족되는지 확인
   */
  isSatisfiedBy(requirement: Requirement, candidate: Candidate): boolean {
    // 이름 확인
    if (this.identify(requirement) !== this.identify(candidate)) {
      return false;
    }

    // 버전 스펙 확인
    if (requirement.versionSpec) {
      if (!isVersionCompatible(candidate.version, requirement.versionSpec)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 후보의 의존성 반환
   */
  async getDependencies(candidate: Candidate): Promise<Requirement[]> {
    if (this.config.ignoreDependencies) {
      return [];
    }

    // 캐시 확인
    const cacheKey = `${candidate.name}@${candidate.version}`;
    if (this.dependencyCache.has(cacheKey)) {
      return this.dependencyCache.get(cacheKey)!;
    }

    try {
      const packageInfo = await this.fetchPackageInfo(candidate.name);
      const versionInfo = packageInfo.releases[candidate.version];

      if (!versionInfo || versionInfo.length === 0) {
        return [];
      }

      // requires_dist에서 의존성 파싱
      const requiresDist = packageInfo.info.requires_dist || [];
      const dependencies: Requirement[] = [];

      for (const dep of requiresDist) {
        const parsed = this.parseDependencyString(dep);
        if (parsed && this.evaluateMarker(parsed.marker)) {
          dependencies.push(parsed);
        }
      }

      // 캐시 저장
      this.dependencyCache.set(cacheKey, dependencies);

      return dependencies;
    } catch (error) {
      console.error(`의존성 조회 실패: ${candidate.name}@${candidate.version}`, error);
      return [];
    }
  }

  /**
   * 의존성 문자열 파싱
   */
  private parseDependencyString(depString: string): Requirement | null {
    try {
      const [mainPart, marker] = depString.split(';').map((s) => s.trim());

      // extras 추출
      const extrasMatch = mainPart.match(/\[([^\]]+)\]/);
      const extras = extrasMatch
        ? extrasMatch[1].split(',').map((e) => e.trim())
        : undefined;

      // extras 제거
      const withoutExtras = mainPart.replace(/\[[^\]]+\]/, '');

      // 버전 지정자 패턴
      const versionPattern = /(>=|<=|==|!=|~=|>|<|===)/;
      const match = withoutExtras.match(versionPattern);

      let name: string;
      let versionSpec: string | undefined;

      if (match) {
        const index = withoutExtras.indexOf(match[0]);
        name = withoutExtras.substring(0, index).trim();
        versionSpec = withoutExtras.substring(index).trim();
      } else {
        name = withoutExtras.trim();
      }

      // 패키지명 정규화
      name = name.toLowerCase().replace(/-/g, '_');

      return {
        name,
        versionSpec,
        extras,
        marker: marker || undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * 환경 마커 평가
   */
  private evaluateMarker(marker?: string): boolean {
    if (!marker) return true;

    // extra 마커는 제외
    if (marker.includes('extra')) return false;

    // platform_system 평가
    const systemMatch = marker.match(/platform_system\s*==\s*["'](\w+)["']/);
    if (systemMatch) {
      const requiredSystem = systemMatch[1];
      const systemMap: Record<string, PlatformType> = {
        'Linux': 'linux',
        'Windows': 'windows',
        'Darwin': 'macos',
      };
      if (systemMap[requiredSystem] !== this.config.platform) {
        return false;
      }
    }

    // python_version 평가
    const pyVersionMatch = marker.match(/python_version\s*([<>=!]+)\s*["'](\d+\.\d+)["']/);
    if (pyVersionMatch) {
      const [, op, ver] = pyVersionMatch;
      const target = parseFloat(this.config.pythonVersion);
      const required = parseFloat(ver);

      switch (op) {
        case '>=': if (target < required) return false; break;
        case '>': if (target <= required) return false; break;
        case '<=': if (target > required) return false; break;
        case '<': if (target >= required) return false; break;
        case '==': if (target !== required) return false; break;
        case '!=': if (target === required) return false; break;
      }
    }

    return true;
  }

  /**
   * 우선순위 비교
   */
  comparePreferences(a: Preference, b: Preference): number {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
}
