import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMavenDownloader } from './maven';

describe('maven downloader', () => {
  let downloader: ReturnType<typeof getMavenDownloader>;

  beforeEach(() => {
    downloader = getMavenDownloader();
  });

  describe('getMavenDownloader', () => {
    it('싱글톤 인스턴스 반환', () => {
      const instance1 = getMavenDownloader();
      const instance2 = getMavenDownloader();
      expect(instance1).toBe(instance2);
    });

    it('type이 maven', () => {
      expect(downloader.type).toBe('maven');
    });
  });

  describe('parseCoordinates', () => {
    it('groupId:artifactId 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: undefined,
      });
    });

    it('groupId:artifactId:version 파싱', () => {
      const result = downloader.parseCoordinates('com.google.code.gson:gson:2.10.1');
      expect(result).toEqual({
        groupId: 'com.google.code.gson',
        artifactId: 'gson',
        version: '2.10.1',
      });
    });

    it('잘못된 형식은 null 반환', () => {
      expect(downloader.parseCoordinates('invalid')).toBeNull();
      expect(downloader.parseCoordinates('')).toBeNull();
    });

    it('복잡한 groupId 처리', () => {
      const result = downloader.parseCoordinates('org.springframework.boot:spring-boot-starter:3.2.0');
      expect(result).toEqual({
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot-starter',
        version: '3.2.0',
      });
    });
  });
});

// MavenDownloader 클래스 메서드 테스트 (모킹)
import { MavenDownloader } from './maven';

