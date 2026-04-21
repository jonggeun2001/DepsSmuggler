import pLimit from 'p-limit';

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

export type ConcurrencyLimiterFactory = (concurrency: number) => Limiter;

export const createConcurrencyLimiter: ConcurrencyLimiterFactory = (concurrency) =>
  pLimit(concurrency) as unknown as Limiter;
