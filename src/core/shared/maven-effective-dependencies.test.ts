import { describe, expect, it, vi } from 'vitest';
import { MavenBomProcessor } from './maven-bom-processor';
import { dependencyManagementKey } from './maven-types';
import type { MavenCoordinate, PomDependency, PomProject } from './maven-types';

const coordinate = (artifactId: string, version = '1.0'): MavenCoordinate => ({
  groupId: 'test',
  artifactId,
  version,
});

const dependency = (artifactId: string, version?: string): PomDependency => ({
  groupId: 'test',
  artifactId,
  ...(version === undefined ? {} : { version }),
});

function processorFor(models: Record<string, PomProject>) {
  const fetch = vi.fn(async (coord: MavenCoordinate) => {
    const model = models[`${coord.artifactId}:${coord.version}`];
    if (!model) throw new Error(`missing ${coord.artifactId}:${coord.version}`);
    return model;
  });
  return { fetch, processor: new MavenBomProcessor(fetch) };
}

describe('Maven effective ordinary dependencies', () => {
  it('inherits parent dependencies, resolves them in child context, and merges child overrides', async () => {
    const parentDependency = dependency('inherited', '${project.version}');
    const parent = {
      properties: { parentOnly: 'yes' },
      dependencyManagement: {
        dependencies: { dependency: dependency('managed', '4.0') },
      },
      dependencies: {
        dependency: [
          parentDependency,
          {
            ...dependency('override', '1.0'),
            scope: 'runtime',
            optional: true,
            type: 'jar',
            classifier: 'linux',
            exclusions: { exclusion: { groupId: 'test', artifactId: 'blocked' } },
          },
          dependency('managed'),
        ],
      },
    } satisfies PomProject;
    const child = {
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      properties: { childOnly: 'yes' },
      dependencies: {
        dependency: [
          { ...dependency('override', '2.0'), scope: 'compile', optional: false, classifier: 'linux' },
        ],
      },
    } satisfies PomProject;
    const { processor } = processorFor({ 'parent:1.0': parent });

    const result = await processor.processModel(child, coordinate('child', '9.0'), new Map());

    expect(result.properties).toMatchObject({ parentOnly: 'yes', childOnly: 'yes' });
    expect(result.dependencies).toEqual([
      { ...parentDependency, version: '9.0' },
      {
        ...dependency('override', '2.0'),
        scope: 'compile',
        optional: false,
        classifier: 'linux',
        type: 'jar',
        exclusions: { exclusion: { groupId: 'test', artifactId: 'blocked' } },
      },
      { ...dependency('managed', '4.0') },
    ]);
    expect(parentDependency).toEqual(dependency('inherited', '${project.version}'));
  });

  it('inherits ordinary dependencies through multiple parents without expanding imported BOM dependencies', async () => {
    const grandparent = {
      dependencies: { dependency: dependency('grandparent-library', '1.0') },
    } satisfies PomProject;
    const parent = {
      parent: { groupId: 'test', artifactId: 'grandparent', version: '1.0' },
      dependencyManagement: {
        dependencies: {
          dependency: {
            groupId: 'test',
            artifactId: 'runtime-library',
            version: '2.0',
          },
        },
      },
      dependencies: { dependency: dependency('runtime-library') },
    } satisfies PomProject;
    const bom = {
      dependencies: { dependency: dependency('bom-runtime', '3.0') },
    } satisfies PomProject;
    const child = {
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      dependencyManagement: {
        dependencies: {
          dependency: {
            groupId: 'test',
            artifactId: 'fixture-bom',
            version: '1.0',
            type: 'pom',
            scope: 'import',
          },
        },
      },
    } satisfies PomProject;
    const { processor } = processorFor({
      'grandparent:1.0': grandparent,
      'parent:1.0': parent,
      'fixture-bom:1.0': bom,
    });

    const result = await processor.processModel(child, coordinate('child'), new Map());

    expect(result.dependencies).toEqual([
      dependency('grandparent-library', '1.0'),
      dependency('runtime-library', '2.0'),
    ]);
    expect(result.dependencies.some(dep => dep.artifactId === 'bom-runtime')).toBe(false);
    expect(processor.getRequiredPoms().map(item => item.artifactId)).toEqual([
      'parent', 'grandparent', 'fixture-bom',
    ]);
  });

  it('resolves inherited dependency properties without mutating cached parent models', async () => {
    const rawDependency = dependency('property-library', '${library.version}');
    const parent = {
      dependencies: { dependency: rawDependency },
    } satisfies PomProject;
    const { processor } = processorFor({ 'parent:1.0': parent });

    const result = await processor.processModel({
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      properties: { 'library.version': '7.2' },
    }, coordinate('child'), new Map());

    expect(result.dependencies).toEqual([dependency('property-library', '7.2')]);
    expect(rawDependency).toEqual(dependency('property-library', '${library.version}'));
    expect(parent.dependencies?.dependency).toBe(rawDependency);
  });

  it('defers ancestor dependency properties until the final child context', async () => {
    const grandparentDependency = dependency('property-library', '${library.version}');
    const grandparent = {
      properties: { 'library.version': '1.0' },
      dependencies: { dependency: grandparentDependency },
    } satisfies PomProject;
    const parent = {
      parent: { groupId: 'test', artifactId: 'grandparent', version: '1.0' },
      properties: { 'library.version': '2.0' },
    } satisfies PomProject;
    const child = {
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      properties: { 'library.version': '3.0' },
    } satisfies PomProject;
    const { processor } = processorFor({
      'grandparent:1.0': grandparent,
      'parent:1.0': parent,
    });

    const result = await processor.processModel(child, coordinate('child'), new Map());

    expect(result.dependencies).toEqual([dependency('property-library', '3.0')]);
    expect(grandparentDependency.version).toBe('${library.version}');
  });

  it('keeps shared parent dependency contexts isolated across sibling children', async () => {
    const parentDependency = dependency('property-library', '${library.version}');
    const parent = {
      dependencies: { dependency: parentDependency },
    } satisfies PomProject;
    const { processor } = processorFor({ 'parent:1.0': parent });

    const first = await processor.processModel({
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      properties: { 'library.version': 'first' },
    }, coordinate('first'), new Map());
    const second = await processor.processModel({
      parent: { groupId: 'test', artifactId: 'parent', version: '1.0' },
      properties: { 'library.version': 'second' },
    }, coordinate('second'), new Map());

    expect(first.dependencies).toEqual([dependency('property-library', 'first')]);
    expect(second.dependencies).toEqual([dependency('property-library', 'second')]);
    expect(parentDependency.version).toBe('${library.version}');
  });

  it('keeps generic management from selecting a classified artifact version', async () => {
    const classifiedDependency: PomDependency = {
      ...dependency('library'),
      classifier: 'linux',
    };

    const { processor } = processorFor({});
    const result = await processor.processModel({
      dependencies: { dependency: classifiedDependency },
    }, coordinate('child'), new Map([['test:library', '2.0']]));

    expect(result.dependencies).toEqual([classifiedDependency]);
    expect(result.dependencyManagement.get('test:library')).toBe('2.0');
    expect(result.dependencyManagement.get(dependencyManagementKey(classifiedDependency))).toBeUndefined();
  });

  it('registers imported BOM management with its classifier and type identity', async () => {
    const managedDependency: PomDependency = {
      ...dependency('library', '7.0'),
      classifier: 'linux',
      type: 'jar',
    };
    const childDependency: PomDependency = {
      ...dependency('library'),
      classifier: 'linux',
      type: 'jar',
    };
    const child = {
      dependencyManagement: {
        dependencies: {
          dependency: {
            groupId: 'test',
            artifactId: 'fixture-bom',
            version: '1.0',
            type: 'pom',
            scope: 'import',
          },
        },
      },
      dependencies: { dependency: childDependency },
    } satisfies PomProject;
    const { processor } = processorFor({
      'fixture-bom:1.0': {
        dependencyManagement: { dependencies: { dependency: managedDependency } },
      },
    });

    const result = await processor.processModel(child, coordinate('child'), new Map());

    expect(result.dependencies).toEqual([{ ...childDependency, version: '7.0' }]);
    expect(result.dependencyManagement.get(dependencyManagementKey(managedDependency))).toBe('7.0');
    expect(result.dependencyManagement.get('test:library')).toBeUndefined();
  });
});
