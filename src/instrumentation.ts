// Next.js instrumentation — runs once on server start.
// Recovers orphaned generation runs left by a previous process
// (deploy restart, crash): completed stages reuse persisted provider
// responses, the in-flight stage resumes provider polling.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { recoverInterruptedGenerations } = await import(
      "./lib/application/generation-recovery"
    );
    // Fire-and-forget — recovery runs in the background.
    recoverInterruptedGenerations();
  } catch (e) {
    console.error("instrumentation: generation recovery init failed:", e);
  }
}
