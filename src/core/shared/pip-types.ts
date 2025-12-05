// PyPI 공통 타입 정의

/**
 * PyPI 릴리스 정보 (wheel/sdist 파일)
 */
export interface PyPIRelease {
  filename: string;
  url: string;
  size: number;
  md5_digest: string;
  digests: {
    md5: string;
    sha256: string;
  };
  packagetype: 'sdist' | 'bdist_wheel' | 'bdist_egg';
  python_version: string;
  requires_python?: string;
}

/**
 * PyPI 패키지 정보
 */
export interface PyPIInfo {
  name: string;
  version: string;
  summary?: string;
  author?: string;
  author_email?: string;
  license?: string;
  home_page?: string;
  project_url?: string;
  requires_dist?: string[];
  requires_python?: string;
}

/**
 * PyPI API 응답 (pypi.org/pypi/{package}/{version}/json)
 */
export interface PyPIResponse {
  info: PyPIInfo;
  releases: Record<string, PyPIRelease[]>;
  urls: PyPIRelease[];
}

/**
 * PyPI 검색 결과 (warehouse API)
 */
export interface PyPISearchResult {
  name: string;
  version: string;
  summary: string;
}

/**
 * Wheel 파일 태그 정보
 * 형식: {distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl
 */
export interface WheelTags {
  pythonTags: string[];  // 예: ['cp311', 'cp3', 'py3', 'py311']
  abiTags: string[];     // 예: ['cp311', 'abi3', 'none']
  platformTags: string[]; // 예: ['manylinux_2_17_x86_64', 'linux_x86_64', 'any']
}

/**
 * 지원 태그 (PEP 425)
 */
export interface SupportedTag {
  python: string;
  abi: string;
  platform: string;
}
