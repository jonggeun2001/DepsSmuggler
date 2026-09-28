import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from './cart-store';

type Input = Omit<CartItem, 'id' | 'addedAt'>;
const loadStore = async () => {
  vi.resetModules();
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  vi.stubGlobal('localStorage', storage);
  const { useCartStore: store } = await import('./cart-store');
  const notified = vi.fn();
  store.subscribe(notified);
  storage.setItem.mockClear();
  return { store, storage, notified };
};

afterEach(() => vi.unstubAllGlobals());

describe('cart bulk add', () => {
  it('신규 2,000개를 순서대로 한 번만 알리고 저장하며 실제 추가 수를 반환한다', async () => {
    const { store, storage, notified } = await loadStore();
    const inputs: Input[] = Array.from({ length: 2000 }, (_, i) => ({
      type: 'npm',
      name: `package-${i}`,
      version: '1.0.0',
    }));
    expect(store.getState().addItems(inputs)).toBe(2000);
    const items = store.getState().items;
    expect(items.map(({ name }) => name)).toEqual(inputs.map(({ name }) => name));
    expect(new Set(items.map(({ id }) => id)).size).toBe(2000);
    expect(items.every(({ addedAt }) => addedAt > 0)).toBe(true);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, serialized] = storage.setItem.mock.calls[0];
    expect(key).toBe('depssmuggler-cart');
    expect(JSON.parse(serialized).state.items).toEqual(items);

    notified.mockClear();
    storage.setItem.mockClear();
    const state = store.getState();
    expect(state.addItems([])).toBe(0);
    expect(state.addItems(inputs)).toBe(0);
    expect(state.addItem(inputs[0])).toBeUndefined();
    expect(store.getState()).toBe(state);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
  });

  it('기존 항목과 입력 내 최초 항목의 ID·순서·옵션을 유지하고 뒤 옵션을 병합하지 않는다', async () => {
    const { store, storage } = await loadStore();
    const first: Input = {
      type: 'pip',
      name: 'requests',
      version: '1',
      arch: 'arm64',
      languageVersion: '3.11',
      extras: ['security'],
      indexUrl: 'https://first.example/simple',
      repository: { baseUrl: 'https://first.example' },
      location: 'first',
      downloadUrl: 'first',
      metadata: { source: 'first' },
      classifier: 'first',
    };
    store.getState().addItem(first);
    const existing = store.getState().items[0];
    const next: Input = { ...first, name: 'new', extras: ['first'], metadata: { first: true } };
    const later: Input = {
      ...first,
      arch: 'x86_64',
      languageVersion: '3.12',
      extras: ['later'],
      indexUrl: 'https://later.example',
      repository: { baseUrl: 'https://later.example' },
      location: 'later',
      downloadUrl: 'later',
      metadata: { later: true },
      classifier: 'later',
    };
    storage.setItem.mockClear();
    expect(store.getState().addItems([later, next, { ...later, name: 'new' }])).toBe(1);
    const items = store.getState().items;
    expect(items[0]).toBe(existing);
    expect(items[0]).toMatchObject(first);
    expect(items[1]).toMatchObject(next);
    expect(items[1].metadata).toEqual({ first: true });
    expect(items.map(({ name }) => name)).toEqual(['requests', 'new']);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('Maven type의 기본 jar, 원문 문자열, JAR/POM 구분과 무시하는 classifier를 보존한다', async () => {
    const { store } = await loadStore();
    const base: Input = { type: 'maven', name: 'org.example:artifact', version: '1' };
    expect(
      store.getState().addItems([
        base,
        ...[undefined, null, 0, '', ' ', '\t', 'jar'].map((type) => ({
          ...base,
          metadata: { type },
        })),
        { ...base, metadata: { type: 'pom' }, classifier: 'first' },
        { ...base, metadata: { type: 'pom' }, classifier: 'later' },
        { ...base, metadata: { type: ' pom ' } },
        { ...base, metadata: { type: 'JAR' } },
      ])
    ).toBe(4);
    expect(store.getState().items.map(({ metadata }) => metadata?.type)).toEqual([
      undefined,
      'pom',
      ' pom ',
      'JAR',
    ]);
    expect(store.getState().items[1].classifier).toBe('first');
    for (const type of [undefined, null, 0, '', ' ', 'jar', 'pom', ' pom ', 'JAR']) {
      expect(store.getState().hasItem(base.type, base.name, base.version, { type })).toBe(true);
    }
    expect(store.getState().hasItem(base.type, base.name, base.version, { type: 'war' })).toBe(
      false
    );
  });

  it('type·이름 대소문자·버전은 구분하고 구분자 문자가 들어가도 키가 충돌하지 않는다', async () => {
    const { store } = await loadStore();
    const inputs: Input[] = [
      { type: 'npm', name: 'name', version: '1' },
      { type: 'pip', name: 'name', version: '1' },
      { type: 'npm', name: 'Name', version: '1' },
      { type: 'npm', name: 'name', version: '2' },
      { type: 'npm', name: 'a|b', version: 'c' },
      { type: 'npm', name: 'a', version: 'b|c' },
    ];
    expect(store.getState().addItems(inputs)).toBe(6);
    expect(
      store.getState().addItems(inputs.map((item) => ({ ...item, metadata: { type: 'pom' } })))
    ).toBe(0);
    for (const item of inputs)
      expect(store.getState().hasItem(item.type, item.name, item.version)).toBe(true);
    expect(store.getState().hasItem('npm', 'NAME', '1')).toBe(false);
  });
});
