'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const riskPath = path.join(ROOT, 'governance/layered-ci/risk-policy.json');
const testPath = path.join(ROOT, 'tests/layered-ci/governance-policy.test.js');
const target = 'release/architecture-closure-v2/wp-b-governance-package.json';

const risk = JSON.parse(fs.readFileSync(riskPath, 'utf8'));
if (!Array.isArray(risk.l2ExactPaths)) throw new Error('missing l2ExactPaths');
if (risk.l2ExactPaths.includes(target)) throw new Error('target already classified');
const releaseProductionIndex = risk.l2ExactPaths.indexOf('release/production-dependency-binding.json');
if (releaseProductionIndex < 0) throw new Error('missing production binding anchor');
risk.l2ExactPaths.splice(releaseProductionIndex, 0, target);
if (risk.l2Prefixes.includes('release/')) throw new Error('broad release/ prefix is forbidden');
fs.writeFileSync(riskPath, `${JSON.stringify(risk, null, 2)}\n`);

let testSource = fs.readFileSync(testPath, 'utf8');
const anchor = "    'release/electron-distribution-trust.json',\n    'release/production-dependency-binding.json',";
const matches = testSource.split(anchor).length - 1;
if (matches !== 2) throw new Error(`expected exactly two permanent-contract anchors, got ${matches}`);
const replacement = "    'release/electron-distribution-trust.json',\n    'release/architecture-closure-v2/wp-b-governance-package.json',\n    'release/production-dependency-binding.json',";
testSource = testSource.split(anchor).join(replacement);
fs.writeFileSync(testPath, testSource);

console.log('GREEN: exact Layered L2 classification patch materialized');
