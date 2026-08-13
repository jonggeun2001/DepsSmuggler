export type ResolutionOperation = 'latest-version' | 'package-info' | 'packument' | 'pom';

type ResolverName = 'pip' | 'conda' | 'maven' | 'npm';

interface ResolutionSessionStats {
  hits: number;
  misses: number;
  joins: number;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return `boolean:${value}`;
    case 'number':
      if (Number.isNaN(value)) {
        return 'number:NaN';
      }
      if (Object.is(value, -0)) {
        return 'number:-0';
      }
      return `number:${value}`;
    case 'string':
      return `string:${JSON.stringify(value)}`;
    case 'bigint':
      return `bigint:${value}`;
    case 'symbol':
      return `symbol:${String(value)}`;
    case 'function':
      return `function:${String(value)}`;
    case 'object':
      if (Array.isArray(value)) {
        return `array:[${Array.from(value, stableSerialize).join(',')}]`;
      }

      return `object:{${Object.keys(value)
        .sort()
        .map((key) => `${stableSerialize(key)}:${stableSerialize(value[key as keyof typeof value])}`)
        .join(',')}}`;
    default:
      throw new TypeError('Unsupported context value type');
  }
}

export class ResolutionSession {
  private readonly entries = new Map<string, Promise<unknown>>();
  private readonly inFlightKeys = new Set<string>();
  private readonly stats: ResolutionSessionStats = { hits: 0, misses: 0, joins: 0 };

  getOrCreate<T>(
    resolver: ResolverName,
    operation: ResolutionOperation,
    context: Record<string, unknown>,
    producer: () => Promise<T>,
    options?: { isCacheable?: (value: T) => boolean },
  ): Promise<T> {
    const key = `${resolver}:${operation}:${stableSerialize(context)}`;
    const cached = this.entries.get(key) as Promise<T> | undefined;

    if (cached) {
      if (this.inFlightKeys.has(key)) {
        this.stats.joins += 1;
      } else {
        this.stats.hits += 1;
      }

      return cached.then((value) => structuredClone(value));
    }

    this.stats.misses += 1;
    const canonical = Promise.resolve().then(producer);
    this.entries.set(key, canonical);
    this.inFlightKeys.add(key);

    const isCacheable = options?.isCacheable ?? ((value: T) => value !== null && value !== undefined);
    void canonical.then(
      (value) => {
        this.inFlightKeys.delete(key);
        if (!isCacheable(value) && this.entries.get(key) === canonical) {
          this.entries.delete(key);
        }
      },
      () => {
        this.inFlightKeys.delete(key);
        if (this.entries.get(key) === canonical) {
          this.entries.delete(key);
        }
      },
    );

    return canonical.then((value) => structuredClone(value));
  }

  getStats(): ResolutionSessionStats {
    return { ...this.stats };
  }
}
