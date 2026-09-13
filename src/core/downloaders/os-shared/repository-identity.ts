import type { Repository } from './types';

/** Stable identity for both resolver reuse and persisted metadata provenance. */
export function getRepositoryIdentity(repository: Repository): string {
  return JSON.stringify({
    id: repository.id,
    name: repository.name,
    baseUrl: repository.baseUrl,
    enabled: repository.enabled,
    gpgCheck: repository.gpgCheck,
    gpgKeyUrl: repository.gpgKeyUrl ?? null,
    priority: repository.priority ?? null,
    isOfficial: repository.isOfficial,
  } satisfies Record<keyof Repository, unknown>);
}
