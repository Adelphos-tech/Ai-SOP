import { promises as fs } from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "logs", "fx-cache.json");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ExchangeRateInfo {
  pair: string;
  rate: number;
  source: string;
  retrievedAt: string;
  stale: boolean;
}

interface FxCache {
  rate: number;
  source: string;
  retrievedAt: string;
}

async function readCache(): Promise<FxCache | null> {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(data) as FxCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: FxCache): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("Failed to write FX cache:", e);
  }
}

export async function getUsdToInrRate(): Promise<ExchangeRateInfo> {
  // Try cache first
  const cached = await readCache();
  if (cached) {
    const age = Date.now() - new Date(cached.retrievedAt).getTime();
    if (age < CACHE_TTL_MS) {
      return {
        pair: "USD/INR",
        rate: cached.rate,
        source: cached.source,
        retrievedAt: cached.retrievedAt,
        stale: false,
      };
    }
  }

  // Fetch fresh rate from free API
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "Accept": "application/json" },
      // @ts-ignore - Next.js supports this
      next: { revalidate: 21600 },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`FX API returned ${response.status}`);

    const data = await response.json();
    const inrRate = data?.rates?.INR;

    if (!inrRate || typeof inrRate !== "number") throw new Error("INR rate not found in response");

    const source = `open.er-api.com (as of ${data.time_last_update_utc || "unknown"})`;
    const retrievedAt = new Date().toISOString();

    await writeCache({ rate: inrRate, source, retrievedAt });

    return {
      pair: "USD/INR",
      rate: inrRate,
      source,
      retrievedAt,
      stale: false,
    };
  } catch (error) {
    // Fall back to cached rate if available
    if (cached) {
      return {
        pair: "USD/INR",
        rate: cached.rate,
        source: cached.source,
        retrievedAt: cached.retrievedAt,
        stale: true,
      };
    }

    // No rate available
    return {
      pair: "USD/INR",
      rate: 0,
      source: "unavailable",
      retrievedAt: new Date().toISOString(),
      stale: true,
    };
  }
}
