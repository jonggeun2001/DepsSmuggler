import { QueryRequestError } from '../../utils/query-error';

export async function requestQueryJson(
  fetchImpl: typeof fetch,
  url: string
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw new QueryRequestError('HTTP', response.status);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (controller.signal.aborted) throw new QueryRequestError('TIMEOUT');
      throw new QueryRequestError('INVALID_RESPONSE');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new QueryRequestError('INVALID_RESPONSE');
    return data as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) throw new QueryRequestError('TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
