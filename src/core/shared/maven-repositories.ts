import * as os from 'os';
import * as path from 'path';
import axios from 'axios';
import * as fs from 'fs-extra';
import logger from '../../utils/logger';
import { MAVEN_CENTRAL_URL, normalizeMavenRepositories } from '../../utils/maven-repositories';

/** Read on each operation so saved settings apply without restarting the app. */
export async function getMavenRepositories(
  primaryRepository = MAVEN_CENTRAL_URL
): Promise<string[]> {
  // Preserve explicit single-repository clients (e.g. a local repository fixture).
  if (primaryRepository !== MAVEN_CENTRAL_URL) return [primaryRepository];
  try {
    const settings = await fs.readJson(path.join(os.homedir(), '.depssmuggler', 'settings.json'));
    return [MAVEN_CENTRAL_URL, ...normalizeMavenRepositories(settings.mavenRepositories ?? [])];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Maven 저장소 설정을 읽지 못해 Central을 사용합니다.');
    }
    return [MAVEN_CENTRAL_URL];
  }
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
