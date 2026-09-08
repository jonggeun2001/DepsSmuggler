import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  convertToSearchResults,
  createResolverFactory,
  groupPackagesByName,
  matchPackagesByQuery,
  searchPackagesCommon,
  sortVersionsDescending,
  type DependencyResolverOptions,
} from './os-resolver-utils';
import type { OSPackageInfo } from '../downloaders/os-shared/types';
import * as versionUtils from '../shared/version-utils';

function pkg(name: string, version = '1.0'): OSPackageInfo {
  return {
    name,
    version,
    architecture: 'amd64',
    size: 100,
    location: `${name}.deb`,
    dependencies: [],
    checksum: { type: 'sha256', value: 'checksum' },
    repository: {
      id: 'main',
      name: 'Main',
      baseUrl: 'https://example.test',
      enabled: true,
      gpgCheck: false,
      isOfficial: true,
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('OS resolver search helpers', () => {
  const packages = [
    pkg('libfoo'),
    pkg('libfoo-dev'),
    pkg('libbar'),
    pkg('other-libfoo'),
    pkg('foo'),
  ];

  it('distinguishes exact names from the default partial search', () => {
    expect(matchPackagesByQuery(packages, 'libfoo', 'exact')).toEqual([packages[0]]);
    expect(matchPackagesByQuery(packages, 'libfoo')).toEqual([
      packages[0],
      packages[1],
      packages[3],
    ]);
    expect(matchPackagesByQuery(packages, 'LIBFOO')).toEqual([]);
  });

  it.each([
    { query: 'lib*', expected: ['libfoo', 'libfoo-dev', 'libbar'] },
    { query: '*foo', expected: ['libfoo', 'other-libfoo', 'foo'] },
    { query: 'lib???', expected: ['libfoo', 'libbar'] },
    { query: 'lib??', expected: [] },
  ])('supports anchored glob search for $query', ({ query, expected }) => {
    expect(matchPackagesByQuery(packages, query, 'wildcard').map((result) => result.name)).toEqual(
      expected
    );
  });

  it('returns empty results for absent packages and handles an empty catalog', () => {
    expect(searchPackagesCommon(packages, 'missing')).toEqual([]);
    expect(searchPackagesCommon([], '')).toEqual([]);
    expect(groupPackagesByName([])).toEqual(new Map());
    expect(convertToSearchResults(new Map())).toEqual([]);
    expect(sortVersionsDescending([])).toEqual([]);
  });

  it('groups versions by package name, sorts names and versions, and preserves the input arrays', () => {
    const input = [
      pkg('zlib', '1.9'),
      pkg('alpha', '2.0'),
      pkg('zlib', '1.10'),
      pkg('zlib', '2.0'),
    ];
    const original = [...input];
    const grouped = groupPackagesByName(input);
    expect(grouped.get('zlib')).toEqual([input[0], input[2], input[3]]);

    const results = convertToSearchResults(grouped);
    expect(results.map((result) => result.name)).toEqual(['alpha', 'zlib']);
    expect(results[1]).toEqual({
      name: 'zlib',
      versions: [input[3], input[2], input[0]],
      latest: input[3],
    });
    expect(input).toEqual(original);
    expect(grouped.get('zlib')).toEqual([input[0], input[2], input[3]]);
    expect(searchPackagesCommon(input, 'zlib', 'exact')).toEqual([results[1]]);
  });

  it('falls back to lexical version ordering when the shared comparator cannot compare a pair', () => {
    vi.spyOn(versionUtils, 'compareVersions').mockImplementation(() => {
      throw new Error('unrecognized version format');
    });
    const older = pkg('pkg', 'a-custom');
    const newer = pkg('pkg', 'z-custom');
    expect(sortVersionsDescending([older, newer])).toEqual([newer, older]);
  });

  it('normalizes an empty version before invoking the shared comparator', () => {
    const compare = vi.spyOn(versionUtils, 'compareVersions');
    const empty = pkg('pkg', '');
    const versioned = pkg('pkg', '1.0');
    expect(sortVersionsDescending([empty, versioned])).toEqual([versioned, empty]);
    expect(compare).toHaveBeenCalledWith('', '1.0');
  });
});

describe('createResolverFactory', () => {
  class Resolver {
    constructor(readonly options: DependencyResolverOptions) {}
  }

  function options(): DependencyResolverOptions {
    const repository = pkg('example').repository;
    return {
      distribution: {
        id: 'ubuntu-22.04',
        name: 'Ubuntu',
        version: '22.04',
        packageManager: 'apt',
        architectures: ['amd64', 'arm64'],
        defaultRepos: [repository],
        extendedRepos: [],
      },
      architecture: 'amd64',
      repositories: [repository],
      includeOptional: false,
      includeRecommends: false,
    };
  }

  it('requires options and recovers on the next valid request', () => {
    const create = createResolverFactory(Resolver, 'APT resolver');
    expect(() => create()).toThrow('APT resolver requires DependencyResolverOptions');
    const opts = options();
    expect(create(opts).options).toBe(opts);
  });

  it('reuses an instance for equivalent options and keeps distinct factories isolated', () => {
    const firstFactory = createResolverFactory(Resolver, 'APT');
    const secondFactory = createResolverFactory(Resolver, 'APT');
    const opts = options();
    const first = firstFactory(opts);
    expect(
      firstFactory({
        ...opts,
        distribution: { ...opts.distribution },
        repositories: [...opts.repositories],
      })
    ).toBe(first);
    expect(secondFactory(opts)).not.toBe(first);
  });

  it.each([
    {
      field: 'distribution',
      change: (opts: DependencyResolverOptions) => ({
        ...opts,
        distribution: { ...opts.distribution, id: 'ubuntu-24.04' },
      }),
    },
    {
      field: 'architecture',
      change: (opts: DependencyResolverOptions) => ({ ...opts, architecture: 'arm64' as const }),
    },
    {
      field: 'includeOptional',
      change: (opts: DependencyResolverOptions) => ({ ...opts, includeOptional: true }),
    },
    {
      field: 'includeRecommends',
      change: (opts: DependencyResolverOptions) => ({ ...opts, includeRecommends: true }),
    },
    {
      field: 'repositories',
      change: (opts: DependencyResolverOptions) => ({
        ...opts,
        repositories: [{ ...opts.repositories[0], id: 'universe' }],
      }),
    },
  ])('creates and caches a fresh resolver when $field changes', ({ change }) => {
    const create = createResolverFactory(Resolver, 'APT');
    const opts = options();
    const first = create(opts);
    const changed = change(opts);
    const second = create(changed);
    expect(second).not.toBe(first);
    expect(second.options).toBe(changed);
    expect(create(changed)).toBe(second);
  });

  it.each(['abortSignal', 'onProgress'] as const)(
    'isolates request-specific %s without replacing the reusable instance',
    (field) => {
      const create = createResolverFactory(Resolver, 'APT');
      const opts = options();
      const cached = create(opts);
      const requestOptions = {
        ...opts,
        [field]: field === 'abortSignal' ? new AbortController().signal : vi.fn(),
      };
      const firstRequest = create(requestOptions);
      const secondRequest = create(requestOptions);
      expect(firstRequest).not.toBe(cached);
      expect(secondRequest).not.toBe(firstRequest);
      expect(firstRequest.options).toBe(requestOptions);
      expect(create(opts)).toBe(cached);
    }
  );

  it('does not cache a failed constructor', () => {
    const construct = vi.fn().mockImplementationOnce(() => {
      throw new Error('metadata initialization failed');
    });
    class FallibleResolver {
      constructor(_options: DependencyResolverOptions) {
        construct();
      }
    }
    const create = createResolverFactory(FallibleResolver, 'APT');
    const opts = options();
    expect(() => create(opts)).toThrow('metadata initialization failed');
    const resolved = create(opts);
    expect(create(opts)).toBe(resolved);
    expect(construct).toHaveBeenCalledTimes(2);
  });
});

const packages = ['libssl', 'libxml', 'curl', 'libssl'].map((name) => ({ name }) as OSPackageInfo);

describe('OS package query matching', () => {
  it('검색 모드별 순서와 중복을 유지한다', () => {
    expect(matchPackagesByQuery(packages, 'libssl', 'exact')).toEqual([packages[0], packages[3]]);
    expect(matchPackagesByQuery(packages, 'lib', 'partial')).toEqual([
      packages[0],
      packages[1],
      packages[3],
    ]);
    expect(matchPackagesByQuery(packages, 'lib???', 'wildcard')).toEqual([
      packages[0],
      packages[1],
      packages[3],
    ]);
    expect(matchPackagesByQuery(packages, 'lib(ssl|xml)', 'wildcard')).toEqual([
      packages[0],
      packages[1],
      packages[3],
    ]);
  });

  it('빈 목록에서는 잘못된 패턴도 평가하지 않고, 후보가 있으면 기존 오류를 유지한다', () => {
    expect(matchPackagesByQuery([], '[', 'wildcard')).toEqual([]);
    expect(() => matchPackagesByQuery(packages, '[', 'wildcard')).toThrow(SyntaxError);
  });

  it('와일드카드 정규식은 검색당 한 번만 생성한다', () => {
    const OriginalRegExp = RegExp;
    const constructor = vi.fn(function (pattern: string, flags?: string) {
      return new OriginalRegExp(pattern, flags);
    });
    vi.stubGlobal('RegExp', constructor);
    try {
      matchPackagesByQuery(packages, 'lib*', 'wildcard');
      expect(constructor).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
