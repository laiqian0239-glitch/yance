#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTrustedProductProbeBlocker } = require('./trusted-product-probe-scope');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
function args(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]);
  return values;
}
function git(argsList) { return execFileSync('git', argsList, { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' }).trim(); }
function canonical(value) {
  const sort = (input) => Array.isArray(input) ? input.map(sort) : (!input || typeof input !== 'object' ? input : Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])])));
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

try {
  const output = path.resolve(arg('--output'));
  if (!arg('--output')) throw new Error('--output is required');
  const reasons = args('--reason');
  const document = createTrustedProductProbeBlocker({
    sourceCommit: arg('--source-commit', git(['rev-parse', 'HEAD'])),
    sourceTree: arg('--source-tree', git(['rev-parse', 'HEAD^{tree}'])),
    generatedAtUtc: arg('--generated-at-utc', new Date().toISOString()),
    blockingReasonCodes: reasons.length ? reasons : [
      'WP7_OFFICIAL_ELECTRON_ARCHIVE_UNAVAILABLE',
      'WP7_PACKAGED_PRODUCT_EXECUTABLE_UNAVAILABLE',
      'WP7_PACKAGED_PAYLOAD_ROOT_UNAVAILABLE',
      'WP7_PACKAGED_RESOURCES_ROOT_UNAVAILABLE'
    ],
    electronArchiveAvailable: arg('--electron-archive-available') === 'true',
    packagedProductExecutableAvailable: arg('--product-executable-available') === 'true',
    packagedPayloadRootAvailable: arg('--payload-root-available') === 'true',
    packagedResourcesRootAvailable: arg('--resources-root-available') === 'true',
    requiredElectronArchive: {
      fileName: arg('--electron-archive-file', 'electron-v43.4.1-linux-x64.zip'),
      sha256: arg('--electron-archive-sha256', 'dd5f4b21682e9d031defff525809dc58028521925f42ec9caa5ca6535d1524e7'),
      executableEntry: arg('--electron-executable-entry', 'electron')
    }
  });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, canonical(document));
  process.stdout.write(`${JSON.stringify({ status: 'PASS', output, formalProbeIds: document.formalProbeIds }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_TRUSTED_PRODUCT_PROBE_BLOCKER_GENERATION_FAILED', message: error.message, details: error.details || null }, null, 2)}\n`);
  process.exit(1);
}
