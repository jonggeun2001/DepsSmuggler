/** Maven parent/BOM model processing and required POM collection. */
import {
  dependencyManagementKey,
  PomProject,
  PomDependency,
  MavenCoordinate,
} from './maven-types';
import { resolveProperty } from './maven-pom-utils';

export type FetchPomFunction = (coordinate: MavenCoordinate) => Promise<PomProject>;

/** Required model failures must not produce an apparently complete offline bundle. */
export class MavenPomResolutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MavenPomResolutionError';
  }
}

type Properties = Record<string, string>;
interface ModelFrame {
  pom: PomProject;
  coordinate?: MavenCoordinate;
  properties: Properties;
  dependencies: PomDependency[];
  includeManagement: boolean;
  phase: 'parent' | 'management' | 'imports' | 'done';
  imports: PomDependency[];
  importIndex: number;
  parentResult?: ModelResult;
  isParent: boolean;
  isImport: boolean;
  managementDeclarations: PomDependency[];
  dependencyManagement: Map<string, string>;
}

interface ModelResult {
  properties: Properties;
  dependencies: PomDependency[];
  managementDeclarations: PomDependency[];
  dependencyManagement: Map<string, string>;
}

/**
 * Traverses parent and import edges separately from ordinary dependencies.
 * The explicit stack tracks ancestry, so shared models are not mistaken for cycles.
 */
export class MavenBomProcessor {
  private dependencyManagement: Map<string, string>;
  private readonly requiredPoms = new Map<string, MavenCoordinate>();
  private readonly models = new Map<string, Promise<PomProject>>();
  private readonly completedImports = new Map<string, ModelResult>();
  private readonly modelReferences = new Map<string, Set<string>>();

  constructor(private fetchPom: FetchPomFunction, dependencyManagement?: Map<string, string>) {
    this.dependencyManagement = dependencyManagement || new Map();
  }

  getDependencyManagement(): Map<string, string> {
    return this.dependencyManagement;
  }

  setDependencyManagement(dm: Map<string, string>): void {
    this.dependencyManagement = dm;
    this.completedImports.clear();
  }

  /** Return fresh coordinates; callers cannot mutate the collection. */
  getRequiredPoms(): MavenCoordinate[] {
    return Array.from(this.requiredPoms.values(), (coordinate) => ({ ...coordinate }));
  }

  clearDependencyManagement(): void {
    this.dependencyManagement.clear();
    this.requiredPoms.clear();
    this.models.clear();
    this.completedImports.clear();
    this.modelReferences.clear();
  }

  /**
   * Resolve one model against root management without leaking its declarations
   * into siblings. Callers process models sequentially; raw POMs and the required
   * output collection remain shared for the complete resolution request.
   */
  async processModel(
    pom: PomProject,
    coordinate: MavenCoordinate,
    rootManagement: Map<string, string>
  ): Promise<{
    properties: Properties;
    dependencyManagement: Map<string, string>;
    dependencies: PomDependency[];
  }> {
    const model = await this.walkModels(this.frame(pom, coordinate, undefined, true));
    const dependencyManagement = new Map(model.dependencyManagement);
    for (const [key, version] of rootManagement) dependencyManagement.set(key, version);
    return {
      properties: model.properties,
      dependencyManagement,
      dependencies: this.resolveEffectiveDependencies(
        model.dependencies, model.properties, dependencyManagement,
      ),
    };
  }

  async processParentPom(
    pom: PomProject,
    coordinate: MavenCoordinate,
    inheritedProperties?: Properties
  ): Promise<Properties> {
    const result = await this.walkModels(this.frame(pom, coordinate, inheritedProperties, false));
    this.mergeMissingManagement(this.dependencyManagement, result.dependencyManagement);
    return result.properties;
  }

  async processDependencyManagement(pom: PomProject, properties?: Properties): Promise<void> {
    // Parent inheritance has already been processed by processParentPom. Keeping
    // this root on the active path still detects a BOM that imports its owner.
    const coordinate = this.inferCoordinate(pom, properties);
    const frame = this.frame(pom, coordinate, properties, true);
    frame.properties = properties || frame.properties;
    frame.phase = 'management';
    const result = await this.walkModels(frame);
    this.mergeMissingManagement(this.dependencyManagement, result.dependencyManagement);
  }

