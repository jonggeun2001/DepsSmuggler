import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LINUX_DISTRO_GLIBC_MAP,
  getDistrosByFamily,
  getDistrosByGlibcVersion,
  isDistroEOL,
  isDistroEOLSoon,
  GLIBC_VERSION_MAP
} from './platform-mappings';

describe('platform-mappings', () => {
  describe('LINUX_DISTRO_GLIBC_MAP', () => {
    it('모든 배포판이 필수 필드를 가져야 함', () => {
      Object.entries(LINUX_DISTRO_GLIBC_MAP).forEach(([id, distro]) => {
        expect(distro.id).toBe(id);
        expect(distro.name).toBeTruthy();
        expect(distro.family).toMatch(/^(rhel|debian|ubuntu|other)$/);
        expect(distro.glibcVersion).toMatch(/^\d+\.\d+$/);
        expect(distro.status).toMatch(/^(current|lts|eol|extended-support)$/);
      });
    });

    it('13개 배포판이 등록되어야 함', () => {
      expect(Object.keys(LINUX_DISTRO_GLIBC_MAP)).toHaveLength(13);
    });

    it('glibc 버전 형식 검증', () => {
      Object.values(LINUX_DISTRO_GLIBC_MAP).forEach(distro => {
        expect(distro.glibcVersion).toMatch(/^\d+\.\d+$/);
        const version = parseFloat(distro.glibcVersion);
        expect(version).toBeGreaterThanOrEqual(2.17);
        expect(version).toBeLessThanOrEqual(2.40);
      });
    });
  });

  describe('getDistrosByFamily', () => {
    it('RHEL 계열 8개 반환', () => {
      const grouped = getDistrosByFamily();
      expect(grouped.rhel).toHaveLength(8);
      expect(grouped.rhel.map(d => d.id)).toContain('centos7');
      expect(grouped.rhel.map(d => d.id)).toContain('rhel7');
      expect(grouped.rhel.map(d => d.id)).toContain('rhel8');
      expect(grouped.rhel.map(d => d.id)).toContain('rhel9');
      expect(grouped.rhel.map(d => d.id)).toContain('rocky8');
      expect(grouped.rhel.map(d => d.id)).toContain('rocky9');
      expect(grouped.rhel.map(d => d.id)).toContain('almalinux8');
      expect(grouped.rhel.map(d => d.id)).toContain('almalinux9');
    });

    it('Ubuntu 계열 3개 반환', () => {
      const grouped = getDistrosByFamily();
      expect(grouped.ubuntu).toHaveLength(3);
      expect(grouped.ubuntu.map(d => d.id)).toContain('ubuntu20');
      expect(grouped.ubuntu.map(d => d.id)).toContain('ubuntu22');
      expect(grouped.ubuntu.map(d => d.id)).toContain('ubuntu24');
    });

    it('Debian 계열 2개 반환', () => {
      const grouped = getDistrosByFamily();
      expect(grouped.debian).toHaveLength(2);
      expect(grouped.debian.map(d => d.id)).toContain('debian11');
      expect(grouped.debian.map(d => d.id)).toContain('debian12');
    });

    it('기타 계열은 비어있음', () => {
      const grouped = getDistrosByFamily();
      expect(grouped.other).toHaveLength(0);
    });
  });

  describe('getDistrosByGlibcVersion', () => {
    it('glibc 2.34를 사용하는 배포판 조회', () => {
      const distros = getDistrosByGlibcVersion('2.34');
      expect(distros.map(d => d.id).sort()).toEqual(['almalinux9', 'rhel9', 'rocky9']);
    });

    it('glibc 2.17을 사용하는 배포판 조회', () => {
      const distros = getDistrosByGlibcVersion('2.17');
      expect(distros.map(d => d.id).sort()).toEqual(['centos7', 'rhel7']);
    });

    it('glibc 2.28을 사용하는 배포판 조회', () => {
      const distros = getDistrosByGlibcVersion('2.28');
      expect(distros.map(d => d.id).sort()).toEqual(['almalinux8', 'rhel8', 'rocky8']);
    });

    it('존재하지 않는 glibc 버전은 빈 배열 반환', () => {
      const distros = getDistrosByGlibcVersion('9.99');
      expect(distros).toHaveLength(0);
    });
  });

  describe('isDistroEOL', () => {
    beforeEach(() => {
      // 2025-01-01로 고정
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('CentOS 7은 EOL이어야 함', () => {
      expect(isDistroEOL('centos7')).toBe(true);
    });

    it('RHEL 7은 EOL이어야 함', () => {
      expect(isDistroEOL('rhel7')).toBe(true);
    });

    it('Debian 11은 EOL이어야 함', () => {
      expect(isDistroEOL('debian11')).toBe(true);
    });

    it('RHEL 9는 EOL이 아니어야 함', () => {
      expect(isDistroEOL('rhel9')).toBe(false);
    });

    it('Ubuntu 22.04는 EOL이 아니어야 함', () => {
      expect(isDistroEOL('ubuntu22')).toBe(false);
    });

    it('존재하지 않는 배포판은 false 반환', () => {
      expect(isDistroEOL('invalid')).toBe(false);
    });
  });

  describe('isDistroEOLSoon', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-12-01'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('Ubuntu 20.04는 6개월 이내 EOL', () => {
      expect(isDistroEOLSoon('ubuntu20', 6)).toBe(true);
    });

    it('RHEL 9는 EOL 임박하지 않음', () => {
      expect(isDistroEOLSoon('rhel9', 6)).toBe(false);
    });

    it('이미 EOL된 배포판은 false 반환 (CentOS 7)', () => {
      expect(isDistroEOLSoon('centos7', 6)).toBe(false);
    });

    it('존재하지 않는 배포판은 false 반환', () => {
      expect(isDistroEOLSoon('invalid', 6)).toBe(false);
    });
  });

  describe('GLIBC_VERSION_MAP', () => {
    it('간단한 매핑 제공', () => {
      expect(GLIBC_VERSION_MAP['centos7']).toBe('2.17');
      expect(GLIBC_VERSION_MAP['ubuntu22']).toBe('2.35');
      expect(GLIBC_VERSION_MAP['rocky9']).toBe('2.34');
      expect(GLIBC_VERSION_MAP['debian12']).toBe('2.36');
    });

    it('모든 배포판의 glibc 매핑 포함', () => {
      const distroIds = Object.keys(LINUX_DISTRO_GLIBC_MAP);
      const mappedIds = Object.keys(GLIBC_VERSION_MAP);
      expect(mappedIds.sort()).toEqual(distroIds.sort());
    });
  });
});
