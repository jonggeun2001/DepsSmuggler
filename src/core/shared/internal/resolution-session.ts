export type ResolutionOperation = 'latest-version' | 'package-info' | 'packument' | 'pom';

type ResolverName = 'pip' | 'conda' | 'maven' | 'npm';

type ResolutionContextPrimitive = string | number | boolean | null | undefined;

export type ResolutionContextValue =
  | ResolutionContextPrimitive
  | ResolutionContextValue[]
  | ResolutionContext;

export interface ResolutionContext {
  [key: string]: ResolutionContextValue;
}

interface ResolutionSessionStats {
  hits: number;
  misses: number;
  joins: number;
}

function unsupportedContextValue(): never {
  throw new TypeError('Resolution context must be JSON-like');
}

function isArrayIndex(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

function stableSerialize(value: unknown, ancestors = new WeakSet<object>()): string {
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
    case 'object':
      if (ancestors.has(value)) {
        throw new TypeError('Resolution context must not contain cyclic references');
      }

      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          if (Object.getPrototypeOf(value) !== Array.prototype) {
            return unsupportedContextValue();
          }

          for (const key of Reflect.ownKeys(value)) {
            if (key === 'length') {
              continue;
            }

            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (
              typeof key !== 'string' ||
              !isArrayIndex(key) ||
              !descriptor?.enumerable ||
              !('value' in descriptor)
            ) {
              return unsupportedContextValue();
            }
          }

          return `array:[${Array.from({ length: value.length }, (_, index) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor?.enumerable || !('value' in descriptor)) {
              return unsupportedContextValue();
            }

            return stableSerialize(descriptor.value, ancestors);
          }).join(',')}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return unsupportedContextValue();
        }

        const plainObject = value as Record<string, unknown>;
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (typeof key !== 'string' || !descriptor?.enumerable || !('value' in descriptor)) {
            return unsupportedContextValue();
          }
        }

        return `object:{${Object.keys(value)
          .sort()
          .map((key) => `${stableSerialize(key)}:${stableSerialize(plainObject[key], ancestors)}`)
          .join(',')}}`;
      } finally {
        ancestors.delete(value);
      }
    default:
      return unsupportedContextValue();
  }
}

export class ResolutionSession {
  private readonly entries = new Map<string, Promise<unknown>>();
  private readonly inFlightKeys = new Set<string>();
  private readonly cacheabilityFailures = new WeakMap<Promise<unknown>, { error: unknown }>();
  private readonly stats: ResolutionSessionStats = { hits: 0, misses: 0, joins: 0 };

  getOrCreate<T>(
    resolver: ResolverName,
    operation: ResolutionOperation,
    context: ResolutionContext,
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

      return this.cloneForConsumer(cached);
    }

    this.stats.misses += 1;
    const canonical = Promise.resolve().then(producer);
    this.entries.set(key, canonical);
    this.inFlightKeys.add(key);

    const isCacheable = options?.isCacheable ?? ((value: T) => value !== null && value !== undefined);
    void canonical.then(
      (value) => {
        this.inFlightKeys.delete(key);
        try {
          if (!isCacheable(value) && this.entries.get(key) === canonical) {
            this.entries.delete(key);
          }
        } catch (error) {
          this.cacheabilityFailures.set(canonical, { error });
          if (this.entries.get(key) === canonical) {
            this.entries.delete(key);
          }
        }
      },
      () => {
        this.inFlightKeys.delete(key);
        if (this.entries.get(key) === canonical) {
          this.entries.delete(key);
        }
      },
    );

    return this.cloneForConsumer(canonical);
  }

  getStats(): ResolutionSessionStats {
    return { ...this.stats };
  }

  private cloneForConsumer<T>(canonical: Promise<T>): Promise<T> {
    return canonical.then((value) => {
      const cacheabilityFailure = this.cacheabilityFailures.get(canonical);
      if (cacheabilityFailure) {
        throw cacheabilityFailure.error;
      }

      return structuredClone(value);
    });
  }
}
