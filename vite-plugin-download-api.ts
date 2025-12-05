import type { Plugin, ViteDevServer } from 'vite';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import {
  DownloadPackage,
  DownloadOptions,
  getPyPIDownloadUrl,
  getCondaDownloadUrl,
  downloadFile,
  createZipArchive,
  generateInstallScripts,
  resolveAllDependencies,
} from './src/core/shared';

// 활성 SSE 연결 관리
const sseClients = new Map<string, http.ServerResponse>();

export function downloadApiPlugin(): Plugin {
  return {
    name: 'download-api',
    configureServer(server: ViteDevServer) {
      // SSE 연결 엔드포인트
      server.middlewares.use('/api/download/events', (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const clientId = url.searchParams.get('clientId');

        if (!clientId) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'clientId required' }));
          return;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // SSE 연결 즉시 응답하여 클라이언트가 연결 성공을 인식하도록 함
        res.write(':connected\n\n');

        sseClients.set(clientId, res);

        req.on('close', () => {
          sseClients.delete(clientId);
        });
      });

      // 출력 폴더 검사 엔드포인트
      server.middlewares.use('/api/download/check-path', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { outputDir } = JSON.parse(body) as { outputDir: string };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (!outputDir) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'outputDir required' }));
              return;
            }

            // 폴더 존재 여부 확인
            if (!fs.existsSync(outputDir)) {
              res.end(JSON.stringify({ exists: false, files: [], totalSize: 0 }));
              return;
            }

            // 폴더 내용 검사
            const files: string[] = [];
            let totalSize = 0;

            const scanDir = (dir: string) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  scanDir(fullPath);
                } else {
                  files.push(path.relative(outputDir, fullPath));
                  totalSize += fs.statSync(fullPath).size;
                }
              }
            };

            scanDir(outputDir);

            res.end(JSON.stringify({
              exists: true,
              files,
              fileCount: files.length,
              totalSize,
            }));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // 출력 폴더 삭제 엔드포인트
      server.middlewares.use('/api/download/clear-path', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { outputDir } = JSON.parse(body) as { outputDir: string };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (!outputDir) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'outputDir required' }));
              return;
            }

            // 폴더가 없으면 성공으로 처리
            if (!fs.existsSync(outputDir)) {
              res.end(JSON.stringify({ success: true, deleted: false }));
              return;
            }

            // 폴더 내용 삭제 (폴더 자체는 유지)
            const deleteContents = (dir: string) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  deleteContents(fullPath);
                  fs.rmdirSync(fullPath);
                } else {
                  fs.unlinkSync(fullPath);
                }
              }
            };

            deleteContents(outputDir);

            res.end(JSON.stringify({ success: true, deleted: true }));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // 다운로드 시작 엔드포인트
      server.middlewares.use('/api/download/start', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { packages, options, clientId } = JSON.parse(body) as {
              packages: DownloadPackage[];
              options: DownloadOptions;
              clientId: string;
            };

            const sseClient = sseClients.get(clientId);
            const sendEvent = (event: string, data: unknown) => {
              if (sseClient && !sseClient.writableEnded) {
                sseClient.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
              }
            };

            const { outputDir, outputFormat, includeScripts, targetOS, architecture, includeDependencies, pythonVersion } = options;

            // 의존성 해결 상태 전송
            sendEvent('status', {
              phase: 'resolving',
              message: '의존성 분석 중...',
            });

            // 의존성 해결
            let allPackages: DownloadPackage[] = packages;

            // includeDependencies가 false면 의존성 해결 건너뛰기
            if (includeDependencies === false) {
              console.log('의존성 해결 건너뛰기 (설정에서 비활성화됨)');
            } else {
              try {
                const resolved = await resolveAllDependencies(packages, {
                  targetOS: (targetOS as 'any' | 'windows' | 'macos' | 'linux') || 'any',
                  architecture: architecture || 'x86_64',
                  pythonVersion: pythonVersion,
                });
                allPackages = resolved.allPackages;

                console.log(`의존성 해결 완료: ${packages.length}개 → ${allPackages.length}개 패키지`);

                // 의존성 해결 완료 이벤트 전송
                sendEvent('deps-resolved', {
                  originalPackages: packages,
                  allPackages: allPackages,
                  dependencyTrees: resolved.dependencyTrees,
                  failedPackages: resolved.failedPackages,
                });
              } catch (error) {
                console.warn('의존성 해결 실패, 원본 패키지만 다운로드합니다:', error);
              }
            }

            // 다운로드 시작 상태 전송
            sendEvent('status', {
              phase: 'downloading',
              message: '다운로드 중...',
            });

            // 출력 디렉토리 생성
            const packagesDir = path.join(outputDir, 'packages');
            if (!fs.existsSync(packagesDir)) {
              fs.mkdirSync(packagesDir, { recursive: true });
            }

            const results: Array<{ id: string; success: boolean; error?: string }> = [];

            for (const pkg of allPackages) {
              try {
                sendEvent('progress', {
                  packageId: pkg.id,
                  status: 'downloading',
                  progress: 0,
                  downloadedBytes: 0,
                  totalBytes: 0,
                  speed: 0,
                });

                let downloadInfo: { url: string; filename: string; size: number } | null = null;

                if (pkg.type === 'conda') {
                  // conda 패키지는 conda repodata에서 URL 조회
                  downloadInfo = await getCondaDownloadUrl(
                    pkg.name,
                    pkg.version,
                    architecture || pkg.architecture,
                    targetOS,
                    'conda-forge',
                    pythonVersion
                  );
                } else if (pkg.type === 'pip') {
                  // pip 패키지는 PyPI에서 URL 조회
                  downloadInfo = await getPyPIDownloadUrl(
                    pkg.name,
                    pkg.version,
                    architecture || pkg.architecture,
                    targetOS,
                    pythonVersion
                  );
                }

                if (!downloadInfo) {
                  throw new Error(`다운로드 URL을 찾을 수 없습니다: ${pkg.name}@${pkg.version}`);
                }

                const destPath = path.join(packagesDir, downloadInfo.filename);
                let lastProgressUpdate = Date.now();
                let lastBytes = 0;

                await downloadFile(downloadInfo.url, destPath, (downloaded, total) => {
                  const now = Date.now();
                  const elapsed = (now - lastProgressUpdate) / 1000;

                  if (elapsed >= 0.3) {
                    const speed = (downloaded - lastBytes) / elapsed;
                    const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;

                    sendEvent('progress', {
                      packageId: pkg.id,
                      status: 'downloading',
                      progress,
                      downloadedBytes: downloaded,
                      totalBytes: total,
                      speed,
                    });

                    lastProgressUpdate = now;
                    lastBytes = downloaded;
                  }
                });

                sendEvent('progress', {
                  packageId: pkg.id,
                  status: 'completed',
                  progress: 100,
                });

                results.push({ id: pkg.id, success: true });
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                sendEvent('progress', {
                  packageId: pkg.id,
                  status: 'failed',
                  error: errorMessage,
                });

                results.push({ id: pkg.id, success: false, error: errorMessage });
              }
            }

            // 설치 스크립트 생성 (의존성 포함)
            if (includeScripts) {
              generateInstallScripts(outputDir, allPackages);
            }

            // ZIP 압축
            if (outputFormat === 'zip') {
              try {
                const zipPath = `${outputDir}.zip`;
                await createZipArchive(outputDir, zipPath);
              } catch (error) {
                console.error('Failed to create ZIP:', error);
              }
            }

            sendEvent('complete', {
              success: true,
              results,
              outputPath: outputDir,
            });

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, results }));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // 의존성 해결 엔드포인트 (장바구니에서 의존성 트리 미리보기용)
      server.middlewares.use('/api/dependency/resolve', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const requestBody = JSON.parse(body);
            // 하위 호환성: 배열인 경우 기존 방식, 객체인 경우 새 방식
            let packages: DownloadPackage[];
            let resolverOptions: { targetOS?: string; architecture?: string; pythonVersion?: string } = {};

            if (Array.isArray(requestBody)) {
              packages = requestBody as DownloadPackage[];
            } else {
              packages = requestBody.packages as DownloadPackage[];
              resolverOptions = requestBody.options || {};
            }

            console.log(`Resolving dependencies for ${packages.length} packages (targetOS: ${resolverOptions.targetOS || 'any'}, python: ${resolverOptions.pythonVersion || 'any'})`);

            const resolved = await resolveAllDependencies(packages, {
              targetOS: resolverOptions.targetOS as 'any' | 'windows' | 'macos' | 'linux' | undefined,
              architecture: resolverOptions.architecture,
              pythonVersion: resolverOptions.pythonVersion,
            });
            console.log(`Dependencies resolved: ${packages.length} → ${resolved.allPackages.length} packages`);

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify({
              originalPackages: packages,
              allPackages: resolved.allPackages,
              dependencyTrees: resolved.dependencyTrees,
              failedPackages: resolved.failedPackages,
            }));
          } catch (error) {
            console.error('Failed to resolve dependencies:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // PyPI 프록시 (CORS 우회용)
      server.middlewares.use('/api/pypi', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const pypiPath = url.pathname.replace('/api/pypi', '');
        const pypiUrl = `https://pypi.org${pypiPath}`;

        https
          .get(pypiUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (pypiRes) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            pypiRes.pipe(res);
          })
          .on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
      });

      // Maven Central 검색 프록시 (CORS 우회용)
      server.middlewares.use('/api/maven/search', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const query = url.searchParams.get('q') || '';
        const mavenUrl = `https://search.maven.org/solrsearch/select?q=${encodeURIComponent(query)}&rows=20&wt=json`;

        https
          .get(mavenUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (mavenRes) => {
            let data = '';
            mavenRes.on('data', (chunk) => (data += chunk));
            mavenRes.on('end', () => {
              try {
                const json = JSON.parse(data);
                const results = json.response.docs.map((doc: { g: string; a: string; latestVersion: string }) => ({
                  name: `${doc.g}:${doc.a}`,
                  version: doc.latestVersion,
                  description: `Maven artifact: ${doc.g}:${doc.a}`,
                }));
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ results }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to parse Maven response' }));
              }
            });
          })
          .on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
      });

      // npm Registry 검색 프록시 (CORS 우회용)
      server.middlewares.use('/api/npm/search', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const query = url.searchParams.get('q') || '';
        const npmUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`;

        https
          .get(npmUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (npmRes) => {
            let data = '';
            npmRes.on('data', (chunk) => (data += chunk));
            npmRes.on('end', () => {
              try {
                const json = JSON.parse(data);
                const results = json.objects.map((obj: { package: { name: string; version: string; description?: string } }) => ({
                  name: obj.package.name,
                  version: obj.package.version,
                  description: obj.package.description || '',
                }));
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ results }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to parse npm response' }));
              }
            });
          })
          .on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
      });

      // Docker Hub 검색 프록시 (CORS 우회용)
      server.middlewares.use('/api/docker/search', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const query = url.searchParams.get('q') || '';
        const dockerUrl = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=20`;

        https
          .get(dockerUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (dockerRes) => {
            let data = '';
            dockerRes.on('data', (chunk) => (data += chunk));
            dockerRes.on('end', () => {
              try {
                const json = JSON.parse(data);
                const results = (json.results || []).map((repo: { repo_name: string; short_description?: string }) => ({
                  name: repo.repo_name,
                  version: 'latest',
                  description: repo.short_description || '',
                }));
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ results }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to parse Docker Hub response' }));
              }
            });
          })
          .on('error', (err) => {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          });
      });
    },
  };
}
