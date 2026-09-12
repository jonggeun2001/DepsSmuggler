import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerAuthClient } from './docker-auth-client';
import {
  AuthStrategyRegistry,
  CustomRegistryAuthStrategy,
  DockerHubAuthStrategy,
  ECRAuthStrategy,
  GHCRAuthStrategy,
  QuayAuthStrategy,
  defaultAuthStrategyRegistry,
  type RegistryAuthStrategy,
} from './docker-auth-strategies';
import { REGISTRY_CONFIGS, createCustomRegistryConfig, type RegistryType } from './docker-utils';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ default: { error: vi.fn(), debug: vi.fn() } }));

const get = vi.mocked(axios.get);

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Docker registry authentication strategies', () => {
  const providers = [
    {
      type: 'docker.io',
      strategy: new DockerHubAuthStrategy(),
      config: REGISTRY_CONFIGS['docker.io'],
      url: 'https://auth.docker.io/token',
    },
    {
      type: 'ghcr.io',
      strategy: new GHCRAuthStrategy(),
      config: REGISTRY_CONFIGS['ghcr.io'],
      url: 'https://ghcr.io/token',
    },
    {
      type: 'ecr',
      strategy: new ECRAuthStrategy(),
      config: REGISTRY_CONFIGS.ecr,
      url: 'https://public.ecr.aws/token',
    },
    {
      type: 'custom',
      strategy: new CustomRegistryAuthStrategy(),
      config: createCustomRegistryConfig('registry.example.test'),
      url: 'https://registry.example.test/v2/auth',
    },
  ] as const;

  it.each(providers)(
    '$type requests a pull-scoped token using its provider endpoint',
    async ({ strategy, config, url, type }) => {
      get.mockResolvedValue({ data: { token: 'pull-token', expires_in: 900 } });

      await expect(strategy.getToken(config, 'team/image')).resolves.toEqual({
        token: 'pull-token',
        expiresIn: 900,
      });
      expect(get).toHaveBeenCalledExactlyOnceWith(url, {
        params: { service: config.service, scope: 'repository:team/image:pull' },
      });
      expect(strategy.isApplicable(type)).toBe(true);
      expect(strategy.isApplicable('quay.io')).toBe(false);
    }
  );

  it.each(providers)(
    '$type uses an unscoped catalog request and default token lifetime',
    async ({ strategy, config }) => {
      get.mockResolvedValue({ data: { token: 'catalog-token' } });

      await expect(strategy.getToken(config, '')).resolves.toEqual({
        token: 'catalog-token',
        expiresIn: 300,
      });
      expect(get).toHaveBeenCalledWith(expect.any(String), {
        params: { service: config.service, scope: '' },
      });
    }
  );

  it.each(providers.slice(0, 3))(
    '$type propagates authentication rejection',
    async ({ strategy, config }) => {
      const denied = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
      get.mockRejectedValue(denied);

      await expect(strategy.getToken(config, 'team/private')).rejects.toBe(denied);
      expect(get).toHaveBeenCalledTimes(1);
    }
  );

  it('custom registries allow an anonymous fallback when token retrieval fails', async () => {
    get.mockRejectedValue(new Error('token endpoint unavailable'));

    await expect(
      new CustomRegistryAuthStrategy().getToken(
        createCustomRegistryConfig('registry.example.test'),
        'public/image'
      )
    ).resolves.toEqual({ token: '', expiresIn: 300 });
  });

  it('Quay discovers the token realm and service from a 401 challenge', async () => {
    get
      .mockResolvedValueOnce({
        headers: {
          'www-authenticate':
            'Bearer realm="https://auth.example.test/token",service="challenge-service"',
        },
      })
      .mockResolvedValueOnce({ data: { token: 'quay-token', expires_in: 600 } });
    const strategy = new QuayAuthStrategy();

    await expect(strategy.getToken(REGISTRY_CONFIGS['quay.io'], 'org/image')).resolves.toEqual({
      token: 'quay-token',
      expiresIn: 600,
    });
    const challengeOptions = get.mock.calls[0][1]!;
    expect(get.mock.calls[0][0]).toBe('https://quay.io/v2/');
    expect(challengeOptions.validateStatus!(401)).toBe(true);
    expect(challengeOptions.validateStatus!(200)).toBe(false);
    expect(get).toHaveBeenLastCalledWith('https://auth.example.test/token', {
      params: { service: 'challenge-service', scope: 'repository:org/image:pull' },
    });
    expect(strategy.isApplicable('quay.io')).toBe(true);
    expect(strategy.isApplicable('custom')).toBe(false);
  });

  it('Quay uses its configured service and default lifetime when the challenge omits them', async () => {
    get
      .mockResolvedValueOnce({
        headers: { 'www-authenticate': 'Bearer realm="https://auth.example.test/token"' },
      })
      .mockResolvedValueOnce({ data: { token: 'catalog-token' } });

    await expect(new QuayAuthStrategy().getToken(REGISTRY_CONFIGS['quay.io'], '')).resolves.toEqual(
      { token: 'catalog-token', expiresIn: 300 }
    );
    expect(get).toHaveBeenLastCalledWith('https://auth.example.test/token', {
      params: { service: 'quay.io', scope: '' },
    });
  });

  it.each([{}, { 'www-authenticate': 'Basic service="quay.io"' }])(
    'Quay falls back to anonymous access without a bearer realm: %j',
    async (headers) => {
      get.mockResolvedValue({ headers });
      await expect(
        new QuayAuthStrategy().getToken(REGISTRY_CONFIGS['quay.io'], 'public/image')
      ).resolves.toEqual({ token: '', expiresIn: 300 });
      expect(get).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['challenge', 'token'])(
    'Quay falls back to anonymous access after a failed %s request',
    async (stage) => {
      if (stage === 'token') {
        get.mockResolvedValueOnce({
          headers: { 'www-authenticate': 'Bearer realm="https://auth.example.test/token"' },
        });
      }
      get.mockRejectedValue(new Error('Access denied'));

      await expect(
        new QuayAuthStrategy().getToken(REGISTRY_CONFIGS['quay.io'], 'public/image')
      ).resolves.toEqual({ token: '', expiresIn: 300 });
      expect(get).toHaveBeenCalledTimes(stage === 'token' ? 2 : 1);
    }
  );

  it.each(providers)('$type forwards abort signal to its token request', async ({ strategy, config }) => {
    const controller = new AbortController();
    get.mockResolvedValue({ data: { token: 'pull-token', expires_in: 900 } });

    await strategy.getToken(config, 'team/image', { signal: controller.signal });

    expect(get.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it('Quay rethrows cancellation instead of anonymous fallback', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new QuayAuthStrategy().getToken(REGISTRY_CONFIGS['quay.io'], 'public/image', {
        signal: controller.signal,
      })
    ).rejects.toBeDefined();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ...providers.map(({ type, strategy, config }) => ({ type, strategy, config })),
    { type: 'quay.io', strategy: new QuayAuthStrategy(), config: REGISTRY_CONFIGS['quay.io'] },
  ])('$type rejects a pending token request when its signal aborts', async ({ type, strategy, config }) => {
    const controller = new AbortController();
    let calls = 0;
    get.mockImplementation((_url, options: { signal?: AbortSignal }) => {
      calls += 1;
      if (type === 'quay.io' && calls === 1) {
        return Promise.resolve({
          headers: { 'www-authenticate': 'Bearer realm="https://auth.example.test/token"' },
        });
      }
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
      });
    });
    const pending = strategy.getToken(config, 'team/image', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toThrow('request aborted');
    expect(get).toHaveBeenCalledTimes(type === 'quay.io' ? 2 : 1);
  });

  it('Quay aborts the pending initial challenge without anonymous fallback', async () => {
    const controller = new AbortController();
    get
      .mockImplementationOnce((_url, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('challenge aborted')), { once: true });
      }));
    const pending = new QuayAuthStrategy().getToken(REGISTRY_CONFIGS['quay.io'], 'team/image', {
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toThrow('challenge aborted');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('selects each built-in strategy and gives newly registered strategies priority', () => {
    const registry = new AuthStrategyRegistry();
    for (const type of ['docker.io', 'ghcr.io', 'ecr', 'quay.io', 'custom'] as RegistryType[]) {
      expect(registry.getStrategy(type).isApplicable(type)).toBe(true);
    }
    const override: RegistryAuthStrategy = {
      isApplicable: (type) => type === 'docker.io',
      getToken: vi.fn(),
    };
    registry.registerStrategy(override);

    expect(registry.getStrategy('docker.io')).toBe(override);
    expect(registry.getStrategies()[0]).toBe(override);
    expect(defaultAuthStrategyRegistry.getStrategies()).not.toContain(override);
    expect(() => new AuthStrategyRegistry([]).getStrategy('custom')).toThrow(
      'No auth strategy found for registry type: custom'
    );
  });
});

