/**
 * In-memory limits: request rate per user, a cap on concurrent work, and per-key cooldowns.
 * Kept in process memory on purpose: production runs exactly one API instance (see the deploy runbook),
 * so there is nothing to share between instances. No dependencies, so it is easy to unit-test.
 */

/** Fixed-window counter per key (e.g. 30 uploads per 10 minutes per user). */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Count one request for `key`. */
  hit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.sweep(t);
    }
    w.count++;
    return { allowed: w.count <= this.limit, remaining: Math.max(0, this.limit - w.count), resetAt: w.resetAt };
  }

  private sweep(t: number): void {
    for (const [k, w] of this.windows) if (t >= w.resetAt) this.windows.delete(k);
  }
}

/** At most `max` tasks run at once; the rest wait their turn in order. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly max: number) {}

  get running(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.queue.push(() => {
        this.active++;
        resolve();
      })
    );
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }
}

/** "Not again until…" per key. */
export class Cooldowns {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  start(key: string, ms: number): void {
    if (ms > 0) this.until.set(key, this.now() + ms);
  }

  /** Milliseconds left, 0 when the key is free. */
  remainingMs(key: string): number {
    const u = this.until.get(key);
    if (u === undefined) return 0;
    const left = u - this.now();
    if (left <= 0) {
      this.until.delete(key);
      return 0;
    }
    return left;
  }

  /** ISO time the key becomes free, or null when it already is. */
  availableAt(key: string): string | null {
    const left = this.remainingMs(key);
    return left ? new Date(this.now() + left).toISOString() : null;
  }
}

/** "45 s", "3 min" — for messages shown to people. */
export function formatWait(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}
