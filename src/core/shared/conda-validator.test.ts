import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCondaChannel, validateCondaChannelStrict } from './conda-validator';

vi.mock('axios', () => ({ default: { head: vi.fn() } }));

describe('Conda 채널 검증', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('채널의 noarch 인덱스가 200이면 유효하다', async () => {
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });
    await expect(validateCondaChannel('conda-forge')).resolves.toBe(true);
    expect(axios.head).toHaveBeenCalledWith(
      'https://conda.anaconda.org/conda-forge/noarch/repodata.json',
      expect.objectContaining({ timeout: 5000 })
    );
    const validate = vi.mocked(axios.head).mock.calls[0][1]!.validateStatus!;
    expect(validate(200)).toBe(true);
    expect(validate(403)).toBe(false);
  });

  it('defaults는 공식 main repository의 noarch endpoint를 검증한다', async () => {
    vi.mocked(axios.head).mockResolvedValue({ status: 200 });

    await expect(validateCondaChannel('defaults')).resolves.toBe(true);
    expect(axios.head).toHaveBeenCalledWith(
      'https://repo.anaconda.com/pkgs/main/noarch/repodata.json',
      expect.objectContaining({ timeout: 5000 })
    );
    expect(axios.head).not.toHaveBeenCalledWith(
      'https://conda.anaconda.org/defaults/noarch/repodata.json',
      expect.anything()
    );
  });

  it('200 이외의 응답은 유효하지 않다', async () => {
    vi.mocked(axios.head).mockResolvedValue({ status: 204 });
    await expect(validateCondaChannel('empty-channel')).resolves.toBe(false);
  });

  it.each([401, 403, 404, 500])('채널 HTTP %s 오류는 false로 반환한다', async (status) => {
    vi.mocked(axios.head).mockRejectedValue(
      Object.assign(new Error(`HTTP ${status}`), { response: { status } })
    );
    await expect(validateCondaChannel('private-or-missing')).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('타임아웃과 빈 채널의 접근 실패도 false로 반환한다', async () => {
    vi.mocked(axios.head).mockRejectedValue(new Error('timeout'));
    await expect(validateCondaChannel('')).resolves.toBe(false);
  });

  it('일부 플랫폼이 실패해도 하나의 인덱스가 접근 가능하면 유효하다', async () => {
    vi.mocked(axios.head)
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ status: 200 })
      .mockRejectedValue(new Error('403'));
    await expect(validateCondaChannelStrict('linux-only')).resolves.toBe(true);
    expect(axios.head).toHaveBeenCalledTimes(4);
  });

  it('모든 플랫폼이 실패하면 유효하지 않다', async () => {
    vi.mocked(axios.head).mockRejectedValue(new Error('network offline'));
    await expect(validateCondaChannelStrict('offline', ['linux-64', 'noarch'])).resolves.toBe(
      false
    );
    expect(axios.head).toHaveBeenCalledTimes(2);
  });

  it('빈 플랫폼 목록은 요청하지 않고 false를 반환한다', async () => {
    await expect(validateCondaChannelStrict('conda-forge', [])).resolves.toBe(false);
    expect(axios.head).not.toHaveBeenCalled();
  });
});
