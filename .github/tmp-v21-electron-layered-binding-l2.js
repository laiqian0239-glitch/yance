'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const riskPath = 'governance/layered-ci/risk-policy.json';
const testPath = 'tests/layered-ci/governance-policy.test.js';
const bindingPath = 'release/production-dependency-binding.json';
const anchor = 'release/electron-distribution-trust.json';

const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
if (!Array.isArray(risk.l2ExactPaths)) throw new Error('risk.l2ExactPaths missing');
if (risk.l2ExactPaths.includes(bindingPath)) throw new Error('binding already classified');
const anchorIndex = risk.l2ExactPaths.indexOf(anchor);
if (anchorIndex < 0) throw new Error('risk exact-path anchor missing');
risk.l2ExactPaths.splice(anchorIndex + 1, 0, bindingPath);
fs.writeFileSync(riskPath, `${JSON.stringify(risk, null, 2)}\n`);

let testSource = fs.readFileSync(testPath, 'utf8');
const needle = "    'release/electron-distribution-trust.json',\n    'vendor/electron/electron-v39.8.5-win32-x64.zip',";
const replacement = "    'release/electron-distribution-trust.json',\n    'release/production-dependency-binding.json',\n    'vendor/electron/electron-v39.8.5-win32-x64.zip',";
const matches = testSource.split(needle).length - 1;
if (matches !== 2) throw new Error(`expected exactly 2 governance-test anchors, got ${matches}`);
testSource = testSource.split(needle).join(replacement);
fs.writeFileSync(testPath, testSource);

execFileSync(process.execPath, ['--test', testPath], { stdio: 'inherit' });
const changed = execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean).sort();
const expected = [riskPath, testPath].sort();
if (JSON.stringify(changed) !== JSON.stringify(expected)) {
  throw new Error(`unexpected temp mutation set: ${JSON.stringify(changed)}`);
}

console.log(JSON.stringify({ pass: true, changed, bindingPath }, null, 2));
