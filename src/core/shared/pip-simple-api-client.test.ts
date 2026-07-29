import { createHash } from 'crypto';
import axios from 'axios';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  fetchWheelMetadata,
  parseSimpleApiHtml,
} from './pip-simple-api-client';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('parseSimpleApiHtml', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('SHA-256 이외의 Simple API URL fragment 체크섬도 보존한다', () => {
    const [file] = parseSimpleApiHtml(
      '<a href="demo-1.0.0-py3-none-any.whl#md5=abc123">demo-1.0.0-py3-none-any.whl</a>',
      'https://index.example/simple/demo/',
    );

    expect(file).toMatchObject({
      url: 'https://index.example/simple/demo/demo-1.0.0-py3-none-any.whl',
      hash: {
        algorithm: 'md5',
        digest: 'abc123',
      },
    });
  });

  it('PEP 714 core metadata를 legacy 속성보다 우선한다', () => {
    const [file] = parseSimpleApiHtml(
      [
        '<a href="demo-1.0.0-py3-none-any.whl"',
        'data-core-metadata="sha512=bb"',
        'data-dist-info-metadata="sha256=aa">',
        'demo-1.0.0-py3-none-any.whl</a>',
      ].join(' '),
      'https://index.example/simple/demo/',
    );

    expect(file).toMatchObject({
      metadataAvailable: true,
      metadataHash: {
        algorithm: 'sha512',
        digest: 'bb',
      },
    });
  });

  it.each([
    ['data-core-metadata', 'true', undefined],
    [
      'data-dist-info-metadata',
      'md5=abc123',
      { algorithm: 'md5', digest: 'abc123' },
    ],
  ])(
    '%s의 %s 값을 metadata availability로 보존한다',
    (attribute, value, metadataHash) => {
      const [file] = parseSimpleApiHtml(
        `<a href="demo-1.0.0-py3-none-any.whl" ${attribute}="${value}">demo-1.0.0-py3-none-any.whl</a>`,
        'https://index.example/simple/demo/',
      );

      expect(file.metadataAvailable).toBe(true);
      expect(file.metadataHash).toEqual(metadataHash);
    },
  );
});

describe('fetchWheelMetadata', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('광고된 해시와 일치하는 Core Metadata만 파싱한다', async () => {
    const metadata =
      'Metadata-Version: 2.4\nRequires-Dist: child==1.0.0\n';
    const digest = createHash('sha256')
      .update(metadata)
      .digest('hex');
    mockedAxios.get.mockResolvedValue({ data: metadata });

    await expect(
      fetchWheelMetadata({
        filename: 'demo-1.0.0-py3-none-any.whl',
        url: 'https://index.example/demo.whl',
        metadataAvailable: true,
        metadataHash: {
          algorithm: 'sha256',
          digest,
        },
      }),
    ).resolves.toEqual(['child==1.0.0']);
  });

  it.each([
    ['sha256', '0'.repeat(64)],
    ['unsupported-hash', 'abc123'],
  ])(
    'Core Metadata의 %s 해시를 검증할 수 없으면 null을 반환한다',
    async (algorithm, digest) => {
      mockedAxios.get.mockResolvedValue({
        data:
          'Metadata-Version: 2.4\nRequires-Dist: forged==9\n',
      });

      await expect(
        fetchWheelMetadata({
          filename: 'demo-1.0.0-py3-none-any.whl',
          url: 'https://index.example/demo.whl',
          metadataAvailable: true,
          metadataHash: { algorithm, digest },
        }),
      ).resolves.toBeNull();
    },
  );

  it('해시가 없는 true metadata도 조회한다', async () => {
    mockedAxios.get.mockResolvedValue({
      data: 'Metadata-Version: 2.4\n',
    });

    await expect(
      fetchWheelMetadata({
        filename: 'demo-1.0.0-py3-none-any.whl',
        url: 'https://index.example/demo.whl',
        metadataAvailable: true,
      }),
    ).resolves.toEqual([]);
  });
});
