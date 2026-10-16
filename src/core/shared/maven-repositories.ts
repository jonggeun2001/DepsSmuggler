import axios from 'axios';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositoryUrl } from '../../utils/maven-repositories';

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
