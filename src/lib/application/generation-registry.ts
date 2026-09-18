// ============================================================
// GENERATION REGISTRY — in-process live-execution tracking
// ============================================================
// Single-process architecture: tracks which documents have a live
// pipeline execution in THIS process. Used by restart recovery to
// distinguish orphaned runs (process died) from active ones.
// ============================================================

const liveDocuments = new Set<string>();

export function markGenerationLive(documentId: string): void {
  liveDocuments.add(documentId);
}

export function unmarkGenerationLive(documentId: string): void {
  liveDocuments.delete(documentId);
}

export function isGenerationLive(documentId: string): boolean {
  return liveDocuments.has(documentId);
}
