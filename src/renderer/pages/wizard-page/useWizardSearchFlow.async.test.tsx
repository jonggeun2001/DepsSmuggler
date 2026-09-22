// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWizardSearchFlow } from './useWizardSearchFlow';
import type { WizardSearchContext } from './search-service';
import { createRendererDataClient, getRendererDataClient } from '../../lib/renderer-data-client';

vi.mock('../../lib/renderer-data-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/renderer-data-client')>()),
  getRendererDataClient: vi.fn(),
}));
const context: WizardSearchContext = {
  packageType: 'maven',
  condaChannel: 'conda-forge',
  dockerRegistry: 'docker.io',
  customRegistryUrl: '',
  useCustomIndex: false,
  customIndexUrl: '',
  yumDistribution: { id: 'rocky-9', architecture: 'x86_64' },
  aptDistribution: { id: 'ubuntu-24.04', architecture: 'amd64' },
  apkDistribution: { id: 'alpine-3.20', architecture: 'x86_64' },
};
const record = { name: 'com.amazon.deequ:deequ', version: '3.0.3-spark3.5', description: '' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const packages = vi.fn();
const versions = vi.fn();
const notifier = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
function mount() {
  return renderHook(
    ({ searchContext }) =>
      useWizardSearchFlow({
        packageType: searchContext.packageType,
        searchContext,
        notifier,
        setCurrentStep: vi.fn(),
      }),
    { initialProps: { searchContext: context } }
  );
}
async function debounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  packages.mockReset().mockResolvedValue({ results: [] });
  versions.mockReset().mockResolvedValue({ versions: ['3.0.3-spark3.5'] });
  vi.mocked(getRendererDataClient).mockReturnValue(
    createRendererDataClient({
      electronAPI: { search: { packages, versions } },
    })
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('automatic wizard search', () => {
  it('debounces input, exposes IPC failure once, retries and distinguishes empty success', async () => {
    packages.mockResolvedValueOnce({ results: [], error: { code: 'TLS_CERTIFICATE' } });
    const { result } = mount();
    act(() => {
      result.current.handleInputChange('de');
      result.current.handleInputChange('deequ');
    });
    expect(packages).not.toHaveBeenCalled();
    await debounce();
    expect(packages).toHaveBeenCalledTimes(1);
    expect(result.current.searchError?.code).toBe('TLS_CERTIFICATE');
    expect(result.current.searchEmpty).toBe(false);
    expect(result.current.searching).toBe(false);
    await act(() => result.current.handleSearch(result.current.searchQuery));
    expect(packages).toHaveBeenCalledTimes(2);
    expect(result.current.searchError).toBeNull();
    expect(result.current.searchEmpty).toBe(true);
    expect(notifier.error).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an old %s as soon as input changes, before next debounce',
    async (completion) => {
      const old = deferred<{ results: (typeof record)[] }>();
      packages.mockReturnValueOnce(old.promise);
      const { result } = mount();
      act(() => result.current.handleInputChange('old'));
      await debounce();
      act(() => result.current.handleInputChange('new'));
      await act(async () => {
        if (completion === 'resolve') old.resolve({ results: [record] });
        else old.reject(new Error('ECONNRESET'));
      });
      expect(result.current.suggestions).toEqual([]);
      expect(result.current.searchError).toBeNull();
      expect(result.current.searchEmpty).toBe(false);
      await debounce();
      expect(result.current.searchEmpty).toBe(true);
    }
  );

  it.each(['clear', 'reset', 'context'] as const)(
    'invalidates in-flight work on %s',
    async (change) => {
      const old = deferred<{ results: (typeof record)[] }>();
      packages.mockReturnValueOnce(old.promise);
      const { result, rerender } = mount();
      act(() => result.current.handleInputChange('deequ'));
      await debounce();
      if (change === 'context') rerender({ searchContext: { ...context, packageType: 'npm' } });
      else
        act(() =>
          change === 'clear' ? result.current.handleInputChange('') : result.current.resetSearch()
        );
      await act(async () => old.reject(new Error('ETIMEDOUT')));
      expect(result.current.searchQuery).toBe('');
      expect(result.current.searchError).toBeNull();
      expect(result.current.searching).toBe(false);
    }
  );

  it('manual Enter cancels scheduled debounce and unmount cancels scheduled input', async () => {
    const { result, unmount } = mount();
    act(() => result.current.handleInputChange('deequ'));
    await act(() => result.current.handleSearch('deequ'));
    await debounce();
    expect(packages).toHaveBeenCalledTimes(1);
    act(() => result.current.handleInputChange('spring'));
    unmount();
    await debounce();
    expect(packages).toHaveBeenCalledTimes(1);
  });

  it('keeps fallback versions with a visible failure and recovers on retry', async () => {
    versions.mockResolvedValueOnce({ versions: [], error: { code: 'TIMEOUT' } });
    const { result } = mount();
    await act(() => result.current.handleSelectPackage(record));
    expect(result.current.versionError?.code).toBe('TIMEOUT');
    expect(result.current.availableVersions).toEqual([record.version]);
    await act(() => result.current.handleSelectPackage(record));
    expect(result.current.versionError).toBeNull();
    expect(result.current.loadingVersions).toBe(false);
  });

  it('ignores late version failures after selecting another package', async () => {
    const old = deferred<{ versions: string[] }>();
    versions.mockReturnValueOnce(old.promise);
    const { result } = mount();
    let oldRequest!: Promise<void>;
    act(() => {
      oldRequest = result.current.handleSelectPackage(record);
    });
    await act(() => result.current.handleSelectPackage({ ...record, name: 'g:other' }));
    await act(async () => {
      old.reject(new Error('ETIMEDOUT'));
      await oldRequest;
    });
    expect(result.current.selectedPackage?.name).toBe('g:other');
    expect(result.current.versionError).toBeNull();
    expect(result.current.loadingVersions).toBe(false);
  });
});