  async importBom(dep: PomDependency, properties?: Properties): Promise<void> {
    const coordinate = this.requiredCoordinate(dep, properties, 'BOM');
    let result = this.completedImports.get(this.key(coordinate));
    if (!result) {
      const pom = await this.loadRequiredPom(coordinate);
      result = await this.walkModels(this.frame(pom, coordinate, undefined, true, false, true));
    }
    this.mergeMissingManagement(this.dependencyManagement, result.dependencyManagement);
  }

  private key(coordinate: MavenCoordinate): string {
    return `${coordinate.groupId}:${coordinate.artifactId}:${coordinate.version}`;
  }

  private projectProperties(coordinate?: MavenCoordinate): Properties {
    if (!coordinate) return {};
    return {
      'project.version': coordinate.version,
      'project.groupId': coordinate.groupId,
      'project.artifactId': coordinate.artifactId,
      version: coordinate.version,
      groupId: coordinate.groupId,
      artifactId: coordinate.artifactId,
    };
  }

  private frame(
    pom: PomProject,
    coordinate: MavenCoordinate | undefined,
    inheritedProperties: Properties | undefined,
    includeManagement: boolean,
    isParent = false,
    isImport = false
  ): ModelFrame {
    return {
      pom,
      coordinate,
      properties: { ...inheritedProperties, ...pom.properties, ...this.projectProperties(coordinate) },
      dependencies: this.ownDependencies(pom),
      includeManagement,
      phase: 'parent',
      imports: [],
      importIndex: 0,
      isParent,
      isImport,
      managementDeclarations: [],
      dependencyManagement: new Map(),
    };
  }

  private ownDependencies(pom: PomProject): PomDependency[] {
    const dependencies = pom.dependencies?.dependency;
    if (!dependencies) return [];
    return (Array.isArray(dependencies) ? dependencies : [dependencies])
      .map((dependency) => ({ ...dependency }));
  }

  private resolveDependencyFields(
    dependency: PomDependency,
    properties: Properties,
  ): PomDependency {
    const resolved: PomDependency = {
      ...dependency,
      groupId: resolveProperty(dependency.groupId, properties),
      artifactId: resolveProperty(dependency.artifactId, properties),
    };
    if (dependency.version !== undefined) {
      resolved.version = resolveProperty(dependency.version, properties);
    }
    if (dependency.scope !== undefined) {
      resolved.scope = resolveProperty(dependency.scope, properties);
    }
    if (dependency.type !== undefined) {
      resolved.type = resolveProperty(dependency.type, properties);
    }
    if (dependency.classifier !== undefined) {
      resolved.classifier = resolveProperty(dependency.classifier, properties);
    }
    if (typeof dependency.optional === 'string') {
      resolved.optional = resolveProperty(dependency.optional, properties);
    }
    if (dependency.exclusions) {
      const exclusions = Array.isArray(dependency.exclusions.exclusion)
        ? dependency.exclusions.exclusion
        : [dependency.exclusions.exclusion];
      const resolvedExclusions = exclusions.map((exclusion) => ({
        ...exclusion,
        groupId: resolveProperty(exclusion.groupId, properties),
        artifactId: resolveProperty(exclusion.artifactId, properties),
      }));
      resolved.exclusions = {
        exclusion: Array.isArray(dependency.exclusions.exclusion)
          ? resolvedExclusions
          : resolvedExclusions[0],
      };
    }
    return resolved;
  }

  private cloneDependency(dependency: PomDependency): PomDependency {
    if (!dependency.exclusions) return { ...dependency };
    const exclusions = Array.isArray(dependency.exclusions.exclusion)
      ? dependency.exclusions.exclusion.map((exclusion) => ({ ...exclusion }))
      : { ...dependency.exclusions.exclusion };
    return { ...dependency, exclusions: { exclusion: exclusions } };
  }

  private mergeExclusions(
    first: PomDependency['exclusions'],
    second: PomDependency['exclusions'],
  ): PomDependency['exclusions'] | undefined {
    if (!first && !second) return undefined;
    const exclusions = [first, second]
      .filter((value): value is NonNullable<PomDependency['exclusions']> => Boolean(value))
      .flatMap((value) => Array.isArray(value.exclusion) ? value.exclusion : [value.exclusion])
      .map((exclusion) => ({ ...exclusion }));
    const unique = new Map(exclusions.map((exclusion) => [
      `${exclusion.groupId}\0${exclusion.artifactId}`,
      exclusion,
    ]));
    const values = [...unique.values()];
    return {
      exclusion: values.length === 1 ? values[0] : values,
    };
  }

