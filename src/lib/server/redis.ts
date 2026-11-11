import { Redis } from "@upstash/redis";

const KEY_PREFIX = process.env["REDIS_KEY_PREFIX"]?.trim() || "pns:frontend:";
const DEFAULT_TTL = Number.parseInt(process.env["REDIS_DEFAULT_TTL"] ?? "60", 10);
const REDIS_ENABLED = process.env["REDIS_ENABLED"] !== "false";

const globalForRedis = globalThis as typeof globalThis & {
  pnsRedis?: Redis;
};

function redisClient(): Redis | null {
  if (
    !REDIS_ENABLED ||
    !process.env["UPSTASH_REDIS_REST_URL"] ||
    !process.env["UPSTASH_REDIS_REST_TOKEN"]
  ) {
    return null;
  }
  globalForRedis.pnsRedis ??= Redis.fromEnv();
  return globalForRedis.pnsRedis;
}

function keyFor(key: string) {
  return key.startsWith(KEY_PREFIX) ? key : `${KEY_PREFIX}${key}`;
}

function ttlFor(ttl?: number) {
  return Number.isFinite(ttl) && ttl && ttl > 0
    ? Math.floor(ttl)
    : Number.isFinite(DEFAULT_TTL) && DEFAULT_TTL > 0
      ? DEFAULT_TTL
      : 60;
}

async function withoutRedis<T>(
  operation: string,
  fallback: T,
  action: (client: Redis) => Promise<T>,
) {
  const client = redisClient();
  if (!client) return fallback;
  try {
    return await action(client);
  } catch (error) {
    console.warn(`Redis ${operation} failed; continuing without cache.`, error);
    return fallback;
  }
}

export async function getCached<T>(key: string): Promise<T | null> {
  return withoutRedis("read", null, (client) => client.get<T>(keyFor(key)));
}

export async function setCached<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
  const result = await withoutRedis("write", null, (client) =>
    client.set(keyFor(key), value, { ex: ttlFor(ttlSeconds) }),
  );
  return result === "OK";
}

export async function deleteCached(...keys: string[]): Promise<boolean> {
  if (keys.length === 0) return true;
  const deleted = await withoutRedis("delete", 0, (client) => client.del(...keys.map(keyFor)));
  return deleted > 0;
}

export async function invalidateCachedPattern(pattern: string): Promise<number> {
  return withoutRedis("pattern invalidation", 0, async (client) => {
    let cursor = 0;
    let deleted = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, { match: keyFor(pattern), count: 100 });
      cursor = Number(nextCursor);
      if (keys.length > 0) deleted += await client.del(...keys);
    } while (cursor !== 0);
    return deleted;
  });
}

export function frontendRedisKey(key: string) {
  return keyFor(key);
}
