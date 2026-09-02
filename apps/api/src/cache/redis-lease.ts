import { randomUUID } from 'node:crypto';

export type RedisLeaseClient = {
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
};

const releaseScript = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

export class RedisLease {
  constructor(
    private readonly redis: RedisLeaseClient,
    private readonly key: string,
    private readonly ttlMilliseconds: number,
    private readonly createToken: () => string = randomUUID
  ) {}

  async acquire(): Promise<string | null> {
    const token = this.createToken();
    const result = await this.redis.set(this.key, token, { NX: true, PX: this.ttlMilliseconds });
    return result === 'OK' ? token : null;
  }

  async release(token: string | null): Promise<void> {
    if (!token) return;
    await this.redis.eval(releaseScript, { keys: [this.key], arguments: [token] });
  }
}
