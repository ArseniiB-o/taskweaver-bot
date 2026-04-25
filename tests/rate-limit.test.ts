import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/security/rate-limit.js';

describe('RateLimiter', () => {
  it('grants tokens up to capacity', () => {
    const rl = new RateLimiter({ capacity: 3, refillPerMinute: 1, maxConcurrentPerUser: 5 });
    expect(rl.tryAcquire(1).ok).toBe(true);
    expect(rl.tryAcquire(1).ok).toBe(true);
    expect(rl.tryAcquire(1).ok).toBe(true);
    rl.release(1); rl.release(1); rl.release(1);
    const denied = rl.tryAcquire(1);
    expect(denied.ok).toBe(false);
  });

  it('limits concurrency per user', () => {
    const rl = new RateLimiter({ capacity: 100, refillPerMinute: 1, maxConcurrentPerUser: 1 });
    expect(rl.tryAcquire(42).ok).toBe(true);
    const r2 = rl.tryAcquire(42);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('too_many_concurrent');
  });

  it('isolates users', () => {
    const rl = new RateLimiter({ capacity: 1, refillPerMinute: 1, maxConcurrentPerUser: 1 });
    expect(rl.tryAcquire(1).ok).toBe(true);
    expect(rl.tryAcquire(2).ok).toBe(true);
  });

  it('cancelJobs invokes cancel callback', () => {
    const rl = new RateLimiter({ capacity: 5, refillPerMinute: 1, maxConcurrentPerUser: 5 });
    rl.tryAcquire(1);
    let cancelled = 0;
    rl.registerJob(1, 'job1', () => { cancelled += 1; });
    rl.registerJob(1, 'job2', () => { cancelled += 1; });
    expect(rl.cancelJobs(1)).toBe(2);
    expect(cancelled).toBe(2);
  });
});
