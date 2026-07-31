'use strict';

const path = require('node:path');
const { prepareSourceUat } = require('./source-uat-delivery');

function parseArgs(argv) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--allow-dirty') options.allowDirty = true;
    else if (argument.startsWith('--output=')) options.outputRoot = path.resolve(argument.slice('--output='.length));
    else if (argument.startsWith('--commit=')) options.commit = argument.slice('--commit='.length);
    else if (argument.startsWith('--tree=')) options.tree = argument.slice('--tree='.length);
    else if (argument.startsWith('--branch=')) options.branch = argument.slice('--branch='.length);
    else if (argument.startsWith('--tag=')) options.tag = argument.slice('--tag='.length);
    else throw Object.assign(new Error(`不支持的参数：${argument}`), { reasonCode: 'SOURCE_UAT_ARGUMENT_INVALID' });
  }
  return options;
}

try {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = prepareSourceUat(repoRoot, parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    reasonCode: null,
    outputRoot: result.outputRoot,
    buildId: result.manifest.buildId,
    sourceCommit: result.identity.commit,
    sourceTree: result.identity.tree,
    manifestSha256: result.manifestSha256,
    sourceFileCount: result.records.length,
    platformAuthConfigured: result.platformAuth.configured,
    artifactClass: result.manifest.artifactClass
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_PREPARATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2)}\n`);
  process.exitCode = 1;
}
