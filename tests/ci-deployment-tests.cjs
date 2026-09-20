const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scripts = path.resolve(__dirname, '../scripts');
const tests = [];

function snapshot(directory) {
  if (!fs.existsSync(directory)) return null;
  const entries = {};
  function visit(current, relative) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      entries[relative] = { type: 'link', target: fs.readlinkSync(current) };
    } else if (stat.isDirectory()) {
      entries[relative] = { type: 'directory', mode: stat.mode & 0o777 };
      for (const name of fs.readdirSync(current).sort()) {
        visit(path.join(current, name), relative ? `${relative}/${name}` : name);
      }
    } else {
      entries[relative] = {
        type: 'file',
        mode: stat.mode & 0o777,
        content: fs.readFileSync(current).toString('base64'),
      };
    }
  }
  visit(directory, '');
  return entries;
}

const stubSource = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = ${snapshot.toString()};
const command = process.argv[2];
const args = process.argv.slice(3);
const root = fs.realpathSync(process.env.FIXTURE_ROOT);
const app = process.env.APP_DIR;
const incoming = app + '.incoming-' + process.env.RELEASE_ID;
const previous = app + '.previous-' + process.env.RELEASE_ID;
function confined(value) {
  const resolved = path.resolve(value);
  assert.ok(resolved.startsWith(root + path.sep), 'Fixture path outside temporary directory: ' + resolved);
  return resolved;
}
function readBuild() {
  const file = confined(path.join(app, '.next/BUILD_ID'));
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
}
const event = { command, args, cwd: process.cwd(), build: readBuild() };
if (command === 'npm') {
  assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(confined(incoming)));
  event.live = snapshot(confined(app));
  event.incoming = snapshot(confined(incoming));
}
if (command === 'mv') {
  assert.equal(args.length, 2);
  args.forEach(confined);
  event.source = snapshot(args[0]);
  event.previous = snapshot(confined(previous));
  event.liveExists = fs.existsSync(app);
}
fs.appendFileSync(confined(process.env.EVENT_LOG), JSON.stringify(event) + '\n');
switch (command) {
  case 'npm':
    fs.mkdirSync(confined(path.join(incoming, 'node_modules')), { recursive: true });
    fs.writeFileSync(confined(path.join(incoming, 'node_modules/installed.txt')), 'dependencies-' + fs.readFileSync(confined(path.join(incoming, '.next/BUILD_ID')), 'utf8').trim());
    if (process.env.FAIL_NPM === '1') process.exit(42);
    break;
  case 'pm2':
    assert.deepEqual(args, ['restart', 'fixture-app', '--update-env']);
    if (event.build === process.env.FAIL_RESTART_BUILD) process.exit(43);
    break;
  case 'curl': {
    const url = args[args.length - 1];
    assert.ok(url.startsWith('http://fixture.invalid/') || url.startsWith('https://external.invalid/'));
    if (url.startsWith('https://external.invalid/')) {
      process.exit(process.env.FAIL_EXTERNAL === '1' ? 22 : 0);
    }
    const suffix = process.env.FAIL_HEALTH_PATH;
    if (event.build === process.env.FAIL_HEALTH_BUILD && (!suffix || url.endsWith(suffix))) process.exit(22);
    break;
  }
  case 'sleep':
    break;
  case 'flock':
    assert.deepEqual(args, ['-n', '9']);
    break;
  case 'mv': {
    if (process.env.FAIL_ACTIVATION === '1' && args[0] === incoming && args[1] === app) process.exit(44);
    const destination = fs.existsSync(args[1]) && fs.statSync(args[1]).isDirectory()
      ? path.join(args[1], path.basename(args[0]))
      : args[1];
    fs.renameSync(confined(args[0]), confined(destination));
    break;
  }
  default:
    throw new Error('Unexpected stub command: ' + command);
}
`;

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ci deployment tests-')));
  const app = path.join(root, 'app');
  const bin = path.join(root, 'bin');
  const eventsFile = path.join(root, 'events.jsonl');
  const release = 'release-1';
  const previous = `${app}.previous-${release}`;
  const incoming = `${app}.incoming-${release}`;
  const failed = `${app}.failed-${release}`;
  function write(file, value, mode = 0o644) {
    assert.ok(path.resolve(file).startsWith(root + path.sep));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value, { mode });
  }
  function seed(directory, build, installed = false) {
    write(path.join(directory, '.next/BUILD_ID'), `${build}\n`);
    write(path.join(directory, '.next/prerender-manifest.json'), JSON.stringify({ build }));
    write(path.join(directory, '.next/static', build, '_buildManifest.js'), `manifest-${build}`);
    write(path.join(directory, 'package.json'), JSON.stringify({ name: build, private: true }));
    write(path.join(directory, 'package-lock.json'), JSON.stringify({ name: build, lockfileVersion: 3 }));
    write(path.join(directory, 'next.config.js'), `module.exports = { env: { build: '${build}' } };\n`);
    write(path.join(directory, 'src/server.js'), `source-${build}\n`);
    write(path.join(directory, 'scripts/start.sh'), `#!/bin/bash\nprintf '%s' '${build}'\n`, 0o755);
    write(path.join(directory, '.hidden-release-file'), `hidden-${build}`);
    write(path.join(directory, '.env.example'), `EXAMPLE=${build}\n`);
    if (installed) write(path.join(directory, 'node_modules/installed.txt'), `dependencies-${build}`);
  }
  try {
    seed(app, 'old-build', true);
    write(path.join(app, '.ci-release-id'), 'original-release\n');
    write(path.join(app, '.env.local'), 'DATABASE_URL=fixture-only\nSECRET=preserve-exactly\n', 0o600);
    write(path.join(app, '.env'), 'BASE_ENV=keep\n', 0o600);
    write(path.join(app, 'logs/server.log'), 'original logs\n');
    write(path.join(app, 'backups/backup.txt'), 'original backup\n');
    write(path.join(app, 'baselines/baseline.txt'), 'original baseline\n');
    write(path.join(root, 'persistent-uploads/upload.txt'), 'original upload\n');
    fs.symlinkSync('../persistent-uploads', path.join(app, 'uploads'));
    seed(incoming, 'new-build');
    write(path.join(incoming, '.env.local'), 'SHOULD_BE_REPLACED=true\n');
    write(path.join(root, 'stub.cjs'), stubSource);
    for (const command of ['npm', 'pm2', 'curl', 'sleep', 'flock', 'mv']) {
      write(path.join(bin, command), `#!/bin/bash\nexec ${shellQuote(process.execPath)} ${shellQuote(path.join(root, 'stub.cjs'))} ${shellQuote(command)} "$@"\n`, 0o755);
    }
    write(eventsFile, '');
    const original = snapshot(app);
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      TMPDIR: root,
      LC_ALL: 'C',
      APP_DIR: app,
      SHARED_DIR: path.join(root, 'shared'),
      PM2_NAME: 'fixture-app',
      LOCAL_HEALTH_URL: 'http://fixture.invalid',
      NEXT_PUBLIC_BUILD_ID: 'new-build',
      RELEASE_ID: release,
      FIXTURE_ROOT: root,
      EVENT_LOG: eventsFile,
    };
    function run(command, args, overrides = {}) {
      const result = spawnSync(command, args, {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      return result;
    }
    return {
      root, app, incoming, previous, failed, original, seed, write,
      deploy: (overrides) => run('/bin/bash', [path.join(scripts, 'ci-deploy.sh')], overrides),
      rollback: (overrides) => run('/bin/bash', [path.join(scripts, 'ci-rollback.sh')], overrides),
      externalHealth: () => run(path.join(bin, 'curl'), ['--fail', 'https://external.invalid/students'], { FAIL_EXTERNAL: '1' }),
      events: () => fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)),
      cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function test(name, body) {
  tests.push({ name, body });
}

function success(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function failure(result) {
  assert.notEqual(result.status, 0, `Unexpected success:\n${result.stdout}\n${result.stderr}`);
}

function assertEnvironment(f, directory = f.app) {
  for (const name of ['.env', '.env.local']) {
    assert.deepEqual(snapshot(directory)[name], f.original[name], `${name} contents and permissions must survive`);
  }
}

function assertPersistent(f, directory = f.app, deployed = false) {
  for (const [entry, file, expected] of [
    ['logs', 'server.log', 'original logs\n'],
    ['uploads', 'upload.txt', 'original upload\n'],
    ['backups', 'backup.txt', 'original backup\n'],
    ['baselines', 'baseline.txt', 'original baseline\n'],
  ]) {
    assert.equal(fs.readFileSync(path.join(directory, entry, file), 'utf8'), expected);
    if (deployed || entry === 'uploads') assert.ok(fs.lstatSync(path.join(directory, entry)).isSymbolicLink(), entry);
  }
  assert.equal(fs.realpathSync(path.join(directory, 'uploads')), path.join(f.root, 'persistent-uploads'));
}

function assertRestored(f, failedExpected = true) {
  assert.deepEqual(snapshot(f.app), f.original, 'Rollback must restore the entire previous release');
  assertEnvironment(f);
  assertPersistent(f);
  assert.equal(fs.existsSync(f.previous), false);
  assert.equal(fs.existsSync(f.failed), failedExpected);
  if (failedExpected) {
    assert.equal(fs.readFileSync(path.join(f.failed, '.next/BUILD_ID'), 'utf8'), 'new-build\n');
    assertEnvironment(f, f.failed);
  }
  const restarts = f.events().filter((event) => event.command === 'pm2');
  assert.equal(restarts[restarts.length - 1].build, 'old-build');
  const health = f.events().filter((event) => event.command === 'curl');
  assert.ok(health.some((event) => event.args.at(-1) === 'http://fixture.invalid/_next/static/old-build/_buildManifest.js'));
}

function assertInstallIsolated(f, expectedIncoming = f.incoming, expectedLive = f.original) {
  const installs = f.events().filter((event) => event.command === 'npm' && event.cwd === expectedIncoming);
  assert.equal(installs.length, 1);
  assert.deepEqual(installs[0].args, ['ci', '--include=dev', '--no-audit', '--no-fund']);
  assert.deepEqual(installs[0].live, expectedLive, 'npm must not modify the live release');
  assert.equal(installs[0].incoming.node_modules, undefined);
}

test('successful deployment saves the entire previous release before activation and preserves persistent data', (f) => {
  success(f.deploy());
  assertInstallIsolated(f);
  assert.deepEqual(snapshot(f.previous), f.original);
  const activation = f.events().find((event) => event.command === 'mv' && event.args[0] === f.incoming);
  assert.ok(activation);
  assert.equal(activation.liveExists, false);
  assert.deepEqual(activation.previous, f.original, 'All old files must be backed up before activation');
  assert.ok(activation.source['node_modules/installed.txt']);
  assert.equal(fs.readFileSync(path.join(f.app, '.next/BUILD_ID'), 'utf8'), 'new-build\n');
  assert.equal(fs.readFileSync(path.join(f.app, 'node_modules/installed.txt'), 'utf8'), 'dependencies-new-build');
  assert.equal(fs.readFileSync(path.join(f.app, '.ci-release-id'), 'utf8'), 'release-1\n');
  assert.equal(fs.readFileSync(path.join(f.app, '.env.example'), 'utf8'), 'EXAMPLE=new-build\n');
  assertEnvironment(f);
  assertPersistent(f, f.app, true);
  assertPersistent(f, f.previous);
  assert.equal(fs.existsSync(f.incoming), false);
  assert.equal(fs.existsSync(f.failed), false);
  assert.equal(f.events().filter((event) => event.command === 'flock').length, 1);
  assert.deepEqual(f.events().filter((event) => event.command === 'curl').map((event) => event.args.at(-1)), [
    'http://fixture.invalid/students',
    'http://fixture.invalid/_next/static/new-build/_buildManifest.js',
  ]);
});

test('deployment works when only .env.local exists', (f) => {
  fs.unlinkSync(path.join(f.app, '.env'));
  const original = snapshot(f.app);
  success(f.deploy());
  assert.deepEqual(snapshot(f.previous), original);
  assert.equal(fs.readFileSync(path.join(f.app, '.env.local'), 'utf8'), fs.readFileSync(path.join(f.previous, '.env.local'), 'utf8'));
  assertPersistent(f, f.app, true);
});

test('npm install failure leaves the live release intact', (f) => {
  failure(f.deploy({ FAIL_NPM: '1' }));
  assertInstallIsolated(f);
  assert.deepEqual(snapshot(f.app), f.original);
  assertEnvironment(f);
  assertPersistent(f);
  assert.equal(fs.existsSync(f.previous), false);
  assert.equal(fs.existsSync(f.failed), false);
  assert.ok(fs.existsSync(path.join(f.incoming, 'node_modules/installed.txt')));
  assert.equal(f.events().some((event) => ['mv', 'pm2', 'curl'].includes(event.command)), false);
});

test('restart failure automatically rolls back the entire release', (f) => {
  failure(f.deploy({ FAIL_RESTART_BUILD: 'new-build' }));
  assertRestored(f);
  assert.deepEqual(f.events().filter((event) => event.command === 'pm2').map((event) => event.build), ['new-build', 'old-build']);
});

for (const endpoint of ['/students', '/_buildManifest.js']) {
  test(`local health failure at ${endpoint} automatically rolls back after retries`, (f) => {
    failure(f.deploy({ FAIL_HEALTH_BUILD: 'new-build', FAIL_HEALTH_PATH: endpoint }));
    assertRestored(f);
    const failedChecks = f.events().filter((event) => event.command === 'curl' && event.build === 'new-build' && event.args.at(-1).endsWith(endpoint));
    assert.equal(failedChecks.length, 5);
  });
}

test('partial rename failure restores the previous release even when the live directory is absent', (f) => {
  failure(f.deploy({ FAIL_ACTIVATION: '1' }));
  assertRestored(f, false);
  assert.equal(fs.existsSync(f.incoming), true);
  assert.deepEqual(f.events().filter((event) => event.command === 'mv').map((event) => event.args), [
    [f.app, f.previous], [f.incoming, f.app], [f.previous, f.app],
  ]);
});

test('explicit rollback after external health failure restores environment and persistent content', (f) => {
  success(f.deploy());
  failure(f.externalHealth());
  success(f.rollback());
  assertRestored(f);
  assert.equal(f.events().filter((event) => event.command === 'flock').length, 2);
});

test('rollback refuses a wrong release ID even when that ID has a backup', (f) => {
  success(f.deploy());
  const wrongPrevious = `${f.app}.previous-wrong-release`;
  f.seed(wrongPrevious, 'unrelated-build', true);
  const live = snapshot(f.app);
  const backup = snapshot(wrongPrevious);
  const eventCount = f.events().length;
  failure(f.rollback({ RELEASE_ID: 'wrong-release' }));
  assert.deepEqual(snapshot(f.app), live);
  assert.deepEqual(snapshot(wrongPrevious), backup);
  assert.deepEqual(snapshot(f.previous), f.original);
  assert.equal(fs.existsSync(`${f.app}.failed-wrong-release`), false);
  assert.equal(f.events().slice(eventCount).some((event) => ['mv', 'pm2', 'curl'].includes(event.command)), false);
});

test('deployment and rollback reject invalid and missing release IDs before side effects', (f) => {
  const staged = snapshot(f.incoming);
  const invalidIds = ['', '../escape', '/absolute', '-leading', 'has space', 'has/slash', 'has_underscore', 'has.dot', 'id;echo unsafe', 'id\nnext', 'a'.repeat(102), undefined];
  for (const releaseId of invalidIds) {
    for (const invoke of [f.deploy, f.rollback]) {
      failure(invoke({ RELEASE_ID: releaseId }));
      assert.deepEqual(snapshot(f.app), f.original);
      assert.deepEqual(snapshot(f.incoming), staged);
      assert.equal(fs.existsSync(f.previous), false);
      assert.equal(fs.existsSync(f.failed), false);
      assert.equal(fs.existsSync(`${f.app}.deploy.lock`), false);
    }
  }
  assert.deepEqual(f.events(), []);
});

test('repeating a deployment does not overwrite an existing previous release backup', (f) => {
  success(f.deploy());
  f.seed(f.incoming, 'repeat-build');
  const live = snapshot(f.app);
  const staged = snapshot(f.incoming);
  const eventCount = f.events().length;
  const result = f.deploy();
  assert.deepEqual(snapshot(f.previous), f.original, 'Existing previous release backup must not be changed');
  assert.deepEqual(snapshot(f.app), live);
  assert.deepEqual(snapshot(f.incoming), staged);
  failure(result);
  assert.equal(f.events().slice(eventCount).some((event) => ['npm', 'mv', 'pm2'].includes(event.command)), false);
});

test('deployment refuses an existing failed release without overwriting it', (f) => {
  f.seed(f.failed, 'earlier-failed-build', true);
  const failed = snapshot(f.failed);
  failure(f.deploy());
  assert.deepEqual(snapshot(f.failed), failed);
  assert.deepEqual(snapshot(f.app), f.original);
  assert.equal(fs.existsSync(f.previous), false);
  assert.equal(f.events().some((event) => ['npm', 'mv', 'pm2'].includes(event.command)), false);
});

test('second successful deployment retains original logs and uploads through another rollback', (f) => {
  success(f.deploy());
  const firstLive = snapshot(f.app);
  const secondIncoming = `${f.app}.incoming-release-2`;
  const secondPrevious = `${f.app}.previous-release-2`;
  f.seed(secondIncoming, 'second-build');
  success(f.deploy({ RELEASE_ID: 'release-2', NEXT_PUBLIC_BUILD_ID: 'second-build' }));
  assertInstallIsolated(f, secondIncoming, firstLive);
  assert.deepEqual(snapshot(f.previous), f.original);
  assert.deepEqual(snapshot(secondPrevious), firstLive);
  assertEnvironment(f);
  assertPersistent(f, f.app, true);
  assert.equal(fs.realpathSync(path.join(f.app, 'logs')), path.join(f.root, 'shared', 'logs'));
  fs.appendFileSync(path.join(f.app, 'logs/server.log'), 'second deployment log\n');
  fs.appendFileSync(path.join(f.app, 'uploads/upload.txt'), 'second deployment upload\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'shared', 'logs', 'server.log'), 'utf8'), 'original logs\nsecond deployment log\n');
  success(f.rollback({ RELEASE_ID: 'release-2' }));
  assert.deepEqual(snapshot(f.app), firstLive);
  assertEnvironment(f);
  assert.equal(fs.readFileSync(path.join(f.app, 'logs/server.log'), 'utf8'), 'original logs\nsecond deployment log\n');
  assert.equal(fs.readFileSync(path.join(f.app, 'uploads/upload.txt'), 'utf8'), 'original upload\nsecond deployment upload\n');
});

let failures = 0;
for (const { name, body } of tests) {
  let f;
  try {
    f = fixture();
    body(f);
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n${error.stack}`);
  } finally {
    if (f) f.cleanup();
  }
}
console.log(`${tests.length - failures}/${tests.length} deployment tests passed`);
process.exitCode = failures ? 1 : 0;
