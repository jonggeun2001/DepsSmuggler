import { describe, expect, it, vi } from 'vitest';
import { collectMavenManagedPackages } from './maven-project-managed';
import type { PackageInfo } from '../../types';

const pkg = (name: string, version: string, metadata = {}): PackageInfo => ({ type: 'maven', name, version, metadata });

describe('project management transport closure', () => {
  it('collects a used managed version and management reached only through that version, retaining original inputs', async () => {
    const roots = [pkg('g:a', '1')];
    const resolve = vi.fn(async (root: PackageInfo) => {
      if (root.name === 'g:a') return [pkg('g:b', '1')];
      if (root.name === 'g:b' && root.version === '2') return [pkg('g:c', '1')];
      return [];
    });
    const result = await collectMavenManagedPackages(roots, new Map([
      ['g:a', '99'], ['g:b', '2'], ['g:c', '3'], ['g:unused', '4'],
    ]), resolve);
    expect(result.map(p => `${p.name}:${p.version}`)).toEqual(['g:b:2', 'g:c:3']);
    expect(roots).toEqual([pkg('g:a', '1')]);
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it('respects classifier/type identities and deduplicates repeated managed targets and cycles', async () => {
    const resolve = vi.fn(async (root: PackageInfo) => root.name === 'g:a'
      ? [pkg('g:b', '1'), pkg('g:b', '1'), pkg('g:b', '1', { classifier: 'tests' }), pkg('g:b', '1', { type: 'pom' })]
      : [pkg('g:b', '1')]);
    const result = await collectMavenManagedPackages([pkg('g:a', '1')], new Map([['g:b', '2']]), resolve);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'g:b', version: '2' });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('does not scan model POMs or resolve any graph when no project management exists', async () => {
    const resolve = vi.fn(async () => []);
    expect(await collectMavenManagedPackages([pkg('g:a', '1')], new Map(), resolve)).toEqual([]);
    expect(await collectMavenManagedPackages([pkg('g:parent', '1', { type: 'pom', origin: 'project-model' })], new Map([['g:b', '2']]), resolve)).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails on a missing tree or unresolved used managed version', async () => {
    await expect(collectMavenManagedPackages([pkg('g:a', '1')], new Map([['g:b', '2']]), async () => {
      throw new Error('missing POM');
    })).rejects.toThrow('missing POM');
    await expect(collectMavenManagedPackages([pkg('g:a', '1')], new Map([['g:b', '${missing}']]), async () => [pkg('g:b', '1')])).rejects.toThrow();
  });
});