  private dependencyIdentity(dependency: PomDependency, properties: Properties): string {
    const resolved = this.resolveDependencyFields(dependency, properties);
    return [
      resolved.groupId,
      resolved.artifactId,
      resolved.type || 'jar',
      resolved.classifier || '',
    ].join('\0');
  }

  private mergeDependencies(
    inherited: PomDependency[],
    own: PomDependency[],
    properties: Properties,
  ): PomDependency[] {
    const merged = new Map<string, PomDependency>();
    for (const dependency of inherited) {
      const raw = this.cloneDependency(dependency);
      merged.set(this.dependencyIdentity(raw, properties), raw);
    }
    for (const dependency of own) {
      const raw = this.cloneDependency(dependency);
      const key = this.dependencyIdentity(raw, properties);
      const inheritedDependency = merged.get(key);
      merged.set(key, {
        ...inheritedDependency,
        ...raw,
        exclusions: this.mergeExclusions(inheritedDependency?.exclusions, raw.exclusions),
      });
    }
    return [...merged.values()];
  }

  private mergeMissingManagement(target: Map<string, string>, source: Map<string, string>): void {
    for (const [key, version] of source) {
      if (!target.has(key)) target.set(key, version);
    }
  }

  /** Inherit declarations before interpolating them in the child model. */
  private inheritManagement(
    inherited: PomDependency[], own: PomDependency[], properties: Properties,
  ): PomDependency[] {
    const ownKeys = new Set(own.map((dependency) => this.dependencyIdentity(dependency, properties)));
    const inheritedByKey = new Map(inherited.map((dependency) => [
      this.dependencyIdentity(dependency, properties), dependency,
    ]));
    return [
      ...own.map((dependency) => {
        const parent = inheritedByKey.get(this.dependencyIdentity(dependency, properties));
        return {
          ...parent,
          ...dependency,
          exclusions: this.mergeExclusions(parent?.exclusions, dependency.exclusions),
        };
      }),
      ...inherited.filter((dependency) => !ownKeys.has(this.dependencyIdentity(dependency, properties))),
    ].map((dependency) => this.cloneDependency(dependency));
  }

  private resolveEffectiveDependencies(
    dependencies: PomDependency[],
    properties: Properties,
    dependencyManagement: Map<string, string>,
  ): PomDependency[] {
    return dependencies.map((dependency) => {
      const resolved = this.resolveDependencyFields(dependency, properties);
      if (!resolved.version) {
        const managedVersion = dependencyManagement.get(dependencyManagementKey(resolved));
        if (managedVersion) resolved.version = managedVersion;
      }
      return resolved;
    });
  }

  private inferCoordinate(pom: PomProject, properties?: Properties): MavenCoordinate | undefined {
    const groupId = properties?.['project.groupId'] || pom.groupId || pom.parent?.groupId;
    const artifactId = properties?.['project.artifactId'] || pom.artifactId;
    const version = properties?.['project.version'] || pom.version || pom.parent?.version;
    return groupId && artifactId && version ? { groupId, artifactId, version } : undefined;
  }

  private requiredCoordinate(
    reference: { groupId?: string; artifactId?: string; version?: string },
    properties: Properties | undefined,
    kind: string
  ): MavenCoordinate {
    const groupId = resolveProperty(reference.groupId || '', properties).trim();
    const artifactId = resolveProperty(reference.artifactId || '', properties).trim();
    const version = resolveProperty(reference.version || '', properties).trim();
    if ([groupId, artifactId, version].some((value) => !value || value.includes('${'))) {
      throw new MavenPomResolutionError(`필수 ${kind} POM 좌표를 해결할 수 없습니다: ${groupId}:${artifactId}:${version}`);
    }
    return { groupId, artifactId, version, type: 'pom' };
  }

