/**
 * Maven 유틸리티 함수
 */

import axios from 'axios';

/**
 * 설정의 OS/아키텍처를 Maven classifier로 변환
 *
 * @param targetOS - 대상 OS (linux, darwin, windows 등)
 * @param architecture - 대상 아키텍처 (x86_64, amd64, aarch64, arm64 등)
 * @returns Maven classifier 문자열 (예: 'linux-x86_64', 'osx-aarch_64') 또는 undefined
 *
 * @example
 * buildMavenClassifier('linux', 'x86_64') // 'linux-x86_64'
 * buildMavenClassifier('darwin', 'aarch64') // 'osx-aarch_64'
 * buildMavenClassifier('windows', 'amd64') // 'windows-x86_64'
 */
export function buildMavenClassifier(
  targetOS?: string,
  architecture?: string
): string | undefined {
  if (!targetOS || !architecture) {
    return undefined;
  }

  // OS 매핑
  const osMap: Record<string, string> = {
    'linux': 'linux',
    'macos': 'osx',
    'darwin': 'osx',
    'windows': 'windows',
  };

  // 아키텍처 매핑
  const archMap: Record<string, string> = {
    'x86_64': 'x86_64',
    'amd64': 'x86_64',
    'aarch64': 'aarch_64',
    'arm64': 'aarch_64',
  };

  const mappedOS = osMap[targetOS.toLowerCase()];
  const mappedArch = archMap[architecture.toLowerCase()];

  if (!mappedOS || !mappedArch) {
    return undefined;
  }

  return `${mappedOS}-${mappedArch}`;
}

/**
 * 네이티브 패키지 여부 판별
 *
 * artifactId나 groupId에 native 키워드가 포함되거나,
 * 알려진 네이티브 라이브러리 목록에 해당하는지 확인
 *
 * @param groupId - Maven groupId
 * @param artifactId - Maven artifactId
 * @returns 네이티브 패키지이면 true, 아니면 false
 *
 * @example
 * isNativeArtifact('io.netty', 'netty-transport-native-epoll') // true
 * isNativeArtifact('org.lwjgl', 'lwjgl-opengl') // true
 * isNativeArtifact('org.apache.commons', 'commons-lang3') // false
 */
export function isNativeArtifact(groupId: string, artifactId: string): boolean {
  // artifactId에 'native' 포함 여부
  if (artifactId.toLowerCase().includes('native')) {
    return true;
  }

  // 알려진 네이티브 라이브러리 패턴
  const nativePatterns = [
    /^netty-transport-native-/,
    /^lwjgl($|-)/, // lwjgl 또는 lwjgl-* 모두 매칭
    /^javacpp-/,
    /^jni4net-/,
    /^jogamp-/,
  ];

  return nativePatterns.some(pattern => pattern.test(artifactId));
}

/**
 * 네이티브 라이브러리별 classifier 매핑
 *
 * 각 라이브러리 패턴별로 사용 가능한 classifier 목록 정의
 */
export const NATIVE_CLASSIFIERS: Record<string, string[]> = {
  // LWJGL: natives-${platform} 형식
  'lwjgl': [
    'natives-linux',
    'natives-linux-arm64',
    'natives-linux-arm32',
    'natives-macos',
    'natives-macos-arm64',
    'natives-windows',
    'natives-windows-x86',
    'natives-windows-arm64',
  ],
  // Netty native transport: ${os}-${arch} 형식
  'netty-transport-native': [
    'linux-x86_64',
    'linux-aarch_64',
    'osx-x86_64',
    'osx-aarch_64',
  ],
  // JavaCPP presets
  'javacpp': [
    'linux-x86_64',
    'linux-arm64',
    'linux-ppc64le',
    'macosx-x86_64',
    'macosx-arm64',
    'windows-x86_64',
    'windows-x86',
  ],
  // JNA (Java Native Access)
  'jna': [
    'linux-x86-64',
    'linux-aarch64',
    'darwin-x86-64',
    'darwin-aarch64',
    'win32-x86-64',
    'win32-x86',
  ],
  // SWT (Eclipse)
  'swt': [
    'gtk-linux-x86_64',
    'gtk-linux-aarch64',
    'cocoa-macosx-x86_64',
    'cocoa-macosx-aarch64',
    'win32-win32-x86_64',
  ],
};

/**
 * Maven Central API에서 동적으로 classifier 목록을 가져옴
 *
 * Maven Search API의 `ec` 필드에서 classifier를 추출
 * ec 필드 형식: [".jar", "-sources.jar", "-javadoc.jar", "-natives-linux.jar", ...]
 *
 * @param groupId - Maven groupId
 * @param artifactId - Maven artifactId
 * @param version - 버전 (선택, 없으면 최신 버전 사용)
 * @returns 사용 가능한 classifier 배열
 *
 * @example
 * await fetchClassifiersFromMavenCentral('org.lwjgl', 'lwjgl', '3.3.6')
 * // ['natives-linux', 'natives-linux-arm64', 'natives-macos', ...]
 */
