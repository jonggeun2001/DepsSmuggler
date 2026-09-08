import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PipProvider } from './pip-provider';
import type {
  Candidate,
  PackageInfoFetcher,
  Preference,
  ProviderConfig,
  Requirement,
  RequirementInformation,
} from './pip-provider';
import type { PyPIReleaseInfo } from './pip-candidate';

const config: ProviderConfig = { pythonVersion: '3.11', platform: 'windows', arch: 'x86_64' };

function release(
  version: string,
  filename = `demo-${version}-py3-none-any.whl`,
  overrides: Partial<PyPIReleaseInfo> = {}
): PyPIReleaseInfo {
  return {
    filename,
    url: `https://files.example.test/${filename}`,
    size: 100,
    packagetype: filename.endsWith('.whl') ? 'bdist_wheel' : 'sdist',
    python_version: 'py3',
    digests: { sha256: 'test-digest' },
    ...overrides,
  };
}

function packageInfo(
  releases: Record<string, PyPIReleaseInfo[]>,
  requires_dist?: string[]
): Awaited<ReturnType<PackageInfoFetcher>> {
  return { info: { name: 'demo', version: '2.0', requires_dist }, releases };
}

function candidate(version = '1.0', name = 'demo'): Candidate {
  return {
    name,
    version,
    dependencies: [],
    installationCandidate: {
      name,
      version,
      filename: `${name}-${version}.tar.gz`,
      url: 'https://files.example.test/demo.tar.gz',
      packageType: 'sdist',
    },
  };
}

function requirementMap(...requirements: Requirement[]) {
  return new Map([['demo', requirements]]);
}