describe('MavenDownloader 클래스 메서드 테스트', () => {
  let downloader: MavenDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new MavenDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchPackages', () => {
    it('검색 결과 성공 처리', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({
          data: {
            components: [
              {
                namespace: 'com.google.code.gson',
                name: 'gson',
                latestVersionInfo: { version: '2.10.1' },
                nsPopularityAppCount: 150000,
              },
              {
                namespace: 'org.json',
                name: 'json',
                latestVersionInfo: { version: '20231013' },
                nsPopularityAppCount: 80000,
              },
            ],
            totalResultCount: 2,
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('gson');

      expect(results.length).toBe(2);
      expect(results[0].name).toBe('com.google.code.gson:gson');
      expect(results[0].version).toBe('2.10.1');
      expect(results[0].type).toBe('maven');
      expect(results[0].metadata?.popularityCount).toBe(150000);
    });

    it('검색 결과 없음', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({
          data: { components: [], totalResultCount: 0 },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('nonexistent-package-xyz');
      expect(results).toHaveLength(0);
    });

    it('네트워크 오류 시 예외 발생', async () => {
      const mockClient = {
        post: vi.fn().mockRejectedValue(new Error('Network Error')),
      };
      (downloader as any).client = mockClient;

      await expect(downloader.searchPackages('test')).rejects.toThrow();
    });
  });

  describe('getVersions', () => {
    it('metadata.xml에서 버전 목록 조회', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: `<?xml version="1.0" encoding="UTF-8"?>
            <metadata>
              <groupId>com.google.code.gson</groupId>
              <artifactId>gson</artifactId>
              <versioning>
                <versions>
                  <version>2.10.0</version>
                  <version>2.10.1</version>
                </versions>
                <lastUpdated>20231213</lastUpdated>
              </versioning>
            </metadata>`,
        }),
      };
      (downloader as any).client = mockClient;

      const versions = await downloader.getVersions('com.google.code.gson:gson');

      expect(versions).toContain('2.10.1');
      expect(versions).toContain('2.10.0');
    });
  });

  describe('getPackageMetadata', () => {
    it('메타데이터 조회 성공', async () => {
      const mockClient = {
        get: vi.fn().mockImplementation((url: string) => {
          if (url.includes('.sha1')) {
            return Promise.resolve({
              data: 'a1b2c3d4e5f6',
            });
          }
          // Search API 응답
          return Promise.resolve({
            data: {
              response: {
                docs: [
                  {
                    id: 'com.google.code.gson:gson',
                    g: 'com.google.code.gson',
                    a: 'gson',
                    v: '2.10.1',
                    p: 'jar',
                    latestVersion: '2.10.1',
                  },
                ],
              },
            },
          });
        }),
      };
      (downloader as any).client = mockClient;

      const metadata = await downloader.getPackageMetadata('com.google.code.gson:gson', '2.10.1');

      expect(metadata.name).toBe('com.google.code.gson:gson');
      expect(metadata.version).toBe('2.10.1');
      expect(metadata.type).toBe('maven');
    });
  });

  describe('buildDownloadUrl', () => {
    it('POM URL 생성', () => {
      const url = (downloader as any).buildDownloadUrl(
        'com.google.code.gson',
        'gson',
        '2.10.1',
        'pom'
      );
      expect(url).toBe(
        'https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.pom'
      );
    });
  });

  describe('buildFileName', () => {
    it('sources artifact type 파일명', () => {
      const fileName = (downloader as any).buildFileName('gson', '2.10.1', 'sources');
      expect(fileName).toBe('gson-2.10.1-sources.jar');
    });

    it('javadoc artifact type 파일명', () => {
      const fileName = (downloader as any).buildFileName('gson', '2.10.1', 'javadoc');
      expect(fileName).toBe('gson-2.10.1-javadoc.jar');
    });
  });

  describe('validateArtifactType', () => {
    it('sources 타입을 유지', () => {
      expect((downloader as any).validateArtifactType('sources')).toBe('sources');
    });

    it('javadoc 타입을 유지', () => {
      expect((downloader as any).validateArtifactType('javadoc')).toBe('javadoc');
    });
  });

  describe('parseMetadataXml', () => {
    it('버전 목록 추출', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <metadata>
          <groupId>com.google.code.gson</groupId>
          <artifactId>gson</artifactId>
          <versioning>
            <versions>
              <version>2.9.0</version>
              <version>2.10.0</version>
              <version>2.10.1</version>
            </versions>
            <lastUpdated>20231213</lastUpdated>
          </versioning>
        </metadata>`;

      const versions = (downloader as any).parseMetadataXml(xml);

      expect(versions).toContain('2.9.0');
      expect(versions).toContain('2.10.0');
      expect(versions).toContain('2.10.1');
      expect(versions.length).toBe(3);
    });

    it('빈 XML에서 빈 배열 반환', () => {
      const xml = '<metadata></metadata>';
      const versions = (downloader as any).parseMetadataXml(xml);
      expect(versions).toHaveLength(0);
    });
  });

  describe('getVersionsFromMetadata', () => {
    it('metadata.xml에서 버전 목록 조회 성공', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: `<?xml version="1.0" encoding="UTF-8"?>
            <metadata>
              <versioning>
                <versions>
                  <version>2.10.0</version>
                  <version>2.10.1</version>
                </versions>
              </versioning>
            </metadata>`,
        }),
      };
      (downloader as any).client = mockClient;

      const versions = await (downloader as any).getVersionsFromMetadata('com.google.code.gson', 'gson');

      expect(versions).toContain('2.10.0');
      expect(versions).toContain('2.10.1');
    });

    it('조회 실패 시 예외 발생', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network Error')),
      };
      (downloader as any).client = mockClient;

      await expect((downloader as any).getVersionsFromMetadata('invalid', 'package'))
        .rejects.toThrow('Network Error');
    });
  });

  describe('getVersionsFromSearchApi', () => {
    it('Search API에서 버전 목록 조회', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            response: {
              docs: [
                { v: '2.10.1' },
                { v: '2.10.0' },
                { v: '2.9.1' },
              ],
            },
          },
        }),
      };
      (downloader as any).client = mockClient;

      const versions = await (downloader as any).getVersionsFromSearchApi('com.google.code.gson', 'gson');

      expect(versions).toContain('2.10.1');
      expect(versions).toContain('2.10.0');
      expect(versions).toContain('2.9.1');
    });

    it('조회 실패 시 예외 발생', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network Error')),
      };
      (downloader as any).client = mockClient;

      await expect((downloader as any).getVersionsFromSearchApi('invalid', 'package'))
        .rejects.toThrow('Network Error');
    });
  });

  describe('downloadPom', () => {
    it('downloadArtifact를 pom 타입으로 호출', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/path/to/file.pom');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      await downloader.downloadPom('com.google.code.gson', 'gson', '2.10.1', '/dest');

      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        'com.google.code.gson', 'gson', '2.10.1', '/dest', 'pom'
      );
    });
  });

  describe('downloadSources', () => {
    it('downloadArtifact를 sources 타입으로 호출', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/path/to/file-sources.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      await downloader.downloadSources('com.google.code.gson', 'gson', '2.10.1', '/dest');

      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        'com.google.code.gson', 'gson', '2.10.1', '/dest', 'sources'
      );
    });
  });

  describe('downloadJavadoc', () => {
    it('downloadArtifact를 javadoc 타입으로 호출', async () => {
      const mockDownloadArtifact = vi.fn().mockResolvedValue('/path/to/file-javadoc.jar');
      (downloader as any).downloadArtifact = mockDownloadArtifact;

      await downloader.downloadJavadoc('com.google.code.gson', 'gson', '2.10.1', '/dest');

      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        'com.google.code.gson', 'gson', '2.10.1', '/dest', 'javadoc'
      );
    });
  });
});

// Maven 검색 안정성 개선 테스트
describe('Maven 검색 안정성 - Fallback API 및 재시도', () => {
  let downloader: MavenDownloader;

  beforeEach(() => {
    vi.clearAllMocks();
    downloader = new MavenDownloader();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseMavenQuery', () => {
    it('keyword 형식 파싱', () => {
      const result = (downloader as any).parseMavenQuery('spring-boot');
      expect(result).toEqual({
        type: 'keyword',
        keyword: 'spring-boot',
      });
    });

    it('coordinates 형식 파싱 (colon 포함)', () => {
      const result = (downloader as any).parseMavenQuery('org.springframework.boot:spring-boot');
      expect(result).toEqual({
        type: 'coordinates',
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot',
      });
    });

    it('coordinates 형식 공백 제거', () => {
      const result = (downloader as any).parseMavenQuery('  org.springframework.boot : spring-boot  ');
      expect(result).toEqual({
        type: 'coordinates',
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot',
      });
    });

    it('colon이 하나만 있는 경우도 coordinates로 처리', () => {
      const result = (downloader as any).parseMavenQuery('group:artifact');
      expect(result).toEqual({
        type: 'coordinates',
        groupId: 'group',
        artifactId: 'artifact',
      });
    });
  });

  describe('searchViaSonatypeApi', () => {
    it('Sonatype API 검색 성공', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue({
          data: {
            versions: [
              { version: '3.2.0' },
              { version: '3.1.5' },
              { version: '3.1.0' },
            ],
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await (downloader as any).searchViaSonatypeApi(
        'org.springframework.boot',
        'spring-boot'
      );

      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('org.springframework.boot:spring-boot');
      expect(results[0].version).toBe('3.2.0');
      expect(results[0].type).toBe('maven');
      expect(results[0].metadata).toEqual({
        groupId: 'org.springframework.boot',
        artifactId: 'spring-boot',
      });

      expect(mockClient.get).toHaveBeenCalledWith(
        'https://central.sonatype.com/api/internal/browse/component/versions',
        {
          params: {
            namespace: 'org.springframework.boot',
            name: 'spring-boot',
          },
          timeout: 10000,
        }
      );
    });

    it('Sonatype API 네트워크 오류 시 예외 발생', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Network Error')),
      };
      (downloader as any).client = mockClient;

      await expect(
        (downloader as any).searchViaSonatypeApi('org.test', 'artifact')
      ).rejects.toThrow('Network Error');
    });
  });

  describe('searchViaSearchApi', () => {
    it('Search API 검색 성공', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({
          data: {
            components: [
              {
                namespace: 'org.springframework.boot',
                name: 'spring-boot',
                latestVersionInfo: { version: '3.2.0' },
                nsPopularityAppCount: 507700,
              },
              {
                namespace: 'org.springframework.boot',
                name: 'spring-boot-starter',
                latestVersionInfo: { version: '3.2.0' },
                nsPopularityAppCount: 1250000,
              },
            ],
            totalResultCount: 2,
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await (downloader as any).searchViaSearchApi('spring-boot');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('org.springframework.boot:spring-boot');
      expect(results[0].version).toBe('3.2.0');
      expect(results[0].metadata?.popularityCount).toBe(507700);
      expect(results[1].metadata?.popularityCount).toBe(1250000);
    });

    it('인기도가 없는 패키지는 undefined로 처리', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({
          data: {
            components: [
              {
                namespace: 'com.example',
                name: 'test-lib',
                latestVersionInfo: { version: '1.0.0' },
                // nsPopularityAppCount 없음
              },
            ],
            totalResultCount: 1,
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await (downloader as any).searchViaSearchApi('test-lib');

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.popularityCount).toBeUndefined();
    });

    it('Search API 504 에러 시 명확한 에러 메시지', async () => {
      const mockClient = {
        post: vi.fn().mockRejectedValue({ response: { status: 504 } }),
      };
      (downloader as any).client = mockClient;

      await expect((downloader as any).searchViaSearchApi('spring-boot')).rejects.toThrow(
        /Maven 검색 실패/
      );
    });

    it('Search API 재시도 후 성공 (mocking with retry)', async () => {
      let callCount = 0;
      const mockClient = {
        post: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount < 3) {
            return Promise.reject({ response: { status: 504 } });
          }
          return Promise.resolve({
            data: {
              components: [
                {
                  namespace: 'org.springframework.boot',
                  name: 'spring-boot',
                  latestVersionInfo: { version: '3.2.0' },
                  nsPopularityAppCount: 100000,
                },
              ],
              totalResultCount: 1,
            },
          });
        }),
      };
      (downloader as any).client = mockClient;

      const results = await (downloader as any).searchViaSearchApi('spring-boot');

      expect(results).toHaveLength(1);
      expect(callCount).toBe(3); // 초기 + 2회 재시도
    });
  });

  describe('searchPackages - 통합 검색 로직', () => {
    it('coordinates 형식 입력 시 Sonatype API 우선 사용', async () => {
      const mockSonatypeResponse = {
        data: {
          versions: [{ version: '3.2.0' }, { version: '3.1.5' }],
        },
      };

      const mockClient = {
        get: vi.fn().mockResolvedValue(mockSonatypeResponse),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('org.springframework.boot:spring-boot');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('org.springframework.boot:spring-boot');
      expect(results[0].version).toBe('3.2.0');

      // Sonatype API 호출 확인
      expect(mockClient.get).toHaveBeenCalledWith(
        expect.stringContaining('central.sonatype.com'),
        expect.any(Object)
      );
    });

    it('Sonatype API 실패 시 Search API로 fallback', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('504 Gateway Timeout')),
        post: vi.fn().mockResolvedValue({
          data: {
            components: [
              {
                namespace: 'org.springframework.boot',
                name: 'spring-boot',
                latestVersionInfo: { version: '3.2.0' },
                nsPopularityAppCount: 500000,
              },
            ],
            totalResultCount: 1,
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('org.springframework.boot:spring-boot');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('org.springframework.boot:spring-boot');
      expect(results[0].metadata?.popularityCount).toBe(500000);
      // Sonatype API 시도 확인
      expect(mockClient.get).toHaveBeenCalled();
      // Search API fallback 확인
      expect(mockClient.post).toHaveBeenCalled();
    });

    it('keyword 형식 입력 시 Search API 직접 사용', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({
          data: {
            components: [
              {
                namespace: 'org.springframework.boot',
                name: 'spring-boot',
                latestVersionInfo: { version: '3.2.0' },
                nsPopularityAppCount: 500000,
              },
            ],
            totalResultCount: 1,
          },
        }),
      };
      (downloader as any).client = mockClient;

      const results = await downloader.searchPackages('spring-boot');

      expect(results).toHaveLength(1);
      expect(results[0].metadata?.popularityCount).toBe(500000);
      // Search API 호출 확인 (POST 메서드)
      expect(mockClient.post).toHaveBeenCalledWith(
        expect.stringContaining('central.sonatype.com'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('모든 API 실패 시 명확한 에러 메시지', async () => {
      const mockClient = {
        post: vi.fn().mockRejectedValue({ response: { status: 504 } }),
      };
      (downloader as any).client = mockClient;

      try {
        await downloader.searchPackages('spring-boot');
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('Maven 검색 실패');
      }
    });
  });
});