export async function fetchClassifiersFromMavenCentral(
  groupId: string,
  artifactId: string,
  version?: string
): Promise<string[]> {
  try {
    // 버전이 지정된 경우 특정 버전 조회, 아니면 최신 버전 조회
    let query: string;
    if (version) {
      query = `g:${groupId}+AND+a:${artifactId}+AND+v:${version}`;
    } else {
      query = `g:${groupId}+AND+a:${artifactId}`;
    }

    const url = `https://search.maven.org/solrsearch/select?q=${query}&core=gav&rows=1&wt=json`;
    console.log('[Maven] Fetching classifiers from:', url);

    const response = await axios.get(url, { timeout: 10000 });

    if (!response.data?.response?.docs || response.data.response.docs.length === 0) {
      console.log('[Maven] No results found from Maven Central');
      return [];
    }

    const doc = response.data.response.docs[0];
    const ec = doc.ec as string[] | undefined;

    if (!ec || !Array.isArray(ec)) {
      console.log('[Maven] No ec (extensions/classifiers) field found');
      return [];
    }

    console.log('[Maven] Raw ec field:', ec);

    // classifier 추출: "-{classifier}.jar" 형식에서 classifier 부분만 추출
    // 예: "-natives-linux.jar" -> "natives-linux"
    // sources, javadoc, tests 등은 제외
    const excludePatterns = ['sources', 'javadoc', 'tests', 'test-sources'];
    const classifiers: string[] = [];

    for (const item of ec) {
      // "-{classifier}.jar" 형식 매칭
      const match = item.match(/^-([^.]+)\.jar$/);
      if (match) {
        const classifier = match[1];
        // sources, javadoc 등 제외
        if (!excludePatterns.some(p => classifier.includes(p))) {
          classifiers.push(classifier);
        }
      }
    }

    console.log('[Maven] Extracted classifiers:', classifiers);
    return classifiers;
  } catch (error) {
    console.error('[Maven] Failed to fetch classifiers from Maven Central:', error);
    return [];
  }
}

/**
 * Maven Central API에서 동적으로 네이티브 artifact 여부를 확인
 *
 * classifier가 존재하고, 그 중에 OS/플랫폼 관련 classifier가 있으면 네이티브로 판단
 *
 * @param groupId - Maven groupId
 * @param artifactId - Maven artifactId
 * @param version - 버전 (선택)
 * @returns 네이티브 artifact이면 true
 */
export async function isNativeArtifactFromApi(
  groupId: string,
  artifactId: string,
  version?: string
): Promise<boolean> {
  const classifiers = await fetchClassifiersFromMavenCentral(groupId, artifactId, version);

  if (classifiers.length === 0) {
    // API에서 classifier를 찾지 못하면 네이티브가 아닌 것으로 판단
    return false;
  }

  // 네이티브 관련 키워드가 classifier에 포함되어 있는지 확인
  const nativeKeywords = [
    'natives', 'native', 'linux', 'windows', 'macos', 'osx', 'darwin',
    'x86', 'amd64', 'aarch64', 'arm64', 'arm32', 'ppc64'
  ];

  return classifiers.some(c =>
    nativeKeywords.some(keyword => c.toLowerCase().includes(keyword))
  );
}

/**
 * 주어진 Maven artifact에 대해 사용 가능한 classifier 목록 반환 (동기 버전 - 하드코딩 폴백)
 *
 * @param groupId - Maven groupId
 * @param artifactId - Maven artifactId
 * @returns 사용 가능한 classifier 배열
 *
 * @example
 * getAvailableClassifiers('org.lwjgl', 'lwjgl-opengl')
 * // ['natives-linux', 'natives-linux-arm64', ...]
 *
 * getAvailableClassifiers('io.netty', 'netty-transport-native-epoll')
 * // ['linux-x86_64', 'linux-aarch_64', ...]
 */
export function getAvailableClassifiers(groupId: string, artifactId: string): string[] {
  const lowerArtifactId = artifactId.toLowerCase();

  // 정확한 매칭 시도
  for (const [pattern, classifiers] of Object.entries(NATIVE_CLASSIFIERS)) {
    if (lowerArtifactId.startsWith(pattern)) {
      return classifiers;
    }
  }

  // 매칭되지 않으면 기본 classifier 목록 반환
  if (isNativeArtifact(groupId, artifactId)) {
    return [
      'linux-x86_64',
      'linux-aarch64',
      'macos-x86_64',
      'macos-aarch64',
      'windows-x86_64',
      'windows-x86',
    ];
  }

  return [];
}

/**
 * Maven Central API에서 동적으로 classifier 목록을 가져옴
 *
 * @param groupId - Maven groupId
 * @param artifactId - Maven artifactId
 * @param version - 버전 (선택)
 * @returns 사용 가능한 classifier 배열
 */
export async function getAvailableClassifiersAsync(
  groupId: string,
  artifactId: string,
  version?: string
): Promise<string[]> {
  // API에서 동적으로 가져오기
  return fetchClassifiersFromMavenCentral(groupId, artifactId, version);
}
