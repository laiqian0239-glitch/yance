'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { npmCommandForPlatform, npmInvocationForPlatform, runNpmCommand, spawnFailureDetails } = require('../../tools/wp7/host-command-runner');
const { runNsisCompiler, Wp7Error } = require('../../tools/wp7/lib');

function capture(result = { status: 0, stdout: '', stderr: '' }) {
  const calls = [];
  return { calls, spawn(command, args, options) { calls.push({ command, args, options }); return result; } };
}

function minimalPe(machine = 0x8664) {
  const bytes = Buffer.alloc(0x58, 0);
  bytes.write('MZ', 0, 'ascii');
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.write('PE\0\0', 0x40, 'binary');
  bytes.writeUInt16LE(machine, 0x44);
  return bytes;
}

function nsisFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-builder-command-'));
  const staging = path.join(root, 'staging');
  const payload = path.join(staging, 'application-payload');
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(path.join(payload, 'payload.txt'), 'fixture');
  const script = path.join(root, 'installer.nsi');
  fs.writeFileSync(script, 'File /r "${STAGING_ROOT}\\application-payload\\*.*"\n');
  return { root, staging, script, output: path.join(root, 'Yance-Setup.exe') };
}

test('Windows npm uses npm.cmd through the shell and hides the window', () => {
  const seen = capture();
  runNpmCommand(['ci', '--omit=dev'], { platform: 'win32', cwd: 'C:\\Yance', spawn: seen.spawn });
  assert.equal(seen.calls[0].command, 'npm.cmd');
  assert.equal(seen.calls[0].options.shell, true);
  assert.equal(seen.calls[0].options.windowsHide, true);
});



test('pinned npm invocation uses the reviewed Node executable and npm CLI without a shell', () => {
  const invocation = npmInvocationForPlatform('win32', {
    nodeExecutable: 'D:\\node-v22.16.0-win-x64\\node.exe',
    npmCli: 'D:\\node-v22.16.0-win-x64\\node_modules\\npm\\bin\\npm-cli.js',
    allowMissingPinnedNpm: true
  });
  assert.equal(invocation.command, path.resolve('D:\\node-v22.16.0-win-x64\\node.exe'));
  assert.deepEqual(invocation.prefixArgs, [path.resolve('D:\\node-v22.16.0-win-x64\\node_modules\\npm\\bin\\npm-cli.js')]);
  assert.equal(invocation.shell, false);
  assert.equal(invocation.mode, 'PINNED_NODE_NPM_CLI');
});

test('non-Windows npm remains a direct process invocation', () => {
  const seen = capture();
  runNpmCommand(['ci'], { platform: 'linux', cwd: '/tmp/yance', spawn: seen.spawn });
  assert.equal(seen.calls[0].command, 'npm');
  assert.equal(seen.calls[0].options.shell, false);
});

test('Windows npm rejects arbitrary shell shims and metacharacters', () => {
  assert.throws(() => npmCommandForPlatform('win32', 'custom.cmd'), /npm\.cmd/);
  assert.throws(() => npmCommandForPlatform('win32', 'npm.cmd & calc'), /unsafe/);
});

test('spawn failures retain status, signal and native error diagnostics', () => {
  const error = Object.assign(new Error('invalid argument'), { code: 'EINVAL' });
  assert.deepEqual(spawnFailureDetails({ status: null, signal: null, error, stdout: '', stderr: '' }), {
    status: null,
    signal: null,
    errorCode: 'EINVAL',
    errorMessage: 'invalid argument',
    stdout: '',
    stderr: ''
  });
});

test('Windows final installer rejects command shims instead of weakening compiler custody', () => {
  const fixture = nsisFixtureRoot();
  try {
    assert.throws(() => runNsisCompiler({
      stagingRoot: fixture.staging,
      outputFile: fixture.output,
      productVersion: '29.2.5',
      scriptPath: fixture.script,
      compilerPath: 'makensis.cmd',
      hostPlatform: 'win32'
    }), (error) => error instanceof Wp7Error && error.reasonCode === 'WP7_INSTALLER_COMPILER_SHIM_DENIED');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('Windows final installer rejects a compiler output that is not PE', () => {
  const fixture = nsisFixtureRoot();
  try {
    const seen = capture({ status: 0, stdout: 'ok', stderr: '' });
    seen.spawn = (command, args, options) => {
      seen.calls.push({ command, args, options });
      fs.writeFileSync(fixture.output, 'stub-installer');
      return { status: 0, stdout: 'ok', stderr: '' };
    };
    assert.throws(() => runNsisCompiler({
      stagingRoot: fixture.staging,
      outputFile: fixture.output,
      productVersion: '29.2.5',
      scriptPath: fixture.script,
      compilerPath: 'makensis.exe',
      hostPlatform: 'win32',
      spawn: seen.spawn
    }), (error) => error instanceof Wp7Error && error.reasonCode === 'WP7_INSTALLER_NOT_PE');
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('Windows final installer accepts direct makensis.exe output when it is PE', () => {
  const fixture = nsisFixtureRoot();
  try {
    const calls = [];
    const result = runNsisCompiler({
      stagingRoot: fixture.staging,
      outputFile: fixture.output,
      productVersion: '29.2.5',
      scriptPath: fixture.script,
      compilerPath: 'C:\\Program Files (x86)\\NSIS\\makensis.exe',
      hostPlatform: 'win32',
      spawn(command, args, options) {
        calls.push({ command, args, options });
        fs.writeFileSync(fixture.output, minimalPe());
        return { status: 0, stdout: 'ok', stderr: '' };
      }
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.estimatedSizeBytes, Buffer.byteLength('fixture'));
    assert.equal(result.estimatedSizeKb, 1);
    assert.ok(calls[0].args.includes('/DINSTALL_DIRECTORY_NAME=Yance'));
    assert.ok(calls[0].args.includes('/DUSER_DATA_DIRECTORY_NAME=Yance'));
    assert.ok(calls[0].args.includes('/DESTIMATED_SIZE_KB=1'));
    assert.equal(calls[0].options.shell, undefined);
    assert.equal(calls[0].options.windowsHide, true);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});


test('WP7 verifier routes every npm child command through the Windows-safe runner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'wp7', 'verify.js'), 'utf8');
  assert.match(source, /npmInvocationForPlatform/);
  assert.match(source, /function recordNpmCommand\(/);
  const rawNpmRecordCalls = source.split(/\r?\n/).filter((line) => line.includes('recordCommand(') && /['"]npm['"]/.test(line));
  assert.deepEqual(rawNpmRecordCalls, []);
  const invocations = source.match(/recordNpmCommand\('/g) || [];
  assert.ok(invocations.length >= 7, `expected every npm verification stage to use recordNpmCommand, observed ${invocations.length}`);
});
