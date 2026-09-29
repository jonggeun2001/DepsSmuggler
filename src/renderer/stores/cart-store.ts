import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 패키지 타입
export type PackageType = 'pip' | 'conda' | 'maven' | 'npm' | 'yum' | 'apt' | 'apk' | 'docker';

// 아키텍처 타입 (Docker: arm/v7, 386 포함)
export type Architecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'i386' | 'i686' | 'noarch' | 'all' | 'arm/v7' | '386';

// 장바구니 아이템
export interface CartItem {
  id: string;
  type: PackageType;
  name: string;
  version: string;
  arch?: Architecture;
  languageVersion?: string;  // 언어/런타임 버전 (예: Python 3.11, Java 17)
  metadata?: Record<string, unknown>;
  addedAt: number;
  // OS 패키지용 추가 필드
  downloadUrl?: string;
  repository?: { baseUrl: string; name?: string };
  location?: string;
  // pip 커스텀 인덱스 URL
  indexUrl?: string;
  // pip extras 의존성 (예: ['cuda'], ['security', 'socks'])
  extras?: string[];
  // Maven classifier (예: natives-linux, natives-windows)
  classifier?: string;
}

type CartItemIdentity = Pick<CartItem, 'type' | 'name' | 'version' | 'metadata'>;

const getMavenArtifactType = (metadata?: Record<string, unknown>): string => {
  const artifactType = metadata?.type;
  return typeof artifactType === 'string' && artifactType.trim() !== ''
    ? artifactType
    : 'jar';
};

// 장바구니 동일성은 다운로드 아티팩트 키와 다르다. 옵션을 추가로 비교하지 않는다.
const getCartIdentityKey = (item: CartItemIdentity): string =>
  JSON.stringify([
    item.type,
    item.name,
    item.version,
    item.type === 'maven' ? getMavenArtifactType(item.metadata) : null,
  ]);

// 장바구니 상태
interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
  addItems: (items: ReadonlyArray<Omit<CartItem, 'id' | 'addedAt'>>) => number;
  removeItem: (id: string) => void;
  clearCart: () => void;
  hasItem: (
    type: PackageType,
    name: string,
    version: string,
    metadata?: Record<string, unknown>
  ) => boolean;
}

// 고유 ID 생성
const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        get().addItems([item]);
      },

      addItems: (items) => {
        if (items.length === 0) return 0;
        const existing = get().items;
        const seen = new Set(existing.map(getCartIdentityKey));
        const added: CartItem[] = [];
        for (const item of items) {
          const key = getCartIdentityKey(item);
          if (seen.has(key)) continue;
          seen.add(key);
          added.push({ ...item, id: generateId(), addedAt: Date.now() });
        }
        if (added.length > 0) set({ items: [...existing, ...added] });
        return added.length;
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        }));
      },

      clearCart: () => {
        set({ items: [] });
      },

      hasItem: (type, name, version, metadata) => {
        const key = getCartIdentityKey({ type, name, version, metadata });
        return get().items.some((item) => getCartIdentityKey(item) === key);
      },
    }),
    {
      name: 'depssmuggler-cart',
    }
  )
);
