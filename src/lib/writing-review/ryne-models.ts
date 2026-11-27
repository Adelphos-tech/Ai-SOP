// ============================================================
// Ryne humanizer model registry — the single source of truth for
// selectable humanizerMode values across routes, UI dropdowns and
// the spend ledger. Priority order:
//   a) verified defaults (apex / titan / balanced)
//   b) auto-discovered slugs from ryne.ai/api-docs + /changelog
//      (24h in-memory cache, fail-open, 5s timeout, strict pairing
//      with the literal `humanizerMode` key)
//   c) RYNE_EXTRA_MODELS env JSON — adds/overrides without a deploy
// Discovery transport is injectable so tests never touch the network.
// ============================================================

export interface RyneModelSpec {
  /** The `humanizerMode` value sent to Ryne. */
  id: string;
  label: string;
  /** Documented or estimated price per 1K words (USD). */
  pricePer1kUsd: number;
  recommended?: boolean;
  /** Found via docs/changelog auto-discovery — not yet verified by us. */
  autoDetected?: boolean;
  description?: string;
}

export const VERIFIED_RYNE_MODELS: RyneModelSpec[] = [
  { id: "apex", label: "Apex", pricePer1kUsd: 0.50, recommended: true, description: "Ryne's flagship humanizer model." },
  { id: "titan", label: "Titan", pricePer1kUsd: 0.50, description: "Strong rewrite; English only." },
  { id: "balanced", label: "Balanced", pricePer1kUsd: 0.08, description: "Lighter, cheaper rewrite." },
];

export const DEFAULT_RYNE_MODEL = "balanced";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const isModelSlug = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 2 && s.length <= 24 && SLUG_RE.test(s);

// ---------- env extension ----------

function extraModelsFromEnv(): RyneModelSpec[] {
  const raw = process.env.RYNE_EXTRA_MODELS?.trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: RyneModelSpec[] = [];
    for (const m of arr) {
      if (!m || typeof m !== "object" || !isModelSlug(m.id)) continue;
      const price = Number(m.pricePer1k);
      if (!Number.isFinite(price) || price <= 0) continue;
      out.push({
        id: m.id,
        label: typeof m.label === "string" && m.label.trim() ? m.label.trim() : m.id,
        pricePer1kUsd: price,
        recommended: m.recommended === true,
        description: typeof m.description === "string" ? m.description : undefined,
      });
    }
    return out;
  } catch {
    console.warn("[ryne-models] RYNE_EXTRA_MODELS is not valid JSON — ignored.");
    return [];
  }
}

// ---------- discovery ----------

const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 5_000;
const DISCOVERY_URLS = ["https://ryne.ai/api-docs", "https://ryne.ai/changelog"];

let discoveryCache: { at: number; models: RyneModelSpec[] } | null = null;

/** Extract `humanizerMode` slugs strictly paired with the key —
 *  `humanizerMode: "apex"`, `"humanizerMode":"nova"` or
 *  `humanizerMode = 'nova'`. Bare words never count. */
export function extractModelSlugs(docText: string): string[] {
  const found = new Set<string>();
  const re = /humanizerMode[\s"'`]{0,3}[:=][\s"'`]{0,3}([a-z0-9][a-z0-9-]{0,23})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(docText))) {
    if (isModelSlug(m[1])) found.add(m[1]);
  }
  return [...found];
}

/** Fetch docs/changelog and return newly documented slugs. Fail-open:
 *  any fetch/parse failure returns the last good cache or []. */
export async function discoverRyneModels(fetcher: typeof fetch = fetch, now = Date.now()): Promise<RyneModelSpec[]> {
  if (discoveryCache && now - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.models;
  const known = new Set(VERIFIED_RYNE_MODELS.map(m => m.id));
  const extra = new Set(extraModelsFromEnv().map(m => m.id));
  const discovered = new Set<string>();
  for (const url of DISCOVERY_URLS) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DISCOVERY_TIMEOUT_MS);
      try {
        const res = await fetcher(url, { signal: ac.signal });
        if (res.ok) for (const s of extractModelSlugs(await res.text())) discovered.add(s);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // fail-open per URL — a dead docs page must not break selection
    }
  }
  const models = [...discovered]
    .filter(id => !known.has(id) && !extra.has(id))
    .map(id => ({
      id,
      label: `${id[0].toUpperCase()}${id.slice(1)}`,
      pricePer1kUsd: 0.50,
      autoDetected: true,
      description: "New (Auto-detected) — documented by Ryne, not yet verified by us.",
    }));
  discoveryCache = { at: now, models };
  return models;
}

/** Reset the discovery cache — tests only. */
export function _resetRyneModelDiscoveryCache() { discoveryCache = null; }

/** Merge verified + discovered + env extras. Env wins on id collisions;
 *  verified wins over discovered. Order is stable for UI rendering. */
function merge(discovered: RyneModelSpec[]): RyneModelSpec[] {
  const byId = new Map<string, RyneModelSpec>();
  for (const m of VERIFIED_RYNE_MODELS) byId.set(m.id, { ...m });
  for (const m of discovered) if (!byId.has(m.id)) byId.set(m.id, m);
  for (const m of extraModelsFromEnv()) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()];
}

/** Full registry — awaits docs discovery (cached 24h, fail-open). */
export async function listRyneModels(fetcher?: typeof fetch): Promise<RyneModelSpec[]> {
  return merge(await discoverRyneModels(fetcher));
}

/** Synchronous registry — verified + env + last-good discovery cache.
 *  Used where no async context exists (pricing, status labels). */
export function listRyneModelsSync(): RyneModelSpec[] {
  return merge(discoveryCache?.models ?? []);
}

export const isRyneModel = (id: unknown): id is string =>
  typeof id === "string" && listRyneModelsSync().some(m => m.id === id);

/** Map a client-supplied mode to a known model id; unknown → fallback. */
export function normalizeRyneModel(id: unknown, fallback = DEFAULT_RYNE_MODEL): string {
  return isRyneModel(id) ? id : fallback;
}

export function ryneModelSpec(id: string): RyneModelSpec | null {
  return listRyneModelsSync().find(m => m.id === id) ?? null;
}

export function ryneModelPricePer1k(id: string): number {
  return ryneModelSpec(id)?.pricePer1kUsd ?? ryneModelSpec(DEFAULT_RYNE_MODEL)!.pricePer1kUsd;
}
