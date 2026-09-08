import { beforeEach, describe, expect, it, vi } from 'vitest';

type StorageMock = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

const createStorageMock = (): StorageMock => {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
};

const loadCartStore = async () => {
  vi.resetModules();
  const localStorage = createStorageMock();
  vi.stubGlobal('localStorage', localStorage);

  const module = await import('./cart-store');
  module.useCartStore.setState({ items: [] });
  await module.useCartStore.persist.clearStorage();

  return {
    localStorage,
    useCartStore: module.useCartStore,
  };
};

describe('cart-store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('addItem은 같은 type/name/version 조합의 중복 추가를 막는다', async () => {
    const { useCartStore } = await loadCartStore();

    useCartStore.getState().addItem({
      type: 'pip',
      name: 'requests',
      version: '2.32.0',
    });
    useCartStore.getState().addItem({
      type: 'pip',
      name: 'requests',
      version: '2.32.0',
    });

    expect(useCartStore.getState().items).toHaveLength(1);
    expect(useCartStore.getState().items[0]).toEqual(
      expect.objectContaining({
        type: 'pip',
        name: 'requests',
        version: '2.32.0',
      })
    );
  });

  it('Maven은 같은 GAV여도 artifact type이 다르면 별도 항목으로 보관한다', async () => {
    const { useCartStore } = await loadCartStore();

    useCartStore.getState().addItem({
      type: 'maven',
      name: 'org.apache.flink:flink-metrics',
      version: '1.20.5',
    });
    useCartStore.getState().addItem({
      type: 'maven',
      name: 'org.apache.flink:flink-metrics',
      version: '1.20.5',
      metadata: { type: 'pom' },
    });
    useCartStore.getState().addItem({
      type: 'maven',
      name: 'org.apache.flink:flink-metrics',
      version: '1.20.5',
      metadata: { type: 'pom' },
    });

    const items = useCartStore.getState().items;

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.metadata?.type ?? 'jar').sort()).toEqual([
      'jar',
      'pom',
    ]);
  });

  it('removeItem은 지정한 항목만 제거한다', async () => {
    const { useCartStore } = await loadCartStore();

    useCartStore.getState().addItem({
      type: 'pip',
      name: 'requests',
      version: '2.32.0',
    });
    useCartStore.getState().addItem({
      type: 'npm',
      name: 'vite',
      version: '7.3.2',
    });

    const [firstItem, secondItem] = useCartStore.getState().items;
    useCartStore.getState().removeItem(firstItem.id);

    expect(useCartStore.getState().items).toEqual([secondItem]);
  });

  it('clearCart는 전체 항목을 비운다', async () => {
    const { useCartStore } = await loadCartStore();

    useCartStore.getState().addItem({
      type: 'pip',
      name: 'requests',
      version: '2.32.0',
    });
    useCartStore.getState().addItem({
      type: 'apt',
      name: 'curl',
      version: '8.5.0',
    });

    useCartStore.getState().clearCart();

    expect(useCartStore.getState().items).toEqual([]);
  });
});
