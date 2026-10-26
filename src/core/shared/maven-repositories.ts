import axios from 'axios';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositoryUrl } from '../../utils/maven-repositories';
import { toQueryFailure } from '../../utils/query-error';
import type { MavenRepositoryTestResult } from '../../types/maven-repository';
import type { Readable } from 'node:stream';

/** Check only the entered endpoint. A successful response does not prove artifact availability. */
export async function testMavenRepositoryConnection(
  value: unknown
): Promise<MavenRepositoryTestResult> {
  let repositoryUrl: string;
  try {
    repositoryUrl = normalizeMavenRepositoryUrl(value);
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }

  try {
    const response = await axios.get<Readable>(`${repositoryUrl}/`, {
      responseType: 'stream',
      decompress: false,
      timeout: 10000,
      signal: AbortSignal.timeout(10000),
      maxRedirects: 5,
      validateStatus: () => true,
    });
    // Headers are sufficient for a connection check; do not download a directory listing or file.
    response.data.destroy();
    const status = response.status;
    if (status >= 200 && status < 300) {
      return { success: true, repositoryUrl, status, message: `연결 성공 (HTTP ${status})` };
    }
    const message =
      status === 401
        ? '인증이 필요한 주소입니다. 인증 없이 접근 가능한 저장소 URL을 확인하세요.'
        : status === 403 || status === 404
          ? '주소에 접근할 수 없습니다. URL을 확인하세요. 목록 조회를 제한한 저장소는 패키지 검색으로 확인할 수 있습니다.'
          : '서버가 연결 테스트 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.';
    return { success: false, repositoryUrl, status, message: `${message} (HTTP ${status})` };
  } catch (error) {
    // The deadline may surface as Axios cancellation rather than a timeout error.
    const failure = toQueryFailure(axios.isCancel(error) ? { code: 'ETIMEDOUT' } : error);
    return { success: false, repositoryUrl, message: failure.message, status: failure.status };
  }
}

/** Only the selected repository and Central participate in resolution/downloads. */
export async function getMavenRepositories(repositoryUrl = MAVEN_CENTRAL_URL): Promise<string[]> {
  return [...new Set([normalizeMavenRepositoryUrl(repositoryUrl), MAVEN_CENTRAL_URL])];
}

export async function tryMavenRepositories<T>(
  repositories: string[],
  request: (repository: string) => Promise<T>,
  shouldTryNext: (error: unknown) => boolean = () => true
): Promise<T> {
  if (repositories.length === 1) return request(repositories[0]);
  let lastError: unknown;
  for (const repository of repositories) {
    try {
      return await request(repository);
    } catch (error) {
      if (axios.isCancel(error) || !shouldTryNext(error)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('Maven 저장소가 없습니다.');
}
