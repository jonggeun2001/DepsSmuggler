// Conda 관련 유틸리티 함수 (repodata.json 기반 패키지 URL 조회)
import axios from 'axios';
import * as fzstd from 'fzstd';
import type { DownloadUrlResult } from './types';
import type { RepoData, RepoDataPackage, AnacondaFileInfo } from './conda-types';

// repodata 캐시 (channel/subdir -> RepoData)
const repodataCache = new Map<string, RepoData>();

const CONDA_URL = 'https://conda.anaconda.org';
const ANACONDA_API_URL = 'https://api.anaconda.org';

/**
 * OS와 아키텍처에서 conda subdir 결정
 */
export function getCondaSubdir(targetOS?: string, architecture?: string): string {
  const os = targetOS?.toLowerCase() || 'linux';
  const arch = architecture?.toLowerCase() || 'x86_64';

  // 아키텍처 정규화
  const isArm = arch === 'arm64' || arch === 'aarch64';

  if (os === 'linux') {
    return isArm ? 'linux-aarch64' : 'linux-64';
  } else if (os === 'macos' || os === 'darwin') {
    return isArm ? 'osx-arm64' : 'osx-64';
  } else if (os === 'windows') {
    return isArm ? 'win-arm64' : 'win-64';
  }

  return 'linux-64'; // 기본값
}

/**
 * repodata.json 가져오기 (zstd 압축 우선, 캐싱 포함)
 */
async function getRepoData(channel: string, subdir: string): Promise<RepoData | null> {
  const cacheKey = `${channel}/${subdir}`;

  // 캐시 확인
  if (repodataCache.has(cacheKey)) {
    return repodataCache.get(cacheKey)!;
  }

  // 우선순위: zstd 압축 > current_repodata.json > repodata.json
  const urls = [
    { url: `${CONDA_URL}/${channel}/${subdir}/repodata.json.zst`, compressed: true },
    { url: `${CONDA_URL}/${channel}/${subdir}/current_repodata.json`, compressed: false },
    { url: `${CONDA_URL}/${channel}/${subdir}/repodata.json`, compressed: false },
  ];

  for (const { url, compressed } of urls) {
    try {
      console.log(`[conda-utils] repodata 가져오기: ${url}`);

      if (compressed) {
        // zstd 압축 파일 다운로드 및 해제
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'DepsSmuggler/1.0' },
          timeout: 120000,
        });

        const compressedData = new Uint8Array(response.data);
        const decompressedData = fzstd.decompress(compressedData);
        const jsonString = new TextDecoder().decode(decompressedData);
        const repodata = JSON.parse(jsonString) as RepoData;

        // 캐시에 저장
        repodataCache.set(cacheKey, repodata);

        console.log(`[conda-utils] repodata 가져오기 성공 (zstd): ${Object.keys(repodata.packages || {}).length} packages`);

        return repodata;
      } else {
        // 일반 JSON
        const response = await axios.get(url, {
          headers: { 'User-Agent': 'DepsSmuggler/1.0' },
          timeout: 120000,
        });

        const repodata = response.data as RepoData;
        repodataCache.set(cacheKey, repodata);

        console.log(`[conda-utils] repodata 가져오기 성공: ${Object.keys(repodata.packages || {}).length} packages`);

        return repodata;
      }
    } catch (error) {
      // 다음 URL 시도
      continue;
    }
  }

  return null;
}

/**
 * Python 버전에서 conda build 태그 추출 (예: "3.12" -> "py312")
 */
function getPythonBuildTag(pythonVersion?: string): string | null {
  if (!pythonVersion) return null;

  const match = pythonVersion.match(/^(\d+)\.(\d+)/);
  if (!match) return null;

  return `py${match[1]}${match[2]}`;
}

/**
 * build 문자열이 Python 버전과 호환되는지 확인
 * - noarch 패키지는 항상 호환
 * - Python 버전이 없는 네이티브 패키지 (libblas 등)는 항상 호환
 * - py312, py311 등이 포함된 경우 매칭 확인
 */
function isBuildCompatibleWithPython(build: string, pythonTag: string | null): boolean {
  // pythonTag가 없으면 필터링 안함
  if (!pythonTag) return true;

  // build에 python 버전이 없으면 (네이티브 라이브러리) 호환
  const pyMatch = build.match(/py\d+/);
  if (!pyMatch) return true;

  // Python 버전이 있으면 정확히 매칭
  return build.includes(pythonTag);
}

/**
 * repodata에서 패키지 찾기
 */
