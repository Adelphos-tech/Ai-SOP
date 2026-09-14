const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const studentId = require('node:crypto').randomUUID();
const profile = { _revision: 7, personalData: { firstName: 'Existing', lastName: 'Student' } };

if (process.env.CV_UPLOAD_SMOKE_CHILD === '1') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      console.error('SMOKE_UNEXPECTED_NETWORK_ACCESS');
      throw new Error('SMOKE_UNEXPECTED_NETWORK_ACCESS');
    }
    return originalFetch(input, options);
  };
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const { Document, Packer, Paragraph } = require('docx');
  const root = path.resolve(__dirname, '..');
  const dbEnv = { SOP_DB_HOST: '127.0.0.1', SOP_DB_PORT: '3306', SOP_DB_NAME: 'sop_ai_app_test', SOP_DB_USER: process.env.SOP_TEST_DB_USER || 'sop_test', SOP_DB_PASSWORD: process.env.SOP_TEST_DB_PASSWORD || '' };
  const connection = await require('mysql2/promise').createConnection({ host: dbEnv.SOP_DB_HOST, user: dbEnv.SOP_DB_USER, password: dbEnv.SOP_DB_PASSWORD, database: dbEnv.SOP_DB_NAME });
  const [[database]] = await connection.query('SELECT DATABASE() AS name');
  assert.equal(database.name, 'sop_ai_app_test');
  await connection.execute('INSERT INTO students (id, first_name, last_name, email, profile_data) VALUES (?, ?, ?, ?, ?)', [studentId, 'Existing', 'Student', 'smoke@example.test', JSON.stringify(profile)]);
  const [before] = await connection.execute('SELECT * FROM students WHERE id = ?', [studentId]);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-production-smoke-'));
  const port = Number(process.env.CV_SMOKE_PORT || 5097);
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  const child = spawn(process.execPath, ['--require', __filename, require.resolve('next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', CV_UPLOAD_SMOKE_CHILD: '1', SOP_CV_STORAGE: temporary, ...dbEnv, OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('Next.js exited before readiness');
      if (output.includes('Ready in')) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(ready, 'Next.js must start');
    const text = 'Jane Smith\njane@example.test\nEducation\nBachelor of Computer Science, Example University\nSkills\nPython, SQL, Docker';
    async function pdf(content) {
      const doc = await PDFDocument.create();
      const page = doc.addPage();
      if (content) page.drawText(content, { font: await doc.embedFont(StandardFonts.Helvetica), size: 12, x: 50, y: 700 });
      return doc.save();
    }
    const cases = [
      ['searchable.pdf', 'application/pdf', await pdf(text), 200, null],
      ['blank.pdf', 'application/pdf', await pdf(''), 400, 'IMAGE_ONLY_PDF'],
      ['short.pdf', 'application/pdf', await pdf('Jane Smith curriculum'), 400, 'INSUFFICIENT_TEXT'],
      ['corrupt.pdf', 'application/pdf', Buffer.from('%PDF-1.4\ninvalid'), 400, 'CORRUPT_OR_UNREADABLE_PDF'],
      ['searchable.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await Packer.toBuffer(new Document({ sections: [{ children: text.split('\n').map(line => new Paragraph(line)) }] })), 200, null],
    ];
    for (const filename of process.argv.slice(2)) {
      cases.push([path.basename(filename), 'application/pdf', await fs.readFile(filename), 200, null]);
    }
    for (const [name, mime, buffer, status, code] of cases) {
      const form = new FormData();
      form.append('studentId', studentId);
      form.append('file', new Blob([buffer], { type: mime }), name);
      const response = await fetch(`${origin}/api/application/cv-upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      assert.equal(response.status, status, `${name}: ${body.code || 'no error code'}`);
      if (code) {
        assert.equal(body.code, code);
        assert.equal(typeof body.error, 'string');
        assert(!body.error.includes(' at '));
      } else {
        assert.equal(body.success, true);
        assert.equal(body.reused, false);
        assert.equal(body.profileRevision, profile._revision);
        assert(body.parsed.rawTextLength >= 50);
      }
      const [after] = await connection.execute('SELECT * FROM students WHERE id = ?', [studentId]);
      assert.deepEqual(after, before, 'Student profile must remain unchanged');
      console.log(`PASS ${name}: HTTP ${status}${code ? ` ${code}` : ''}`);
    }
    assert(!output.includes('SMOKE_UNEXPECTED_'), 'No profile mutation or external API access');
    assert(!output.includes('jane@example.test'), 'No CV text in logs');
    const logs = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    for (const reason of ['IMAGE_ONLY_PDF', 'INSUFFICIENT_TEXT', 'CORRUPT_OR_UNREADABLE_PDF']) {
      const log = logs.find(item => item.reason === reason);
      assert(log, `Structured log for ${reason}`);
      for (const field of ['event', 'reason', 'studentId', 'mimeType', 'fileSize', 'buildId']) assert(field in log, field);
    }
  } catch (error) {
    console.error(output);
    throw error;
  } finally {
    const exited = once(child, 'exit');
    if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
    await fs.rm(temporary, { recursive: true, force: true });
    await connection.end();
  }
}
