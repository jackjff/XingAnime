const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if current <= tonumber(ARGV[2]) then
  return 1
end
return 0
`;

export type RedisScriptClient = {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<number | string>;
};

export class RateLimitExceededError extends Error {
  constructor(public readonly provider: string) {
    super(`Rate limit budget exhausted for ${provider}`);
    this.name = 'RateLimitExceededError';
  }
}

export class RedisWindowRateLimiter {
  constructor(
    private readonly redis: RedisScriptClient,
    private readonly limit: number,
    private readonly windowMilliseconds: number,
    private readonly key: string
  ) {}

  async acquire(): Promise<void> {
    const result = await this.redis.eval(FIXED_WINDOW_SCRIPT, {
      keys: [this.key],
      arguments: [String(this.windowMilliseconds), String(this.limit)]
    });

    if (Number(result) !== 1) {
      throw new RateLimitExceededError(this.key);
    }
  }
}
