import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('createSearchOrchestrator', () => {
  it('패키지 타입별 검색과 버전 조회를 router에 위임한다', async () => {
    const { createSearchOrchestrator } = await import('./search-orchestrator');

    const packageRouter = {
      prime: vi.fn(),
      searchPackages: vi.fn().mockResolvedValue([
        { name: 'react', version: '19.0.0', description: 'React' },
      ]),
      getVersions: vi.fn().mockResolvedValue(['19.0.0', '18.3.1']),
      suggest: vi.fn().mockResolvedValue(['react', 'react-dom']),
    };
    const mavenArtifactService = {
      isNativeArtifact: vi.fn().mockResolvedValue(false),
      getAvailableClassifiers: vi.fn().mockResolvedValue(['sources']),
    };

    const orchestrator = createSearchOrchestrator({
      packageRouter,
      mavenArtifactService,
    });

    await orchestrator.prime();
    const searchResult = await orchestrator.searchPackages('npm', 'react');
    const versionsResult = await orchestrator.getVersions('npm', 'react');
    const suggestResult = await orchestrator.suggest('npm', 'rea');

    expect(packageRouter.prime).toHaveBeenCalled();
    expect(searchResult).toEqual({
      results: [{ name: 'react', version: '19.0.0', description: 'React' }],
    });
    expect(versionsResult).toEqual({ versions: ['19.0.0', '18.3.1'] });
    expect(suggestResult).toEqual(['react', 'react-dom']);
  });
});
