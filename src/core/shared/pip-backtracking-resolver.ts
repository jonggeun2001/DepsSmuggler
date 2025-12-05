/**
 * 백트래킹 Resolver - resolvelib 스타일 의존성 해결
 * pip의 resolution/resolvelib/resolver.py를 TypeScript로 포팅
 *
 * 참고:
 * - https://github.com/sarugaku/resolvelib
 * - https://github.com/pypa/pip/blob/main/src/pip/_internal/resolution/resolvelib/resolver.py
 */

import {
  PipProvider,
  Requirement,
  Candidate,
  RequirementInformation,
  Preference,
  ProviderConfig,
  PackageInfoFetcher,
} from './pip-provider';

/**
 * 해결 상태
 */
interface ResolutionState {
  /** 현재 해결된 후보들 */
  mapping: Map<string, Candidate>;
  /** 미해결 요구사항들 */
  criteria: Map<string, ResolutionCriterion>;
  /** 백트래킹 원인 */
  backtrackCauses: RequirementInformation[];
}

/**
 * 해결 기준 (각 패키지별)
 */
interface ResolutionCriterion {
  /** 패키지 식별자 */
  identifier: string;
  /** 요구사항 정보 목록 */
  information: RequirementInformation[];
  /** 남은 후보들 */
  candidates: Candidate[];
  /** 비호환 후보들 */
  incompatibilities: Candidate[];
}

/**
 * 해결 결과
 */
export interface ResolutionResult {
  /** 성공 여부 */
  success: boolean;
  /** 해결된 패키지 맵 */
  mapping: Map<string, Candidate>;
  /** 충돌 정보 (실패 시) */
  conflicts?: ConflictInfo[];
  /** 백트래킹 횟수 */
  backtrackCount: number;
}

/**
 * 충돌 정보
 */
export interface ConflictInfo {
  /** 패키지 이름 */
  package: string;
  /** 충돌하는 요구사항들 */
  requirements: Requirement[];
  /** 요청한 부모 패키지들 */
  requestedBy: string[];
}

/**
 * Resolver 설정
 */
export interface ResolverConfig extends ProviderConfig {
  /** 최대 백트래킹 횟수 */
  maxBacktracks?: number;
  /** 최대 탐색 라운드 */
  maxRounds?: number;
}

/**
 * BacktrackingResolver 클래스
 * resolvelib의 Resolver와 유사한 백트래킹 알고리즘 구현
 */
export class BacktrackingResolver {
  private readonly provider: PipProvider;
  private readonly maxBacktracks: number;
  private readonly maxRounds: number;
  private backtrackCount: number = 0;

  constructor(config: ResolverConfig, fetchPackageInfo: PackageInfoFetcher) {
    this.provider = new PipProvider(config, fetchPackageInfo);
    this.maxBacktracks = config.maxBacktracks ?? 100000;
    this.maxRounds = config.maxRounds ?? 200000;
  }

