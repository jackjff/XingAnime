export type Sleep = (milliseconds: number) => Promise<void>;

const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class IntervalRateLimiter {
  private nextAvailableAt = 0;
  private queue = Promise.resolve();

  constructor(
    private readonly intervalMilliseconds: number,
    private readonly now: () => number = () => Date.now(),
    private readonly wait: Sleep = sleep
  ) {}

  acquire(): Promise<void> {
    const permit = this.queue.then(async () => {
      const delay = Math.max(0, this.nextAvailableAt - this.now());
      if (delay > 0) await this.wait(delay);
      this.nextAvailableAt = this.now() + this.intervalMilliseconds;
    });

    this.queue = permit.catch(() => undefined);
    return permit;
  }
}

export class CompositeRateLimiter {
  constructor(
    private readonly budgetLimiter: Pick<IntervalRateLimiter, 'acquire'>,
    private readonly intervalLimiter: Pick<IntervalRateLimiter, 'acquire'>
  ) {}

  async acquire(): Promise<void> {
    await this.intervalLimiter.acquire();
    await this.budgetLimiter.acquire();
  }
}
