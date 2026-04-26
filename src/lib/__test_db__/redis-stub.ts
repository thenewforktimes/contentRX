/**
 * In-process Redis stub for vitest. Implements the slice of the
 * @upstash/redis interface our code actually uses (set with NX/EX,
 * get, del, expire). Backed by a Map; keys with `ex` get a setTimeout
 * that clears them at TTL.
 *
 * The webhook idempotency tests dedupe via `redis.set(key, "1", {nx,
 * ex})`. The contract is:
 *   - first call with NX returns "OK"
 *   - second call with NX returns null
 *   - the production code branches on `setResult === null`
 *
 * Use `createRedisStub()` to get a fresh instance per test or
 * suite. The returned object is a plain `Redis`-shaped duck-typed
 * stub — it does NOT extend the real client class, so production
 * code that does `instanceof Redis` would fail (none of ours does).
 */

interface SetOpts {
  nx?: boolean;
  ex?: number;
}

export interface RedisStub {
  /** Clear all keys + cancel pending TTL timers. */
  reset: () => void;
  /** Inspect the key/value store directly (test-only). */
  store: Map<string, string>;
  /** Force the next `set` to throw — simulates an Upstash outage. */
  failNext: (err?: Error) => void;
  // — Upstash Redis subset used by production code —
  set: (
    key: string,
    value: string,
    opts?: SetOpts,
  ) => Promise<"OK" | null>;
  get: (key: string) => Promise<string | null>;
  del: (key: string) => Promise<number>;
}

export function createRedisStub(): RedisStub {
  const store = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let nextError: Error | null = null;

  function clearTimer(key: string): void {
    const t = timers.get(key);
    if (t) {
      clearTimeout(t);
      timers.delete(key);
    }
  }

  function setTtl(key: string, ex?: number): void {
    if (ex === undefined) return;
    const t = setTimeout(() => {
      store.delete(key);
      timers.delete(key);
    }, ex * 1000);
    // Don't keep the event loop alive on stale timers.
    if (typeof t === "object" && t && "unref" in t) {
      (t as { unref: () => void }).unref();
    }
    timers.set(key, t);
  }

  return {
    store,
    reset: () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      store.clear();
      nextError = null;
    },
    failNext: (err = new Error("Upstash Redis stub: simulated outage")) => {
      nextError = err;
    },
    async set(key, value, opts): Promise<"OK" | null> {
      if (nextError) {
        const err = nextError;
        nextError = null;
        throw err;
      }
      if (opts?.nx && store.has(key)) {
        return null;
      }
      clearTimer(key);
      store.set(key, value);
      setTtl(key, opts?.ex);
      return "OK";
    },
    async get(key): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async del(key): Promise<number> {
      clearTimer(key);
      return store.delete(key) ? 1 : 0;
    },
  };
}
