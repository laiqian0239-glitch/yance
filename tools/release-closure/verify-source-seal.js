#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifySourceSeal, verifyStandardChecksums } = require('./source-seal-lib');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--seal-dir') args.sealDir = argv[++index];
    else if (argv[index] === '--help' || argv[index] === '-h') args.help = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.sealDir) {
    process.stdout.write('Usage: node tools/release-closure/verify-source-seal.js --seal-dir <directory>\n');
    if (!args.help) process.exitCode = 2;
    return;
  }
  const sealDir = path.resolve(args.sealDir);
  const identity = JSON.parse(fs.readFileSync(path.join(sealDir, 'SOURCE_SEAL_IDENTITY.json'), 'utf8'));
  const checksum = verifyStandardChecksums(sealDir, path.join(sealDir, identity.checksumFile || 'SHA256SUMS.txt'));
  const verification = verifySourceSeal(sealDir);
  const result = Object.freeze({
    pass: checksum.pass && verification.pass,
    checksum,
    verification
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (error.reasonCode) process.stderr.write(`${JSON.stringify({ reasonCode: error.reasonCode, details: error.details || {} })}\n`);
  process.exitCode = 1;
}
