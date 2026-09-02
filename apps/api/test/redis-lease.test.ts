import { describe, expect, it, vi } from 'vitest';
import { RedisLease } from '../src/cache/redis-lease.js';

describe('RedisLease', () => {
  it('acquires a lease with NX/PX and releases only its own token', async () => {
    const set = vi.fn(async () => 'OK');
    const evalScript = vi.fn(async () => 1);
    const lease = new RedisLease({ set, eval: evalScript }, 'xing:test:lease', 30_000, () => 'token-1');

    const token = await lease.acquire();
    await lease.release(token);

    expect(token).toBe('token-1');
    expect(set).toHaveBeenCalledWith('xing:test:lease', 'token-1', { NX: true, PX: 30_000 });
    expect(evalScript).toHaveBeenCalledWith(expect.stringContaining('ARGV[1]'), { keys: ['xing:test:lease'], arguments: ['token-1'] });
  });

  it('returns null when another worker owns the lease', async () => {
    const lease = new RedisLease({ set: vi.fn(async () => null), eval: vi.fn(async () => 0) }, 'xing:test:lease', 30_000, () => 'token-2');
    await expect(lease.acquire()).resolves.toBeNull();
  });
});
