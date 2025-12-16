import { describe, it, expect, beforeEach } from 'vitest';
import { CondaRepoDataProcessor } from './conda-repodata-processor';
import { RepoData } from '../shared/conda-types';

describe('CondaRepoDataProcessor', () => {
  let processor: CondaRepoDataProcessor;

  beforeEach(() => {
    processor = new CondaRepoDataProcessor({
      condaUrl: 'https://conda.anaconda.org',
      targetSubdir: 'linux-64',
      pythonVersion: null,
    });
  });

  describe('getPythonMatchScore', () => {
    it('should return 1 when no python version is set', () => {
      expect(processor.getPythonMatchScore('py311_0')).toBe(1);
    });

    it('should return 2 for an exact match', () => {
      processor.updateConfig({ pythonVersion: '3.11.5' });
      expect(processor.getPythonMatchScore('py311_0')).toBe(2);
    });

    it('should return 1 for a generic build', () => {
      processor.updateConfig({ pythonVersion: '3.11.5' });
      expect(processor.getPythonMatchScore('h12345_0')).toBe(1);
    });

    it('should return 0 for a mismatched python version', () => {
      processor.updateConfig({ pythonVersion: '3.11.5' });
      expect(processor.getPythonMatchScore('py310_0')).toBe(0);
    });
  });

  describe('findPackageCandidates', () => {
    const mockRepoData: RepoData = {
      info: { subdir: 'linux-64' },
      packages: {
        'test-pkg-1.0.0-py311_0.tar.bz2': {
          name: 'test-pkg',
          version: '1.0.0',
          build: 'py311_0',
          build_number: 0,
          depends: [],
        },
        'test-pkg-1.1.0-h123_0.tar.bz2': {
          name: 'test-pkg',
          version: '1.1.0',
          build: 'h123_0',
          build_number: 0,
          depends: [],
        },
        'test-pkg-1.0.0-py310_0.tar.bz2': {
          name: 'test-pkg',
          version: '1.0.0',
          build: 'py310_0',
          build_number: 0,
          depends: [],
        },
      },
    };

    it('should prioritize python-specific builds over generic builds with higher versions', () => {
      processor.updateConfig({ pythonVersion: '3.11.5' });
      const candidates = processor.findPackageCandidates(
        mockRepoData,
        'test-pkg'
      );
      expect(candidates[0].build).toBe('py311_0');
      expect(candidates[1].build).toBe('h123_0');
      expect(candidates[2].build).toBe('py310_0');
    });

    it('should select the highest version for generic builds when no python version is specified', () => {
      const candidates = processor.findPackageCandidates(
        mockRepoData,
        'test-pkg'
      );
      expect(candidates[0].version).toBe('1.1.0');
    });
  });
});
