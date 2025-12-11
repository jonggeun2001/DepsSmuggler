import type { Plugin, ViteDevServer } from 'vite';
import * as fs from 'fs';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import pLimit from 'p-limit';
import {
  DownloadPackage,
  DownloadOptions,
  getPyPIDownloadUrl,
  getCondaDownloadUrl,
  downloadFile,
  createZipArchive,
  generateInstallScripts,
  resolveAllDependencies,
  sortByRelevance,
} from './src/core/shared';

// OS 패키지 관련
import {
  OSPackageDownloader,
  OS_DISTRIBUTIONS,
  getDistributionsByPackageManager,
  getDistributionById,
  getSimplifiedDistributions,
  invalidateDistributionCache,
} from './src/core/downloaders/os';
import type {
  OSPackageManager,
  OSDistribution,
  OSArchitecture,
  OSPackageInfo,
  MatchType,
} from './src/core/downloaders/os/types';

// Docker 다운로더
import { getDockerDownloader } from './src/core/downloaders/docker';
import type { Architecture } from './src/types';

// OS 다운로더 싱글톤
let osDownloaderInstance: OSPackageDownloader | null = null;
function getOSDownloader(): OSPackageDownloader {
  if (!osDownloaderInstance) {
    osDownloaderInstance = new OSPackageDownloader({ concurrency: 3 });
  }
  return osDownloaderInstance;
}

// 활성 SSE 연결 관리
const sseClients = new Map<string, http.ServerResponse>();

// 취소 플래그 관리
const cancelFlags = new Map<string, boolean>();

// Maven 다운로드 URL 생성
const MAVEN_REPO_URL = 'https://repo1.maven.org/maven2';

function getMavenDownloadUrl(
  name: string,
  version: string
): { url: string; filename: string; size: number; m2SubPath: string } | null {
  // name은 "groupId:artifactId" 형식
  const parts = name.split(':');
  if (parts.length < 2) {
    return null;
  }

  const groupId = parts[0];
  const artifactId = parts[1];
  const groupPath = groupId.replace(/\./g, '/');
  const filename = `${artifactId}-${version}.jar`;
  const url = `${MAVEN_REPO_URL}/${groupPath}/${artifactId}/${version}/${filename}`;
  // .m2 저장소 구조: groupId/artifactId/version
  const m2SubPath = `${groupPath}/${artifactId}/${version}`;

  return { url, filename, size: 0, m2SubPath };
}

