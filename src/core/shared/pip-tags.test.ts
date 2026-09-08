import { describe, expect, it } from 'vitest';
import {
  generateCompatibleTags,
  generateCPythonTags,
  generateLinuxPlatformTags,
  generateMacOSPlatformTags,
  generatePlatformTags,
  generateWindowsPlatformTags,
  getFullSupportedTags,
  getSupportedTags,
  getTagPriority,
  isTagCompatible,
  normalizeArch,
  parseTag,
  tagsToIndexMap,
  tagToString,
  versionToNodot,
} from './pip-tags';

describe('pip wheel 지원 태그', () => {
  it('태그를 파싱하고 손실 없이 직렬화한다', () => {
    const tag = { pythonTag: 'cp311', abiTag: 'abi3', platformTag: 'win_amd64' };
    expect(parseTag(tagToString(tag))).toEqual(tag);
  });
  it.each(['', 'cp311', 'cp311-none', 'cp311-none-any-extra'])(
    '잘못된 형식 %j는 태그가 아니다',
    (value) => {
      expect(parseTag(value)).toBeNull();
    }
  );
  it.each([
    ['3.11.9', '311'],
    ['3.9', '39'],
    ['', ''],
  ])('버전 %j의 major/minor만 태그에 사용한다', (input, expected) => {
    expect(versionToNodot(input)).toBe(expected);
  });
  it.each([
    ['amd64', 'x86_64'],
    ['i386', 'i686'],
    ['arm64', 'arm64'],
    ['aarch64', 'aarch64'],
  ] as const)('아키텍처 별칭 %s를 정규화한다', (input, expected) => {
    expect(normalizeArch(input)).toBe(expected);
  });
  it('CPython ABI를 먼저 생성하고 과거 stable ABI를 포함한다', () => {
    const tags = generateCPythonTags({ version: '3.11', platforms: ['win_amd64'] }).map(
      tagToString
    );
    expect(tags[0]).toBe('cp311-cp311-win_amd64');
    expect(tags).toContain('cp32-abi3-win_amd64');
    expect(tags).not.toContain('cp31-abi3-win_amd64');
    expect(tags).not.toContain('cp312-abi3-win_amd64');
  });
  it('사용자 ABI와 빈 플랫폼 목록을 처리한다', () => {
    expect(
      generateCPythonTags({ version: '3.11', abis: ['custom'], platforms: ['any'] })[0]
    ).toEqual({ pythonTag: 'cp311', abiTag: 'custom', platformTag: 'any' });
    expect(generateCPythonTags({ version: '3.11', platforms: [] })).toEqual([]);
    expect(generateCompatibleTags({ version: '3.11', platforms: [] })).toEqual([]);
  });
  it('순수 Python 태그는 하위 minor와 major 공용 태그를 포함한다', () => {
    const tags = generateCompatibleTags({ version: '3.11' }).map(tagToString);
    expect(tags[0]).toBe('py311-none-any');
    expect(tags).toContain('py30-none-any');
    expect(tags.at(-1)).toBe('py3-none-any');
  });
  it('비 CPython 구현체의 지원 목록은 CPython ABI를 포함하지 않는다', () => {
    const tags = getSupportedTags({ version: '3.11', implementation: 'pp' }).map(tagToString);
    expect(tags).toContain('py3-none-any');
    expect(tags.some((tag) => tag.startsWith('cp'))).toBe(false);
  });
  it('중복 태그는 첫 우선순위를 유지한다', () => {
    const tags = getFullSupportedTags('3.11', 'windows', 'x86_64');
    const first = tags[0];
    expect(tagsToIndexMap([...tags, first]).get(tagToString(first))).toBe(0);
    expect(getTagPriority(first, tags)).toBe(0);
    expect(isTagCompatible(first, tags)).toBe(true);
    expect(getTagPriority(first, [])).toBe(-1);
    expect(isTagCompatible(first, [])).toBe(false);
    expect(tagsToIndexMap([]).size).toBe(0);
  });
  it('Linux 아키텍처에 맞는 manylinux와 legacy 태그를 생성한다', () => {
    const x64 = generateLinuxPlatformTags('amd64');
    expect(x64[0]).toBe('manylinux_2_35_x86_64');
    expect(x64).toContain('manylinux1_x86_64');
    expect(x64.at(-1)).toBe('linux_x86_64');
    const arm = generateLinuxPlatformTags('aarch64');
    expect(arm).toContain('manylinux2014_aarch64');
    expect(arm).not.toContain('manylinux1_aarch64');
  });
  it.each([
    ['x86_64', 'win_amd64'],
    ['arm64', 'win_arm64'],
    ['i386', 'win32'],
    ['i686', 'win32'],
  ] as const)('Windows %s의 플랫폼 태그를 생성한다', (arch, expected) => {
    expect(generateWindowsPlatformTags(arch)).toEqual([expected]);
  });
  it('macOS ARM과 universal2 태그 및 지정한 최소 major를 반영한다', () => {
    const tags = generateMacOSPlatformTags('arm64', [12, 0]);
    expect(tags).toContain('macosx_12_0_arm64');
    expect(tags).toContain('macosx_12_0_universal2');
    expect(tags).not.toContain('macosx_11_0_arm64');
  });
  it.each(['linux', 'windows', 'macos', 'any'] as const)(
    '%s 플랫폼은 순수 Python용 any를 포함한다',
    (platform) => {
      expect(generatePlatformTags(platform, 'x86_64').at(-1)).toBe('any');
      expect(getFullSupportedTags('3.11', platform, 'x86_64').map(tagToString)).toContain(
        'py3-none-any'
      );
    }
  );
});