  /**
   * 의존성 해결 수행
   */
  async resolve(requirements: Requirement[]): Promise<ResolutionResult> {
    this.backtrackCount = 0;

    // 초기 상태 생성
    const state: ResolutionState = {
      mapping: new Map(),
      criteria: new Map(),
      backtrackCauses: [],
    };

    // 초기 요구사항 추가
    for (const req of requirements) {
      await this.addRequirement(state, req, null);
    }

    // 해결 루프
    let rounds = 0;
    const stateStack: ResolutionState[] = [];

    while (rounds < this.maxRounds) {
      rounds++;

      // 미해결 요구사항 확인
      const unsatisfied = this.getUnsatisfiedCriteria(state);

      if (unsatisfied.length === 0) {
        // 모든 요구사항 해결됨
        return {
          success: true,
          mapping: state.mapping,
          backtrackCount: this.backtrackCount,
        };
      }

      // 다음에 처리할 요구사항 선택
      const nextIdentifier = await this.selectNextIdentifier(state, unsatisfied);
      if (!nextIdentifier) {
        // 충돌 발생 - 백트래킹 시도
        const backtracked = this.backtrack(state, stateStack);
        if (!backtracked) {
          return this.createFailureResult(state);
        }
        continue;
      }

      // 후보 찾기
      const criterion = state.criteria.get(nextIdentifier)!;
      const candidates = await this.findCandidates(state, criterion);

      if (candidates.length === 0) {
        // 후보 없음 - 백트래킹
        const backtracked = this.backtrack(state, stateStack);
        if (!backtracked) {
          return this.createFailureResult(state);
        }
        continue;
      }

      // 상태 저장 (백트래킹용)
      if (candidates.length > 1) {
        stateStack.push(this.cloneState(state));
      }

      // 첫 번째 후보 선택
      const selectedCandidate = candidates[0];

      // 후보의 의존성 가져오기
      const dependencies = await this.provider.getDependencies(selectedCandidate);

      // 후보 적용
      state.mapping.set(nextIdentifier, selectedCandidate);
      criterion.candidates = candidates.slice(1); // 나머지 후보 저장

      // 의존성 요구사항 추가
      for (const dep of dependencies) {
        const depId = this.provider.identify(dep);

        // 이미 해결된 패키지인 경우 호환성 확인
        if (state.mapping.has(depId)) {
          const resolved = state.mapping.get(depId)!;
          if (!this.provider.isSatisfiedBy(dep, resolved)) {
            // 충돌 발생 - 백트래킹 원인 기록
            state.backtrackCauses.push({
              requirement: dep,
              parent: selectedCandidate,
            });

            // 백트래킹
            const backtracked = this.backtrack(state, stateStack);
            if (!backtracked) {
              return this.createFailureResult(state);
            }
            break;
          }
        } else {
          // 새 요구사항 추가
          await this.addRequirement(state, dep, selectedCandidate);
        }
      }
    }

    // 최대 라운드 초과
    return {
      success: false,
      mapping: state.mapping,
      conflicts: [{ package: 'resolution', requirements: [], requestedBy: ['max rounds exceeded'] }],
      backtrackCount: this.backtrackCount,
    };
  }

  /**
   * 요구사항 추가
   */
  private async addRequirement(
    state: ResolutionState,
    requirement: Requirement,
    parent: Candidate | null
  ): Promise<void> {
    const identifier = this.provider.identify(requirement);

    if (!state.criteria.has(identifier)) {
      state.criteria.set(identifier, {
        identifier,
        information: [],
        candidates: [],
        incompatibilities: [],
      });
    }

    const criterion = state.criteria.get(identifier)!;
    criterion.information.push({ requirement, parent });
  }

  /**
   * 미해결 기준 반환
   */
  private getUnsatisfiedCriteria(state: ResolutionState): ResolutionCriterion[] {
    const unsatisfied: ResolutionCriterion[] = [];

    for (const [identifier, criterion] of state.criteria) {
      if (!state.mapping.has(identifier)) {
        unsatisfied.push(criterion);
      }
    }

    return unsatisfied;
  }

  /**
   * 다음에 처리할 식별자 선택
   */
  private async selectNextIdentifier(
    state: ResolutionState,
    unsatisfied: ResolutionCriterion[]
  ): Promise<string | null> {
    if (unsatisfied.length === 0) return null;

    // 식별자 목록
    const identifiers = unsatisfied.map((c) => c.identifier);

    // 백트래킹 원인 우선 처리
    const narrowed = this.provider.narrowRequirementSelection(
      identifiers,
      state.mapping,
      new Map(), // candidates - 아직 조회 전
      this.criteriaToInformation(state.criteria),
      state.backtrackCauses
    );

    if (narrowed.length > 0) {
      // 우선순위로 정렬
      const preferences: [string, Preference][] = [];

      for (const id of narrowed) {
        const pref = this.provider.getPreference(
          id,
          state.mapping,
          new Map(),
          this.criteriaToInformation(state.criteria),
          state.backtrackCauses
        );
        preferences.push([id, pref]);
      }

      preferences.sort((a, b) => this.provider.comparePreferences(a[1], b[1]));
      return preferences[0][0];
    }

    return null;
  }

