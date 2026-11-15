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

function aiScoreResponse(tool) {
  if (tool === "zerogpt") {
    return { error: true, error_msg: "stub: simulated detector failure (retained as UNKNOWN)" };
  }
  const reilaa = tool === "reilaa";
  return {
    source: tool,
    aiScore: 42,
    classification: "moderate",
    details: {
      classification: "moderate",
      rawScore: 42,
      granularity: reilaa ? "document" : "sentence",
      ...(reilaa
        ? {}
        : {
            sentences: [
              { text: "stub flagged sentence one", score: 88 },
              { text: "stub flagged sentence two", score: 76 },
            ],
          }),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  try {
    const body = await readBody(req);
    if (req.method === "POST" && req.url === "/api/ai-score") {
      const tool = String(req.headers["tool"] || "");
      const parsed = JSON.parse(body || "{}");
      if (!tool || typeof parsed.text !== "string" || !parsed.text) {
        return send(400, { error: true, error_msg: "missing tool or text" });
      }
      return send(200, aiScoreResponse(tool));
    }
    if (req.method === "POST" && req.url === "/api/humanizer/models/supernova") {
      const parsed = JSON.parse(body || "{}");
      if (typeof parsed.text !== "string" || !parsed.text) {
        return send(400, { error: true, error_msg: "missing text" });
      }
      const mode = parsed.humanizerMode === "titan" ? "titan" : "balanced";
      return send(200, {
        content: `[stub-${mode}] ${parsed.text}`,
        aiScore: 8.5,
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
