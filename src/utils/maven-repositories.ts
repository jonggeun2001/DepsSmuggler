export const MAVEN_CENTRAL_URL = 'https://repo1.maven.org/maven2';

/** Shared by the settings form, IPC and CLI. Credentials are not supported. */
export function normalizeMavenRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Maven 저장소는 URL 배열이어야 합니다.');
  const urls = value.map(normalizeMavenRepositoryUrl);
  return [...new Set(urls)].filter((url) => url !== MAVEN_CENTRAL_URL);
}

export function normalizeMavenRepositoryUrl(entry: unknown): string {
  if (typeof entry !== 'string' || !entry.trim()) {
    throw new Error('Maven 저장소 URL을 입력하세요.');
  }
  let url: URL;
  try {
    url = new URL(entry.trim());
  } catch {
    throw new Error('올바른 Maven 저장소 URL을 입력하세요.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.includes('?') ||
    url.href.includes('#')
  ) {
    throw new Error('Maven 저장소는 인증 정보, 쿼리, 프래그먼트가 없는 HTTP(S) URL이어야 합니다.');
  }
  return url.href.replace(/\/+$/, '');
}
