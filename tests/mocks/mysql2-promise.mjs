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
//   };

function oneLine(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

function db() {
  if (!globalThis.__MOCK_DB) globalThis.__MOCK_DB = {};
  return globalThis.__MOCK_DB;
}

export function createPool() {
  return {
    async execute(sql, params = []) {
      const s = oneLine(sql);
      const store = db();

      // getConsultantSession: sessions JOIN consultants on token hash
      if (/FROM consultant_sessions s JOIN consultants c/.test(s) && /s\.token_hash = \?/.test(s)) {
        const row = store.sessionRows?.[params[0]];
        return [row ? [row] : []];
      }
      // expired-session cleanup / logout
      if (/^DELETE FROM consultant_sessions/.test(s)) {
        return [{ affectedRows: 1 }];
      }
      // getDocument
      if (/^SELECT \* FROM application_documents WHERE id = \?$/.test(s)) {
        const row = store.documents?.[params[0]];
        return [row ? [row] : []];
      }
      // getApplication
      if (/^SELECT \* FROM applications WHERE id = \?$/.test(s)) {
        const row = store.applications?.[params[0]];
        return [row ? [row] : []];
      }
      // listDocumentVersions / getDocumentVersion
      if (/FROM document_versions WHERE document_id = \?/.test(s)) {
        return [store.versions?.[params[0]] ?? []];
      }
      if (/^SELECT \* FROM document_versions WHERE id = \?$/.test(s)) {
        const all = Object.values(store.versions ?? {}).flat();
        const row = all.find(v => v.id === params[0]);
        return [row ? [row] : []];
      }
      throw new Error(`mock mysql2: unhandled SQL: ${s}`);
    },
    async getConnection() {
      throw new Error("mock mysql2: getConnection not supported by this fixture");
    },
    async end() {},
  };
}

export default { createPool };
