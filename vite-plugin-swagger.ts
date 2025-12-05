/**
 * Vite Swagger UI 플러그인
 * 개발 환경에서만 활성화되어 API 문서화 및 테스트 기능을 제공합니다.
 */
import type { Plugin, ViteDevServer } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import { generateOpenAPISpec } from './src/api/openapi-spec';

/**
 * Swagger UI Vite 플러그인
 * - /api-docs: Swagger UI 페이지
 * - /api-docs/openapi.json: OpenAPI 스펙 JSON
 */
export function swaggerPlugin(): Plugin {
  return {
    name: 'swagger-ui',
    apply: 'serve', // 개발 서버에서만 적용
    configureServer(server: ViteDevServer) {
      // swagger-ui-dist 패키지 경로 찾기
      let swaggerUiPath: string;
      try {
        swaggerUiPath = path.dirname(require.resolve('swagger-ui-dist/package.json'));
      } catch {
        console.warn('[swagger-ui] swagger-ui-dist 패키지를 찾을 수 없습니다');
        return;
      }

      // Swagger UI 미들웨어
      server.middlewares.use('/api-docs', (req, res, next) => {
        const url = req.url || '/';
        const urlPath = url.split('?')[0]; // 쿼리 파라미터 제거

        // 루트 경로: Swagger UI HTML 페이지
        if (urlPath === '/' || urlPath === '') {
          const indexHtml = generateSwaggerUIHtml();
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(indexHtml);
          return;
        }

        // OpenAPI 스펙 JSON
        if (urlPath === '/openapi.json') {
          const spec = generateOpenAPISpec();
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(spec, null, 2));
          return;
        }

        // swagger-ui-dist 정적 파일 서빙
        const staticPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
        const filePath = path.join(swaggerUiPath, staticPath);

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const contentTypes: Record<string, string> = {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.map': 'application/json',
          };
          const contentType = contentTypes[ext] || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.end(content);
          return;
        }

        next();
      });

      // 서버 시작 시 안내 메시지
      console.log('\n📚 Swagger UI: http://localhost:3000/api-docs');
      console.log('📄 OpenAPI Spec: http://localhost:3000/api-docs/openapi.json\n');
    },
  };
}

/**
 * Swagger UI HTML 페이지 생성
 */
function generateSwaggerUIHtml(): string {
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DepsSmuggler API Documentation</title>
  <link rel="stylesheet" href="/api-docs/swagger-ui.css">
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }
    .swagger-ui .topbar {
      background-color: #1890ff;
    }
    .swagger-ui .topbar .download-url-wrapper {
      display: none;
    }
    .custom-header {
      background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
      color: white;
      padding: 20px 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .custom-header h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      font-weight: 600;
    }
    .custom-header p {
      margin: 0;
      opacity: 0.9;
      font-size: 14px;
    }
    .custom-header .badges {
      margin-top: 12px;
    }
    .custom-header .badge {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      margin-right: 8px;
    }
    .swagger-ui .info {
      margin-top: 0;
    }
    /* 다크 모드 지원 */
    @media (prefers-color-scheme: dark) {
      body {
        background: #1a1a1a;
      }
      .swagger-ui {
        filter: invert(88%) hue-rotate(180deg);
      }
      .swagger-ui img {
        filter: invert(100%) hue-rotate(180deg);
      }
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <h1>DepsSmuggler API</h1>
    <p>폐쇄망 환경을 위한 패키지 의존성 다운로드 API</p>
    <div class="badges">
      <span class="badge">OpenAPI 3.0</span>
      <span class="badge">개발 환경 전용</span>
      <span class="badge">v1.0.0</span>
    </div>
  </div>
  <div id="swagger-ui"></div>

  <script src="/api-docs/swagger-ui-bundle.js"></script>
  <script src="/api-docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/api-docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: 'StandaloneLayout',
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        syntaxHighlight: {
          activate: true,
          theme: 'monokai'
        },
        tryItOutEnabled: true,
        requestInterceptor: (req) => {
          // 요청 인터셉터 (필요시 헤더 추가 등)
          return req;
        },
        responseInterceptor: (res) => {
          // 응답 인터셉터
          return res;
        }
      });
    };
  </script>
</body>
</html>
  `.trim();
}

export default swaggerPlugin;
