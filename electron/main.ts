import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import axios from 'axios';

// SSL 인증서 검증 비활성화 (기업 프록시/방화벽 환경 지원)
// 환경변수로 제어 가능: DEPSSMUGGLER_STRICT_SSL=true로 설정하면 검증 활성화
if (process.env.DEPSSMUGGLER_STRICT_SSL !== 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  // axios 기본 설정에 httpsAgent 추가
  axios.defaults.httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}
import { getLogger, createScopedLogger } from './utils/logger';

// 스코프별 로거 생성
const log = createScopedLogger('Main');
const searchLog = createScopedLogger('Search');
const downloadLog = createScopedLogger('Download');
import {
  DownloadPackage,
  DownloadOptions as SharedDownloadOptions,
  getPyPIDownloadUrl,
  downloadFile,
  createZipArchive,
  generateInstallScripts,
  resolveAllDependencies,
  sortByRelevance,
  Architecture,
} from '../src/core/shared';

// OS 패키지 핸들러
import { registerOSPackageHandlers } from './os-package-handlers';

// 다운로더 모듈 import
import {
  getPipDownloader,
  getMavenDownloader,
  getCondaDownloader,
  getDockerDownloader,
  getYumDownloader,
  getNpmDownloader,
  PipDownloader,
  MavenDownloader,
  CondaDownloader,
  DockerDownloader,
  YumDownloader,
  NpmDownloader,
} from '../src/core';

// 캐시 모듈 import
import * as pipCache from '../src/core/shared/pip-cache';
import * as npmCache from '../src/core/shared/npm-cache';
import * as mavenCache from '../src/core/shared/maven-cache';
import * as condaCache from '../src/core/shared/conda-cache';

// 자동 업데이트 모듈
import { initAutoUpdater, checkForUpdatesOnStartup } from './updater';

// 다운로더 타입 매핑
const downloaderMap = {
  pip: getPipDownloader,
  conda: getCondaDownloader,
  maven: getMavenDownloader,
  docker: getDockerDownloader,
  yum: getYumDownloader,
  npm: getNpmDownloader,
} as const;

type SupportedPackageType = keyof typeof downloaderMap;

// 개발 모드 여부 확인
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Vite 개발 서버 URL
const VITE_DEV_SERVER_URL = 'http://localhost:3000';

let mainWindow: BrowserWindow | null = null;

// Vite 서버가 준비될 때까지 대기하는 함수
async function waitForViteServer(
  url: string,
  maxRetries = 30,
  retryDelay = 500
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, { timeout: 1000 });
      if (response.status === 200) {
        log.info(`Vite server is ready after ${i + 1} attempts`);
        return true;
      }
    } catch {
      log.debug(`Waiting for Vite server... (${i + 1}/${maxRetries})`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }
  log.error('Vite server did not become ready in time');
  return false;
}

async function createWindow(): Promise<void> {
  // 아이콘 경로 설정
  const iconPath = path.join(__dirname, '..', 'assets', 'icons',
    process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
  );

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    resizable: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'DepsSmuggler - 의존성 밀수꾼',
    show: false, // ready-to-show 이벤트 후 표시
  });

  // 윈도우가 준비되면 표시
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 개발 모드: Vite 개발 서버 로드, 프로덕션: 빌드된 파일 로드
  if (isDev) {
    // Vite 서버가 준비될 때까지 대기
    const serverReady = await waitForViteServer(VITE_DEV_SERVER_URL);
    if (serverReady) {
      // Vite 개발 서버에서 로드
      mainWindow.loadURL(VITE_DEV_SERVER_URL);
    } else {
      // 서버가 준비되지 않았어도 시도 (오류 페이지 표시됨)
      mainWindow.loadURL(VITE_DEV_SERVER_URL);
    }
    // DevTools 자동 열기 (비활성화 - MCP 테스트 시 충돌 방지)
    // mainWindow.webContents.openDevTools();
  } else {
    // 프로덕션: dist/renderer/index.html (Vite 빌드 출력)
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 자동 업데이트 초기화
  initAutoUpdater(mainWindow);
}

