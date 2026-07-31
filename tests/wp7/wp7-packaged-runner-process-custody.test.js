'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnProduct } = require('../../tools/wp7/run-packaged-electron-probe-integration');
const { processTreeSpawnOptions, terminateProcessTree } = require('../../tools/wp7/process-tree-custody');

test('trusted packaged runner uses process-group custody on POSIX and taskkill tree custody on Windows', () => {
  assert.deepEqual(processTreeSpawnOptions('linux'), { detached: true });
  assert.deepEqual(processTreeSpawnOptions('win32'), { detached: false });
  const calls = [];
  const child = { pid: 1234, kill(signal) { calls.push(['fallback', signal]); } };
  const posix = terminateProcessTree(child, { platform: 'linux', kill(pid, signal) { calls.push([pid, signal]); } });
  assert.equal(posix.method, 'posix-process-group');
  assert.deepEqual(calls[0], [-1234, 'SIGKILL']);
  const windows = terminateProcessTree(child, { platform: 'win32', spawnSync(file, args) { calls.push([file, args]); return { status: 0 }; } });
  assert.equal(windows.method, 'taskkill-tree');
  assert.deepEqual(calls[1], ['taskkill.exe', ['/PID', '1234', '/T', '/F']]);
});

test('trusted packaged runner timeout kills descendants and settles without inherited-pipe hang', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX process-group regression');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp7-runner-tree-timeout-'));
  const pidPath = path.join(root, 'descendant.pid');
  const parentScript = [
    "const fs=require('node:fs');",
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});",
    `fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid));`,
    "setInterval(()=>{},1000);"
  ].join('');
  const started = Date.now();
  await assert.rejects(
    spawnProduct({
      executable: process.execPath,
      args: ['-e', parentScript],
      cwd: root,
      env: process.env,
      timeoutMs: 250
    }),
    (error) => error?.reasonCode === 'WP7_PACKAGED_ELECTRON_PROBE_EXECUTION_TIMEOUT'
  );
  assert.ok(Date.now() - started < 4000, 'timeout must settle independently of descendant-held pipes');
  const descendantPid = Number(fs.readFileSync(pidPath, 'utf8'));
  let state = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const statPath = `/proc/${descendantPid}/stat`;
    if (!fs.existsSync(statPath)) { state = 'gone'; break; }
    state = String(fs.readFileSync(statPath, 'utf8')).split(' ')[2] || '';
    if (state === 'Z') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(state === 'gone' || state === 'Z', `descendant must be terminated, observed state=${state}`);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
