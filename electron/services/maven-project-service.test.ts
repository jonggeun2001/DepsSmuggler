import { describe, expect, it, vi } from 'vitest';
import { createMavenProjectService } from './maven-project-service';

const { collectMock } = vi.hoisted(() => ({ collectMock: vi.fn() }));
vi.mock('../../src/core/shared/maven-project', () => ({ collectMavenProjectPackages: collectMock }));

describe('Maven project service', () => {
  it('rejects non-string and empty POM content without calling the collector', async () => {
    const service = createMavenProjectService();
    await expect(service.parseProject(null)).resolves.toMatchObject({ success: false, packages: [] });
    await expect(service.parseProject('  ')).resolves.toMatchObject({ success: false, packages: [] });
    expect(collectMock).not.toHaveBeenCalled();
  });

  it('delegates valid content and preserves collector packages/options', async () => {
    const packages = [{ type: 'maven', name: 'g:a', version: '1.0.0' }];
    collectMock.mockResolvedValueOnce(packages);
    const service = createMavenProjectService();
    await expect(service.parseProject('<project/>', { mavenVersion: '3.9.9' }))
      .resolves.toEqual({ success: true, packages });
    expect(collectMock).toHaveBeenCalledWith('<project/>', { mavenVersion: '3.9.9' });
  });

  it('converts collector failures to a stable failure result', async () => {
    collectMock.mockRejectedValueOnce(new Error('invalid POM'));
    await expect(createMavenProjectService().parseProject('<project/>'))
      .resolves.toEqual({ success: false, packages: [], error: 'invalid POM' });
  });
});
