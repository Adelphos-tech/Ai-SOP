// ============================================================
// GET /api/metrics — Lightweight process metrics (no PII)
// ============================================================
// Returns CPU, memory, event loop, and resource limiter stats.
// Used for monitoring CPU-heavy work and concurrency gates.
//
// SECURITY: Requires authenticated consultant session.
// Operational/server metrics are not exposed publicly.
// No PII is included.
// ============================================================

import { NextResponse, NextRequest } from "next/server";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { getAllLimiterStats, isSystemUnderPressure } from "@/lib/concurrency/resource-limiter";
import {
  requireConsultantSession,
  authErrorResponse,
  AuthError,
} from "@/lib/auth/consultant-session";

let eventLoopMonitor: any = null;
try {
  eventLoopMonitor = monitorEventLoopDelay({ resolution: 100 });
  eventLoopMonitor.enable();
} catch {
  // Some environments may not support this
}

export async function GET(request: NextRequest) {
  // ===== AUTH =====
  try {
    await requireConsultantSession(request);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const elapsed = process.uptime();

  // Calculate CPU percent from process.cpuUsage
  const totalCpuUs = (cpu.user + cpu.system) / 1000; // microseconds → milliseconds
  const cpuPercent = elapsed > 0 ? (totalCpuUs / (elapsed * 1000)) * 100 : 0;

  // Event loop delay
  let eventLoopDelayP95 = 0;
  if (eventLoopMonitor) {
    eventLoopDelayP95 = Math.round(eventLoopMonitor.percentile(95) / 1000); // ns → μs → ms
  }

  const loadAvg = require("node:os").loadavg();

  const limiterStats = getAllLimiterStats();

  return NextResponse.json({
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(elapsed),
      cpuPercent: Math.round(cpuPercent * 100) / 100,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      externalMb: Math.round(mem.external / 1024 / 1024),
    },
    system: {
      loadAverage1: loadAvg[0],
      loadAverage5: loadAvg[1],
      loadAverage15: loadAvg[2],
      cpuCores: require("node:os").cpus().length,
    },
    eventLoop: {
      delayP95Ms: eventLoopDelayP95,
    },
    resourceLimiters: limiterStats,
    admissionBackpressure: isSystemUnderPressure(),
    timestamp: new Date().toISOString(),
  });
}
