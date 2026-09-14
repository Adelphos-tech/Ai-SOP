/**
 * @file resource-limiter.ts
 * @description
 * In-process semaphore + bounded queue for CPU-heavy operations.
 *
 * Prevents unbounded concurrency for expensive operations like
 * Puppeteer PDF rendering, PDF/DOCX export, and web crawling.
 *
 * Each limiter has:
 *   - maxConcurrent: max simultaneous operations
 *   - maxQueued: max operations waiting for a slot
 *
 * When both are full, acquire() returns null (caller should return 429/503).
 *
 * All limits are configurable via environment variables.
 * All counters are exposed for metrics.
 *
 * No PII. No external dependencies.
 */

// ============================================================
// TYPES
// ============================================================

export type ResourceType = "render" | "export" | "crawl" | "cvParse";

export interface LimiterStats {
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueued: number;
  totalAcquired: number;
  totalRejected: number;
}

export class ResourceBusyError extends Error {
  code = "RESOURCE_BUSY";
  resource: ResourceType;
  constructor(resource: ResourceType, message: string) {
    super(message);
    this.resource = resource;
    this.name = "ResourceBusyError";
  }
}

// ============================================================
// RESOURCE LIMITER
// ============================================================

class ResourceLimiter {
  private active = 0;
  private queue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }> = [];

  readonly maxConcurrent: number;
  readonly maxQueued: number;
  readonly resource: ResourceType;
  private totalAcquired = 0;
  private totalRejected = 0;

  constructor(resource: ResourceType, maxConcurrent: number, maxQueued: number) {
    this.resource = resource;
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
  }

  /**
   * Acquire a slot. Returns a release function.
   * Throws ResourceBusyError if queue is full.
   */
  async acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.totalAcquired++;
      return () => this.release();
    }

    if (this.queue.length >= this.maxQueued) {
      this.totalRejected++;
      throw new ResourceBusyError(
        this.resource,
        `${this.resource} processing is currently busy. Please try again shortly.`,
      );
    }

    return new Promise<() => void>((resolve, reject) => {
      this.queue.push({
        resolve: () => {
          this.active++;
          this.totalAcquired++;
          resolve(() => this.release());
        },
        reject,
      });
    });
  }

  private release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    }
  }

  /**
   * Try to acquire immediately without waiting. Returns null if full.
   */
  tryAcquire(): (() => void) | null {
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.totalAcquired++;
      return () => this.release();
    }
    return null;
  }

  /**
   * Check if the system is under pressure (active >= 80% of max).
   */
  isUnderPressure(): boolean {
    return this.active >= Math.ceil(this.maxConcurrent * 0.8);
  }

  getStats(): LimiterStats {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
      totalAcquired: this.totalAcquired,
      totalRejected: this.totalRejected,
    };
  }
}

// ============================================================
// GLOBAL LIMITER INSTANCES
// ============================================================

function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (!v) return def;
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

// Render: Puppeteer launches Chromium — heaviest operation
export const renderLimiter = new ResourceLimiter(
  "render",
  envInt("MAX_CONCURRENT_RENDERS", 2),
  envInt("MAX_QUEUED_RENDERS", 3),
);

// Export: pdf-lib / docx — moderate CPU
export const exportLimiter = new ResourceLimiter(
  "export",
  envInt("MAX_CONCURRENT_EXPORTS", 3),
  envInt("MAX_QUEUED_EXPORTS", 5),
);

// Crawl: web fetching + HTML parsing — I/O bound but CPU in regex
export const crawlLimiter = new ResourceLimiter(
  "crawl",
  envInt("MAX_CONCURRENT_CRAWLS", 2),
  envInt("MAX_QUEUED_CRAWLS", 3),
);

// CV parse: pdf-parse + mammoth + regex — moderate CPU
export const cvParseLimiter = new ResourceLimiter(
  "cvParse",
  envInt("MAX_CONCURRENT_CV_PARSE", 2),
  envInt("MAX_QUEUED_CV_PARSE", 3),
);

// ============================================================
// ALL LIMITER STATS (for metrics endpoint)
// ============================================================

export function getAllLimiterStats(): Record<ResourceType, LimiterStats> {
  return {
    render: renderLimiter.getStats(),
    export: exportLimiter.getStats(),
    crawl: crawlLimiter.getStats(),
    cvParse: cvParseLimiter.getStats(),
  };
}

/**
 * Check if any expensive resource is under severe pressure.
 * Used for CPU load shedding — reject new expensive work but
 * allow normal reads to continue.
 */
export function isSystemUnderPressure(): boolean {
  return (
    renderLimiter.isUnderPressure() ||
    exportLimiter.isUnderPressure() ||
    crawlLimiter.isUnderPressure() ||
    cvParseLimiter.isUnderPressure()
  );
}
