type CacheEntry<T> = {
  expiresAt: number;
  promise: Promise<T>;
};

const cacheStores = new Map<string, Map<string, CacheEntry<unknown>>>();

const getStore = (namespace: string) => {
  const existing = cacheStores.get(namespace);

  if (existing) {
    return existing;
  }

  const created = new Map<string, CacheEntry<unknown>>();
  cacheStores.set(namespace, created);
  return created;
};

export function memoizeWithTtl<Args extends unknown[], Result>(
  namespace: string,
  ttlMs: number,
  keyBuilder: (...args: Args) => string,
  loader: (...args: Args) => Promise<Result>,
) {
  return (...args: Args): Promise<Result> => {
    const store = getStore(namespace);
    const key = keyBuilder(...args);
    const now = Date.now();
    const existing = store.get(key) as CacheEntry<Result> | undefined;

    if (existing && existing.expiresAt > now) {
      return existing.promise;
    }

    const promise = loader(...args).catch((error) => {
      const current = store.get(key);

      if (current?.promise === promise) {
        store.delete(key);
      }

      throw error;
    });

    store.set(key, {
      expiresAt: now + ttlMs,
      promise,
    });

    return promise;
  };
}
