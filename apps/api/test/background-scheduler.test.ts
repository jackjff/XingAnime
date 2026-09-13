import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundScheduler, runMetadataCycle } from '../src/catalog/background-scheduler.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

afterEach(() => vi.useRealTimers());

describe('metadata cycle', () => {
  it.each([undefined, 'seed', 'home', 'hydrate', 'schedule'])('runs in order, stops at %s and invalidates partial writes', async (stop) => {
    const calls: string[] = [];
    const stage = (name: string) => async () => {
      calls.push(name);
      return { succeeded: 1, stoppedOnRateLimit: name === stop };
    };
    await runMetadataCycle({ seed: stage('seed'), home: stage('home'), hydrate: stage('hydrate'), schedule: stage('schedule'), invalidate: async () => { calls.push('invalidate'); } });
    const stages = ['seed', 'home', 'hydrate', 'schedule'];
    expect(calls).toEqual([...stages.slice(0, stop ? stages.indexOf(stop) + 1 : 4), 'invalidate']);
  });
});

describe('BackgroundScheduler', () => {
  it('clears every timer before draining work and lease release, then permits resource close', async () => {
    vi.useFakeTimers();
    const work = deferred();
    const release = deferred();
    const events: string[] = [];
    const scheduler = new BackgroundScheduler([
      { name: 'metadata', intervals: [{ milliseconds: 100 }, { milliseconds: 200 }], lease: { acquire: async () => 'token', release: async () => { events.push('release'); await release.promise; } }, run: async () => { events.push('work'); await work.promise; } },
      { name: 'posters', intervals: [{ milliseconds: 300 }], run: async () => { events.push('posters'); } }
    ], vi.fn());
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const closing = scheduler.stop().then(() => { events.push('database'); events.push('redis'); });
    expect(vi.getTimerCount()).toBe(0);
    work.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(['posters', 'work', 'release']);
    release.resolve();
    await closing;
    scheduler.start();
    expect(vi.getTimerCount()).toBe(0);
    expect(events).toEqual(['posters', 'work', 'release', 'database', 'redis']);
  });

  it('skips a contended lease and recovers after acquisition and release errors', async () => {
    vi.useFakeTimers();
    const acquire = vi.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValueOnce(null).mockResolvedValue('token');
    const release = vi.fn().mockRejectedValueOnce(new Error('release failed')).mockResolvedValue(undefined);
    const run = vi.fn(async () => {});
    const onError = vi.fn();
    const scheduler = new BackgroundScheduler([{ name: 'metadata', run, lease: { acquire, release }, intervals: [{ milliseconds: 100 }] }], onError);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(300);
    await scheduler.stop();
    expect(acquire).toHaveBeenCalledTimes(4);
    expect(run).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('starts only explicitly and single-flights even while acquiring its lease', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const acquire = vi.fn(async () => { await gate.promise; return 'token'; });
    const release = vi.fn(async () => {});
    const run = vi.fn(async () => {});
    const scheduler = new BackgroundScheduler([{ name: 'metadata', run, lease: { acquire, release }, intervals: [{ milliseconds: 100 }] }], vi.fn());
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(acquire).toHaveBeenCalledTimes(1);
    gate.resolve();
    await scheduler.stop();
    expect(run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('token');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renews an owned distributed lease until the job settles', async () => {
    vi.useFakeTimers();
    const work = deferred();
    const renew = vi.fn(async () => true);
    const release = vi.fn(async () => {});
    const scheduler = new BackgroundScheduler([{
      name: 'metadata',
      intervals: [],
      lease: { acquire: async () => 'token', renew, release, renewalIntervalMilliseconds: 100 },
      run: async () => { await work.promise; }
    }], vi.fn());

    scheduler.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(renew).toHaveBeenCalledTimes(2);
    work.resolve();
    await scheduler.stop();
    expect(release).toHaveBeenCalledWith('token');
  });
});
