#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assetService = require('../../backend/services/localAiRuntimeAssetService');

function usage() {
  return 'Usage: node tools/local-ai/materialize-adaptive-runtimes.js --asset <local-file> --target <local-target> --sha256 <expected> --free-bytes <n> --consent';
}

function parseArgs(argv) {
  const out = { consent: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--consent') out.consent = true;
    else if (token.startsWith('--')) out[token.slice(2)] = argv[++i];
  }
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.asset || !args.target || !args.sha256) throw Object.assign(new Error(usage()), { code: 'LOCAL_RUNTIME_MATERIALIZER_ARGS_REQUIRED' });
  const source = path.resolve(args.asset);
  if (!fs.existsSync(source)) throw Object.assign(new Error(`Local asset not found: ${source}`), { code: 'LOCAL_RUNTIME_ASSET_NOT_FOUND' });
  const stat = fs.statSync(source);
  const result = await assetService.materializeLocalArtifact({
    consent: args.consent === true,
    localAssetPath: source,
    destinationPath: path.resolve(args.target),
    expectedSha256: String(args.sha256),
    requiredBytes: stat.size,
    freeDiskBytes: Number(args['free-bytes'] || 0)
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.code || 'LOCAL_RUNTIME_MATERIALIZE_FAILED'}: ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { main, parseArgs };