  private async loadRequiredPom(coordinate: MavenCoordinate): Promise<PomProject> {
    const key = this.key(coordinate);
    let pending = this.models.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => this.fetchPom(coordinate));
      this.models.set(key, pending);
    }
    try {
      const pom = await pending;
      if (!pom || typeof pom !== 'object' || Array.isArray(pom)) {
        throw new Error('유효한 POM 프로젝트가 없습니다');
      }
      this.requiredPoms.set(key, { ...coordinate, type: 'pom' });
      return pom;
    } catch (error) {
      this.models.delete(key);
      if (error instanceof MavenPomResolutionError) throw error;
      throw new MavenPomResolutionError(`필수 POM을 가져오지 못했습니다: ${key}`, error);
    }
  }

  /** A completed import may be reused unless it can lead back to this ancestry.
   * Parent evaluation can depend on the current child properties, so observed
   * edges are conservative: a possible intersection triggers normal traversal,
   * rather than declaring a cycle from cached data alone.
   */
  private mayReachAncestor(key: string, active: Set<string>): boolean {
    const pending = [key];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (active.has(current)) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const reference of this.modelReferences.get(current) || []) {
        pending.push(reference);
      }
    }
    return false;
  }

  private async walkModels(root: ModelFrame): Promise<ModelResult> {
    const stack = [root];
    const active = new Set<string>();
    if (root.coordinate) active.add(this.key(root.coordinate));

    const pushReference = async (
      coordinate: MavenCoordinate,
      inheritedProperties?: Properties,
      isParent = false
    ): Promise<void> => {
      const key = this.key(coordinate);
      const owner = stack[stack.length - 1].coordinate;
      if (owner) {
        const ownerKey = this.key(owner);
        const references = this.modelReferences.get(ownerKey) || new Set<string>();
        references.add(key);
        this.modelReferences.set(ownerKey, references);
      }
      if (active.has(key)) {
        const path = stack.flatMap((frame) => frame.coordinate ? [this.key(frame.coordinate)] : []);
        throw new MavenPomResolutionError(`필수 POM 순환 참조: ${[...path, key].join(' → ')}`);
      }
      // Only fully processed imports have an importer-independent context.
      // Parent frames are always re-evaluated with the current child's properties.
      const completed = this.completedImports.get(key);
      if (!isParent && completed && !this.mayReachAncestor(key, active)) {
        this.mergeMissingManagement(stack[stack.length - 1].dependencyManagement, completed.dependencyManagement);
        return;
      }
      const pom = await this.loadRequiredPom(coordinate);
      active.add(key);
      stack.push(this.frame(pom, coordinate, inheritedProperties, true, isParent, !isParent));
    };

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      if (current.phase === 'parent') {
        current.phase = 'management';
        if (current.pom.parent) {
          const parent = this.requiredCoordinate({
            ...current.pom.parent,
            groupId: current.pom.parent.groupId || current.coordinate?.groupId,
          }, current.properties, 'parent');
          await pushReference(parent, current.properties, true);
          continue;
        }
      }

      if (current.phase === 'management') {
        if (current.parentResult) {
          current.properties = {
            ...current.parentResult.properties,
            ...current.pom.properties,
            ...this.projectProperties(current.coordinate),
          };
          current.dependencies = this.mergeDependencies(
            current.parentResult.dependencies,
            current.dependencies,
            current.properties,
          );
        }
        const managed = current.includeManagement
          ? current.pom.dependencyManagement?.dependencies?.dependency
          : undefined;
        current.managementDeclarations = this.inheritManagement(
          current.parentResult?.managementDeclarations || [],
          managed ? (Array.isArray(managed) ? managed : [managed]) : [],
          current.properties,
        );
        current.phase = 'imports';
        // Direct declarations (including inherited ones) precede imported BOM
        // contents. Imports are then merged in declaration order, first wins.
        for (const dep of current.managementDeclarations) {
          const resolved = this.resolveDependencyFields(dep, current.properties);
          if (resolved.scope === 'import' && resolved.type === 'pom') {
            current.imports.push(dep);
          } else if (resolved.version) {
            current.dependencyManagement.set(dependencyManagementKey(resolved), resolved.version);
          }
        }
      }

      if (current.phase === 'imports') {
        const next = current.imports[current.importIndex++];
        if (next) {
          await pushReference(this.requiredCoordinate(next, current.properties, 'BOM'));
          continue;
        }
        current.phase = 'done';
      }

      stack.pop();
      const result: ModelResult = {
        properties: current.properties,
        dependencies: current.dependencies,
        managementDeclarations: current.managementDeclarations,
        dependencyManagement: current.dependencyManagement,
      };
      if (current.coordinate) {
        const key = this.key(current.coordinate);
        active.delete(key);
        if (current.isImport) this.completedImports.set(key, result);
      }
      if (stack.length > 0) {
        const owner = stack[stack.length - 1];
        if (current.isParent) owner.parentResult = result;
        else this.mergeMissingManagement(owner.dependencyManagement, result.dependencyManagement);
      }
    }
    return {
      properties: root.properties,
      dependencies: root.dependencies,
      managementDeclarations: root.managementDeclarations,
      dependencyManagement: root.dependencyManagement,
    };
  }
}
