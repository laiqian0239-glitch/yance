'use strict';

const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalEvidenceProcessIdentity(pid, discriminator = 'default') {
  const value = Number(pid);
  if (!Number.isInteger(value) || value < 1) {
    const error = new Error('Evidence process identity requires a positive integer PID');
    error.reasonCode = 'WP4_EVIDENCE_PROCESS_IDENTITY_PID_INVALID';
    throw error;
  }
  const label = String(discriminator || 'default');
  return Object.freeze({
    platform: 'test',
    startTicks: `${value}:${sha256(`wp4-evidence-start:${label}:${value}`).slice(0, 24)}`,
    commandDigest: sha256(`wp4-evidence-command:${label}:${value}`)
  });
}

module.exports = { canonicalEvidenceProcessIdentity };
