'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const [orphanInput, legacyInput, orphanOutput, legacyOutput] = process.argv.slice(2).map(value => path.resolve(value));
if (!orphanInput || !legacyInput || !orphanOutput || !legacyOutput) {
  throw new Error('expected orphan input, legacy input, orphan output and legacy output');
}
const orphanFragment = fs.readFileSync(path.resolve(__dirname, 'tombstone-orphan-test-fragment.txt'), 'utf8');
const gateFragment = fs.readFileSync(path.resolve(__dirname, 'tombstone-gate-fragment.txt'), 'utf8');
const orphan = fs.readFileSync(orphanInput, 'utf8');
const legacy = fs.readFileSync(legacyInput, 'utf8');
if (orphan.includes('legacy auth discovery stays diagnostic')) throw new Error('orphan test already patched');
if (legacy.includes('isolated orphan reconciliation suite enforces legacy tombstones')) throw new Error('legacy test already patched');
fs.writeFileSync(orphanOutput, orphan.trimEnd() + orphanFragment, 'utf8');
fs.writeFileSync(legacyOutput, legacy.trimEnd() + gateFragment, 'utf8');
for (const file of [orphanOutput, legacyOutput]) {
  const syntax = childProcess.spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || `syntax failed: ${file}`);
}
