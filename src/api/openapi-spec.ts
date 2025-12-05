/**
 * DepsSmuggler API OpenAPI 3.0 스펙 정의
 * 개발 환경에서 Swagger UI를 통해 API 문서화 및 테스트 제공
 */

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
    contact?: { name: string };
  };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
}

/**
 * OpenAPI 3.0 스펙 생성 함수
 */
export function generateOpenAPISpec(): OpenAPISpec {
  return {
    openapi: '3.0.3',
    info: {
      title: 'DepsSmuggler API',
      description: `
폐쇄망 환경을 위한 패키지 의존성 다운로드 API

## 개요
DepsSmuggler는 인터넷이 차단된 환경에서 필요한 패키지와 의존성을 다운로드하는 도구입니다.

## 지원 패키지 타입
- **pip/conda**: Python 패키지 (PyPI, Anaconda)
- **maven/gradle**: Java 라이브러리 (Maven Central)
- **npm**: Node.js 패키지 (npm Registry)
- **docker**: Docker 컨테이너 이미지 (Docker Hub)
- **yum/apt/apk**: Linux OS 패키지

## SSE (Server-Sent Events)
다운로드 진행 상태는 SSE를 통해 실시간으로 전달됩니다.
\`/api/download/events?clientId=xxx\` 엔드포인트로 연결하세요.
      `.trim(),
      version: '1.0.0',
      contact: { name: 'DepsSmuggler Team' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Vite 개발 서버' },
    ],
    tags: [
      { name: 'Download', description: '패키지 다운로드 관련 API' },
      { name: 'Dependency', description: '의존성 해결 관련 API' },
      { name: 'Search', description: '패키지 검색 프록시 API' },
    ],
    paths: {
      '/api/download/start': {
        post: {
          tags: ['Download'],
          summary: '패키지 다운로드 시작',
          description: '지정된 패키지들의 다운로드를 시작합니다. 의존성 해결 후 모든 패키지를 다운로드합니다.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DownloadRequest' },
                example: {
                  packages: [
                    {
                      id: 'pkg-1',
                      name: 'requests',
                      version: '2.31.0',
                      type: 'pip',
                      architecture: 'any',
                    },
                  ],
                  options: {
                    outputDir: './depssmuggler-downloads',
                    outputFormat: 'zip',
                    includeScripts: true,
                  },
                  clientId: 'client-123',
                },
              },
            },
          },
          responses: {
            '200': {
              description: '다운로드 시작 성공',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      results: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            success: { type: 'boolean' },
                            error: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '500': { description: '서버 오류' },
          },
        },
      },
      '/api/download/events': {
        get: {
          tags: ['Download'],
          summary: 'SSE 다운로드 진행 상태 스트림',
          description: `
Server-Sent Events를 통해 다운로드 진행 상태를 실시간으로 수신합니다.

**이벤트 타입:**
- \`status\`: 다운로드 단계 변경 (resolving, downloading)
- \`deps-resolved\`: 의존성 해결 완료
- \`progress\`: 개별 패키지 다운로드 진행률
- \`complete\`: 전체 다운로드 완료

**참고:** SSE 엔드포인트는 Swagger UI에서 직접 테스트할 수 없습니다.
          `.trim(),
          parameters: [
            {
              name: 'clientId',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'SSE 클라이언트 고유 ID',
              example: 'download-1699999999999',
            },
          ],
          responses: {
            '200': {
              description: 'SSE 스트림 연결 성공',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' },
                },
              },
            },
            '400': { description: 'clientId 파라미터 누락' },
          },
        },
      },
      '/api/dependency/resolve': {
        post: {
          tags: ['Dependency'],
          summary: '패키지 의존성 해결',
          description: '지정된 패키지들의 의존성을 분석하고 전체 의존성 트리를 반환합니다.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/DownloadPackage' },
                },
                example: [
                  {
                    id: 'pkg-1',
                    name: 'requests',
                    version: '2.31.0',
                    type: 'pip',
                  },
                ],
              },
            },
          },
          responses: {
            '200': {
              description: '의존성 해결 결과',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/DependencyResolutionResult' },
                },
              },
            },
            '500': { description: '의존성 해결 실패' },
          },
        },
      },
      '/api/pypi/{path}': {
        get: {
          tags: ['Search'],
          summary: 'PyPI API 프록시',
          description: 'PyPI JSON API에 대한 CORS 우회 프록시입니다.',
          parameters: [
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'PyPI API 경로',
              example: 'pypi/requests/json',
            },
          ],
          responses: {
            '200': {
              description: 'PyPI API 응답',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
            '500': { description: 'PyPI 요청 실패' },
          },
        },
      },
      '/api/maven/search': {
        get: {
          tags: ['Search'],
          summary: 'Maven Central 검색',
          description: 'Maven Central Repository에서 아티팩트를 검색합니다.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: '검색어 (예: spring, junit)',
              example: 'spring-core',
            },
          ],
          responses: {
            '200': {
              description: '검색 결과',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchResults' },
                  example: {
                    results: [
                      {
                        name: 'org.springframework:spring-core',
                        version: '6.1.1',
                        description: 'Maven artifact: org.springframework:spring-core',
                      },
                    ],
                  },
                },
              },
            },
            '500': { description: 'Maven 검색 실패' },
          },
        },
      },
      '/api/npm/search': {
        get: {
          tags: ['Search'],
          summary: 'npm Registry 검색',
          description: 'npm Registry에서 패키지를 검색합니다.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: '검색어 (예: lodash, react)',
              example: 'lodash',
            },
          ],
          responses: {
            '200': {
              description: '검색 결과',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchResults' },
                  example: {
                    results: [
                      {
                        name: 'lodash',
                        version: '4.17.21',
                        description: 'Lodash modular utilities.',
                      },
                    ],
                  },
                },
              },
            },
            '500': { description: 'npm 검색 실패' },
          },
        },
      },
      '/api/docker/search': {
        get: {
          tags: ['Search'],
          summary: 'Docker Hub 검색',
          description: 'Docker Hub에서 이미지를 검색합니다.',
          parameters: [
            {
              name: 'q',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: '검색어 (예: nginx, redis)',
              example: 'nginx',
            },
          ],
          responses: {
            '200': {
              description: '검색 결과',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SearchResults' },
                  example: {
                    results: [
                      {
                        name: 'nginx',
                        version: 'latest',
                        description: 'Official build of Nginx.',
                      },
                    ],
                  },
                },
              },
            },
            '500': { description: 'Docker Hub 검색 실패' },
          },
        },
      },
    },
    components: {
      schemas: {
        DownloadPackage: {
          type: 'object',
          required: ['id', 'name', 'version', 'type'],
          properties: {
            id: {
              type: 'string',
              description: '패키지 고유 ID',
              example: 'pkg-1',
            },
            name: {
              type: 'string',
              description: '패키지명',
              example: 'requests',
            },
            version: {
              type: 'string',
              description: '버전',
              example: '2.31.0',
            },
            type: {
              type: 'string',
              enum: ['pip', 'conda', 'maven', 'gradle', 'npm', 'docker', 'yum', 'apt', 'apk'],
              description: '패키지 타입',
              example: 'pip',
            },
            architecture: {
              type: 'string',
              description: '대상 아키텍처',
              example: 'x86_64',
            },
          },
        },
        DownloadOptions: {
          type: 'object',
          required: ['outputDir'],
          properties: {
            outputDir: {
              type: 'string',
              description: '출력 디렉토리 경로',
              example: './depssmuggler-downloads',
            },
            outputFormat: {
              type: 'string',
              enum: ['folder', 'zip', 'tar.gz', 'mirror'],
              description: '출력 형식',
              example: 'zip',
            },
            includeScripts: {
              type: 'boolean',
              description: '설치 스크립트 포함 여부',
              example: true,
            },
          },
        },
        DownloadRequest: {
          type: 'object',
          required: ['packages', 'options', 'clientId'],
          properties: {
            packages: {
              type: 'array',
              items: { $ref: '#/components/schemas/DownloadPackage' },
              description: '다운로드할 패키지 목록',
            },
            options: {
              $ref: '#/components/schemas/DownloadOptions',
            },
            clientId: {
              type: 'string',
              description: 'SSE 클라이언트 ID (진행 상태 수신용)',
              example: 'client-123',
            },
          },
        },
        DependencyResolutionResult: {
          type: 'object',
          properties: {
            originalPackages: {
              type: 'array',
              items: { $ref: '#/components/schemas/DownloadPackage' },
              description: '요청된 원본 패키지 목록',
            },
            allPackages: {
              type: 'array',
              items: { $ref: '#/components/schemas/DownloadPackage' },
              description: '의존성 포함 전체 패키지 목록',
            },
            dependencyTrees: {
              type: 'array',
              description: '의존성 트리 구조 (각 패키지별)',
            },
            failedPackages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                  error: { type: 'string' },
                },
              },
              description: '의존성 해결 실패한 패키지',
            },
          },
        },
        SearchResults: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: '패키지명',
                  },
                  version: {
                    type: 'string',
                    description: '최신 버전',
                  },
                  description: {
                    type: 'string',
                    description: '패키지 설명',
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
