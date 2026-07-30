import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  fetchWheelMetadata,
  type SimpleApiPackageFile,
} from './pip-simple-api-client';

vi.mock('axios');

const mockedAxios = vi.mocked(axios, true);

const metadataFile: SimpleApiPackageFile = {
  filename: 'sample-1.0.0-py3-none-any.whl',
  url: 'https://packages.example.com/sample-1.0.0-py3-none-any.whl',
  metadataHash: {
    algorithm: 'sha256',
    digest: 'abc123',
  },
};

describe('fetchWheelMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('빈 Requires-Dist 메타데이터를 사용 가능한 결과로 구분한다', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: 'Metadata-Version: 2.1\nName: sample\n' });

    await expect(fetchWheelMetadata(metadataFile)).resolves.toEqual({
      status: 'available',
      requiresDist: [],
    });
  });

  it('PEP 658 메타데이터 요청 실패를 사용할 수 없는 결과로 구분한다', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('metadata unavailable'));

    await expect(fetchWheelMetadata(metadataFile)).resolves.toEqual({
      status: 'unavailable',
      error: 'metadata unavailable',
    });
  });

  it('메타데이터가 광고되지 않은 파일은 요청하지 않는다', async () => {
    const fileWithoutMetadata = { ...metadataFile, metadataHash: undefined };

    await expect(fetchWheelMetadata(fileWithoutMetadata)).resolves.toEqual({
      status: 'not-advertised',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
