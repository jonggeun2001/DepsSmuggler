import { parentPort } from 'worker_threads';
import type { AxiosResponse } from 'axios';

/** Network stays in the caller, including custom CA/axios defaults. Only bytes cross this port. */
export function requestRepodata(
  url: string,
  options: Record<string, unknown>
): Promise<AxiosResponse> {
  const port = parentPort;
  if (!port) throw new Error('Repodata parsing requires a metadata worker');
  return new Promise((resolve, reject) => {
    const receive = (message: {
      kind: string;
      result: AxiosResponse;
      error?: { message: string; status?: number };
    }) => {
      if (message.kind !== 'http-result') return;
      port.off('message', receive);
      if (message.error)
        reject(
          Object.assign(new Error(message.error.message), {
            isAxiosError: true,
            response: { status: message.error.status },
          })
        );
      else resolve(message.result);
    };
    port.on('message', receive);
    port.postMessage({ kind: 'http', url, options });
  });
}
