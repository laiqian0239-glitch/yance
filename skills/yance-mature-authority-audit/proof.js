'use strict';

const path = require('node:path');
const {
  auditManifest,
  createEvidence,
  parseArgs,
  readJsonFile,
  sha256,
  usage,
  writeEvidence,
} = require('./admission.js');

function proofUsage() {
  return `${usage('proof.js').replace(
    '[--repo-root <path>] [--output <path>]',
    '--admission <admission-evidence.json> [--repo-root <path>] [--output <path>]',
  )}\n\nProof requires an unchanged GREEN admission and re-audits the materialized source.`;
}

function main(argv = process.argv.slice(2)) {
  let args;
  let evidence;
  try {
    args = parseArgs(argv, { proof: true });
    if (args.help) {
      process.stdout.write(`${proofUsage()}\n`);
      return 0;
    }
    if (!args.manifest) throw new Error('--manifest is required.');
    if (!args.admission) throw new Error('--admission is required.');

    const manifestPath = path.resolve(args.manifest);
    const admissionPath = path.resolve(args.admission);
    const repoRoot = path.resolve(args.repoRoot || process.cwd());
    const manifestRecord = readJsonFile(manifestPath);
    const admissionRecord = readJsonFile(admissionPath);

    evidence = auditManifest({
      manifest: manifestRecord.value,
      manifestBytes: manifestRecord.bytes,
      manifestPath,
      repoRoot,
      phase: 'proof',
    });
    evidence.admissionEvidencePath = admissionPath;
    evidence.admissionEvidenceSha256 = sha256(admissionRecord.bytes);

    const admission = admissionRecord.value;
    const admissionBound = Boolean(
      admission
        && admission.schemaVersion === 1
        && admission.kind === 'yance-mature-authority-admission'
        && admission.phase === 'admission'
        && admission.status === 'GREEN'
        && admission.auditId === evidence.auditId
        && admission.manifestSha256 === evidence.manifestSha256
        && Array.isArray(admission.violations)
        && admission.violations.length === 0,
    );
    evidence.checks.unshift({
      id: 'green-admission-bound-to-unchanged-manifest',
      status: admissionBound ? 'PASS' : 'FAIL',
      detail: 'Admission must be GREEN and match auditId plus the exact manifest SHA-256.',
    });
    if (!admissionBound) {
      evidence.violations.unshift({
        code: 'ADMISSION_NOT_GREEN_OR_STALE',
        message: 'Proof is not bound to a GREEN admission for the exact unchanged manifest.',
      });
      evidence.status = 'RED';
    }

    writeEvidence(evidence, args.output);
    return evidence.status === 'GREEN' ? 0 : 2;
  } catch (error) {
    evidence = createEvidence('yance-mature-authority-proof', 'proof', args?.manifest);
    evidence.violations.push({ code: 'PROOF_EXECUTION_ERROR', message: error.message });
    writeEvidence(evidence, args?.output);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, proofUsage };
