/**
 * CPU Benchmark — measures CPU impact of PDF export and Puppeteer render.
 * Run: npx tsx tests/cpu-benchmark.ts
 * No OpenAI calls. No database access. No PII.
 */

import { exportDocument, countPdfPages } from "@/lib/application/document-export";
import { renderApplicationDocument } from "@/lib/render/renderer";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { cpus, loadavg, freemem, totalmem } from "node:os";

// ============================================================
// HELPERS
// ============================================================

const elMonitor = monitorEventLoopDelay({ resolution: 50 });
elMonitor.enable();

function snapshot() {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    load1: loadavg()[0],
    load5: loadavg()[1],
    freeMemMb: Math.round(freemem() / 1024 / 1024),
    elP95Ms: Math.round(elMonitor.percentile(95) / 1_000_000 * 100) / 100,
    cpuCores: cpus().length,
  };
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function measureConcurrent(
  label: string,
  concurrency: number,
  fn: () => Promise<any>,
) {
  console.log(`\n=== ${label} (concurrency=${concurrency}) ===`);
  const before = snapshot();
  console.log(`  Before: RSS=${before.rssMb}MB Heap=${before.heapMb}MB Load=${before.load1} ELP95=${before.elP95Ms}ms`);

  const start = Date.now();
  const tasks: Promise<any>[] = [];
  let rejected = 0;
  for (let i = 0; i < concurrency; i++) {
    tasks.push(fn().catch((e: any) => {
      if (e?.code === "RESOURCE_BUSY") rejected++;
      else throw e;
    }));
  }
  await Promise.all(tasks);
  const duration = Date.now() - start;

  const after = snapshot();
  console.log(`  After:  RSS=${after.rssMb}MB Heap=${after.heapMb}MB Load=${after.load1} ELP95=${after.elP95Ms}ms`);
  console.log(`  Duration: ${duration}ms`);
  console.log(`  Rejected (queue full): ${rejected}`);
  console.log(`  RSS delta: ${after.rssMb - before.rssMb}MB`);
  console.log(`  Heap delta: ${after.heapMb - before.heapMb}MB`);

  return { concurrency, duration, rejected, before, after };
}

// ============================================================
// SYNTHETIC CONTENT
// ============================================================

const SAMPLE_TEXT = `
Statement of Purpose

I am applying to the Master of Science in Computer Science program at your esteemed university. 
My academic journey began with a Bachelor's degree in Computer Engineering, where I developed 
a strong foundation in algorithms, data structures, and software engineering principles.

During my undergraduate studies, I worked on several research projects that deepened my interest 
in artificial intelligence and machine learning. My most significant project involved developing 
a smart attendance system using computer vision, where I designed REST APIs and implemented 
facial recognition algorithms to automate attendance tracking.

Following graduation, I joined Google as a Software Engineer Intern, where I worked on 
distributed systems and gained hands-on experience with large-scale infrastructure. This 
experience reinforced my desire to pursue advanced studies in computer science, particularly 
in the areas of distributed systems and machine learning.

I am particularly drawn to your program because of its strong faculty in AI and the opportunity 
to work on cutting-edge research. I believe the curriculum aligns perfectly with my career goals 
of becoming a research engineer in the field of artificial intelligence.

My short-term goal is to work as a machine learning engineer at a leading technology company, 
where I can apply my skills to solve real-world problems. In the long term, I envision myself 
leading a research team focused on developing AI systems that can benefit society at large.

I am confident that my academic background, research experience, and professional work have 
prepared me well for the rigorous academic environment at your university. I look forward to 
contributing to your research community and making meaningful contributions to the field.
`.repeat(3).trim();

const SAMPLE_COMPONENTS = [
  { componentId: "c1", label: "Academic Background", text: SAMPLE_TEXT.substring(0, 2000) },
  { componentId: "c2", label: "Research Experience", text: SAMPLE_TEXT.substring(2000, 4000) },
  { componentId: "c3", label: "Career Goals", text: SAMPLE_TEXT.substring(4000, 6000) },
];

// ============================================================
// PDF EXPORT BENCHMARK
// ============================================================

