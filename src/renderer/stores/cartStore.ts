import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 패키지 타입
export type PackageType = 'pip' | 'conda' | 'maven' | 'gradle' | 'npm' | 'yum' | 'apt' | 'apk' | 'docker';

// 아키텍처 타입
export type Architecture = 'x86_64' | 'amd64' | 'arm64' | 'aarch64' | 'i386' | 'i686' | 'noarch' | 'all';

// 장바구니 아이템
export interface CartItem {
  id: string;
  type: PackageType;
  name: string;
  version: string;
  arch?: Architecture;
  metadata?: Record<string, unknown>;
  addedAt: number;
}

// 장바구니 상태
interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'id' | 'addedAt'>) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  hasItem: (type: PackageType, name: string, version: string) => boolean;
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
        if (state.hasItem(item.type, item.name, item.version)) {
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

      hasItem: (type, name, version) => {
        return get().items.some(
          (item) =>
            item.type === type && item.name === name && item.version === version
        );
      },
    }),
    {
      name: 'depssmuggler-cart',
    }
  )
);
