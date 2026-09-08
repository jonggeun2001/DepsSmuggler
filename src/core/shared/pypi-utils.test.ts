import { EventEmitter } from 'events';
import * as https from 'https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPackageFiles } from './pip-simple-api-client';
import { extractVersionFromFilename, getPyPIDownloadUrl } from './pypi-utils';

vi.mock('https', () => ({ get: vi.fn() }));
vi.mock('./pip-simple-api-client', () => ({ fetchPackageFiles: vi.fn() }));
const file = (filename: string) => ({ filename, url: `https://files.example/${filename}` });
const index = 'https://registry.example/simple';

beforeEach(() => vi.resetAllMocks());

describe('PyPI 다운로드 파일 선택', () => {
  it.each([
    ['torch-2.1.0+cu121-cp311-cp311-linux_x86_64.whl', '2.1.0+cu121'],
    ['demo-1.0-2-py3-none-any.whl', '1.0'],
    ['demo-1.0rc1.tar.gz', '1.0rc1'],
    ['my-package-2.3.zip', '2.3'],
    ['', null],
    ['not-a-distribution.txt', null],
    ['package.whl', null],
  ])('파일명 %j에서 버전을 추출한다', (filename, version) => {
    expect(extractVersionFromFilename(filename)).toBe(version);
  });

  it.each([
    ['linux', 'x86_64', 'manylinux_2_17_x86_64'],
    ['linux', 'aarch64', 'manylinux2014_aarch64'],
    ['windows', 'amd64', 'win_amd64'],
    ['windows', 'arm64', 'win_arm64'],
    ['macos', 'arm64', 'macosx_11_0_arm64'],
    ['macos', 'x86_64', 'macosx_10_15_x86_64'],
  ])('%s/%s에서 호환 wheel을 소스와 공용 wheel보다 우선한다', async (os, arch, tag) => {
    const native = file(`demo-1.0-cp311-cp311-${tag}.whl`);
    vi.mocked(fetchPackageFiles).mockResolvedValue([
      file('demo-1.0.tar.gz'),
      file('demo-1.0-py3-none-any.whl'),
      native,
      file('demo-2.0-py3-none-any.whl'),
    ]);
    await expect(getPyPIDownloadUrl('demo', '1.0', arch, os, '3.11', index)).resolves.toEqual({
      ...native,
      size: 0,
    });
    expect(fetchPackageFiles).toHaveBeenCalledExactlyOnceWith(index, 'demo');
    expect(https.get).not.toHaveBeenCalled();
  });

  it('다른 플랫폼 wheel과 잘못된 wheel 파일명은 소스 선택을 방해하지 않는다', async () => {
    const source = file('demo-1.0.tar.gz');
    vi.mocked(fetchPackageFiles).mockResolvedValue([
      file('demo-1.0-cp311-cp311-win_amd64.whl'),
      file('demo-1.0.whl'),
      source,
    ]);
    await expect(
      getPyPIDownloadUrl('demo', '1.0', 'x86_64', 'linux', '3.11', index)
    ).resolves.toEqual({ ...source, size: 0 });
  });

  it('이전 CPython의 stable ABI wheel도 선택할 수 있다', async () => {
    const stable = file('demo-1.0-cp38-abi3-win_amd64.whl');
    vi.mocked(fetchPackageFiles).mockResolvedValue([file('demo-1.0.tar.gz'), stable]);
    await expect(
      getPyPIDownloadUrl('demo', '1.0', 'x86_64', 'windows', '3.11', index)
    ).resolves.toEqual({ ...stable, size: 0 });
  });

  it.each([
    { scenario: '빈 목록', files: [] },
    { scenario: '요청 버전 없음', files: [file('demo-2.0-py3-none-any.whl')] },
  ])('$scenario이면 null을 반환한다', async ({ files }) => {
    vi.mocked(fetchPackageFiles).mockResolvedValue(files);
    await expect(
      getPyPIDownloadUrl('demo', '1.0', undefined, undefined, undefined, index)
    ).resolves.toBeNull();
  });

  it.each(['403 Forbidden', 'ETIMEDOUT', 'invalid index'])(
    '인덱스 접근 실패는 null을 반환한다: %s',
    async (message) => {
      vi.mocked(fetchPackageFiles).mockRejectedValue(new Error(message));
      await expect(
        getPyPIDownloadUrl('demo', '1.0', undefined, undefined, undefined, index)
      ).resolves.toBeNull();
      expect(https.get).not.toHaveBeenCalled();
    }
  );

  function jsonTransport() {
    const response = new EventEmitter();
    const request = new EventEmitter();
    vi.mocked(https.get).mockImplementationOnce(((
      _url: unknown,
      _options: unknown,
      callback: (value: EventEmitter) => void
    ) => {
      callback(response);
      return request;
    }) as never);
    return { response, request };
  }

  it('JSON API 청크를 합쳐 다운로드 크기와 URL을 보존한다', async () => {
    const { response } = jsonTransport();
    const selected = file('demo-1.0-py3-none-any.whl');
    const pending = getPyPIDownloadUrl('demo', '1.0');
    const body = JSON.stringify({
      urls: [{ ...selected, size: 321, packagetype: 'bdist_wheel', python_version: 'py3' }],
    });
    response.emit('data', body.slice(0, 20));
    response.emit('data', body.slice(20));
    response.emit('end');
    await expect(pending).resolves.toEqual({ ...selected, size: 321 });
    expect(https.get).toHaveBeenCalledWith(
      'https://pypi.org/pypi/demo/1.0/json',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it.each(['', '<html>Forbidden</html>', '{}', '{"urls":[]}'])(
    '비어 있거나 잘못된 API 본문 %j는 null을 반환한다',
    async (body) => {
      const { response } = jsonTransport();
      const pending = getPyPIDownloadUrl('demo', '1.0');
      response.emit('data', body);
      response.emit('end');
      await expect(pending).resolves.toBeNull();
    }
  );

  it('JSON API 네트워크 오류도 null을 반환한다', async () => {
    const { request } = jsonTransport();
    const pending = getPyPIDownloadUrl('demo', '1.0');
    request.emit('error', new Error('offline'));
    await expect(pending).resolves.toBeNull();
  });
});
