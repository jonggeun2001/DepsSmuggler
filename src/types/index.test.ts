import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const typesDir = __dirname;
const repoRoot = path.resolve(typesDir, '../..');

const readFile = (relativePath: string): string => {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
};

describe('Phase 2 type module structure', () => {
  it('canonical type modules가 분리돼 있어야 한다', () => {
    const requiredFiles = [
      'src/types/history.ts',
      'src/types/interfaces.ts',
      'src/types/manifest/package-manifest.ts',
      'src/types/package-manager/metadata.ts',
      'src/types/package-manager/package-manager.ts',
      'src/types/packaging.ts',
      'src/types/platform/architecture.ts',
      'src/types/platform/pip-target-platform.ts',
      'src/types/resolver/dependency-graph.ts',
      'src/types/download/item.ts',
      'src/types/download/result.ts',
    ];

    for (const relativePath of requiredFiles) {
      expect(fs.existsSync(path.join(repoRoot, relativePath)), relativePath).toBe(true);
    }
  });

  it('src/types/index.ts는 barrel re-export만 유지해야 한다', () => {
    const indexSource = readFile('src/types/index.ts');

    expect(indexSource).not.toContain('export interface ');
    expect(indexSource).not.toContain('export type ');
    expect(indexSource).toContain("export * from './package-manager/package-manager';");
    expect(indexSource).toContain("export * from './manifest/package-manifest';");
    expect(indexSource).toContain("export * from './platform/pip-target-platform';");
  });

  it('legacy pip-target-platform entry는 shim으로 남아야 한다', () => {
    const shimSource = readFile('src/types/pip-target-platform.ts');

    expect(shimSource).not.toContain('export interface PipTargetPlatform');
    expect(shimSource).toContain("export type { PipTargetPlatform } from './platform/pip-target-platform';");
  });

  it('public PackageManifest surface는 legacy contract를 유지해야 한다', () => {
    const manifestSource = readFile('src/types/manifest/package-manifest.ts');

    expect(manifestSource).toContain('export interface PackageManifest');
    expect(manifestSource).toContain('totalPackages: number;');
    expect(manifestSource).toContain("format: 'archive' | 'withScript';");
    expect(manifestSource).toContain('export interface ArchivePackageManifest');
    expect(manifestSource).toContain('fileCount: number;');
    expect(manifestSource).toContain('version: string;');
  });

  it('archive-packager는 archive 전용 canonical manifest type을 사용해야 한다', () => {
    const archivePackagerSource = readFile('src/core/packager/archive-packager.ts');

    expect(archivePackagerSource).not.toContain('export interface PackageManifest');
    expect(archivePackagerSource).toContain("import type { ArchivePackageManifest } from '../../types/manifest/package-manifest';");
    expect(archivePackagerSource).toContain('ArchivePackageManifest as PackageManifest');
  });
});
