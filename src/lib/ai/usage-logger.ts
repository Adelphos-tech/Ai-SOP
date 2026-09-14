import { promises as fs } from "fs";
import path from "path";
import { UsageLogEntry } from "./types";

const LOG_FILE = path.join(process.cwd(), "logs", "openai-usage.jsonl");

export async function logUsage(entry: UsageLogEntry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.appendFile(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("Failed to log usage:", e);
  }
}
