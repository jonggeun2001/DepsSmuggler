export const CONDA_STANDARD_ORIGIN = 'https://conda.anaconda.org';

/** Return the repository root for a logical Conda channel. */
export function getCondaRepositoryBase(
  channel: string,
  baseUrl: string = CONDA_STANDARD_ORIGIN
): string {
  const origin = baseUrl.replace(/\/+$/, '');
  if (channel === 'defaults' && origin === CONDA_STANDARD_ORIGIN) {
    return 'https://repo.anaconda.com/pkgs/main';
  }
  return `${origin}/${channel}`;
}

/** Return the Anaconda API owner corresponding to a logical channel. */
export function getCondaApiOwner(channel: string): string {
  return channel === 'defaults' ? 'main' : channel;
}
