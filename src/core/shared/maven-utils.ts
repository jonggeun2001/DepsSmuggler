/**
 * Maven 유틸리티 함수
 */

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
    /^lwjgl-/,
    /^javacpp-/,
    /^jni4net-/,
    /^jogamp-/,
  ];

  return nativePatterns.some(pattern => pattern.test(artifactId));
}
