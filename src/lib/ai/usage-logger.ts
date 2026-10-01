import { promises as fs } from "fs";
import path from "path";
import { UsageLogEntry } from "./types";
import { emitEvent } from "../observability/events";

// ACCOUNTING write — appends JSONL. Failure is non-fatal by policy
// (PERSISTENCE_CLASS.usageLedgerRow) but MUST surface as a telemetry
// event instead of disappearing silently.
const resolveLogFile = () =>
  process.env.OPENAI_USAGE_LOG_FILE || path.join(process.cwd(), "logs", "openai-usage.jsonl");

export async function logUsage(entry: UsageLogEntry): Promise<void> {
  try {
    const file = resolveLogFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify(entry) + "\n");
  } catch (e) {
    emitEvent("usage_ledger_write_failed", {
      errorCode: "USAGE_LEDGER_WRITE_FAILED",
      detail: e instanceof Error ? e.message : String(e),
      generationRunId: entry.generationRunId ?? null,
      documentId: entry.documentId ?? null,
      stage: entry.pipelineStage,
      providerResponseId: entry.providerResponseId ?? null,
    }, "warn");
  }
}
