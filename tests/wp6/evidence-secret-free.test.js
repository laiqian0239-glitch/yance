'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateEvidenceDirectory } = require('../../tools/wp6/evidence-validator');

test('WP6 evidence schema forbids credential and API session secret material', () => {
  const report = validateEvidenceDirectory(path.join(__dirname, '..', '..', 'evidence', 'wp6'), { allowMissing: true });
  assert.equal(report.secretMaterialPresent, false, JSON.stringify(report.secretFindings, null, 2));
  const evidenceRoot = path.join(__dirname, '..', '..', 'evidence', 'wp6');
  const pending = [evidenceRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const text = fs.readFileSync(absolute, 'utf8');
      assert.doesNotMatch(text, /apiSessionToken|credentialSecret|decryptedCredential|Bearer\s+[A-Za-z0-9]/i, absolute);
    }
  }
});
