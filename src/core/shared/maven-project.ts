/** Collect the inputs needed to build one submitted project through `package`.
 * Library POM build sections are deliberately not traversed by the resolver.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { PackageInfo } from '../../types';
import { MavenBomProcessor } from './maven-bom-processor';
import { fetchPom } from './maven-cache';
import { DEFAULT_MAVEN_BUILD_VERSION, loadMavenLifecyclePlugins } from './maven-lifecycle';
import { resolveProperty } from './maven-pom-utils';
import { loadMavenSurefireProviders } from './maven-surefire';
import { collectMavenTestRuntimePackages } from './maven-test-runtime';
import { collectMavenManagedPackages } from './maven-project-managed';
import type { MavenCoordinate, PomDependency, PomPlugin, PomProject } from './maven-types';

export interface MavenProjectOptions { mavenVersion?: string }
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const key = (value: MavenCoordinate): string => `${value.groupId}:${value.artifactId}:${value.version}`;

function required(value: string | undefined, label: string, properties: Record<string, string>): string {
  const resolved = resolveProperty(value || '', properties).trim();
  if (!resolved || /\$\{|\s|[[\](),]/.test(resolved) || /^(latest|release)$/i.test(resolved)) {
    throw new Error(`${label}을(를) 확정할 수 없습니다: ${value || '(미지정)'}. 구체적인 버전을 지정한 POM을 사용하세요.`);
  }
  return resolved;
}

function checkModelScope(pom: PomProject): void {
  const model = pom as PomProject & { profiles?: unknown; modules?: unknown; build?: { extensions?: unknown } };
  if (model.profiles || model.modules || model.build?.extensions) {
    throw new Error('프로필·다중 모듈·build extensions POM은 직접 수집할 수 없습니다. 대상 환경의 단일 모듈 effective POM에서 프로필·모듈 선언을 제거하고 확장은 별도로 준비하세요.');
  }
}

function mergePlugin(base: PomPlugin | undefined, own: PomPlugin): PomPlugin {
  // Maven merges plugin dependency declarations by identity. Retain both
  // explicit versions for transport; Maven still chooses the execution version.
  const dependencies = [...array(base?.dependencies?.dependency), ...array(own.dependencies?.dependency)];
  return { ...base, ...own, ...(dependencies.length ? { dependencies: { dependency: dependencies } } : {}) };
}

export async function collectMavenProjectPackages(
  content: string,
  options: MavenProjectOptions = {},
): Promise<PackageInfo[]> {
  if (typeof content !== 'string' || !content.trim()) throw new Error('POM 내용이 비어 있습니다.');
  const validation = XMLValidator.validate(content);
  if (validation !== true) throw new Error(`POM XML 오류: ${validation.err.msg}`);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, removeNSPrefix: true }).parse(content);
  const pom: PomProject = parsed.project;
  if (!pom || typeof pom !== 'object' || Array.isArray(pom)) throw new Error('전체 <project> POM이 필요합니다.');
  checkModelScope(pom);
  const initialProperties = { ...pom.properties };
  // This coordinate is model context only; the locally built project is never
  // added as a remote download root.
  const coordinate: MavenCoordinate = {
    groupId: required(pom.groupId || pom.parent?.groupId || 'local.project', '프로젝트 groupId', initialProperties),
    artifactId: required(pom.artifactId || 'imported-project', '프로젝트 artifactId', initialProperties),
    version: required(pom.version || pom.parent?.version || '1', '프로젝트 version', initialProperties),
  };
  const models = new Map<string, Promise<PomProject>>();
  const loadModel = (value: MavenCoordinate): Promise<PomProject> => {
    const id = key(value);
    let promise = models.get(id);
    if (!promise) {
      promise = fetchPom(value).then(model => { checkModelScope(model); return model; });
      models.set(id, promise);
    }
    return promise;
  };
  const processor = new MavenBomProcessor(loadModel);
  const effective = await processor.processModel(pom, coordinate, new Map());
  const properties = effective.properties;
  const mavenVersion = options.mavenVersion || DEFAULT_MAVEN_BUILD_VERSION;
  const packaging = resolveProperty(pom.packaging || 'jar', properties);
  const lifecycle = await loadMavenLifecyclePlugins(mavenVersion, packaging);
  const packages = new Map<string, PackageInfo>();
  const add = (value: MavenCoordinate, metadata: PackageInfo['metadata'] = {}): void => {
    const type = value.type || 'jar';
    const id = `${key(value)}:${type}:${value.classifier || ''}`;
    packages.set(id, {
      type: 'maven', name: `${value.groupId}:${value.artifactId}`, version: value.version,
      metadata: { groupId: value.groupId, artifactId: value.artifactId, type, ...metadata,
        ...(value.classifier ? { classifier: value.classifier } : {}) },
    });
  };
  const addDependency = (dependency: PomDependency, origin: string): void => {
    const scope = resolveProperty(dependency.scope || 'compile', properties);
    if (scope === 'system') throw new Error(`system 의존성은 로컬 파일이 필요합니다: ${dependency.groupId}:${dependency.artifactId}`);
    add({
      groupId: required(dependency.groupId, `${origin} groupId`, properties),
      artifactId: required(dependency.artifactId, `${origin} artifactId`, properties),
      version: required(dependency.version, `${dependency.groupId}:${dependency.artifactId} version`, properties),
      type: dependency.type ? required(dependency.type, 'dependency type', properties) : 'jar',
      classifier: dependency.classifier ? required(dependency.classifier, 'classifier', properties) : undefined,
    }, { scope, origin });
  };
  for (const dependency of effective.dependencies) addDependency(dependency, 'project-dependency');
  for (const managed of await collectMavenManagedPackages([...packages.values()], effective.dependencyManagement)) {
    const [groupId, artifactId] = managed.name.split(':');
    const managedType = typeof managed.metadata?.type === 'string' ? managed.metadata.type : undefined;
    const managedClassifier = typeof managed.metadata?.classifier === 'string' ? managed.metadata.classifier : undefined;
    add({
      groupId,
      artifactId,
      version: managed.version,
      ...(managedType ? { type: managedType } : {}),
      ...(managedClassifier ? { classifier: managedClassifier } : {}),
    }, managed.metadata);
  }
  for (const model of processor.getRequiredPoms()) add({ ...model, type: 'pom' }, { origin: 'project-model' });

  // Only the submitted project's parent chain contributes build declarations.
  const chain: PomProject[] = [pom];
  const seen = new Set([key(coordinate)]);
  let current = pom;
  while (current.parent) {
    if (chain.length >= 256) throw new Error('프로젝트 parent 깊이가 제한을 초과했습니다.');
    const parentProperties = { ...properties, ...current.properties };
    const parent = {
      groupId: required(current.parent.groupId, 'parent groupId', parentProperties),
      artifactId: required(current.parent.artifactId, 'parent artifactId', parentProperties),
      version: required(current.parent.version, 'parent version', parentProperties),
    };
    if (seen.has(key(parent))) throw new Error(`프로젝트 parent 순환 참조: ${key(parent)}`);
    seen.add(key(parent));
    current = await loadModel(parent);
    chain.push(current);
  }
  const pluginKey = (plugin: PomPlugin): string => `${required(plugin.groupId || 'org.apache.maven.plugins', 'plugin groupId', properties)}:${required(plugin.artifactId, 'plugin artifactId', properties)}`;
  const managed = new Map<string, PomPlugin>();
  const declared = new Map<string, PomPlugin>();
  for (const model of chain.reverse()) {
    for (const entries of [managed, declared]) {
      for (const [id, plugin] of entries) {
        if (String(plugin.inherited) === 'false') entries.delete(id);
      }
    }
    for (const plugin of array(model.build?.pluginManagement?.plugins?.plugin)) {
      const id = pluginKey(plugin);
      managed.set(id, mergePlugin(managed.get(id), plugin));
    }
    for (const plugin of array(model.build?.plugins?.plugin)) {
      const id = pluginKey(plugin);
      declared.set(id, mergePlugin(declared.get(id), plugin));
    }
  }
  const active = new Map<string, PomPlugin>();
  let usesJUnitPlatformProvider = false;
  for (const plugin of lifecycle.plugins) active.set(pluginKey(plugin), plugin);
  for (const [id, plugin] of declared) active.set(id, mergePlugin(active.get(id), plugin));
  for (const [id, plugin] of active) {
    const declaration = declared.get(id);
    const management = managed.get(id);
    const effectivePlugin = mergePlugin(management, plugin);
    // Default lifecycle versions are fallback values, below explicit management.
    const version = declaration?.version || management?.version || plugin.version;
    const pluginCoordinate = {
      groupId: required(effectivePlugin.groupId || 'org.apache.maven.plugins', 'plugin groupId', properties),
      artifactId: required(effectivePlugin.artifactId, 'plugin artifactId', properties),
      version: required(version, `${id} plugin version`, properties),
      type: 'maven-plugin',
    };
    add(pluginCoordinate, {
      origin: 'project-build-plugin', mavenVersion, packaging, phase: 'package',
      lifecycleSource: lifecycle.sourceUrl, lifecycleSha256: lifecycle.sha256,
    });
    for (const dependency of array(effectivePlugin.dependencies?.dependency)) addDependency(dependency, 'project-plugin-dependency');
    if (pluginCoordinate.groupId === 'org.apache.maven.plugins' &&
        ['maven-surefire-plugin', 'maven-failsafe-plugin'].includes(pluginCoordinate.artifactId)) {
      for (const provider of await loadMavenSurefireProviders(pluginCoordinate.version)) {
        if (provider.artifactId === 'surefire-junit-platform') usesJUnitPlatformProvider = true;
        add(provider, { origin: 'project-test-provider', pluginVersion: pluginCoordinate.version });
      }
    }
  }
  if (usesJUnitPlatformProvider) {
    const projectInputs = [...packages.values()].filter(pkg =>
      ['project-dependency', 'project-managed-dependency', 'project-plugin-dependency'].includes(String(pkg.metadata?.origin)),
    );
    for (const runtime of await collectMavenTestRuntimePackages(projectInputs)) {
      const [groupId, artifactId] = runtime.name.split(':');
      add({ groupId, artifactId, version: runtime.version }, runtime.metadata);
    }
  }
  return [...packages.values()];
}
