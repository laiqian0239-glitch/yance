'use strict';

const fs = require('node:fs');
const {
  verifyGitHubAttestation,
  REASON_CODES
} = require('../../shared/verification/githubAttestationVerifier');

const SHA40 = /^[a-f0-9]{40}$/u;
const FLAGS = Object.freeze(new Set([
  '--requirements',
  '--repository',
  '--base',
  '--head',
  '--bundle',
  '--trusted-root'
]));

function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError('arguments must be an array');
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || typeof value !== 'string' || !value || value.startsWith('--')) {
      throw new Error('invalid arguments');
    }
    if (Object.prototype.hasOwnProperty.call(values, flag)) throw new Error(`duplicate arguments: ${flag}`);
    values[flag] = value;
  }
  for (const required of ['--requirements', '--repository', '--base', '--head']) {
    if (!values[required]) throw new Error('missing required arguments');
  }
  if (!SHA40.test(values['--base']) || !SHA40.test(values['--head'])) throw new Error('base/head arguments must be exact commit SHA-1 values');
  const hasBundle = Boolean(values['--bundle']);
  const hasRoot = Boolean(values['--trusted-root']);
  if (hasBundle !== hasRoot) throw new Error('offline verification requires both --bundle and --trusted-root');
  return Object.freeze({
    requirementsPath: values['--requirements'],
    repository: values['--repository'],
    baseCommit: values['--base'],
    headCommit: values['--head'],
    bundlePath: values['--bundle'] || null,
    trustedRootPath: values['--trusted-root'] || null
  });
}

function loadRequirements(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('requirements file must contain one JSON object');
  return value;
}

function runCli(argv, dependencies = {}) {
  let args;
  let requirementSet;
  try {
    args = parseArgs(argv);
    requirementSet = (dependencies.loadRequirements || loadRequirements)(args.requirementsPath);
  } catch (error) {
    return Object.freeze({
      pass: false,
      reasonCode: REASON_CODES.EVIDENCE_SCHEMA_INVALID,
      message: String(error?.message || error)
    });
  }
  const verifier = dependencies.verifyGitHubAttestation || verifyGitHubAttestation;
  return verifier({
    requirementSet,
    expected: {
      repository: args.repository,
      baseCommit: args.baseCommit,
      headCommit: args.headCommit
    },
    bundlePath: args.bundlePath,
    trustedRootPath: args.trustedRootPath,
    ghRunner: dependencies.ghRunner
  });
}

if (require.main === module) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.pass ? 0 : 1;
}

module.exports = { parseArgs, loadRequirements, runCli };
