'use strict';

const { verifySignedExecutorReceipt } = require('./signedExecutorVerifier');
const { verifyGitHubActionsReceipt } = require('./githubActionsVerifier');
const { REASON_CODES } = require('./reasonCodes');

const ADAPTERS = new Set(['github-actions-v1', 'signed-executor-v1']);
function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }

async function verifyEvidenceReceipt({ receipt, expected = {}, registries = {}, adapters = {} }) {
  if (!receipt || !ADAPTERS.has(receipt.adapterType)) return fail(REASON_CODES.EVIDENCE_ADAPTER_UNTRUSTED);
  if (receipt.adapterType === 'signed-executor-v1') {
    const verifier = adapters.signedExecutorVerifier || verifySignedExecutorReceipt;
    return verifier({
      receipt,
      expected,
      executorRegistry: registries.executorRegistry,
      commandSetRegistry: registries.commandSetRegistry,
      artifactResolver: adapters.artifactResolver || null
    });
  }
  const verifier = adapters.githubActionsVerifier || verifyGitHubActionsReceipt;
  return verifier({
    receipt,
    expected,
    commandSetRegistry: registries.commandSetRegistry,
    client: adapters.githubActionsClient || null
  });
}

module.exports = { verifyEvidenceReceipt };
