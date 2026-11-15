// Fake mysql2/promise for tests that must not touch a real database.
// Rows are supplied through globalThis.__MOCK_DB by the test file;
// only the exact queries exercised by the code under test are handled.
// Anything unexpected throws so a test can never silently pass
// against an unmocked code path.
//
//   globalThis.__MOCK_DB = {
//     sessionRows:  { [tokenHash]: <JOIN row for getConsultantSession> },
//     documents:    { [id]: <application_documents row> },
//     applications: { [id]: <applications row> },
//     versions:     { [documentId]: [<document_versions rows>] },
//     spendCounters:{ ["scope|key"]: {reserved_usd, settled_usd} },
//     spendEvents:  { [id]: <ryne_spend_events row> },
//   };
//
// getConnection() returns a working fake connection sharing the same
// store; beginTransaction snapshots it and rollback restores, which
// gives tests real atomicity semantics for multi-statement flows.

function oneLine(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function db() {
  if (!globalThis.__MOCK_DB) globalThis.__MOCK_DB = {};
  if (!globalThis.__MOCK_DB.spendCounters) globalThis.__MOCK_DB.spendCounters = {};
  if (!globalThis.__MOCK_DB.spendEvents) globalThis.__MOCK_DB.spendEvents = {};
  return globalThis.__MOCK_DB;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function counterKey(scope, key) { return `${scope}|${key}`; }
function getCounter(store, scope, key) {
  return store.spendCounters[counterKey(scope, key)] ?? null;
}
function ensureCounter(store, scope, key) {
  const k = counterKey(scope, key);
  if (!store.spendCounters[k]) {
    store.spendCounters[k] = { reserved_usd: 0, settled_usd: 0 };
    return true;
  }
  return false;
}

async function exec(sql, params = []) {
  const s = oneLine(sql);
  const store = db();
  // failure injection for tests: __MOCK_DB.failExec = true
  if (store.failExec) throw new Error("mock mysql2: injected execute failure");

  // ---- consultant sessions / auth (writing-review-auth tests) ----
  if (/FROM consultant_sessions s JOIN consultants c/.test(s) && /s\.token_hash = \?/.test(s)) {
    const row = store.sessionRows?.[params[0]];
    return [row ? [row] : []];
  }
  if (/^DELETE FROM consultant_sessions/.test(s)) {
    return [{ affectedRows: 1 }];
  }
  if (/^SELECT \* FROM application_documents WHERE id = \?$/.test(s)) {
    const row = store.documents?.[params[0]];
    return [row ? [row] : []];
  }
  if (/^SELECT \* FROM applications WHERE id = \?$/.test(s)) {
    const row = store.applications?.[params[0]];
    return [row ? [row] : []];
  }
  if (/FROM document_versions WHERE document_id = \?/.test(s)) {
    return [store.versions?.[params[0]] ?? []];
  }
  if (/^SELECT \* FROM document_versions WHERE id = \?$/.test(s)) {
    const all = Object.values(store.versions ?? {}).flat();
    const row = all.find(v => v.id === params[0]);
    return [row ? [row] : []];
  }

  // ---- ryne spend ledger (writing-review-spend-ledger tests) ----

  // INSERT IGNORE INTO ryne_spend_counters (scope,scope_key) VALUES ('day', ?), ('total','ALL')
  if (/^INSERT IGNORE INTO ryne_spend_counters/.test(s)) {
    let created = 0;
    if (ensureCounter(store, "day", params[0])) created++;
    if (ensureCounter(store, "total", "ALL")) created++;
    return [{ affectedRows: created }];
  }
  // conditional reservation (scope is a SQL literal):
  //   day:   ... WHERE scope='day'   AND scope_key=?     AND reserved_usd + settled_usd + ? <= ?  → [add, key, add, cap]
  //   total: ... WHERE scope='total' AND scope_key='ALL' AND reserved_usd + settled_usd + ? <= ?  → [add, add, cap]
  if (/UPDATE ryne_spend_counters SET reserved_usd = reserved_usd \+ \?/.test(s) && /reserved_usd \+ settled_usd \+ \? <= \?/.test(s)) {
    const isDay = /scope='day'/.test(s);
    const [add, key, add2, cap] = isDay ? params : [params[0], "ALL", params[1], params[2]];
    const c = getCounter(store, isDay ? "day" : "total", key);
    if (c && c.reserved_usd + c.settled_usd + add2 <= cap) {
      c.reserved_usd += add;
      return [{ affectedRows: 1 }];
    }
    return [{ affectedRows: 0 }];
  }
  // unconditional total increment when no total cap is configured → [add]
  if (/UPDATE ryne_spend_counters SET reserved_usd = reserved_usd \+ \?/.test(s)) {
    const c = getCounter(store, "total", "ALL");
    if (!c) return [{ affectedRows: 0 }];
    c.reserved_usd += params[0];
    return [{ affectedRows: 1 }];
  }
  // settle (guarded): reserved_usd = reserved_usd - ?, settled_usd = settled_usd + ?
  //   ... AND reserved_usd >= ?   day → [dec, inc, key, dec]   total → [dec, inc, dec]
  if (/SET reserved_usd = reserved_usd - \?, settled_usd = settled_usd \+ \?/.test(s)) {
    const isDay = /scope='day'/.test(s);
    const [dec, inc, key, guard] = isDay ? params : [params[0], params[1], "ALL", params[2]];
    const c = getCounter(store, isDay ? "day" : "total", key);
    if (!c || c.reserved_usd < guard) return [{ affectedRows: 0 }];
    c.reserved_usd -= dec;
    c.settled_usd += inc;
    return [{ affectedRows: 1 }];
  }
  // refund (guarded): reserved_usd = reserved_usd - ?
  //   ... AND reserved_usd >= ?   day → [dec, key, dec]   total → [dec, dec]
  if (/SET reserved_usd = reserved_usd - \?/.test(s)) {
    const isDay = /scope='day'/.test(s);
    const [dec, key, guard] = isDay ? params : [params[0], "ALL", params[1]];
    const c = getCounter(store, isDay ? "day" : "total", key);
    if (!c || c.reserved_usd < guard) return [{ affectedRows: 0 }];
    c.reserved_usd -= dec;
    return [{ affectedRows: 1 }];
  }
  // INSERT INTO ryne_spend_events — duplicate op+kind+unit → ER_DUP_ENTRY
  if (/^INSERT INTO ryne_spend_events/.test(s)) {
    const [id, operationId, kind, provider, unit, day, actorId, studentId, appId, docId, verId, est, basis, priceUnit, unitPrice, qty, pricingVersion] = params;
    const dup = Object.values(store.spendEvents).find(e =>
      e.operation_id === operationId && e.request_kind === kind && e.request_unit === unit);
    if (dup) {
      const err = new Error(`Duplicate entry for key 'uq_ryne_op_unit'`);
      err.code = "ER_DUP_ENTRY";
      throw err;
    }
    store.spendEvents[id] = {
      id, operation_id: operationId, request_kind: kind, provider, request_unit: unit,
      status: "RESERVED", counter_day: day, actor_id: actorId, student_id: studentId,
      application_id: appId, document_id: docId, version_id: verId,
      estimated_usd: est, settled_usd: null, provider_cost_usd: null, cost_basis: basis,
      price_unit: priceUnit, unit_price_usd: unitPrice, unit_quantity: qty,
      pricing_version: pricingVersion, outcome: null, provider_ref: null,
      reserved_at: new Date().toISOString(), settled_at: null,
    };
    return [{ affectedRows: 1 }];
  }
  // SELECT event by id FOR UPDATE
  if (/SELECT id, status, estimated_usd, counter_day, cost_basis FROM ryne_spend_events WHERE id = \? FOR UPDATE/.test(s)) {
    const row = store.spendEvents[params[0]];
    return [row ? [{ ...row }] : []];
  }
  // SELECT events by operation
  if (/SELECT \* FROM ryne_spend_events WHERE operation_id = \?/.test(s)) {
    return [Object.values(store.spendEvents).filter(e => e.operation_id === params[0])];
  }
  // UPDATE event → SETTLED
  if (/UPDATE ryne_spend_events SET status='SETTLED'/.test(s)) {
    const [settledUsd, outcome, providerRef, providerCost, basis, id] = params;
    const row = store.spendEvents[id];
    if (!row) return [{ affectedRows: 0 }];
    Object.assign(row, {
      status: "SETTLED", settled_usd: settledUsd, outcome, provider_ref: providerRef,
      provider_cost_usd: providerCost, cost_basis: basis, settled_at: new Date().toISOString(),
    });
    return [{ affectedRows: 1 }];
  }
  // UPDATE event → REFUNDED
  if (/UPDATE ryne_spend_events SET status='REFUNDED'/.test(s)) {
    const [outcome, id] = params;
    const row = store.spendEvents[id];
    if (!row) return [{ affectedRows: 0 }];
    Object.assign(row, { status: "REFUNDED", outcome, settled_at: new Date().toISOString() });
    return [{ affectedRows: 1 }];
  }
  // UPDATE event → UNKNOWN (only from RESERVED)
  if (/UPDATE ryne_spend_events SET status='UNKNOWN'/.test(s)) {
    const [outcome, id] = params;
    const row = store.spendEvents[id];
    if (!row || row.status !== "RESERVED") return [{ affectedRows: 0 }];
    row.status = "UNKNOWN";
    row.outcome = outcome;
    return [{ affectedRows: 1 }];
  }
  // counter snapshot read
  if (/SELECT scope, scope_key, reserved_usd, settled_usd FROM ryne_spend_counters/.test(s)) {
    const dayKey = params[0];
    return [Object.entries(store.spendCounters)
      .filter(([k]) => k === `day|${dayKey}` || k === "total|ALL")
      .map(([k, v]) => ({ scope: k.split("|")[0], scope_key: k.split("|")[1], ...v }))];
  }

  throw new Error(`mock mysql2: unhandled SQL: ${s}`);
}

// Transactions serialize like contended InnoDB row locks: each
// beginTransaction queues behind the previous commit/rollback, so a
// follower's snapshot always includes the winner's committed state
// and rollback never erases another transaction's writes.
let txnTail = Promise.resolve();
function acquireTxn() {
  let releaseFn;
  const next = new Promise(r => (releaseFn = r));
  const acquired = txnTail.then(() => releaseFn);
  txnTail = txnTail.then(() => next);
  return acquired;
}

function fakeConnection() {
  let snapshot = null;
  let releaseTxn = null;
  return {
    execute: exec,
    async beginTransaction() {
      releaseTxn = await acquireTxn();
      snapshot = clone(db());
    },
    async commit() { snapshot = null; if (releaseTxn) releaseTxn(); },
    async rollback() {
      if (snapshot) { globalThis.__MOCK_DB = snapshot; snapshot = null; }
      if (releaseTxn) releaseTxn();
    },
    release() { if (releaseTxn) releaseTxn(); },
  };
}

export function createPool() {
  return {
    execute: exec,
    async getConnection() {
      if (globalThis.__MOCK_DB?.failConnect) throw new Error("mock mysql2: injected connect failure");
      return fakeConnection();
    },
    async end() {},
  };
}

export default { createPool };