  /**
   * criteria를 information 맵으로 변환
   */
  private criteriaToInformation(
    criteria: Map<string, ResolutionCriterion>
  ): Map<string, RequirementInformation[]> {
    const result = new Map<string, RequirementInformation[]>();
    for (const [id, criterion] of criteria) {
      result.set(id, criterion.information);
    }
    return result;
  }

  /**
   * 후보 찾기
   */
  private async findCandidates(
    state: ResolutionState,
    criterion: ResolutionCriterion
  ): Promise<Candidate[]> {
    // 이미 캐시된 후보가 있으면 사용
    if (criterion.candidates.length > 0) {
      return criterion.candidates;
    }

    // 요구사항 맵 생성
    const requirements = new Map<string, Requirement[]>();
    for (const info of criterion.information) {
      const id = this.provider.identify(info.requirement);
      if (!requirements.has(id)) {
        requirements.set(id, []);
      }
      requirements.get(id)!.push(info.requirement);
    }

    // 비호환 맵 생성
    const incompatibilities = new Map<string, Candidate[]>();
    incompatibilities.set(criterion.identifier, criterion.incompatibilities);

    // Provider에서 후보 조회
    return this.provider.findMatches(criterion.identifier, requirements, incompatibilities);
  }

  /**
   * 백트래킹 수행
   */
  private backtrack(
    state: ResolutionState,
    stateStack: ResolutionState[]
  ): boolean {
    if (this.backtrackCount >= this.maxBacktracks) {
      return false;
    }

    if (stateStack.length === 0) {
      return false;
    }

    this.backtrackCount++;

    // 이전 상태 복원
    const previousState = stateStack.pop()!;
    state.mapping = previousState.mapping;
    state.criteria = previousState.criteria;

    // 백트래킹 원인 유지
    state.backtrackCauses = [...state.backtrackCauses];

    return true;
  }

  /**
   * 상태 복제
   */
  private cloneState(state: ResolutionState): ResolutionState {
    const clonedMapping = new Map(state.mapping);
    const clonedCriteria = new Map<string, ResolutionCriterion>();

    for (const [id, criterion] of state.criteria) {
      clonedCriteria.set(id, {
        identifier: criterion.identifier,
        information: [...criterion.information],
        candidates: [...criterion.candidates],
        incompatibilities: [...criterion.incompatibilities],
      });
    }

    return {
      mapping: clonedMapping,
      criteria: clonedCriteria,
      backtrackCauses: [...state.backtrackCauses],
    };
  }

  /**
   * 실패 결과 생성
   */
  private createFailureResult(state: ResolutionState): ResolutionResult {
    const conflicts: ConflictInfo[] = [];

    // 충돌 정보 수집
    for (const [identifier, criterion] of state.criteria) {
      if (!state.mapping.has(identifier) && criterion.information.length > 0) {
        const requestedBy = criterion.information
          .filter((info) => info.parent)
          .map((info) => info.parent!.name);

        conflicts.push({
          package: identifier,
          requirements: criterion.information.map((info) => info.requirement),
          requestedBy: requestedBy.length > 0 ? requestedBy : ['(root)'],
        });
      }
    }

    return {
      success: false,
      mapping: state.mapping,
      conflicts,
      backtrackCount: this.backtrackCount,
    };
  }
}

/**
 * 간단한 해결 함수 (편의용)
 */
export async function resolveDependencies(
  requirements: Requirement[],
  config: ResolverConfig,
  fetchPackageInfo: PackageInfoFetcher
): Promise<ResolutionResult> {
  const resolver = new BacktrackingResolver(config, fetchPackageInfo);
  return resolver.resolve(requirements);
}
