export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMilliseconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

type Entry = {
  value: unknown;
  expiresAt: number;
};

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMilliseconds: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + ttlMilliseconds
    });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
