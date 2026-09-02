import type { CacheStore } from './memory-cache.js';

export type RedisCacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

export class RedisCache implements CacheStore {
  constructor(private readonly redis: RedisCacheClient) {}

  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.redis.get(key);
    return value === null ? undefined : (JSON.parse(value) as T);
  }

  async set<T>(key: string, value: T, ttlMilliseconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), { PX: ttlMilliseconds });
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
