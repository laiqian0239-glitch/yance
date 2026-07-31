'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./common');
const REQUIRED = ['electron-api-v2-cutover.json','event-gap-recovery.json','backend-crash-recovery.json','old-runtime-removal.json','runtime-entrypoint-inventory.json'];
const RISK_IDS = ['WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION','WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION','WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION','WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED'];
function validateEvidenceDirectory(directory = path.join(ROOT, 'evidence', 'wp6'), options = {}) {
  const findings = [], secretFindings = [], files = [];
  for (const name of REQUIRED) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) { if (!options.allowMissing) findings.push({ file: name, reasonCode: 'EVIDENCE_FILE_MISSING' }); continue; }
    let value, text;
    try { text = fs.readFileSync(file, 'utf8'); value = JSON.parse(text); } catch (error) { findings.push({ file: name, reasonCode: 'EVIDENCE_JSON_INVALID', message: error.message }); continue; }
    files.push(name);
    if (value.schemaVersion !== 1 || value.stage !== '6.4.5.9' || value.workPackage !== 'WP6' || !['PASS','FAIL'].includes(value.status)) findings.push({ file: name, reasonCode: 'EVIDENCE_ENVELOPE_INVALID' });
    if (value.secretMaterialPresent !== false) findings.push({ file: name, reasonCode: 'SECRET_MATERIAL_FLAG_INVALID' });
    const risks = Array.isArray(value.riskAcceptances) ? value.riskAcceptances.map(row => typeof row === 'string' ? row : row.id) : [];
    for (const id of RISK_IDS) if (!risks.includes(id)) findings.push({ file: name, reasonCode: 'RISK_ACCEPTANCE_MISSING', id });
    if (value.upstreamBindings?.WP5?.acceptedHead !== 'c4d5a641e93c600c0199e9960fe8f570faa07808' || value.upstreamBindings?.WP5?.acceptedSourceTree !== 'b6ece87673d804686bd231858097f6561ff1b200') findings.push({ file: name, reasonCode: 'WP5_BINDING_INVALID' });
    if (name === 'backend-crash-recovery.json') {
      const stop = value.stopTransportUnknownRecovery || {};
      if (stop.status !== 'PASS' || stop.sameCommandId !== true || stop.sameEnvelopeDigest !== true ||
          Number(stop.durableIntentCount) !== 1 || Number(stop.stopSideEffectCount) !== 1 ||
          stop.recoveredOriginalTerminalResult !== true || stop.ownerSessionMismatchRejected !== true ||
          stop.conflictingEnvelopeRejected !== true || stop.backendExitDoesNotCreateSecondIntent !== true ||
          stop.confirmedStopReentryDoesNotCreateSecondIntent !== true ||
          stop.newOwnerBaselineBlockedUntilExitRecovery !== true || stop.resolvedStopArchivedBeforeNewOwnerBaseline !== true ||
          stop.restartOwnerRecoveryPrecedesStopResolution !== true || stop.restartStopResolutionPrecedesNewBaseline !== true ||
          stop.restartBlockedUntilStopOrExitRecoveryResolved !== true || stop.permanentPendingStateEliminated !== true) {
        findings.push({ file: name, reasonCode: 'STOP_TRANSPORT_UNKNOWN_RECOVERY_EVIDENCE_INVALID' });
      }
    }
    const secretPatterns = [/apiSessionToken/i,/authorization\s*[:=]/i,/Bearer\s+[A-Za-z0-9._-]+/i,/decryptedCredential/i,/credentialSecret/i,/session[_-]?token\s*[:=]\s*["'][^"']+/i];
    for (const pattern of secretPatterns) if (pattern.test(text)) secretFindings.push({ file: name, pattern: String(pattern) });
  }
  return { schemaVersion: 1, status: findings.length || secretFindings.length ? 'FAIL' : 'PASS', expectedFiles: REQUIRED, filesPresent: files, findingCount: findings.length, findings, secretMaterialPresent: secretFindings.length > 0, secretFindings };
}
if (require.main === module) { const report = validateEvidenceDirectory(process.argv[2]); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : 1; }
module.exports = { REQUIRED, RISK_IDS, validateEvidenceDirectory };