// npm 다운로드 URL 조회 (registry에서 tarball URL 가져오기)
async function getNpmDownloadUrl(
  name: string,
  version: string
): Promise<{ url: string; filename: string; size: number } | null> {
  return new Promise((resolve) => {
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;

    https.get(registryUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tarballUrl = json.dist?.tarball;
          if (!tarballUrl) {
            resolve(null);
            return;
          }

          const filename = path.basename(new URL(tarballUrl).pathname);
          resolve({
            url: tarballUrl,
            filename,
            size: json.dist?.unpackedSize || 0,
          });
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
}

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
          // 클라이언트가 연결을 끊으면 취소로 간주
          cancelFlags.set(clientId, true);
          sseClients.delete(clientId);
          console.log(`SSE connection closed for client: ${clientId}`);
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

      // 다운로드 취소 엔드포인트
      server.middlewares.use('/api/download/cancel', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { clientId } = JSON.parse(body) as { clientId: string };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (!clientId) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'clientId required' }));
              return;
            }

            // 취소 플래그 설정
            cancelFlags.set(clientId, true);

            // SSE 연결 종료
            const sseClient = sseClients.get(clientId);
            if (sseClient && !sseClient.writableEnded) {
              sseClient.write(`event: cancelled\ndata: ${JSON.stringify({ message: '다운로드 취소됨' })}\n\n`);
              sseClient.end();
            }

            sseClients.delete(clientId);

            console.log(`Download cancelled for client: ${clientId}`);

            res.end(JSON.stringify({ success: true, cancelled: true }));
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

            const { outputDir, outputFormat, includeScripts, targetOS, architecture, includeDependencies, pythonVersion, concurrency = 3 } = options;

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

            // 다운로드 시작 전 취소 플래그 초기화
            cancelFlags.set(clientId, false);

            const results: Array<{ id: string; success: boolean; error?: string }> = [];
            let downloadCancelled = false;

            // p-limit를 사용한 동시 다운로드 제어
            const limit = pLimit(concurrency);
            console.log(`다운로드 시작: concurrency=${concurrency}, 총 ${allPackages.length}개 패키지`);

            // 각 패키지 다운로드 작업을 생성
            const downloadPackage = async (pkg: DownloadPackage): Promise<{ id: string; success: boolean; error?: string }> => {
              // 취소 체크
              if (cancelFlags.get(clientId)) {
                return { id: pkg.id, success: false, error: 'cancelled' };
              }

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
                } else if (pkg.type === 'maven') {
                  // maven 패키지는 Maven Central에서 URL 생성
                  downloadInfo = getMavenDownloadUrl(pkg.name, pkg.version);
                } else if (pkg.type === 'npm') {
                  // npm 패키지는 npm registry에서 tarball URL 조회
                  downloadInfo = await getNpmDownloadUrl(pkg.name, pkg.version);
                } else if (pkg.type === 'yum' || pkg.type === 'apt' || pkg.type === 'apk') {
                  // OS 패키지는 장바구니에 담긴 URL 정보 사용
                  if (pkg.downloadUrl) {
                    const ext = pkg.type === 'yum' ? 'rpm' : pkg.type === 'apt' ? 'deb' : 'apk';
                    const filename = `${pkg.name}-${pkg.version}.${ext}`;
                    downloadInfo = { url: pkg.downloadUrl, filename, size: 0 };
                  } else if (pkg.repository?.baseUrl && pkg.location) {
                    // 저장소 기본 URL과 위치로 URL 생성
                    // $basearch 변수를 실제 아키텍처로 치환
                    const arch = pkg.architecture || 'x86_64';
                    const baseUrl = pkg.repository.baseUrl.replace(/\$basearch/g, arch);
                    const url = `${baseUrl}${pkg.location}`;
                    const filename = path.basename(pkg.location);
                    downloadInfo = { url, filename, size: 0 };
                  }
                } else if (pkg.type === 'docker') {
                  // Docker 이미지는 별도 처리 (레이어별 다운로드 + tar 생성)
                  const dockerDownloader = getDockerDownloader();
                  const registry = (pkg.metadata?.registry as string) || 'docker.io';
                  const arch = (pkg.architecture || 'amd64') as Architecture;
                  let dockerTotalBytes = 0;

                  sendEvent('progress', {
                    packageId: pkg.id,
                    status: 'downloading',
                    progress: 0,
                    message: 'Docker 이미지 다운로드 중...',
                  });

                  const tarPath = await dockerDownloader.downloadImage(
                    pkg.name,
                    pkg.version,
                    arch,
                    packagesDir,
                    (progress) => {
                      dockerTotalBytes = progress.totalBytes;
                      sendEvent('progress', {
                        packageId: pkg.id,
                        status: 'downloading',
                        progress: progress.progress,
                        downloadedBytes: progress.downloadedBytes,
                        totalBytes: progress.totalBytes,
                        speed: progress.speed,
                      });
                    },
                    registry
                  );

                  console.log(`Docker 이미지 다운로드 완료: ${tarPath}`);

                  sendEvent('progress', {
                    packageId: pkg.id,
                    status: 'completed',
                    progress: 100,
                    downloadedBytes: dockerTotalBytes,
                    totalBytes: dockerTotalBytes,
                  });

                  return { id: pkg.id, success: true };
                }

                if (!downloadInfo) {
                  throw new Error(`다운로드 URL을 찾을 수 없습니다: ${pkg.name}@${pkg.version}`);
                }

                // Maven의 경우 .m2 구조로 다운로드
                let destPath: string;
                let m2DestPath: string | null = null;

                if (pkg.type === 'maven' && 'm2SubPath' in downloadInfo && downloadInfo.m2SubPath) {
                  // .m2 구조: packages/m2repo/com/example/artifact/1.0.0/artifact-1.0.0.jar
                  const m2RepoDir = path.join(packagesDir, 'm2repo');
                  const m2Dir = path.join(m2RepoDir, downloadInfo.m2SubPath);
                  await fsExtra.ensureDir(m2Dir);
                  m2DestPath = path.join(m2Dir, downloadInfo.filename);
                  // flat 구조로 먼저 다운로드
                  destPath = path.join(packagesDir, downloadInfo.filename);
                } else {
                  destPath = path.join(packagesDir, downloadInfo.filename);
                }

                let lastProgressUpdate = Date.now();
                let lastBytes = 0;
                let finalTotalBytes = 0;

                await downloadFile(downloadInfo.url, destPath, (downloaded, total) => {
                  const now = Date.now();
                  const elapsed = (now - lastProgressUpdate) / 1000;
                  finalTotalBytes = total;

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

                // Maven의 경우 m2repo 구조에도 복제하고, pom/sha1 파일도 다운로드
                if (pkg.type === 'maven' && m2DestPath && 'm2SubPath' in downloadInfo) {
                  // flat에서 m2repo로 복제
                  await fsExtra.copy(destPath, m2DestPath);

                  // pom, sha1 파일도 다운로드 (m2repo 구조에만)
                  const m2RepoDir = path.join(packagesDir, 'm2repo');
                  const m2Dir = path.join(m2RepoDir, downloadInfo.m2SubPath);
                  const baseUrl = downloadInfo.url.replace(/\.jar$/, '');
                  const baseFilename = downloadInfo.filename.replace(/\.jar$/, '');

                  // 추가 파일 다운로드 (pom, jar.sha1, pom.sha1)
                  const additionalFiles = [
                    { ext: '.pom', filename: `${baseFilename}.pom` },
                    { ext: '.jar.sha1', filename: `${baseFilename}.jar.sha1` },
                    { ext: '.pom.sha1', filename: `${baseFilename}.pom.sha1` },
                  ];

                  for (const file of additionalFiles) {
                    try {
                      const url = file.ext === '.pom'
                        ? `${baseUrl}.pom`
                        : file.ext === '.jar.sha1'
                          ? `${downloadInfo.url}.sha1`
                          : `${baseUrl}.pom.sha1`;
                      const filePath = path.join(m2Dir, file.filename);
                      await downloadFile(url, filePath, () => {});
                    } catch {
                      // pom이나 sha1 파일은 없을 수 있으므로 무시
                    }
                  }
                }

                sendEvent('progress', {
                  packageId: pkg.id,
                  status: 'completed',
                  progress: 100,
                  downloadedBytes: finalTotalBytes,
                  totalBytes: finalTotalBytes,
                });

                return { id: pkg.id, success: true };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);

                sendEvent('progress', {
                  packageId: pkg.id,
                  status: 'failed',
                  error: errorMessage,
                });

                return { id: pkg.id, success: false, error: errorMessage };
              }
            };

            // 동시 다운로드 실행
            const downloadPromises = allPackages.map((pkg) => limit(() => downloadPackage(pkg)));
            const downloadResults = await Promise.all(downloadPromises);

            // 취소 체크
            if (cancelFlags.get(clientId)) {
              console.log('Download cancelled');
              sendEvent('cancelled', { message: '다운로드가 취소되었습니다' });
              downloadCancelled = true;
            }

            // 결과 수집
            results.push(...downloadResults.filter(r => r.error !== 'cancelled'));

            // 취소된 경우 스크립트 생성 및 압축 건너뛰기
            if (!downloadCancelled) {
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
            }

            // 다운로드 종료 시 취소 플래그 정리
            cancelFlags.delete(clientId);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: !downloadCancelled, results, cancelled: downloadCancelled }));
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
                let results = json.response.docs.map((doc: { g: string; a: string; latestVersion: string }) => ({
                  name: `${doc.g}:${doc.a}`,
                  version: doc.latestVersion,
                  description: `Maven artifact: ${doc.g}:${doc.a}`,
                }));
                // Maven 검색 결과 정렬 적용
                results = sortByRelevance(results, query, 'maven');
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

      // Maven 버전 목록 조회 프록시 (CORS 우회용)
      server.middlewares.use('/api/maven/versions', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const packageName = url.searchParams.get('package') || '';

        if (!packageName || !packageName.includes(':')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid package name. Format: groupId:artifactId' }));
          return;
        }

        const [groupId, artifactId] = packageName.split(':');
        const groupPath = groupId.replace(/\./g, '/');
        const metadataUrl = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/maven-metadata.xml`;

        https
          .get(metadataUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (mavenRes) => {
            let data = '';
            mavenRes.on('data', (chunk) => (data += chunk));
            mavenRes.on('end', () => {
              try {
                // XML에서 버전 목록 추출
                const versionRegex = /<version>([^<]+)<\/version>/g;
                const versions: string[] = [];
                let match;

                while ((match = versionRegex.exec(data)) !== null) {
                  versions.push(match[1]);
                }

                // 버전 정렬 (최신순)
                const sortedVersions = versions.sort((a, b) => {
                  const normalize = (v: string) =>
                    v.split(/[.-]/).map((p) => {
                      const num = parseInt(p, 10);
                      return isNaN(num) ? p : num;
                    });

                  const partsA = normalize(a);
                  const partsB = normalize(b);

                  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
                    const partA = partsA[i] ?? 0;
                    const partB = partsB[i] ?? 0;

                    if (typeof partA === 'number' && typeof partB === 'number') {
                      if (partA !== partB) return partB - partA; // 내림차순
                    } else {
                      const strA = String(partA);
                      const strB = String(partB);
                      if (strA !== strB) return strB.localeCompare(strA); // 내림차순
                    }
                  }
                  return 0;
                });

                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ versions: sortedVersions }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Failed to parse Maven metadata' }));
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
                let results = json.objects.map((obj: { package: { name: string; version: string; description?: string } }) => ({
                  name: obj.package.name,
                  version: obj.package.version,
                  description: obj.package.description || '',
                }));
                // npm 검색 결과 정렬 적용
                results = sortByRelevance(results, query, 'npm');
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

      // Docker 검색 프록시 (CORS 우회용, 다중 레지스트리 지원)
      server.middlewares.use('/api/docker/search', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const query = url.searchParams.get('q') || '';
        const registry = url.searchParams.get('registry') || 'docker.io';

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Docker Hub: 검색 API 사용
        if (registry === 'docker.io') {
          const dockerUrl = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page_size=20`;

          https
            .get(dockerUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (dockerRes) => {
              let data = '';
              dockerRes.on('data', (chunk) => (data += chunk));
              dockerRes.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  let results = (json.results || []).map((repo: {
                    repo_name: string;
                    short_description?: string;
                    is_official?: boolean;
                    pull_count?: number;
                  }) => ({
                    name: repo.repo_name,
                    version: 'latest',
                    description: repo.short_description || '',
                    isOfficial: repo.is_official || false,
                    pullCount: repo.pull_count || 0,
                    registry: 'docker.io',
                  }));
                  // Docker 검색 결과 정렬 적용
                  results = sortByRelevance(results, query, 'docker');
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
        } else {
          // 다른 레지스트리: 카탈로그 API 사용
          const registryConfigs: Record<string, { registryUrl: string; authUrl?: string }> = {
            'ghcr.io': { registryUrl: 'https://ghcr.io/v2' },
            'ecr': { registryUrl: 'https://public.ecr.aws/v2' },
            'quay.io': { registryUrl: 'https://quay.io/v2' },
          };

          const config = registryConfigs[registry] || { registryUrl: `https://${registry}/v2` };
          const catalogUrl = `${config.registryUrl}/_catalog?n=100`;

          https
            .get(catalogUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (catalogRes) => {
              let data = '';
              catalogRes.on('data', (chunk) => (data += chunk));
              catalogRes.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  const repositories = json.repositories || [];

                  // 검색어로 필터링
                  const filtered = repositories.filter((name: string) =>
                    name.toLowerCase().includes(query.toLowerCase())
                  );

                  let results = filtered.map((name: string) => ({
                    name,
                    version: 'latest',
                    description: '',
                    isOfficial: false,
                    pullCount: 0,
                    registry,
                  }));

                  results = sortByRelevance(results, query, 'docker');
                  res.end(JSON.stringify({ results }));
                } catch (err) {
                  // 인증 필요한 경우 빈 결과 반환
                  res.end(JSON.stringify({ results: [], message: '레지스트리 접근에 인증이 필요하거나 카탈로그를 지원하지 않습니다.' }));
                }
              });
            })
            .on('error', (err) => {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            });
        }
      });

      // Docker 이미지 태그 목록 조회 API
      server.middlewares.use('/api/docker/tags', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const imageName = url.searchParams.get('image') || '';
        const registry = url.searchParams.get('registry') || 'docker.io';

        if (!imageName) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'image parameter required' }));
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Docker Hub: 태그 API
        if (registry === 'docker.io') {
          // library/ 접두사 처리 (공식 이미지)
          const fullName = imageName.includes('/') ? imageName : `library/${imageName}`;
          const tagsUrl = `https://hub.docker.com/v2/repositories/${fullName}/tags/?page_size=100`;

          https
            .get(tagsUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (tagsRes) => {
              let data = '';
              tagsRes.on('data', (chunk) => (data += chunk));
              tagsRes.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  const tags = (json.results || []).map((tag: { name: string }) => tag.name);
                  res.end(JSON.stringify({ tags }));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Failed to parse Docker Hub tags response' }));
                }
              });
            })
            .on('error', (err) => {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            });
        } else {
          // 다른 레지스트리: Registry V2 API
          const registryConfigs: Record<string, { registryUrl: string }> = {
            'ghcr.io': { registryUrl: 'https://ghcr.io/v2' },
            'ecr': { registryUrl: 'https://public.ecr.aws/v2' },
            'quay.io': { registryUrl: 'https://quay.io/v2' },
          };

          const config = registryConfigs[registry] || { registryUrl: `https://${registry}/v2` };
          const tagsUrl = `${config.registryUrl}/${imageName}/tags/list`;

          https
            .get(tagsUrl, { headers: { 'User-Agent': 'DepsSmuggler/1.0' } }, (tagsRes) => {
              let data = '';
              tagsRes.on('data', (chunk) => (data += chunk));
              tagsRes.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  const tags = json.tags || ['latest'];
                  res.end(JSON.stringify({ tags }));
                } catch (err) {
                  // 인증 필요시 기본 태그 반환
                  res.end(JSON.stringify({ tags: ['latest'] }));
                }
              });
            })
            .on('error', (err) => {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            });
        }
      });

      // Docker 카탈로그 캐시 상태 조회 API
      server.middlewares.use('/api/docker/cache/status', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        try {
          const dockerDownloader = getDockerDownloader();
          const status = dockerDownloader.getCatalogCacheStatus();
          res.end(JSON.stringify({ status }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });

      // Docker 카탈로그 캐시 새로고침 API
      server.middlewares.use('/api/docker/cache/refresh', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');

          try {
            const { registry } = JSON.parse(body || '{}');
            const dockerDownloader = getDockerDownloader();

            if (registry) {
              // 특정 레지스트리 캐시 새로고침
              const repositories = await dockerDownloader.refreshCatalogCache(registry);
              res.end(JSON.stringify({ success: true, registry, repositoryCount: repositories.length }));
            } else {
              // 모든 캐시 삭제
              dockerDownloader.clearCatalogCache();
              res.end(JSON.stringify({ success: true, message: '모든 카탈로그 캐시가 삭제되었습니다' }));
            }
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // ==================== OS 패키지 API ====================

      // OS 배포판 목록 조회
      // - ?source=internet : 인터넷에서 최신 배포판 목록 가져오기
      // - ?source=local : 로컬 하드코딩된 목록 사용 (기본값)
      // - ?refresh=true : 캐시 무효화 후 새로 가져오기
      // - ?type=yum|apt|apk : 특정 패키지 관리자만 필터
      server.middlewares.use('/api/os/distributions', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const osType = url.searchParams.get('type') as OSPackageManager | null;
        const source = url.searchParams.get('source') || 'internet'; // 기본값: 인터넷
        const refresh = url.searchParams.get('refresh') === 'true';

        try {
          let distributions: Array<{
            id: string;
            name: string;
            version: string;
            osType: string;
            packageManager: string;
            architectures: string[];
          }>;

          if (source === 'internet') {
            // 인터넷에서 최신 배포판 목록 가져오기
            if (refresh) {
              invalidateDistributionCache();
            }
            const internetDistros = await getSimplifiedDistributions();

            // 필터링
            if (osType) {
              distributions = internetDistros.filter(d => d.packageManager === osType);
            } else {
              distributions = internetDistros;
            }
          } else {
            // 로컬 하드코딩된 목록 사용
            let localDistros: OSDistribution[];
            if (osType) {
              localDistros = getDistributionsByPackageManager(osType);
            } else {
              localDistros = OS_DISTRIBUTIONS;
            }

            // OSDistribution을 간소화된 형태로 변환
            distributions = localDistros.map(d => ({
              id: d.id,
              name: d.name,
              version: d.version,
              osType: 'linux',
              packageManager: d.packageManager,
              architectures: d.architectures as string[],
            }));
          }

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          // 배열 형태로 직접 반환 (SettingsPage에서 배열을 기대함)
          res.end(JSON.stringify(distributions));
        } catch (error) {
          console.error('Failed to fetch distributions:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });

      // OS 패키지 검색
      server.middlewares.use('/api/os/search', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const options = JSON.parse(body) as {
              query: string;
              distribution: OSDistribution | { id: string; packageManager?: string };
              architecture: OSArchitecture;
              matchType?: MatchType;
              limit?: number;
            };

            // distribution이 ID만 포함하는 간략한 객체일 경우, 전체 정보로 교체
            let fullDistribution: OSDistribution;
            if (options.distribution && 'id' in options.distribution) {
              const dist = getDistributionById(options.distribution.id);
              if (dist) {
                fullDistribution = dist;
              } else {
                // ID로 찾지 못하면 패키지 관리자로 첫 번째 배포판 사용
                const pm = (options.distribution as { packageManager?: string }).packageManager as OSPackageManager || 'yum';
                const distributions = getDistributionsByPackageManager(pm);
                if (distributions.length === 0) {
                  throw new Error(`No distribution found for package manager: ${pm}`);
                }
                fullDistribution = distributions[0];
              }
            } else {
              fullDistribution = options.distribution as OSDistribution;
            }

            // matchType 매핑: 'contains'와 'startsWith'는 'partial'로 매핑
            let resolvedMatchType: MatchType = 'partial';
            if (options.matchType === 'exact') {
              resolvedMatchType = 'exact';
            } else if (options.matchType === 'wildcard') {
              resolvedMatchType = 'wildcard';
            }

            const downloader = getOSDownloader();
            const result = await downloader.search({
              query: options.query,
              distribution: fullDistribution,
              architecture: options.architecture,
              matchType: resolvedMatchType,
              limit: options.limit || 50,
            });

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(result));
          } catch (error) {
            console.error('OS search error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // OS 패키지 의존성 해결
      server.middlewares.use('/api/os/resolve-dependencies', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const options = JSON.parse(body) as {
              packages: OSPackageInfo[];
              distribution: OSDistribution;
              architecture: OSArchitecture;
              includeOptional?: boolean;
              includeRecommends?: boolean;
            };

            const downloader = getOSDownloader();
            const result = await downloader.resolveDependencies(
              options.packages,
              options.distribution,
              options.architecture,
              {
                includeOptional: options.includeOptional,
                includeRecommends: options.includeRecommends,
              }
            );

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(result));
          } catch (error) {
            console.error('OS dependency resolution error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // OS 패키지 다운로드 (SSE로 진행 상황 전송)
      server.middlewares.use('/api/os/download/start', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const options = JSON.parse(body) as {
              packages: OSPackageInfo[];
              outputDir: string;
              clientId: string;
              resolveDependencies?: boolean;
              includeOptionalDeps?: boolean;
              verifyGPG?: boolean;
              concurrency?: number;
            };

            const sseClient = sseClients.get(options.clientId);
            const sendEvent = (event: string, data: any) => {
              if (sseClient && !sseClient.destroyed) {
                sseClient.write(`event: os:${event}\ndata: ${JSON.stringify(data)}\n\n`);
              }
            };

            const downloader = getOSDownloader();
            const result = await downloader.download({
              packages: options.packages,
              outputDir: options.outputDir,
              resolveDependencies: options.resolveDependencies ?? true,
              includeOptionalDeps: options.includeOptionalDeps ?? false,
              verifyGPG: options.verifyGPG ?? false,
              concurrency: options.concurrency ?? 3,
              cacheMode: 'session',
              onProgress: (progress) => {
                sendEvent('progress', progress);
              },
              onError: async (error) => {
                const pkgName = error.package?.name || 'unknown';
                sendEvent('error', { packageName: pkgName, message: error.message });
                return 'skip'; // 개발 모드에서는 기본적으로 건너뛰기
              },
            });

            sendEvent('complete', {
              success: result.success.length > 0,
              successCount: result.success.length,
              failedCount: result.failed.length,
              totalSize: result.totalSize,
            });

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(JSON.stringify(result));
          } catch (error) {
            console.error('OS download error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(error) }));
          }
        });
      });

      // =====================================================
      // 캐시 통계 조회 API (개발 환경용)
      // =====================================================
      server.middlewares.use('/api/cache/stats', async (req, res, next) => {
        if (req.method !== 'GET') {
          next();
          return;
        }

        try {
          const { getCacheStats: getPipCacheStats } = await import('./src/core/shared/pip-cache');
          const { getNpmCacheStats } = await import('./src/core/shared/npm-cache');
          const { getMavenCacheStats } = await import('./src/core/shared/maven-cache');
          const { getCacheStats: getCondaCacheStats } = await import('./src/core/shared/conda-cache');

          const pipStats = getPipCacheStats();
          const npmStats = getNpmCacheStats();
          const mavenStats = getMavenCacheStats();
          const condaStats = getCondaCacheStats();

          const totalEntryCount =
            pipStats.memoryEntries +
            pipStats.diskEntries +
            npmStats.entries +
            mavenStats.memoryEntries +
            condaStats.entries.length;

          const totalSize = pipStats.diskSize + condaStats.totalSize;

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({
            totalSize,
            entryCount: totalEntryCount,
            details: {
              pip: pipStats,
              npm: npmStats,
              maven: mavenStats,
              conda: condaStats,
            }
          }));
        } catch (error) {
          console.error('Cache stats error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });

      // =====================================================
      // 캐시 삭제 API (개발 환경용)
      // =====================================================
      server.middlewares.use('/api/cache/clear', async (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }

        try {
          const { clearAllCache: clearPipCache } = await import('./src/core/shared/pip-cache');
          const { clearNpmCache } = await import('./src/core/shared/npm-cache');
          const { clearMemoryCache: clearMavenMemoryCache, clearDiskCache: clearMavenDiskCache } = await import('./src/core/shared/maven-cache');
          const { clearCache: clearCondaCache } = await import('./src/core/shared/conda-cache');

          clearPipCache();
          clearNpmCache();
          clearMavenMemoryCache();
          await clearMavenDiskCache();
          clearCondaCache();

          console.log('All caches cleared (including conda)');

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('Cache clear error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}