function preference(
  provider: PipProvider,
  requirements: Requirement[],
  identifier = 'demo'
): Preference {
  return provider.getPreference(
    identifier,
    new Map(),
    new Map(),
    new Map([[identifier, requirements.map((requirement) => ({ requirement, parent: null }))]]),
    []
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('PipProvider matching', () => {
  it('chooses one compatible artifact per release and returns versions newest first', async () => {
    const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(
      packageInfo({
        '1.0': [release('1.0')],
        '2.0': [
          release('2.0', 'demo-2.0.tar.gz'),
          release('2.0', 'demo-2.0-cp311-cp311-win_amd64.whl'),
        ],
        '3.0': [release('3.0', 'demo-3.0-cp312-cp312-win_amd64.whl')],
        '4.0': [],
      })
    );
    const provider = new PipProvider(config, fetcher);
    const matches = await provider.findMatches('demo', new Map(), new Map());
    expect(matches.map((item) => item.version)).toEqual(['2.0', '1.0']);
    expect(matches[0]).toMatchObject({
      name: 'demo',
      version: '2.0',
      dependencies: [],
      installationCandidate: {
        filename: 'demo-2.0-cp311-cp311-win_amd64.whl',
        hash: 'test-digest',
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('demo');
  });

  it('intersects all requirements, configured constraints, and backtracked incompatibilities', async () => {
    const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(
      packageInfo({
        '1.0': [release('1.0')],
        '1.5': [release('1.5')],
        '1.8': [release('1.8')],
        '1.9': [release('1.9')],
        '2.0': [release('2.0')],
      })
    );
    const provider = new PipProvider(
      { ...config, constraints: new Map([['demo', { versionSpec: '<=1.8' }]]) },
      fetcher
    );
    const matches = await provider.findMatches(
      'demo',
      requirementMap({ name: 'demo', versionSpec: '>=1.5' }, { name: 'demo', versionSpec: '<2.0' }),
      new Map([['demo', [candidate('1.8')]]])
    );
    expect(matches.map((item) => item.version)).toEqual(['1.5']);
  });

  it('re-filters cached releases when resolver requirements change without refetching', async () => {
    const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(
      packageInfo({
        '1.0': [release('1.0')],
        '2.0': [release('2.0')],
      })
    );
    const provider = new PipProvider(config, fetcher);
    const first = await provider.findMatches(
      'demo',
      requirementMap({ name: 'demo', versionSpec: '==1.0' }),
      new Map()
    );
    const second = await provider.findMatches(
      'demo',
      new Map(),
      new Map([['demo', [candidate('1.0')]]])
    );
    const all = await provider.findMatches('demo', new Map(), new Map());
    expect(first.map((item) => item.version)).toEqual(['1.0']);
    expect(second.map((item) => item.version)).toEqual(['2.0']);
    expect(all.map((item) => item.version)).toEqual(['2.0', '1.0']);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'propagates prerelease allowance to candidate selection: %s',
    async (allowPrerelease) => {
      const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(
        packageInfo({
          '1.0': [release('1.0')],
          '2.0rc1': [release('2.0rc1')],
        })
      );
      const matches = await new PipProvider({ ...config, allowPrerelease }, fetcher).findMatches(
        'demo',
        new Map(),
        new Map()
      );
      expect(matches.map((item) => item.version)).toEqual(
        allowPrerelease ? ['2.0rc1', '1.0'] : ['1.0']
      );
    }
  );

  it('returns an empty list for no usable releases and caches the empty result', async () => {
    const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(
      packageInfo({
        '1.0': [],
        '2.0': [release('2.0', undefined, { yanked: true })],
      })
    );
    const provider = new PipProvider(config, fetcher);
    await expect(provider.findMatches('demo', new Map(), new Map())).resolves.toEqual([]);
    await expect(provider.findMatches('demo', new Map(), new Map())).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not cache a registry failure and permits the next lookup to recover', async () => {
    const failure = new Error('registry offline');
    const fetcher = vi
      .fn<PackageInfoFetcher>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(packageInfo({ '1.0': [release('1.0')] }));
    const provider = new PipProvider(config, fetcher);
    await expect(provider.findMatches('demo', new Map(), new Map())).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith('패키지 정보 조회 실패: demo', failure);
    expect(
      (await provider.findMatches('demo', new Map(), new Map())).map((item) => item.version)
    ).toEqual(['1.0']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ name: 'Demo-Package' }, 'demo_package', '1.5', true],
    [{ name: 'Demo-Package', versionSpec: '>=1.0,<2.0' }, 'demo_package', '1.5', true],
    [{ name: 'Demo-Package', versionSpec: '>=2.0' }, 'demo_package', '1.5', false],
    [{ name: 'Demo-Package' }, 'different_package', '1.5', false],
  ] as Array<[Requirement, string, string, boolean]>)(
    'checks normalized names and version constraints: %j',
    (requirement, name, version, satisfied) => {
      const provider = new PipProvider(config, vi.fn<PackageInfoFetcher>());
      expect(provider.isSatisfiedBy(requirement, candidate(version, name))).toBe(satisfied);
      expect(provider.identify({ name: 'Demo-Package' })).toBe('demo_package');
    }
  );
});

describe('PipProvider dependency lookup', () => {
  it('parses names, extras and version ranges and filters target-platform and optional-extra markers', async () => {
    const fetcher = vi
      .fn<PackageInfoFetcher>()
      .mockResolvedValue(
        packageInfo({ '1.0': [release('1.0')] }, [
          'Requests-Security[tls, socks]>=2.0,<3.0',
          'win-helper; platform_system == "Windows"',
          'linux-helper; platform_system == "Linux"',
          'test-helper; extra == "test"',
          'plain-helper',
        ])
      );
    const provider = new PipProvider(config, fetcher);
    await expect(provider.getDependencies(candidate())).resolves.toEqual([
      {
        name: 'requests_security',
        extras: ['tls', 'socks'],
        versionSpec: '>=2.0,<3.0',
        marker: undefined,
      },
      {
        name: 'win_helper',
        extras: undefined,
        versionSpec: undefined,
        marker: 'platform_system == "Windows"',
      },
      { name: 'plain_helper', extras: undefined, versionSpec: undefined, marker: undefined },
    ]);
  });

  it.each([
    ['>=', '3.10', true],
    ['>=', '3.12', false],
    ['>', '3.10', true],
    ['>', '3.11', false],
    ['<=', '3.11', true],
    ['<=', '3.10', false],
    ['<', '3.12', true],
    ['<', '3.11', false],
    ['==', '3.11', true],
    ['==', '3.12', false],
    ['!=', '3.12', true],
    ['!=', '3.11', false],
  ])('evaluates Python 3.11 dependency marker %s %s', async (operator, version, included) => {
    const marker = `python_version ${operator} '${version}'`;
    const fetcher = vi
      .fn<PackageInfoFetcher>()
      .mockResolvedValue(packageInfo({ '1.0': [release('1.0')] }, [`compat-helper; ${marker}`]));
    const dependencies = await new PipProvider(config, fetcher).getDependencies(candidate());
    expect(dependencies).toEqual(
      included ? [{ name: 'compat_helper', versionSpec: undefined, extras: undefined, marker }] : []
    );
  });

  it('caches dependencies per package version instead of sharing results across versions', async () => {
    const fetcher = vi
      .fn<PackageInfoFetcher>()
      .mockResolvedValueOnce(packageInfo({ '1.0': [release('1.0')] }, ['old-dependency']))
      .mockResolvedValueOnce(packageInfo({ '2.0': [release('2.0')] }, ['new-dependency']));
    const provider = new PipProvider(config, fetcher);
    const first = await provider.getDependencies(candidate('1.0'));
    const cached = await provider.getDependencies(candidate('1.0'));
    const other = await provider.getDependencies(candidate('2.0'));
    expect(first.map((dependency) => dependency.name)).toEqual(['old_dependency']);
    expect(cached).toEqual(first);
    expect(other.map((dependency) => dependency.name)).toEqual(['new_dependency']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('ignoring dependencies performs no metadata requests', async () => {
    const fetcher = vi.fn<PackageInfoFetcher>();
    await expect(
      new PipProvider({ ...config, ignoreDependencies: true }, fetcher).getDependencies(candidate())
    ).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each<{ releases: Record<string, PyPIReleaseInfo[]> }>([
    { releases: {} },
    { releases: { '1.0': [] } },
    { releases: { '1.0': [release('1.0')] } },
  ])(
    'returns an empty dependency list for missing release or requires_dist: %j',
    async ({ releases }) => {
      const fetcher = vi.fn<PackageInfoFetcher>().mockResolvedValue(packageInfo(releases));
      await expect(new PipProvider(config, fetcher).getDependencies(candidate())).resolves.toEqual(
        []
      );
    }
  );

  it('does not cache failed dependency fetches, allowing a later retry', async () => {
    const error = new Error('metadata timed out');
    const fetcher = vi
      .fn<PackageInfoFetcher>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(packageInfo({ '1.0': [release('1.0')] }, ['dependency>=1.0']));
    const provider = new PipProvider(config, fetcher);
    await expect(provider.getDependencies(candidate())).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith('의존성 조회 실패: demo@1.0', error);
    expect(
      (await provider.getDependencies(candidate())).map((dependency) => dependency.name)
    ).toEqual(['dependency']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('PipProvider resolver priorities', () => {
  it('prioritizes Python requirements before backtracking causes', () => {
    const provider = new PipProvider(config, vi.fn<PackageInfoFetcher>());
    const causes: RequirementInformation[] = [
      { requirement: { name: 'demo' }, parent: candidate('1.0', 'parent') },
    ];
    expect(
      provider.narrowRequirementSelection(
        ['demo', '_python_requires', 'parent'],
        new Map(),
        new Map(),
        new Map(),
        causes
      )
    ).toEqual(['_python_requires']);
  });

  it('narrows to both backtracking requirement and parent while preserving identifier order', () => {
    const provider = new PipProvider(config, vi.fn<PackageInfoFetcher>());
    const causes: RequirementInformation[] = [
      { requirement: { name: 'demo' }, parent: candidate('1.0', 'parent') },
      { requirement: { name: 'missing' }, parent: null },
    ];
    expect(
      provider.narrowRequirementSelection(
        ['other', 'parent', 'demo'],
        new Map(),
        new Map(),
        new Map(),
        causes
      )
    ).toEqual(['parent', 'demo']);
    expect(
      provider.narrowRequirementSelection(['other'], new Map(), new Map(), new Map(), causes)
    ).toEqual(['other']);
    expect(provider.narrowRequirementSelection([], new Map(), new Map(), new Map(), [])).toEqual(
      []
    );
  });

  it.each([
    [[], [true, true, true, Infinity, true, 'demo']],
    [
      [{ name: 'demo', url: 'https://files.example.test/demo.whl' }],
      [false, true, true, 2, true, 'demo'],
    ],
    [[{ name: 'demo', versionSpec: '==1.0' }], [true, false, true, 2, false, 'demo']],
    [[{ name: 'demo', versionSpec: '==1.*' }], [true, true, false, 2, false, 'demo']],
    [[{ name: 'demo', versionSpec: '>=1.0,<2.0' }], [true, true, false, 2, false, 'demo']],
    [[{ name: 'demo', versionSpec: '~=1.4' }], [true, true, false, 2, false, 'demo']],
  ] as Array<[Requirement[], Preference]>)(
    'computes direct, pinned, bounded and user-order preferences: %j',
    (requirements, expected) => {
      const provider = new PipProvider(
        { ...config, userRequested: new Map([['demo', 2]]) },
        vi.fn<PackageInfoFetcher>()
      );
      expect(preference(provider, requirements)).toEqual(expected);
    }
  );

  it('compares the preference tuple lexicographically with stable ties and alphabetic fallback', () => {
    const provider = new PipProvider(config, vi.fn<PackageInfoFetcher>());
    const direct = preference(provider, [
      { name: 'demo', url: 'https://files.example.test/demo.whl' },
    ]);
    const pinned = preference(provider, [{ name: 'demo', versionSpec: '==1.0' }]);
    expect(provider.comparePreferences(direct, pinned)).toBe(-1);
    expect(provider.comparePreferences(pinned, direct)).toBe(1);
    expect(provider.comparePreferences(pinned, [...pinned])).toBe(0);
    expect(
      provider.comparePreferences(
        preference(provider, [], 'alpha'),
        preference(provider, [], 'zeta')
      )
    ).toBe(-1);
  });
});
