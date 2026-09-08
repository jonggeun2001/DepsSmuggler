import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildMavenClassifier,
  fetchClassifiersFromMavenCentral,
  getAvailableClassifiers,
  getAvailableClassifiersAsync,
  isNativeArtifact,
  isNativeArtifactFromApi,
} from './maven-utils';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

describe('Maven 네이티브 아티팩트 classifier', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['Linux', 'AMD64', 'linux-x86_64'],
    ['darwin', 'arm64', 'osx-aarch_64'],
    ['macos', 'aarch64', 'osx-aarch_64'],
    ['windows', 'x86_64', 'windows-x86_64'],
    ['', 'x86_64', undefined],
    ['linux', '', undefined],
    ['unknown', 'x86_64', undefined],
    ['linux', 'unsupported', undefined],
  ])('%s/%s를 classifier로 변환하거나 미지원 입력을 제외한다', (os, arch, expected) => {
    expect(buildMavenClassifier(os, arch)).toBe(expected);
  });

  it.each([
    ['netty-transport-native-epoll', true],
    ['lwjgl-opengl', true],
    ['lwjgl', true],
    ['javacpp-platform', true],
    ['commons-lang3', false],
    ['', false],
  ])('%s 아티팩트의 native 여부를 판별한다', (name, expected) => {
    expect(isNativeArtifact('org.example', name)).toBe(expected);
  });

  it('알려진 라이브러리와 일반 native 패키지에 classifier 후보를 제공한다', () => {
    expect(getAvailableClassifiers('org.lwjgl', 'lwjgl-opengl')).toContain('natives-linux');
    expect(getAvailableClassifiers('org.example', 'custom-native')).toContain('linux-x86_64');
    expect(getAvailableClassifiers('org.example', 'plain-library')).toEqual([]);
  });

  it.each([undefined, '3.3.6'])(
    '버전 %s의 classifier 조회에서 문서·소스·테스트 아티팩트를 제외한다',
    async (version) => {
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          response: {
            docs: [
              {
                ec: [
                  '.jar',
                  '.pom',
                  '-sources.jar',
                  '-javadoc.jar',
                  '-tests.jar',
                  '-test-sources.jar',
                  '-natives-linux.jar',
                  '-natives-macos-arm64.jar',
                ],
              },
            ],
          },
        },
      });
      await expect(
        fetchClassifiersFromMavenCentral('org.lwjgl', 'lwjgl', version)
      ).resolves.toEqual(['natives-linux', 'natives-macos-arm64']);
      const url = vi.mocked(axios.get).mock.calls[0][0];
      expect(url).toContain('g:org.lwjgl+AND+a:lwjgl');
      if (version) expect(url).toContain(`+AND+v:${version}`);
      else expect(url).not.toContain('+AND+v:');
      expect(axios.get).toHaveBeenCalledWith(url, { timeout: 10000 });
    }
  );

  it.each([
    undefined,
    {},
    { response: { docs: [] } },
    { response: { docs: [{}] } },
    { response: { docs: [{ ec: 'invalid' }] } },
  ])('빈/잘못된 검색 응답은 classifier가 없다', async (data) => {
    vi.mocked(axios.get).mockResolvedValue({ data });
    await expect(fetchClassifiersFromMavenCentral('org.example', 'missing')).resolves.toEqual([]);
  });

  it.each(['403 Forbidden', 'timeout'])('접근 오류를 빈 목록으로 반환한다: %s', async (message) => {
    vi.mocked(axios.get).mockRejectedValue(new Error(message));
    await expect(getAvailableClassifiersAsync('org.example', 'private', '1.0')).resolves.toEqual(
      []
    );
    expect(console.error).toHaveBeenCalledOnce();
  });

  it.each([
    [['-linux-x86_64.jar'], true],
    [['-all.jar'], false],
    [[], false],
  ])('API의 플랫폼 classifier 여부로 native를 판별한다', async (ec, expected) => {
    vi.mocked(axios.get).mockResolvedValue({ data: { response: { docs: [{ ec }] } } });
    await expect(isNativeArtifactFromApi('org.example', 'library', '1.0')).resolves.toBe(expected);
  });
});
