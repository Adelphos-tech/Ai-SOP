#!/usr/bin/env node
// ============================================================
// Ryne provider stub for the protected staging environment.
// Mimics the documented Ryne endpoints with deterministic
// responses so hosted smoke tests exercise the FULL paid path
// (consent -> reserve -> dispatch -> settle) without real
// provider calls or credits. Runs on 127.0.0.1 only.
// ============================================================
"use strict";

const http = require("http");
const PORT = parseInt(process.env.RYNE_STUB_PORT || "5099", 10);

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

function aiScoreResponse(tool, text) {
  if (tool === "zerogpt") {
    return { error: true, error_msg: "stub: simulated detector failure (retained as UNKNOWN)" };
  }
  const reilaa = tool === "reilaa";
  // Flag the first two REAL document sentences so the UI can
  // anchor them — invented text would never match the doc.
  const sentences = reilaa
    ? []
    : String(text)
        .match(/[^.!?\n]+[.!?]/g)
        ?.slice(0, 2)
        .map((s, i) => ({ text: s.trim(), score: 88 - i * 12 })) || [];
  return {
    source: tool,
    aiScore: 42,
    classification: "moderate",
    details: {
      classification: "moderate",
      rawScore: 42,
      granularity: reilaa ? "document" : "sentence",
      ...(reilaa ? {} : { sentences }),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    // Small latency so in-flight UI states (disabled buttons, spinners)
    // are observable — a zero-latency stub finishes before the browser paints.
    await new Promise(r => setTimeout(r, parseInt(process.env.RYNE_STUB_LATENCY_MS || "600", 10)));
    const body = await readBody(req);
    if (req.method === "POST" && req.url === "/api/ai-score") {
      const tool = String(req.headers["tool"] || "");
      const parsed = JSON.parse(body || "{}");
      if (!tool || typeof parsed.text !== "string" || !parsed.text) {
        return send(400, { error: true, error_msg: "missing tool or text" });
      }
      return send(200, aiScoreResponse(tool, parsed.text));
    }
    if (req.method === "POST" && req.url === "/api/humanizer/models/supernova") {
      const parsed = JSON.parse(body || "{}");
      if (typeof parsed.text !== "string" || !parsed.text) {
        return send(400, { error: true, error_msg: "missing text" });
      }
      const mode = parsed.humanizerMode === "titan" ? "Titan" : "Balanced";
      return send(200, {
        content: `[${mode}-rewritten] ${parsed.text}`,
        aiScore: 8.2,
      });
    }
    return send(404, { error: true, error_msg: "unknown stub route" });
  } catch (e) {
    return send(500, { error: true, error_msg: String(e && e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ryne-stub listening on 127.0.0.1:${PORT}`);
});