// Electron 앱이 준비되면 윈도우 생성
app.whenReady().then(async () => {
  // 로거 초기화
  getLogger();

  await createWindow();

  // OS 패키지 IPC 핸들러 등록
  registerOSPackageHandlers(() => mainWindow);

  // 앱 시작 시 업데이트 체크 (프로덕션만)
  checkForUpdatesOnStartup();

  // macOS: Dock 아이콘 클릭 시 윈도우가 없으면 새로 생성
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 모든 윈도우가 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 핸들러
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

// 폴더 선택 다이얼로그
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: '출력 폴더 선택',
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// 디렉토리 선택 다이얼로그 (설정용)
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: '다운로드 폴더 선택',
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

// 폴더 열기 (Finder/Explorer)
ipcMain.handle('open-folder', async (_, folderPath: string) => {
  await shell.openPath(folderPath);
});

// 파일 저장 다이얼로그
ipcMain.handle('save-file', async (_, defaultPath: string) => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    title: '파일 저장',
    filters: [
      { name: 'ZIP 파일', extensions: ['zip'] },
      { name: 'TAR.GZ 파일', extensions: ['tar.gz'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePath;
});

// 버전 비교 함수
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.-]/);
  const partsB = b.split(/[.-]/);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const partA = partsA[i] || '0';
    const partB = partsB[i] || '0';
    const numA = parseInt(partA, 10);
    const numB = parseInt(partB, 10);

    if (!isNaN(numA) && !isNaN(numB)) {
      if (numA !== numB) return numA - numB;
    } else {
      const cmp = partA.localeCompare(partB);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// PyPI 패키지 목록 캐시 (like 검색용)
let pypiPackageCache: string[] = [];
let pypiCacheLoading = false;
let pypiCacheLoaded = false;

// PyPI Simple API에서 패키지 목록 로드
async function loadPyPIPackageList(): Promise<void> {
  if (pypiCacheLoaded || pypiCacheLoading) return;

  pypiCacheLoading = true;
  searchLog.info('Loading PyPI package list...');

  try {
    const response = await axios.get('https://pypi.org/simple/', {
      timeout: 30000,
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'DepsSmuggler/1.0',
      },
    });

    const html = response.data as string;
    // Simple API 형식: <a href="/simple/package-name/">package-name</a>
    const packageRegex = /<a[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = packageRegex.exec(html)) !== null) {
      pypiPackageCache.push(match[1].toLowerCase());
    }

    pypiCacheLoaded = true;
    searchLog.info(`PyPI package list loaded: ${pypiPackageCache.length} packages`);
  } catch (error) {
    searchLog.error('Failed to load PyPI package list:', error);
  } finally {
    pypiCacheLoading = false;
  }
}

// 앱 시작 시 백그라운드로 로드
loadPyPIPackageList();

// PyPI 패키지 검색 (like 검색)
async function searchPyPI(query: string) {
  const results: Array<{ name: string; version: string; description: string }> = [];
  const lowerQuery = query.toLowerCase();

  // 캐시에서 prefix 검색 (대소문자 무시, 앞부분 일치)
  if (pypiCacheLoaded && pypiPackageCache.length > 0) {
    const matchedPackages = pypiPackageCache
      .filter(pkg => pkg.startsWith(lowerQuery))
      .slice(0, 20);

    // 매칭된 패키지들의 상세 정보 조회 (병렬)
    const detailPromises = matchedPackages.map(async (pkgName) => {
      try {
        const response = await axios.get(`https://pypi.org/pypi/${pkgName}/json`, { timeout: 5000 });
        return {
          name: response.data.info.name,
          version: response.data.info.version,
          description: response.data.info.summary || '',
        };
      } catch {
        return null;
      }
    });

    const details = await Promise.all(detailPromises);
    results.push(...details.filter((d): d is NonNullable<typeof d> => d !== null));
  }

  // 캐시가 없거나 결과가 없으면 정확한 패키지명으로 직접 조회
  if (results.length === 0) {
    try {
      const exactResponse = await axios.get(`https://pypi.org/pypi/${query}/json`, { timeout: 10000 });
      const data = exactResponse.data;
      results.push({
        name: data.info.name,
        version: data.info.version,
        description: data.info.summary || '',
      });
    } catch {
      // 정확한 패키지도 없음
    }
  }

  return results;
}

// PyPI 버전 목록 조회
async function getPyPIVersions(packageName: string): Promise<string[]> {
  const response = await axios.get(`https://pypi.org/pypi/${packageName}/json`, { timeout: 10000 });
  const versions = Object.keys(response.data.releases);
  return versions.sort((a, b) => compareVersions(b, a));
}

// Maven 패키지 검색
async function searchMaven(query: string) {
  try {
    const response = await axios.get('https://search.maven.org/solrsearch/select', {
      params: { q: query, rows: 20, wt: 'json' },
      timeout: 10000,
    });
    return response.data.response.docs.map((doc: { g: string; a: string; latestVersion: string }) => ({
      name: `${doc.g}:${doc.a}`,
      version: doc.latestVersion,
      description: `Maven artifact: ${doc.g}:${doc.a}`,
    }));
  } catch {
    return [];
  }
}

// maven-metadata.xml에서 버전 목록 조회 (정확한 버전 순서)
async function getMavenVersionsFromMetadata(groupId: string, artifactId: string): Promise<string[]> {
  const groupPath = groupId.replace(/\./g, '/');
  const metadataUrl = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/maven-metadata.xml`;

  const response = await axios.get(metadataUrl, {
    responseType: 'text',
    timeout: 10000,
  });

  const versionRegex = /<version>([^<]+)<\/version>/g;
  const versions: string[] = [];
  let match;

  while ((match = versionRegex.exec(response.data)) !== null) {
    versions.push(match[1]);
  }

  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

// Search API에서 버전 목록 조회 (폴백용)
async function getMavenVersionsFromSearchApi(groupId: string, artifactId: string): Promise<string[]> {
  const response = await axios.get('https://search.maven.org/solrsearch/select', {
    params: {
      q: `g:"${groupId}" AND a:"${artifactId}"`,
      core: 'gav',
      rows: 100,
      wt: 'json',
    },
    timeout: 10000,
  });
  const versions = response.data.response.docs.map((doc: { v: string }) => doc.v);
  return versions.sort((a: string, b: string) => compareVersions(b, a));
}

// Maven 버전 목록 조회 (하이브리드 접근)
async function getMavenVersions(packageName: string): Promise<string[]> {
  const [groupId, artifactId] = packageName.split(':');

  try {
    // 1차: maven-metadata.xml에서 정확한 버전 목록 조회
    return await getMavenVersionsFromMetadata(groupId, artifactId);
  } catch (metadataError) {
    searchLog.warn('maven-metadata.xml 조회 실패, 폴백 API 사용:', metadataError);

    try {
      // 2차: 기존 Search API 폴백
      return await getMavenVersionsFromSearchApi(groupId, artifactId);
    } catch (error) {
      searchLog.error('Maven 버전 목록 조회 실패:', error);
      throw error;
    }
  }
}

// 패키지 검색 핸들러 (실제 API 호출)
ipcMain.handle('search:packages', async (_, type: string, query: string, options?: { channel?: string }) => {
  searchLog.debug(`Searching ${type} packages: ${query}`, options);

  try {
    let results: Array<{ name: string; version: string; description: string }> = [];

    switch (type) {
      case 'pip':
        results = await searchPyPI(query);
        results = sortByRelevance(results, query, 'pip');
        break;
      case 'conda':
        // conda는 실제 Anaconda API 사용
        const condaDownloader = getCondaDownloader();
        const channel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
        const condaResults = await condaDownloader.searchPackages(query, channel);
        results = condaResults.map(pkg => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description || '',
        }));
        results = sortByRelevance(results, query, 'conda');
        break;
      case 'maven':
        results = await searchMaven(query);
        results = sortByRelevance(results, query, 'maven');
        break;
      case 'npm':
        const npmDownloader = getNpmDownloader();
        const npmResults = await npmDownloader.searchPackages(query);
        results = npmResults.map(pkg => ({
          name: pkg.name,
          version: pkg.version,
          description: pkg.metadata?.description || '',
        }));
        results = sortByRelevance(results, query, 'npm');
        break;
      case 'docker':
        const dockerDownloader = getDockerDownloader();
        const dockerResults = await dockerDownloader.searchPackages(query);
        results = dockerResults.map(pkg => ({
          name: pkg.name,
          version: pkg.version || 'latest',
          description: pkg.metadata?.description || '',
        }));
        break;
      default:
        // 미구현 타입은 빈 배열 반환
        results = [];
    }

    return { results };
  } catch (error) {
    searchLog.error(`Search error for ${type}:`, error);
    return { results: [] };
  }
});

// 패키지 버전 목록 조회 핸들러
ipcMain.handle('search:versions', async (_, type: string, packageName: string, options?: { channel?: string }) => {
  searchLog.debug(`Getting versions for ${type} package: ${packageName}`, options);

  try {
    let versions: string[] = [];

    switch (type) {
      case 'pip':
        versions = await getPyPIVersions(packageName);
        break;
      case 'conda':
        // conda는 실제 Anaconda API 사용
        const condaDownloaderForVersions = getCondaDownloader();
        const channel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
        versions = await condaDownloaderForVersions.getVersions(packageName, channel);
        break;
      case 'maven':
        versions = await getMavenVersions(packageName);
        break;
      case 'npm':
        const npmDownloaderForVersions = getNpmDownloader();
        versions = await npmDownloaderForVersions.getVersions(packageName);
        break;
      case 'docker':
        const dockerDownloaderForVersions = getDockerDownloader();
        versions = await dockerDownloaderForVersions.getVersions(packageName);
        break;
      default:
        versions = [];
    }

    return { versions };
  } catch (error) {
    searchLog.error(`Version fetch error for ${type}/${packageName}:`, error);
    return { versions: [] };
  }
});

// 검색 타임아웃 설정 (5초)
const SEARCH_TIMEOUT = 5000;

// 자동완성 결과 캐싱 (메모리 캐시)
const suggestionCache = new Map<string, { results: string[]; timestamp: number }>();
const CACHE_TTL = 60000; // 1분

// 패키지 자동완성 제안
ipcMain.handle('search:suggest', async (_, type: string, query: string, options?: { channel?: string }) => {
  // 빈 쿼리면 빈 배열 반환 (2자 미만)
  if (!query || query.trim().length < 2) {
    return [];
  }

  // 캐시 키 생성 (conda의 경우 채널도 포함)
  const channelKey = type === 'conda' ? `:${options?.channel || 'conda-forge'}` : '';
  const cacheKey = `${type}${channelKey}:${query.toLowerCase()}`;

  // 캐시 확인
  const cached = suggestionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.results;
  }

  try {
    const packageType = type as SupportedPackageType;

    // 지원하지 않는 패키지 타입 처리
    if (!downloaderMap[packageType]) {
      searchLog.warn(`Unsupported package type for suggestion: ${type}`);
      return [];
    }

    const getDownloader = downloaderMap[packageType];
    const downloader = getDownloader();

    // 패키지 타입별 검색 Promise 생성
    let searchPromise: Promise<{ name: string }[]>;

    switch (packageType) {
      case 'pip':
        searchPromise = (downloader as PipDownloader).searchPackages(query);
        break;
      case 'conda':
        const condaChannel = (options?.channel || 'conda-forge') as 'conda-forge' | 'anaconda' | 'bioconda' | 'pytorch' | 'all';
        searchPromise = (downloader as CondaDownloader).searchPackages(query, condaChannel);
        break;
      case 'maven':
        searchPromise = (downloader as MavenDownloader).searchPackages(query);
        break;
      case 'docker':
        searchPromise = (downloader as DockerDownloader).searchPackages(query);
        break;
      case 'npm':
        searchPromise = (downloader as NpmDownloader).searchPackages(query);
        break;
      case 'yum':
        searchPromise = (downloader as YumDownloader).searchPackages(query);
        break;
      default:
        return [];
    }

    // 타임아웃 Promise 생성
    const timeoutPromise = new Promise<{ name: string }[]>((_, reject) => {
      setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT);
    });

    // Promise.race로 검색과 타임아웃 경쟁
    const results = await Promise.race([searchPromise, timeoutPromise]);

    // 패키지명만 추출하여 자동완성 제안 목록 반환
    const suggestions = results
      .map((pkg) => pkg.name)
      .filter((name, index, arr) => arr.indexOf(name) === index) // 중복 제거
      .slice(0, 10); // 최대 10개

    // 결과 캐싱
    suggestionCache.set(cacheKey, { results: suggestions, timestamp: Date.now() });

    return suggestions;
  } catch (error) {
    // 타임아웃 에러 처리
    if (error instanceof Error && error.message === 'Search timeout') {
      searchLog.warn(`Search timeout for ${type}: ${query}`);
      return [];
    }
    searchLog.error(`Package suggestion failed for ${type}:`, error);
    // 에러 발생 시 빈 배열 반환 (UI에서 graceful 처리)
    return [];
  }
});

// =====================================================
// 다운로드 관련 상태 및 핸들러
// =====================================================

// 타입 별칭 (공통 모듈에서 가져온 타입 사용)
type DownloadOptions = SharedDownloadOptions;

let downloadCancelled = false;
let downloadPaused = false;

// 다운로드 시작 핸들러
ipcMain.handle('download:start', async (event, data: { packages: DownloadPackage[]; options: DownloadOptions }) => {
  const { packages, options } = data;
  const { outputDir, outputFormat, includeScripts, targetOS, architecture, includeDependencies, pythonVersion } = options;

  downloadLog.info(`Starting download: ${packages.length} packages to ${outputDir}`);

  downloadCancelled = false;
  downloadPaused = false;

  // 의존성 해결 상태 전송
  mainWindow?.webContents.send('download:status', {
    phase: 'resolving',
    message: '의존성 분석 중...',
  });

  // 의존성 해결
  let allPackages: DownloadPackage[] = packages;

  // includeDependencies가 false면 의존성 해결 건너뛰기
  if (includeDependencies === false) {
    downloadLog.info('의존성 해결 건너뛰기 (설정에서 비활성화됨)');
  } else {
    try {
      const resolved = await resolveAllDependencies(packages, {
        targetOS: targetOS || 'any',
        architecture: architecture || 'x86_64',
        pythonVersion,
      });
      allPackages = resolved.allPackages;

      downloadLog.info(`의존성 해결 완료: ${packages.length}개 → ${allPackages.length}개 패키지`);

      // 의존성 해결 완료 이벤트 전송
      mainWindow?.webContents.send('download:deps-resolved', {
        originalPackages: packages,
        allPackages: allPackages,
        dependencyTrees: resolved.dependencyTrees,
        failedPackages: resolved.failedPackages,
      });
    } catch (error) {
      downloadLog.warn('의존성 해결 실패, 원본 패키지만 다운로드합니다:', error);
      // 실패 시 원본 패키지만 사용
    }
  }

  // 다운로드 시작 상태 전송
  mainWindow?.webContents.send('download:status', {
    phase: 'downloading',
    message: '다운로드 중...',
  });

  // 출력 디렉토리 생성
  const packagesDir = path.join(outputDir, 'packages');
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
  }

  const results: Array<{ id: string; success: boolean; error?: string }> = [];

  for (let i = 0; i < allPackages.length; i++) {
    if (downloadCancelled) break;

    const pkg = allPackages[i];

    // 일시정지 대기
    while (downloadPaused && !downloadCancelled) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (downloadCancelled) break;

    try {
      // 진행 상태 전송: 시작
      mainWindow?.webContents.send('download:progress', {
        packageId: pkg.id,
        status: 'downloading',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        speed: 0,
      });

      let downloadUrl: { url: string; filename: string } | null = null;

      // 패키지 타입에 따라 다운로드 URL 가져오기
      if (pkg.type === 'pip' || pkg.type === 'conda') {
        downloadUrl = await getPyPIDownloadUrl(
          pkg.name,
          pkg.version,
          architecture || pkg.architecture,
          targetOS,
          pythonVersion
        );
      } else if (pkg.type === 'npm') {
        // npm 패키지: npm downloader를 통해 메타데이터 조회
        const npmDownloader = getNpmDownloader();
        const metadata = await npmDownloader.getPackageMetadata(pkg.name, pkg.version);
        const tarballUrl = metadata.metadata?.downloadUrl;
        if (tarballUrl) {
          const filename = path.basename(new URL(tarballUrl).pathname);
          downloadUrl = { url: tarballUrl, filename };
        }
      } else if (pkg.type === 'maven') {
        // Maven 패키지: groupId:artifactId 형식에서 URL 생성
        const parts = pkg.name.split(':');
        if (parts.length >= 2) {
          const groupId = parts[0];
          const artifactId = parts[1];
          const groupPath = groupId.replace(/\./g, '/');
          const filename = `${artifactId}-${pkg.version}.jar`;
          const url = `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${pkg.version}/${filename}`;
          downloadUrl = { url, filename };
        }
      } else if (pkg.type === 'yum' || pkg.type === 'apt' || pkg.type === 'apk') {
        // OS 패키지는 장바구니에 담긴 URL 정보 사용
        const pkgWithUrl = pkg as {
          downloadUrl?: string;
          repository?: { baseUrl: string; name?: string };
          location?: string;
          architecture?: string;
        };
        if (pkgWithUrl.downloadUrl) {
          const ext = pkg.type === 'yum' ? 'rpm' : pkg.type === 'apt' ? 'deb' : 'apk';
          const filename = `${pkg.name}-${pkg.version}.${ext}`;
          downloadUrl = { url: pkgWithUrl.downloadUrl, filename };
        } else if (pkgWithUrl.repository?.baseUrl && pkgWithUrl.location) {
          // 저장소 기본 URL과 위치로 URL 생성
          // $basearch 변수를 실제 아키텍처로 치환
          const arch = pkgWithUrl.architecture || pkg.architecture || 'x86_64';
          const baseUrl = pkgWithUrl.repository.baseUrl.replace(/\$basearch/g, arch);
          const url = `${baseUrl}${pkgWithUrl.location}`;
          const filename = path.basename(pkgWithUrl.location);
          downloadUrl = { url, filename };
        }
      } else if (pkg.type === 'docker') {
        // Docker 이미지는 별도 처리 (레이어별 다운로드 + tar 생성)
        const dockerDownloader = getDockerDownloader();
        const registry = (pkg.metadata?.registry as string) || 'docker.io';
        const arch = (pkg.architecture || 'amd64') as Architecture;

        try {
          const tarPath = await dockerDownloader.downloadImage(
            pkg.name,
            pkg.version,
            arch,
            packagesDir,
            (progress) => {
              mainWindow?.webContents.send('download:progress', {
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

          // 완료 상태 전송
          mainWindow?.webContents.send('download:progress', {
            packageId: pkg.id,
            status: 'completed',
            progress: 100,
          });

          results.push({ id: pkg.id, success: true });
          continue; // Docker는 별도 처리 완료, 다음 패키지로
        } catch (dockerError) {
          const errorMessage = dockerError instanceof Error ? dockerError.message : String(dockerError);
          mainWindow?.webContents.send('download:progress', {
            packageId: pkg.id,
            status: 'error',
            error: errorMessage,
          });
          results.push({ id: pkg.id, success: false, error: errorMessage });
          continue;
        }
      }

      if (!downloadUrl) {
        throw new Error(`다운로드 URL을 찾을 수 없습니다: ${pkg.name}@${pkg.version}`);
      }

      const destPath = path.join(packagesDir, downloadUrl.filename);
      let lastProgressUpdate = Date.now();
      let lastBytes = 0;

      await downloadFile(downloadUrl.url, destPath, (downloaded, total) => {
        const now = Date.now();
        const elapsed = (now - lastProgressUpdate) / 1000;

        if (elapsed >= 0.5) { // 0.5초마다 업데이트
          const speed = (downloaded - lastBytes) / elapsed;
          const progress = total > 0 ? Math.round((downloaded / total) * 100) : 0;

          mainWindow?.webContents.send('download:progress', {
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

      // 완료 상태 전송
      mainWindow?.webContents.send('download:progress', {
        packageId: pkg.id,
        status: 'completed',
        progress: 100,
      });

      results.push({ id: pkg.id, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      downloadLog.error(`Download failed for ${pkg.name}:`, errorMessage);

      mainWindow?.webContents.send('download:progress', {
        packageId: pkg.id,
        status: 'failed',
        error: errorMessage,
      });

      results.push({ id: pkg.id, success: false, error: errorMessage });
    }
  }

  if (!downloadCancelled) {
    // 설치 스크립트 생성 (의존성 포함)
    if (includeScripts) {
      generateInstallScripts(outputDir, allPackages);
    }

    // ZIP 압축 (outputFormat이 zip인 경우)
    if (outputFormat === 'zip') {
      try {
        const zipPath = `${outputDir}.zip`;
        await createZipArchive(outputDir, zipPath);
        downloadLog.info(`Created ZIP archive: ${zipPath}`);
      } catch (error) {
        downloadLog.error('Failed to create ZIP archive:', error);
      }
    }

    // 전체 완료 이벤트 전송
    mainWindow?.webContents.send('download:all-complete', {
      success: true,
      outputPath: outputDir,
    });
  }

  return { success: !downloadCancelled, results };
});

// 다운로드 일시정지
ipcMain.handle('download:pause', async () => {
  downloadPaused = true;
  downloadLog.info('Download paused');
  return { success: true };
});

// 다운로드 재개
ipcMain.handle('download:resume', async () => {
  downloadPaused = false;
  downloadLog.info('Download resumed');
  return { success: true };
});

// 다운로드 취소
ipcMain.handle('download:cancel', async () => {
  downloadCancelled = true;
  downloadLog.info('Download cancelled');
  return { success: true };
});

// =====================================================
// 의존성 해결 관련 핸들러
// =====================================================

// 의존성 해결 핸들러 (장바구니에서 의존성 트리 미리보기용)
ipcMain.handle('dependency:resolve', async (_, packages: DownloadPackage[]) => {
  downloadLog.info(`Resolving dependencies for ${packages.length} packages`);

  try {
    const resolved = await resolveAllDependencies(packages);
    downloadLog.info(`Dependencies resolved: ${packages.length} → ${resolved.allPackages.length} packages`);

    return {
      originalPackages: packages,
      allPackages: resolved.allPackages,
      dependencyTrees: resolved.dependencyTrees,
      failedPackages: resolved.failedPackages,
    };
  } catch (error) {
    downloadLog.error('Failed to resolve dependencies:', error);
    throw error;
  }
});

// ============================================
// 히스토리 관련 IPC 핸들러
// ============================================
const historyLog = createScopedLogger('History');
const HISTORY_DIR = path.join(os.homedir(), '.depssmuggler');
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');

// 히스토리 디렉토리 및 파일 초기화
async function ensureHistoryFile(): Promise<void> {
  try {
    if (!fs.existsSync(HISTORY_DIR)) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      historyLog.info(`Created history directory: ${HISTORY_DIR}`);
    }
    if (!fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
      historyLog.info(`Created history file: ${HISTORY_FILE}`);
    }
  } catch (error) {
    historyLog.error('Failed to ensure history file:', error);
    throw error;
  }
}

// 히스토리 로드
ipcMain.handle('history:load', async () => {
  historyLog.info('Loading history...');
  try {
    await ensureHistoryFile();
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const histories = JSON.parse(data);
    historyLog.info(`Loaded ${histories.length} history items`);
    return histories;
  } catch (error) {
    historyLog.error('Failed to load history:', error);
    return [];
  }
});

// 히스토리 저장 (전체 덮어쓰기)
ipcMain.handle('history:save', async (_, histories: unknown[]) => {
  historyLog.info(`Saving ${histories.length} history items...`);
  try {
    await ensureHistoryFile();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2), 'utf-8');
    historyLog.info('History saved successfully');
    return { success: true };
  } catch (error) {
    historyLog.error('Failed to save history:', error);
    throw error;
  }
});

// 히스토리 항목 추가
ipcMain.handle('history:add', async (_, history: unknown) => {
  historyLog.info('Adding new history item...');
  try {
    await ensureHistoryFile();
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const histories = JSON.parse(data);
    histories.unshift(history); // 최신 항목을 앞에 추가
    // 최대 100개 유지
    if (histories.length > 100) {
      histories.splice(100);
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2), 'utf-8');
    historyLog.info('History item added successfully');
    return { success: true };
  } catch (error) {
    historyLog.error('Failed to add history:', error);
    throw error;
  }
});

// 특정 히스토리 항목 삭제
ipcMain.handle('history:delete', async (_, id: string) => {
  historyLog.info(`Deleting history item: ${id}`);
  try {
    await ensureHistoryFile();
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const histories = JSON.parse(data);
    const filteredHistories = histories.filter((h: { id: string }) => h.id !== id);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(filteredHistories, null, 2), 'utf-8');
    historyLog.info(`History item ${id} deleted successfully`);
    return { success: true };
  } catch (error) {
    historyLog.error('Failed to delete history:', error);
    throw error;
  }
});

// 전체 히스토리 삭제
ipcMain.handle('history:clear', async () => {
  historyLog.info('Clearing all history...');
  try {
    await ensureHistoryFile();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2), 'utf-8');
    historyLog.info('All history cleared');
    return { success: true };
  } catch (error) {
    historyLog.error('Failed to clear history:', error);
    throw error;
  }
});

// 캐시 통계 조회
const cacheLog = createScopedLogger('Cache');

ipcMain.handle('cache:stats', async () => {
  cacheLog.debug('Getting cache stats...');
  try {
    const [pipStats, npmStats, mavenStats, condaStats] = await Promise.all([
      Promise.resolve(pipCache.getCacheStats()),
      Promise.resolve(npmCache.getNpmCacheStats()),
      Promise.resolve(mavenCache.getMavenCacheStats()),
      condaCache.getCacheStats(),
    ]);

    const totalSize = (pipStats.diskSize || 0) + (condaStats.totalSize || 0);
    const entryCount =
      (pipStats.memoryEntries || 0) +
      (npmStats.entries || 0) +
      (mavenStats.memoryEntries || 0) +
      (condaStats.entries?.length || 0);

    return {
      totalSize,
      entryCount,
      details: {
        pip: pipStats,
        npm: npmStats,
        maven: mavenStats,
        conda: condaStats,
      },
    };
  } catch (error) {
    cacheLog.error('Failed to get cache stats:', error);
    throw error;
  }
});

// 캐시 전체 삭제
ipcMain.handle('cache:clear', async () => {
  cacheLog.info('Clearing all caches...');
  try {
    await Promise.all([
      Promise.resolve(pipCache.clearAllCache()),
      Promise.resolve(npmCache.clearNpmCache()),
      Promise.all([mavenCache.clearMemoryCache(), mavenCache.clearDiskCache()]),
      condaCache.clearCache(),
    ]);
    cacheLog.info('All caches cleared');
    return { success: true };
  } catch (error) {
    cacheLog.error('Failed to clear caches:', error);
    throw error;
  }
});
