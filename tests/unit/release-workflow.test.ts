import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface Step {
  name: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

const workflow = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8')) as {
  jobs: Record<string, { needs?: string[]; steps: Step[] }>;
};

describe('release publication contract', () => {
  it.each(['windows', 'linux'])(
    'keeps the %s builder from creating a release before its notes',
    (platform) => {
      const steps = workflow.jobs[`build-${platform}`].steps;
      const packaging = steps.find(
        (step) => step.name === `Package for ${platform === 'windows' ? 'Windows' : 'Linux'}`
      );
      expect(packaging?.run).toMatch(/npm run package:(win|linux) -- --publish never$/);
      expect(steps.some((step) => step.uses?.startsWith('softprops/action-gh-release'))).toBe(
        false
      );
    }
  );

  it.each(['windows', 'macos', 'linux'])(
    'forwards %s update metadata and differential files to the final publisher',
    (platform) => {
      const upload = workflow.jobs[`build-${platform}`].steps.find((step) =>
        step.uses?.startsWith('actions/upload-artifact')
      );
      const paths = String(upload?.with?.path).trim().split('\n');
      expect(paths).toContain(platform === 'macos' ? 'build/*-mac.yml' : 'build/*.yml');
      expect(paths).toContain('build/*.blockmap');
      expect(upload?.with?.['if-no-files-found']).toBe('error');
    }
  );

  it('uses a publisher that updates existing release bodies, then checks the saved body', () => {
    const release = workflow.jobs['create-release'];
    expect(release.needs).toEqual(
      expect.arrayContaining(['build-windows', 'build-macos', 'build-linux'])
    );
    const publisher = release.steps.find((step) =>
      step.uses?.startsWith('softprops/action-gh-release')
    );
    if (!publisher) throw new Error('Release publisher missing');
    // v1 returns an existing release early when draft:true, leaving its body empty.
    expect(publisher.uses).toBe('softprops/action-gh-release@v2');
    expect(publisher.with?.generate_release_notes).toBe(true);
    expect(publisher.with?.draft).toBe(true);
    expect(publisher.with?.body).toEqual(expect.stringContaining('변경 사항'));
    const verification = release.steps.findIndex((step) => step.name === 'Verify release notes');
    expect(verification).toBeGreaterThan(release.steps.indexOf(publisher));
    expect(release.steps[verification].run).toContain('releases/$RELEASE_ID');
    expect(release.steps[verification].run).toContain("jq -e '.body");
  });
});
