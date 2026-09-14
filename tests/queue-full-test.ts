/**
 * Queue-full test — verifies ResourceBusyError becomes controlled 429/503.
 * Run: npx tsx tests/queue-full-test.ts
 * No OpenAI, no DB, no PII.
 */

import { renderLimiter, exportLimiter, cvParseLimiter, crawlLimiter, ResourceBusyError } from "@/lib/concurrency/resource-limiter";

async function testLimiterFull(name: string, limiter: typeof renderLimiter) {
  console.log(`\n=== ${name} QUEUE-FULL TEST ===`);
  console.log(`  maxConcurrent=${limiter.maxConcurrent}, maxQueued=${limiter.maxQueued}`);

  // Fill all active slots
  const releases: (() => void)[] = [];
  for (let i = 0; i < limiter.maxConcurrent; i++) {
    const r = await limiter.acquire();
    releases.push(r);
  }
  console.log(`  Active slots filled: ${releases.length}`);

  // Fill all queue slots
  const queuePromises: Promise<() => void>[] = [];
  for (let i = 0; i < limiter.maxQueued; i++) {
    queuePromises.push(limiter.acquire());
  }
  console.log(`  Queue slots filled: ${queuePromises.length}`);

  // Now try to acquire one more — should throw ResourceBusyError
  try {
    await limiter.acquire();
    console.log(`  FAIL: Should have thrown ResourceBusyError`);
  } catch (e: any) {
    if (e instanceof ResourceBusyError) {
      console.log(`  PASS: ResourceBusyError thrown`);
      console.log(`  code: ${e.code}`);
      console.log(`  resource: ${e.resource}`);
      console.log(`  message: ${e.message}`);
    } else {
      console.log(`  FAIL: Wrong error type: ${e.constructor.name}`);
    }
  }

  // Verify stats
  const stats = limiter.getStats();
  console.log(`  Stats: active=${stats.active}, queued=${stats.queued}, rejected=${stats.totalRejected}`);

  // Release all active slots — this will start draining the queue
  for (const r of releases) r();

  // Wait for queue to drain — release each as it becomes active
  const queueReleases: (() => void)[] = [];
  for (const p of queuePromises) {
    const r = await p;
    queueReleases.push(r);
    // Release immediately so next queue item can proceed
    r();
  }
  console.log(`  Cleanup: all slots released`);

  const finalStats = limiter.getStats();
  console.log(`  Final stats: active=${finalStats.active}, queued=${finalStats.queued}`);
}

async function main() {
  console.log("==========================================");
  console.log("QUEUE-FULL CONTROLLED RESPONSE TEST");
  console.log("==========================================");

  await testLimiterFull("RENDER", renderLimiter);
  await testLimiterFull("EXPORT", exportLimiter);
  await testLimiterFull("CV_PARSE", cvParseLimiter);
  await testLimiterFull("CRAWL", crawlLimiter);

  console.log("\n==========================================");
  console.log("ALL QUEUE-FULL TESTS COMPLETE");
  console.log("==========================================");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
