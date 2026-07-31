'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const files = [
  'YANCE_ARTIFACT_DESCRIPTOR.json',
  'YANCE_TEST_PLAN.json',
  'YANCE_ENVIRONMENT_DESCRIPTOR.json',
  'YANCE_EVIDENCE_MANIFEST.json',
  'YANCE_TOOL_PERMISSION_POLICY.json',
  'YANCE_AGENT_CAPABILITY_MANIFEST.json'
];
function fail(message) { throw Object.assign(new Error(message), { code: 'YANCE_PROTOCOL_V3_INVALID' }); }
function load(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) fail(`Missing protocol file: ${name}`);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { fail(`Invalid JSON ${name}: ${error.message}`); }
  if (Number(value.schemaVersion) !== 3) fail(`${name} schemaVersion must be 3`);
  return value;
}
function validate() {
  const docs = Object.fromEntries(files.map(name => [name, load(name)]));
  const artifact = docs['YANCE_ARTIFACT_DESCRIPTOR.json'];
  if (artifact.candidate !== false || artifact.formalRelease !== false) fail('Omission-review source must not self-declare as candidate or release');
  const plan = docs['YANCE_TEST_PLAN.json'];
  for (const key of ['minimumAgentVersion','requiredCapabilities','requiredTools','requiredPermissions','environmentConstraints','resourceBudget','timeoutsSeconds','evidenceRequirements']) if (plan[key] == null) fail(`Test plan missing ${key}`);
  if (plan.evidenceRequirements.truncatedEvidenceAllowed !== false) fail('Truncated evidence must be rejected');
  const evidence = docs['YANCE_EVIDENCE_MANIFEST.json'];
  if (evidence.acceptancePolicy?.truncated !== false || evidence.acceptancePolicy?.allPagesExported !== true) fail('Evidence manifest must fail closed on pagination');
  const policy = docs['YANCE_TOOL_PERMISSION_POLICY.json'];
  if (!policy.levels?.L3?.explicitAuthorizationRequired || !policy.roleSeparation?.selfApprovalForbidden) fail('L3 authorization and three-role separation are mandatory');
  const agent = docs['YANCE_AGENT_CAPABILITY_MANIFEST.json'];
  if (agent.capabilities?.independentReleaseApproval !== false || agent.constraints?.cannotSelfApprove !== true) fail('Agent cannot independently approve its own changes');
  return { ok: true, schemaVersion: 3, files, artifactId: artifact.artifactId, promotionState: evidence.promotionState };
}
if (require.main === module) process.stdout.write(`${JSON.stringify(validate(), null, 2)}\n`);
module.exports = { validate, files };
