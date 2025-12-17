/**
 * Conda 채널 유효성 검증 유틸리티
 *
 * Conda 채널의 repodata.json에 접근 가능한지 확인하여 채널의 유효성을 검증합니다.
 */

import axios from 'axios';

/**
 * Conda 채널 유효성 검증 (단순 버전)
 *
 * @param channel 채널 이름 (예: 'conda-forge', 'my-custom-channel')
 * @returns 유효한 채널이면 true, 아니면 false
 */
export async function validateCondaChannel(channel: string): Promise<boolean> {
  try {
    // anaconda.org API를 통해 채널 존재 여부 확인
    // https://conda.anaconda.org/{channel}/noarch/repodata.json
    const baseUrl = `https://conda.anaconda.org/${channel}/noarch/repodata.json`;

    const response = await axios.head(baseUrl, {
      timeout: 5000,
      validateStatus: (status) => status === 200,
    });

    return response.status === 200;
  } catch (error) {
    console.warn(`Conda 채널 검증 실패: ${channel}`, error);
    return false;
  }
}

/**
 * Conda 채널 유효성 검증 (엄격한 버전)
 *
 * 여러 subdir에서 repodata.json 접근 가능 여부를 확인합니다.
 * 최소 하나의 subdir에서 접근 가능하면 유효한 채널로 판단합니다.
 *
 * @param channel 채널 이름
 * @param subdirs 확인할 subdir 목록 (기본값: noarch, linux-64, win-64, osx-64)
 * @returns 유효한 채널이면 true, 아니면 false
 */
export async function validateCondaChannelStrict(
  channel: string,
  subdirs: string[] = ['noarch', 'linux-64', 'win-64', 'osx-64']
): Promise<boolean> {
  try {
    // 최소 하나의 subdir에서 repodata.json 접근 가능해야 함
    const results = await Promise.allSettled(
      subdirs.map((subdir) =>
        axios.head(`https://conda.anaconda.org/${channel}/${subdir}/repodata.json`, {
          timeout: 3000,
        })
      )
    );

    return results.some((result) => result.status === 'fulfilled');
  } catch {
    return false;
  }
}
