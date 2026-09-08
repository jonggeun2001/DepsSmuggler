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

const isSameCartItem = (item: CartItem, candidate: CartItemIdentity): boolean => {
  if (
    item.type !== candidate.type ||
    item.name !== candidate.name ||
    item.version !== candidate.version
  ) {
    return false;
  }

  return item.type !== 'maven' ||
    getMavenArtifactType(item.metadata) === getMavenArtifactType(candidate.metadata);
};

// 장바구니 상태
interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
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
        const state = get();
        // 중복 체크
        if (state.hasItem(item.type, item.name, item.version, item.metadata)) {
          return;
        }

        set((state) => ({
          items: [
            ...state.items,
            {
              ...item,
              id: generateId(),
              addedAt: Date.now(),
            },
          ],
        }));
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
        return get().items.some((item) =>
          isSameCartItem(item, { type, name, version, metadata })
        );
      },
    }),
    {
      name: 'depssmuggler-cart',
    }
  )
);
