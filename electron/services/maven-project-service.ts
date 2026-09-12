import { collectMavenProjectPackages, type MavenProjectOptions } from '../../src/core/shared/maven-project';
import type { PackageInfo } from '../../src/types';

export interface MavenProjectParseResult {
  success: boolean;
  packages: PackageInfo[];
  error?: string;
}

export function createMavenProjectService() {
  return {
    async parseProject(
      content: unknown,
      options?: MavenProjectOptions,
    ): Promise<MavenProjectParseResult> {
      if (typeof content !== 'string' || !content.trim()) {
        return { success: false, packages: [], error: 'POM 내용이 비어 있습니다.' };
      }
      try {
        const packages = await collectMavenProjectPackages(content, options);
        return { success: true, packages };
      } catch (error) {
        return {
          success: false,
          packages: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
