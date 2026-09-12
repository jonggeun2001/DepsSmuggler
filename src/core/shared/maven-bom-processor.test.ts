import { describe, expect, it, vi } from 'vitest';
import { MavenBomProcessor, MavenPomResolutionError } from './maven-bom-processor';
import type { MavenCoordinate, PomDependency, PomProject } from './maven-types';

const coord = (artifactId: string, version = '1'): MavenCoordinate => ({ groupId: 'test', artifactId, version });
const parent = (artifactId: string, version = '1') => coord(artifactId, version);
const bom = (artifactId: string, version = '1'): PomDependency => ({ ...coord(artifactId, version), type: 'pom', scope: 'import' });
const managed = (...dependency: PomDependency[]) => ({ dependencies: { dependency } });
const versionless = (artifactId: string): PomDependency => ({ groupId: 'test', artifactId });

function fixture(models: Record<string, PomProject>) {
  let calls = 0;
  const fetch = vi.fn(async (coordinate: MavenCoordinate) => {
    // Also bounds the old implementation when proving that cycle detection is missing.
    if (++calls > 10000) throw new Error('fixture fetch limit');
    const model = models[`${coordinate.artifactId}:${coordinate.version}`];
    if (!model) throw new Error(`missing ${coordinate.artifactId}`);
    return model;
  });
  return { fetch, processor: new MavenBomProcessor(fetch) };
}

async function rejectsModelError(operation: Promise<unknown>) {
  await expect(operation).rejects.toBeInstanceOf(MavenPomResolutionError);
}

