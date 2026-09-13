type MetadataStage = () => Promise<{ succeeded: number; stoppedOnRateLimit?: boolean }>;

export async function runMetadataCycle(stages: {
  seed?: MetadataStage;
  home: MetadataStage;
  hydrate: MetadataStage;
  deadLinks?: () => Promise<{ restored: number; stoppedOnRateLimit?: boolean }>;
  schedule: MetadataStage;
  invalidate(): Promise<void>;
}): Promise<void> {
  let changed = false;
  let stoppedOnRateLimit = false;
  try {
    for (const stage of [stages.seed, stages.home, stages.hydrate]) {
      if (!stage) continue;
      const result = await stage();
      changed ||= result.succeeded > 0;
      if (result.stoppedOnRateLimit) {
        stoppedOnRateLimit = true;
        break;
      }
    }
    if (!stoppedOnRateLimit && stages.deadLinks) {
      const result = await stages.deadLinks();
      changed ||= result.restored > 0;
      stoppedOnRateLimit = result.stoppedOnRateLimit === true;
    }
    if (!stoppedOnRateLimit) {
      const result = await stages.schedule();
      changed ||= result.succeeded > 0;
    }
  } finally {
    if (changed) await stages.invalidate();
  }
}

type Lease = {
  acquire(): Promise<string | null>;
  release(token: string | null): Promise<void>;
  renew?(token: string): Promise<boolean>;
  renewalIntervalMilliseconds?: number;
};

type Job = {
  name: string;
  run(): Promise<void>;
  lease?: Lease;
  intervals: Array<{ milliseconds: number; beforeRun?: () => void }>;
};

/** Local single-flight includes lease acquisition and release, not just the work. */
export class BackgroundScheduler {
  private readonly active = new Map<string, Promise<void>>();
  private readonly timers: Array<ReturnType<typeof setInterval>> = [];
  private started = false;
  private stopped = false;

  constructor(private readonly jobs: Job[], private readonly onError: (name: string, error: unknown) => void) {}

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    for (const job of this.jobs) {
      this.trigger(job);
      for (const interval of job.intervals) {
        const timer = setInterval(() => {
          interval.beforeRun?.();
          this.trigger(job);
        }, interval.milliseconds);
        timer.unref();
        this.timers.push(timer);
      }
    }
  }

  private trigger(job: Job): void {
    if (this.stopped || this.active.has(job.name)) return;
    // Defer acquisition so the local guard is installed before any async work.
    const active = Promise.resolve().then(async () => {
      const token = job.lease ? await job.lease.acquire() : null;
      if (job.lease && !token) return;
      let renewalTimer: ReturnType<typeof setInterval> | undefined;
      if (token && job.lease?.renew && job.lease.renewalIntervalMilliseconds) {
        renewalTimer = setInterval(() => {
          void job.lease?.renew?.(token).catch((error: unknown) => this.onError(`${job.name}:lease-renewal`, error));
        }, job.lease.renewalIntervalMilliseconds);
        renewalTimer.unref();
      }
      try {
        await job.run();
      } finally {
        if (renewalTimer) clearInterval(renewalTimer);
        await job.lease?.release(token);
      }
    }).catch((error) => this.onError(job.name, error))
      .finally(() => { this.active.delete(job.name); });
    this.active.set(job.name, active);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    await Promise.allSettled(this.active.values());
  }
}