describe('DockerAuthClient token lifecycle', () => {
  function setup() {
    const getToken = vi
      .fn<RegistryAuthStrategy['getToken']>()
      .mockResolvedValue({ token: 'cached-token', expiresIn: 300 });
    const registry = new AuthStrategyRegistry([{ isApplicable: () => true, getToken }]);
    return { client: new DockerAuthClient(registry), registry, getToken };
  }

  it('reuses tokens until the refresh-buffer boundary, then obtains a fresh token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { client, getToken } = setup();
    await expect(client.getToken('library/nginx')).resolves.toBe('cached-token');
    vi.advanceTimersByTime(239_999);
    await expect(client.getToken('library/nginx')).resolves.toBe('cached-token');
    expect(getToken).toHaveBeenCalledTimes(1);

    getToken.mockResolvedValueOnce({ token: 'refreshed-token', expiresIn: 300 });
    vi.advanceTimersByTime(1);
    await expect(client.getToken('library/nginx')).resolves.toBe('refreshed-token');
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith(REGISTRY_CONFIGS['docker.io'], 'library/nginx');
  });

  it('separates repositories and registries and invalidates only the requested registry', async () => {
    const { client, getToken } = setup();
    await client.getTokenForRegistry('docker.io', 'team/one');
    await client.getTokenForRegistry('docker.io', 'team/two');
    await client.getTokenForRegistry('ghcr.io', 'team/one');
    client.clearTokenCacheForRegistry('docker.io');
    await client.getTokenForRegistry('ghcr.io', 'team/one');
    expect(getToken).toHaveBeenCalledTimes(3);

    await client.getTokenForRegistry('docker.io', 'team/one');
    await client.getTokenForRegistry('docker.io', 'team/two');
    expect(getToken).toHaveBeenCalledTimes(5);
    client.clearTokenCache();
    await client.getTokenForRegistry('ghcr.io', 'team/one');
    expect(getToken).toHaveBeenCalledTimes(6);
  });

  it('caches anonymous tokens and immediately refreshes tokens shorter than the buffer', async () => {
    const { client, getToken } = setup();
    getToken.mockResolvedValue({ token: '', expiresIn: 300 });
    await client.getToken('library/nginx');
    await expect(client.getToken('library/nginx')).resolves.toBe('');
    expect(getToken).toHaveBeenCalledTimes(1);

    client.clearTokenCache();
    getToken.mockResolvedValue({ token: 'short-lived', expiresIn: 30 });
    await client.getToken('library/nginx');
    await client.getToken('library/nginx');
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('preserves the original auth failure and retries a later call without caching it', async () => {
    const { client, getToken } = setup();
    const denied = new Error('forbidden');
    getToken.mockRejectedValueOnce(denied);
    await expect(client.getToken('library/nginx')).rejects.toBe(denied);
    await expect(client.getToken('library/nginx')).resolves.toBe('cached-token');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('normalizes custom registry URLs, reuses configurations, and rejects malformed URLs', async () => {
    const { client, registry, getToken } = setup();
    const config = client.getRegistryConfig('http://localhost:5000/v2/');
    expect(config).toEqual({
      authUrl: 'http://localhost:5000/v2/auth',
      registryUrl: 'http://localhost:5000/v2',
      service: 'localhost',
    });
    expect(client.getRegistryConfig('http://localhost:5000/v2/')).toBe(config);
    expect(client.getRegistryConfig('registry-1.docker.io')).toBe(REGISTRY_CONFIGS['docker.io']);
    expect(client.getStrategyRegistry()).toBe(registry);
    expect(new DockerAuthClient().getStrategyRegistry()).toBe(defaultAuthStrategyRegistry);
    await expect(client.getTokenForRegistry('http://[invalid', 'image')).rejects.toThrow();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('does not return a cached token when the control signal is already aborted', async () => {
    const { client } = setup();
    await client.getToken('library/nginx');
    const controller = new AbortController();
    controller.abort();

    await expect(client.getToken('library/nginx', { signal: controller.signal })).rejects.toBeDefined();
  });

  it('waits before caching and returning a token while paused, then resumes normally', async () => {
    const { client, getToken } = setup();
    let paused = false;
    let pauseAfterStrategy = false;
    getToken.mockImplementation(async () => {
      pauseAfterStrategy = true;
      return { token: 'resumed-token', expiresIn: 300 };
    });

    const pending = client.getToken('library/paused', { shouldPause: () => paused || pauseAfterStrategy });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(getToken).toHaveBeenCalledTimes(1);
    let settled = false;
    void pending.finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toBe(false);
    expect(Reflect.get(client, 'tokenCache').size).toBe(0);
    pauseAfterStrategy = false;
    await expect(pending).resolves.toBe('resumed-token');
    await expect(client.getToken('library/paused')).resolves.toBe('resumed-token');
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});