describe('Maven required parent and imported BOM models', () => {
  it('isolates each model management while sharing required POMs and raw fetches', async () => {
    const { processor, fetch } = fixture({
      'shared:1': { dependencyManagement: managed(coord('shared-library', '3')) },
    });
    const original = new Map([['test:existing', '9']]);
    processor.setDependencyManagement(original);
    const first = await processor.processModel({ dependencyManagement: managed(
      coord('first-only', '1'), bom('shared'),
    ) }, coord('first'), new Map());
    const second = await processor.processModel({ dependencyManagement: managed(
      coord('second-only', '2'), bom('shared'),
    ) }, coord('second'), new Map());
    expect(first.dependencyManagement.get('test:first-only')).toBe('1');
    expect(second.dependencyManagement.has('test:first-only')).toBe(false);
    expect(first.dependencyManagement.has('test:second-only')).toBe(false);
    expect(second.dependencyManagement.get('test:second-only')).toBe('2');
    expect(first.dependencyManagement.get('test:shared-library')).toBe('3');
    expect(second.dependencyManagement.get('test:shared-library')).toBe('3');
    expect(processor.getDependencyManagement()).toBe(original);
    expect([...original]).toEqual([['test:existing', '9']]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(processor.getRequiredPoms()).toEqual([{ ...coord('shared'), type: 'pom' }]);
  });

  it('keeps root management ahead of child parent and own declarations', async () => {
    const { processor } = fixture({
      'base:1': { properties: { inherited: 'yes' }, dependencyManagement: managed(coord('library', '2')) },
    });
    const rootManagement = new Map([['test:library', '5']]);
    const result = await processor.processModel({
      parent: parent('base'), dependencyManagement: managed(coord('library', '3'), coord('local', '7')),
    }, coord('child'), rootManagement);
    expect(result.properties.inherited).toBe('yes');
    expect(result.dependencyManagement.get('test:library')).toBe('5');
    expect(result.dependencyManagement.get('test:local')).toBe('7');
    expect([...rootManagement]).toEqual([['test:library', '5']]);
  });

  it('allows a child direct management entry to override every parent level', async () => {
    const { processor } = fixture({
      'parent:1': { parent: parent('grandparent'), dependencyManagement: managed(coord('library', '2')) },
      'grandparent:1': { dependencyManagement: managed(coord('library', '1')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencyManagement: managed(coord('library', '3')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('3');
  });

  it('inherits an omitted managed version when the child only overrides other fields', async () => {
    const { processor } = fixture({
      'parent:1': { dependencyManagement: managed(coord('library', '2')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'),
      dependencyManagement: managed({ ...versionless('library'), scope: 'test' }),
      dependencies: { dependency: versionless('library') },
    }, coord('child'), new Map());
    expect(result.dependencies[0]?.version).toBe('2');
  });

  it('keeps parent management ahead of a child imported BOM', async () => {
    const { processor } = fixture({
      'parent:1': { dependencyManagement: managed(coord('library', '1')) },
      'bom:1': { dependencyManagement: managed(coord('library', '2')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencyManagement: managed(bom('bom')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('1');
  });

  it('resolves a parent management property in the child dependency context', async () => {
    const { processor } = fixture({
      'parent:1': {
        properties: { selectedVersion: '1' },
        dependencyManagement: managed({ ...versionless('library'), version: '${selectedVersion}' }),
      },
    });
    const result = await processor.processModel({
      parent: parent('parent'), properties: { selectedVersion: '2' },
      dependencies: { dependency: versionless('library') },
    }, coord('child', '2'), new Map());
    expect(result.dependencies[0]?.version).toBe('2');
  });

  it('resolves project.version in inherited management against the child project', async () => {
    const { processor } = fixture({
      'parent:1': {
        dependencyManagement: managed({ ...versionless('library'), version: '${project.version}' }),
      },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencies: { dependency: versionless('library') },
    }, coord('child', '2'), new Map());
    expect(result.dependencies[0]?.version).toBe('2');
  });

  it('lets a child import of the same BOM GA replace the parent import', async () => {
    const { processor } = fixture({
      'parent:1': { dependencyManagement: managed(bom('bom', '1')) },
      'bom:1': { dependencyManagement: managed(coord('library', '1')) },
      'bom:2': { dependencyManagement: managed(coord('library', '2')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencyManagement: managed(bom('bom', '2')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('2');
  });

  it('processes child BOM imports before different inherited BOM imports', async () => {
    const { processor } = fixture({
      'parent:1': { dependencyManagement: managed(bom('parent-bom')) },
      'parent-bom:1': { dependencyManagement: managed(coord('library', '1')) },
      'child-bom:1': { dependencyManagement: managed(coord('library', '2')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencyManagement: managed(bom('child-bom')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('2');
  });

  it('keeps a parent direct management entry ahead of a different child BOM', async () => {
    const { processor } = fixture({
      'parent:1': { dependencyManagement: managed(coord('library', '1')) },
      'bom:2': { dependencyManagement: managed(coord('library', '2')) },
    });
    const result = await processor.processModel({
      parent: parent('parent'), dependencyManagement: managed(bom('bom', '2')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('1');
  });

  it('keeps an imported BOM property context independent from its importer', async () => {
    const { processor } = fixture({
      'bom:1': {
        properties: { selectedVersion: '1' },
        dependencyManagement: managed({ ...versionless('library'), version: '${selectedVersion}' }),
      },
    });
    const result = await processor.processModel({
      properties: { selectedVersion: '2' }, dependencyManagement: managed(bom('bom', '1')),
    }, coord('child'), new Map());
    expect(result.dependencyManagement.get('test:library')).toBe('1');
  });

  it('restores the previous management map after a required model failure', async () => {
    const { processor } = fixture({});
    const original = new Map([['test:existing', '9']]);
    processor.setDependencyManagement(original);
    await rejectsModelError(processor.processModel({ dependencyManagement: managed(
      coord('partial', '1'), bom('missing'),
    ) }, coord('broken'), new Map()));
    expect(processor.getDependencyManagement()).toBe(original);
    expect([...original]).toEqual([['test:existing', '9']]);
    const next = await processor.processModel({}, coord('next'), new Map());
    expect(next.dependencyManagement.size).toBe(0);
  });

  it('collects only referenced models with unique full GAV and POM type', async () => {
    const { processor, fetch } = fixture({
      'parent:1': { dependencyManagement: managed(bom('bom', '1'), bom('bom', '2')) },
      'bom:1': {}, 'bom:2': {},
    });
    await processor.processParentPom({ parent: parent('parent') }, coord('app'));
    expect(processor.getRequiredPoms()).toEqual([
      { ...coord('parent'), type: 'pom' },
      { ...coord('bom'), type: 'pom' },
      { ...coord('bom', '2'), type: 'pom' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['parent', 'bom', 'mixed'] as const)('rejects a true %s ancestry cycle', async (kind) => {
    const models: Record<string, PomProject> = kind === 'parent'
      ? { 'a:1': { parent: parent('b') }, 'b:1': { parent: parent('a') } }
      : kind === 'bom'
        ? { 'a:1': { dependencyManagement: managed(bom('b')) }, 'b:1': { dependencyManagement: managed(bom('a')) } }
        : { 'a:1': { parent: parent('b') }, 'b:1': { dependencyManagement: managed(bom('a')) } };
    const { processor } = fixture(models);
    await rejectsModelError(processor.importBom(bom('a')));
  });

  it('does not mistake shared parents and a diamond of imports for a cycle', async () => {
    const { processor, fetch } = fixture({
      'left:1': { parent: parent('base'), dependencyManagement: managed(bom('shared')) },
      'right:1': { parent: parent('base'), dependencyManagement: managed(bom('shared')) },
      'base:1': { properties: { inherited: 'yes' } },
      'shared:1': { dependencyManagement: managed({ ...coord('library'), version: '3' }) },
    });
    await processor.processDependencyManagement({ ...coord('app'), dependencyManagement: managed(bom('left'), bom('right')) });
    expect(processor.getRequiredPoms().map((item) => item.artifactId)).toEqual(['left', 'base', 'shared', 'right']);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(processor.getDependencyManagement().get('test:library')).toBe('3');
  });

  it('bounds model work for a 24-layer diamond import DAG', async () => {
    const depth = 24;
    let modelReads = 0;
    const fetch = vi.fn(async ({ artifactId }: MavenCoordinate): Promise<PomProject> => {
      const level = Number(artifactId.split('-')[0]);
      return {
        get dependencyManagement() {
          if (++modelReads > 200) throw new Error('repeated model expansion exceeded work limit');
          return level < depth ? managed(bom(`${level + 1}-left`), bom(`${level + 1}-right`)) : undefined;
        },
      };
    });
    const processor = new MavenBomProcessor(fetch);
    await processor.importBom(bom('0-root'));
    expect(processor.getRequiredPoms()).toHaveLength(depth * 2 + 1);
    expect(fetch).toHaveBeenCalledTimes(depth * 2 + 1);
    expect(modelReads).toBeLessThanOrEqual(depth * 2 + 1);
  });

  it('re-evaluates shared parent properties for each child context', async () => {
    const { processor } = fixture({
      'base:1': { parent: parent('grandparent', '${line}') },
      'grandparent:1': {}, 'grandparent:2': {},
    });
    await processor.processParentPom({ parent: parent('base'), properties: { line: '1' } }, coord('first'));
    await processor.processParentPom({ parent: parent('base'), properties: { line: '2' } }, coord('second'));
    expect(processor.getRequiredPoms()).toContainEqual({ ...coord('grandparent', '1'), type: 'pom' });
    expect(processor.getRequiredPoms()).toContainEqual({ ...coord('grandparent', '2'), type: 'pom' });
  });

  it('does not hide a cycle through a previously completed BOM and a contextual parent', async () => {
    const { processor } = fixture({
      'base:1': { dependencyManagement: managed(bom('${selection}')) },
      'cached:1': { parent: parent('base'), properties: { selection: 'leaf' } },
      'leaf:1': {},
    });
    await processor.importBom(bom('cached'));
    await rejectsModelError(processor.processParentPom({
      parent: parent('base'), properties: { selection: 'cached' },
    }, coord('app')));
  });

  it('reapplies completed BOMs when management state is replaced or reset', async () => {
    const { processor } = fixture({ 'bom:1': { dependencyManagement: managed(coord('library', '7')) } });
    await processor.importBom(bom('bom'));
    processor.setDependencyManagement(new Map());
    await processor.importBom(bom('bom'));
    expect(processor.getDependencyManagement().get('test:library')).toBe('7');
    processor.clearDependencyManagement();
    await processor.importBom(bom('bom'));
    expect(processor.getDependencyManagement().get('test:library')).toBe('7');
    expect(processor.getRequiredPoms()).toEqual([{ ...coord('bom'), type: 'pom' }]);
  });

  it('handles a deep parent chain without recursive traversal', async () => {
    const depth = 2000;
    const fetch = vi.fn(async ({ artifactId }: MavenCoordinate): Promise<PomProject> => {
      const index = Number(artifactId);
      return index < depth ? { parent: parent(String(index + 1)) } : { properties: { inherited: 'deep' } };
    });
    const processor = new MavenBomProcessor(fetch);
    const properties = await processor.processParentPom({ parent: parent('1'), properties: { local: 'kept' } }, coord('0'));
    expect(properties).toMatchObject({ inherited: 'deep', local: 'kept', 'project.artifactId': '0' });
    expect(processor.getRequiredPoms()).toHaveLength(depth);
  });

  it('handles a deep import chain with an explicit stack', async () => {
    const depth = 2000;
    const fetch = vi.fn(async ({ artifactId }: MavenCoordinate): Promise<PomProject> => {
      const index = Number(artifactId);
      return index < depth ? { dependencyManagement: managed(bom(String(index + 1))) } : {};
    });
    const processor = new MavenBomProcessor(fetch);
    await processor.importBom(bom('1'));
    expect(processor.getRequiredPoms()).toHaveLength(depth);
  });

  it('allows a project and its imported BOM to share a completed parent', async () => {
    const { processor, fetch } = fixture({
      'base:1': { properties: { inherited: '4' } },
      'bom:1': { parent: parent('base') },
    });
    const project = { ...coord('app'), parent: parent('base'), dependencyManagement: managed(bom('bom')) };
    const properties = await processor.processParentPom(project, coord('app'));
    await processor.processDependencyManagement(project, properties);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(processor.getRequiredPoms().map((item) => item.artifactId)).toEqual(['base', 'bom']);
  });

  it('uses BOM declaration order even when later network responses would be faster', async () => {
    const fetch = vi.fn(async ({ artifactId }: MavenCoordinate): Promise<PomProject> => {
      if (artifactId === 'slow') await new Promise((resolve) => setTimeout(resolve, 5));
      return { dependencyManagement: managed({ ...coord('library'), version: artifactId === 'slow' ? '2' : '3' }) };
    });
    const processor = new MavenBomProcessor(fetch);
    await processor.processDependencyManagement({ dependencyManagement: managed(bom('slow'), bom('fast')) });
    expect(processor.getDependencyManagement().get('test:library')).toBe('2');
  });

  it('keeps inherited properties and deterministic first-declaration managed versions', async () => {
    const { processor } = fixture({
      'base:1': { properties: { inherited: '4', override: 'parent' } },
      'slow:1': { dependencyManagement: managed({ ...coord('library'), version: '2' }) },
      'fast:1': { dependencyManagement: managed({ ...coord('library'), version: '3' }) },
    });
    const properties = await processor.processParentPom({ parent: parent('base'), properties: { override: 'child' } }, coord('app'));
    expect(properties).toMatchObject({ inherited: '4', override: 'child' });
    await processor.processDependencyManagement({ dependencyManagement: managed(
      { ...coord('direct'), version: '${inherited}' }, bom('slow'), bom('fast'),
    ) }, properties);
    expect(processor.getDependencyManagement().get('test:direct')).toBe('4');
    expect(processor.getDependencyManagement().get('test:library')).toBe('2');
  });

  it('never downloads unused ordinary dependencyManagement entries', async () => {
    const { processor, fetch } = fixture({ 'base:1': { dependencyManagement: managed(
      ...Array.from({ length: 650 }, (_, index) => coord(`unused-${index}`)),
    ) } });
    await processor.processParentPom({ parent: parent('base') }, coord('app'));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(processor.getRequiredPoms()).toEqual([{ ...coord('base'), type: 'pom' }]);
    expect(processor.getDependencyManagement()).toHaveProperty('size', 650);
  });

  it.each(['parent', 'bom'] as const)('reports a missing required %s instead of succeeding', async (kind) => {
    const { processor } = fixture({});
    await rejectsModelError(kind === 'parent'
      ? processor.processParentPom({ parent: parent('missing') }, coord('app'))
      : processor.importBom(bom('missing')));
  });

  it.each(['parent', 'bom'] as const)('rejects unresolved required %s coordinates before fetching', async (kind) => {
    const { processor, fetch } = fixture({});
    await rejectsModelError(kind === 'parent'
      ? processor.processParentPom({ parent: parent('base', '${missing}') }, coord('app'))
      : processor.importBom(bom('base', '${missing}')));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resets required models and model cache between independent resolutions', async () => {
    const { processor, fetch } = fixture({ 'base:1': { dependencyManagement: managed(coord('library')) } });
    await processor.processParentPom({ parent: parent('base') }, coord('app'));
    processor.clearDependencyManagement();
    expect(processor.getRequiredPoms()).toEqual([]);
    expect(processor.getDependencyManagement().size).toBe(0);
    await processor.processParentPom({ parent: parent('base') }, coord('another'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