function findPackageInRepoData(
  repodata: RepoData,
  name: string,
  version: string,
  subdir: string,
  pythonVersion?: string
): { filename: string; pkg: RepoDataPackage } | null {
  // packages.conda 우선 (더 최신 형식)
  const allPackages = {
    ...(repodata['packages.conda'] || {}),
    ...repodata.packages,
  };

  const pythonTag = getPythonBuildTag(pythonVersion);

  // 이름과 버전으로 후보 찾기
  const candidates: Array<{ filename: string; pkg: RepoDataPackage; isPythonMatch: boolean }> = [];

  for (const [filename, pkg] of Object.entries(allPackages)) {
    if (pkg.name === name && pkg.version === version) {
      const isPythonMatch = isBuildCompatibleWithPython(pkg.build, pythonTag);
      candidates.push({ filename, pkg, isPythonMatch });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Python 버전 매칭을 우선, 그 다음 build_number가 높은 것
  candidates.sort((a, b) => {
    // Python 매칭이 있는 것 우선
    if (a.isPythonMatch !== b.isPythonMatch) {
      return a.isPythonMatch ? -1 : 1;
    }
    // build_number가 높은 것 우선
    return b.pkg.build_number - a.pkg.build_number;
  });

  const selected = candidates[0];

  // Python 버전이 지정되었는데 매칭되는 게 없으면 경고
  if (pythonTag && !selected.isPythonMatch) {
    console.warn(`[conda-utils] ${name}@${version}: Python ${pythonVersion} 호환 빌드 없음, ${selected.pkg.build} 사용`);
  }

  return { filename: selected.filename, pkg: selected.pkg };
}

/**
 * Anaconda API를 통해 패키지 파일 정보 조회 (repodata에 없는 경우 fallback)
 * RC 버전 등 특수 라벨의 패키지도 조회 가능
 */
async function getPackageFromAnacondaApi(
  packageName: string,
  version: string,
  subdir: string,
  channel: string = 'conda-forge',
  pythonVersion?: string
): Promise<DownloadUrlResult | null> {
  try {
    console.log(`[conda-utils] Anaconda API fallback: ${packageName}@${version}, subdir=${subdir}`);

    const response = await axios.get<AnacondaFileInfo[]>(
      `${ANACONDA_API_URL}/package/${channel}/${packageName}/files`,
      {
        headers: { 'User-Agent': 'DepsSmuggler/1.0' },
        timeout: 30000,
      }
    );

    const files = response.data;
    const pythonTag = getPythonBuildTag(pythonVersion);

    // 버전과 subdir이 일치하는 파일 필터링
    const candidates = files.filter(f =>
      f.version === version &&
      f.attrs.subdir === subdir
    );

    if (candidates.length === 0) {
      // noarch도 확인
      const noarchCandidates = files.filter(f =>
        f.version === version &&
        f.attrs.subdir === 'noarch'
      );

      if (noarchCandidates.length > 0) {
        const selected = noarchCandidates[0];
        const filename = selected.basename.split('/').pop() || selected.basename;
        console.log(`[conda-utils] API에서 noarch 패키지 찾음: ${filename}`);
        return {
          url: `${CONDA_URL}/${channel}/noarch/${filename}`,
          filename,
          size: selected.size || 0,
        };
      }

      console.warn(`[conda-utils] API에서도 패키지를 찾을 수 없음: ${packageName}@${version} in ${subdir}`);
      return null;
    }

    // Python 버전 필터링
    let selected: AnacondaFileInfo;
    if (pythonTag) {
      const pythonMatches = candidates.filter(f =>
        isBuildCompatibleWithPython(f.attrs.build, pythonTag)
      );

      if (pythonMatches.length > 0) {
        // build_number가 높은 것 선택
        pythonMatches.sort((a, b) => b.attrs.build_number - a.attrs.build_number);
        selected = pythonMatches[0];
      } else {
        // Python 매칭이 없으면 build_number가 높은 것 선택
        candidates.sort((a, b) => b.attrs.build_number - a.attrs.build_number);
        selected = candidates[0];
        console.warn(`[conda-utils] ${packageName}@${version}: Python ${pythonVersion} 호환 빌드 없음, ${selected.attrs.build} 사용`);
      }
    } else {
      candidates.sort((a, b) => b.attrs.build_number - a.attrs.build_number);
      selected = candidates[0];
    }

    const filename = selected.basename.split('/').pop() || selected.basename;
    console.log(`[conda-utils] API에서 찾음: ${filename} (build: ${selected.attrs.build})`);

    return {
      url: `${CONDA_URL}/${channel}/${subdir}/${filename}`,
      filename,
      size: selected.size || 0,
    };
  } catch (error) {
    console.error(`[conda-utils] Anaconda API 조회 실패: ${packageName}@${version}`, error);
    return null;
  }
}

/**
 * Conda 패키지 다운로드 URL 조회
 */
export async function getCondaDownloadUrl(
  packageName: string,
  version: string,
  architecture?: string,
  targetOS?: string,
  channel: string = 'conda-forge',
  pythonVersion?: string
): Promise<DownloadUrlResult | null> {
  const subdir = getCondaSubdir(targetOS, architecture);

  console.log(`[conda-utils] 패키지 검색: ${packageName}@${version}, subdir=${subdir}, python=${pythonVersion || 'any'}`);

  // repodata에서 패키지 찾기
  const repodata = await getRepoData(channel, subdir);
  if (repodata) {
    const found = findPackageInRepoData(repodata, packageName, version, subdir, pythonVersion);
    if (found) {
      const { filename, pkg } = found;
      const downloadUrl = `${CONDA_URL}/${channel}/${subdir}/${filename}`;
      console.log(`[conda-utils] 찾음: ${filename} (build: ${pkg.build})`);
      return {
        url: downloadUrl,
        filename,
        size: pkg.size || 0,
      };
    }
  }

  // noarch에서도 확인 (Python 버전 무관)
  const noarchRepodata = await getRepoData(channel, 'noarch');
  if (noarchRepodata) {
    const found = findPackageInRepoData(noarchRepodata, packageName, version, 'noarch');
    if (found) {
      const { filename, pkg } = found;
      const downloadUrl = `${CONDA_URL}/${channel}/noarch/${filename}`;
      console.log(`[conda-utils] noarch에서 찾음: ${filename}`);
      return {
        url: downloadUrl,
        filename,
        size: pkg.size || 0,
      };
    }
  }

  // repodata에서 못 찾으면 Anaconda API fallback 시도
  // (RC 버전 등 특수 라벨의 패키지 지원)
  console.log(`[conda-utils] repodata에서 찾지 못함, Anaconda API 시도: ${packageName}@${version}`);
  const apiResult = await getPackageFromAnacondaApi(packageName, version, subdir, channel, pythonVersion);
  if (apiResult) {
    return apiResult;
  }

  console.warn(`[conda-utils] 패키지를 찾을 수 없음: ${packageName}@${version} in ${channel}/${subdir}`);
  return null;
}
