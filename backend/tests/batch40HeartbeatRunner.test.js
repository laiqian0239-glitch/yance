'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');


test('command runner streams output, writes UTF-8 evidence, and emits terminal-only heartbeats', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-heartbeat-runner-'));
  const child = path.join(root, 'child.js');
  const log = path.join(root, 'evidence', 'child.log');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(child, [
    "process.stdout.write('current-test: alpha\\n');",
    "setTimeout(() => process.stdout.write('done\\n'), 140);"
  ].join('\n'));

  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', '..', 'scripts', 'run-command-with-heartbeat.js'),
    '--name', 'BATCH40_BACKEND_FULL',
    '--log', log,
    '--cwd', root,
    '--file', process.execPath,
    '--heartbeat-ms', '40',
    '--', child
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /current-test: alpha/u);
  assert.match(result.stdout, /done/u);
  assert.match(result.stderr, /HEARTBEAT.*BATCH40_BACKEND_FULL/u);
  assert.match(result.stderr, /current-test: alpha/u);
  const bytes = fs.readFileSync(log);
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), false);
  assert.equal(bytes.toString('utf8'), 'current-test: alpha\ndone\n');
  assert.doesNotMatch(bytes.toString('utf8'), /HEARTBEAT/u);
});