async function benchmarkPdfExport() {
  console.log("\n==========================================");
  console.log("PDF EXPORT BENCHMARK");
  console.log("==========================================");

  const input = {
    content: SAMPLE_TEXT,
    format: "PDF" as const,
    mode: "PREVIEW" as const,
    studentName: "Test Student",
    universityName: "Test University",
    documentType: "Statement of Purpose",
    versionNumber: 1,
    isApproved: false,
  };

  // Warmup
  console.log("\n  Warming up...");
  await exportDocument(input);
  await delay(2000);

  // Concurrency 1
  await measureConcurrent("PDF Export", 1, () => exportDocument(input));
  await delay(3000);

  // Concurrency 2
  await measureConcurrent("PDF Export", 2, () => exportDocument(input));
  await delay(3000);

  // Concurrency 5
  await measureConcurrent("PDF Export", 5, () => exportDocument(input));
  await delay(3000);

  // Concurrency 10
  await measureConcurrent("PDF Export", 10, () => exportDocument(input));
  await delay(5000);
}

// ============================================================
// PUPPETEER RENDER BENCHMARK
// ============================================================

async function benchmarkPuppeteerRender() {
  console.log("\n==========================================");
  console.log("PUPPETEER RENDER BENCHMARK");
  console.log("==========================================");

  // Warmup
  console.log("\n  Warming up Puppeteer...");
  try {
    await renderApplicationDocument("Test Document", SAMPLE_COMPONENTS);
  } catch (e) {
    console.log("  Puppeteer warmup failed:", (e as Error).message);
    return;
  }
  await delay(3000);

  // Concurrency 1
  await measureConcurrent("Puppeteer Render", 1, () =>
    renderApplicationDocument("Test Document", SAMPLE_COMPONENTS),
  );
  await delay(5000);

  // Concurrency 2
  await measureConcurrent("Puppeteer Render", 2, () =>
    renderApplicationDocument("Test Document", SAMPLE_COMPONENTS),
  );
  await delay(5000);

  // Concurrency 3
  await measureConcurrent("Puppeteer Render", 3, () =>
    renderApplicationDocument("Test Document", SAMPLE_COMPONENTS),
  );
  await delay(5000);

  // Concurrency 4
  await measureConcurrent("Puppeteer Render", 4, () =>
    renderApplicationDocument("Test Document", SAMPLE_COMPONENTS),
  );
  await delay(5000);
}

// ============================================================
// ORPHAN PROCESS CHECK
// ============================================================

function checkOrphans() {
  console.log("\n==========================================");
  console.log("ORPHAN PROCESS CHECK");
  console.log("==========================================");
  const { execSync } = require("child_process");
  try {
    const tesseract = execSync("pgrep -c tesseract 2>/dev/null || echo 0").toString().trim();
    const pdftoppm = execSync("pgrep -c pdftoppm 2>/dev/null || echo 0").toString().trim();
    const chromium = execSync("pgrep -c chromium 2>/dev/null || echo 0").toString().trim();
    const chrome = execSync("pgrep -c chrome 2>/dev/null || echo 0").toString().trim();
    console.log(`  Tesseract: ${tesseract}`);
    console.log(`  pdftoppm: ${pdftoppm}`);
    console.log(`  Chromium: ${chromium}`);
    console.log(`  Chrome: ${chrome}`);
  } catch {
    console.log("  (pgrep not available)");
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("CPU RESOURCE BENCHMARK");
  console.log(`CPU Cores: ${cpus().length}`);
  console.log(`Total Memory: ${Math.round(totalmem() / 1024 / 1024)}MB`);
  console.log(`Load Average: ${loadavg().join(", ")}`);

  const idleStart = snapshot();
  console.log(`\nIDLE BASELINE:`);
  console.log(`  RSS: ${idleStart.rssMb}MB`);
  console.log(`  Heap: ${idleStart.heapMb}MB`);
  console.log(`  Load1: ${idleStart.load1}`);
  console.log(`  ELP95: ${idleStart.elP95Ms}ms`);

  await benchmarkPdfExport();
  checkOrphans();

  await benchmarkPuppeteerRender();
  checkOrphans();

  // Final recovery
  console.log("\n==========================================");
  console.log("RECOVERY (10s after all benchmarks)");
  console.log("==========================================");
  await delay(10000);
  const final = snapshot();
  console.log(`  RSS: ${final.rssMb}MB`);
  console.log(`  Heap: ${final.heapMb}MB`);
  console.log(`  Load1: ${final.load1}`);
  console.log(`  ELP95: ${final.elP95Ms}ms`);

  console.log("\n==========================================");
  console.log("BENCHMARK COMPLETE");
  console.log("==========================================");
}

main().catch(console.error);
