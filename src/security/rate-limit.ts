interface UserBucket {
  tokens: number;
  updatedAt: number;
  inFlight: number;
  jobs: Map<string, { startedAt: number; cancel?: () => void }>;
}

export interface RateLimitConfig {
  capacity: number;
  refillPerMinute: number;
  maxConcurrentPerUser: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  capacity: 10,
  refillPerMinute: 20,
  maxConcurrentPerUser: 1,
};

export class RateLimiter {
  private readonly buckets = new Map<number, UserBucket>();
  private readonly config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getBucket(userId: number): UserBucket {
    let b = this.buckets.get(userId);
    if (!b) {
      b = { tokens: this.config.capacity, updatedAt: Date.now(), inFlight: 0, jobs: new Map() };
      this.buckets.set(userId, b);
    }
    return b;
  }

  private refill(b: UserBucket): void {
    const now = Date.now();
    const elapsedMs = now - b.updatedAt;
    if (elapsedMs <= 0) return;
    const refill = (elapsedMs / 60_000) * this.config.refillPerMinute;
    b.tokens = Math.min(this.config.capacity, b.tokens + refill);
    b.updatedAt = now;
  }

  tryAcquire(userId: number): { ok: true } | { ok: false; reason: 'rate_limited' | 'too_many_concurrent'; retryAfterSec?: number } {
    const b = this.getBucket(userId);
    this.refill(b);
    if (b.inFlight >= this.config.maxConcurrentPerUser) {
      return { ok: false, reason: 'too_many_concurrent' };
    }
    if (b.tokens < 1) {
      const need = 1 - b.tokens;
      const retryAfterSec = Math.ceil((need * 60) / this.config.refillPerMinute);
      return { ok: false, reason: 'rate_limited', retryAfterSec };
    }
    b.tokens -= 1;
    b.inFlight += 1;
    return { ok: true };
  }

  release(userId: number): void {
    const b = this.buckets.get(userId);
    if (!b) return;
    b.inFlight = Math.max(0, b.inFlight - 1);
  }

  registerJob(userId: number, jobId: string, cancel?: () => void): void {
    const b = this.getBucket(userId);
    b.jobs.set(jobId, { startedAt: Date.now(), cancel });
  }

  unregisterJob(userId: number, jobId: string): void {
    const b = this.buckets.get(userId);
    if (b) b.jobs.delete(jobId);
  }

  cancelJobs(userId: number): number {
    const b = this.buckets.get(userId);
    if (!b) return 0;
    let cancelled = 0;
    for (const job of b.jobs.values()) {
      if (job.cancel) {
        try { job.cancel(); cancelled += 1; } catch { /* ignore */ }
      }
    }
    return cancelled;
  }

  getStatus(userId: number): { tokens: number; inFlight: number; activeJobs: number } {
    const b = this.getBucket(userId);
    this.refill(b);
    return { tokens: Math.floor(b.tokens), inFlight: b.inFlight, activeJobs: b.jobs.size };
  }
}
