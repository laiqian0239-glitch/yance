'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(ROOT, 'tools', 'product-experience', 'RUN_PRODUCT_EXPERIENCE_MATERIALIZED_UAT.ps1');
const ADAPTER = path.join(ROOT, 'backend', 'services', 'facebookPersonalMessengerMautrixAdapter.js');

function read(file) {
  assert.equal(fs.existsSync(file), true, `missing required runtime path: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

test('materialized Windows UAT keeps ephemeral Matrix secret files alive for the full packaged Yance session', () => {
  const runner = read(RUNNER);
  const adapter = read(ADAPTER);

  assert.match(adapter, /fs\.readFileSync\(filePath, 'utf8'\)/u, 'production adapter must prove secrets are read from their runtime file path');
  assert.match(adapter, /secretFile\('YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE'\)/u);
  assert.match(adapter, /secretFile\('YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE'\)/u);

  const launchIndex = runner.indexOf('$process = Start-Process -FilePath $yanceExe.FullName');
  const waitIndex = runner.indexOf('Wait-Process -Id $process.Id', launchIndex);
  const cleanupIndex = runner.indexOf('Remove-Item -LiteralPath $secretRoot -Recurse -Force', launchIndex);

  assert.ok(launchIndex >= 0, 'packaged Yance launch must exist');
  assert.ok(waitIndex > launchIndex, 'causal RED: UAT runner must remain attached until packaged Yance exits so runtime secret files stay readable');
  assert.ok(cleanupIndex > waitIndex, 'ephemeral secret files may be removed only after packaged Yance has exited');
});
