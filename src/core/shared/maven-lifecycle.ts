import { createHash } from 'node:crypto';
import axios from 'axios';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
export { DEFAULT_MAVEN_BUILD_VERSION } from '../../types/maven-project';

const MAVEN_PACKAGINGS = new Set(['pom', 'jar', 'ejb', 'maven-plugin', 'war', 'ear', 'rar']);
const PACKAGE_PHASES = [
  'validate',
  'initialize',
  'generate-sources',
  'process-sources',
  'generate-resources',
  'process-resources',
  'compile',
  'process-classes',
  'generate-test-sources',
  'process-test-sources',
  'generate-test-resources',
  'process-test-resources',
  'test-compile',
  'process-test-classes',
  'test',
  'prepare-package',
  'package',
] as const;

export interface MavenLifecyclePlugin {
  groupId: string;
  artifactId: string;
  version: string;
}

export interface MavenLifecyclePlugins {
  plugins: MavenLifecyclePlugin[];
  sourceUrl: string;
  sha256: string;
}

type XmlFetcher = (url: string) => Promise<string>;

function sourceUrlFor(version: string): string {
  return `https://raw.githubusercontent.com/apache/maven/maven-${version}/maven-core/src/main/resources/META-INF/plexus/default-bindings.xml`;
}

function validateInputs(mavenVersion: string, packaging: string): void {
  if (!/^3\.\d+\.\d+$/.test(mavenVersion)) {
    throw new Error(`Unsupported Maven version: ${mavenVersion}; expected numeric 3.x.y`);
  }
  if (!MAVEN_PACKAGINGS.has(packaging)) {
    throw new Error(`Unknown Maven packaging: ${packaging}`);
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

interface ParsedComponent {
  role?: string;
  'role-hint'?: string;
  configuration?: {
    lifecycles?: {
      lifecycle?: {
        id?: string;
        phases?: Record<string, string | string[]>;
      } | Array<{ id?: string; phases?: Record<string, string | string[]> }>;
    };
  };
}

function componentFor(xml: string, packaging: string): ParsedComponent | undefined {
  const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml) as {
    'component-set'?: { components?: { component?: ParsedComponent | ParsedComponent[] } };
  };
  const components = asArray(parsed['component-set']?.components?.component);
  if (components.length === 0) {
    throw new Error('Maven lifecycle XML has no components');
  }
  return components.find(
    (component) =>
      component.role === 'org.apache.maven.lifecycle.mapping.LifecycleMapping' &&
      component['role-hint'] === packaging,
  );
}

function defaultPhasesFor(xml: string, packaging: string): Record<string, string | string[]> | undefined {
  const component = componentFor(xml, packaging);
  if (!component) {
    if (packaging === 'pom') return undefined;
    throw new Error(`Maven lifecycle binding not found for packaging: ${packaging}`);
  }
  const lifecycles = asArray(component.configuration?.lifecycles?.lifecycle);
  const lifecycle = lifecycles.find((candidate) => candidate.id === 'default');
  if (!lifecycle?.phases) {
    throw new Error(`Maven default lifecycle phases not found for packaging: ${packaging}`);
  }
  return lifecycle.phases;
}

function extractPlugins(xml: string, packaging: string): MavenLifecyclePlugin[] {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Invalid Maven lifecycle XML: ${validation.err.msg}`);
  }

  // POM packaging has no lifecycle goals through package. Older Maven tables
  // may omit its component entirely, but the XML still must be a real table.
  const phases = defaultPhasesFor(xml, packaging);
  if (!phases) return [];

  const plugins = new Map<string, MavenLifecyclePlugin>();
  for (const phase of PACKAGE_PHASES) {
    const phaseValue = phases[phase];
    if (!phaseValue) continue;
    for (const value of asArray(phaseValue)) {
      const coordinates = [...value.matchAll(/([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^:\s]+):[^\s<]+/g)];
      if (coordinates.length === 0) {
        throw new Error(`Invalid lifecycle plugin binding in ${phase}`);
      }
      for (const [, groupId, artifactId, version] of coordinates) {
        if (version.includes('$') || version.includes('{') || version.includes('}')) {
          throw new Error(`Unresolved lifecycle plugin version in ${phase}: ${version}`);
        }
        const plugin = { groupId, artifactId, version };
        plugins.set(`${groupId}:${artifactId}:${version}`, plugin);
      }
    }
  }
  return [...plugins.values()];
}

export async function loadMavenLifecyclePlugins(
  mavenVersion: string,
  packaging: string,
  fetchXml?: XmlFetcher,
): Promise<MavenLifecyclePlugins> {
  validateInputs(mavenVersion, packaging);
  const sourceUrl = sourceUrlFor(mavenVersion);
  const xml = fetchXml
    ? await fetchXml(sourceUrl)
    : (await axios.get<string>(sourceUrl, { timeout: 15_000, responseType: 'text' })).data;
  if (typeof xml !== 'string' || xml.length === 0) {
    throw new Error('Maven lifecycle binding response was empty');
  }
  return {
    plugins: extractPlugins(xml, packaging),
    sourceUrl,
    sha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
  };
}
