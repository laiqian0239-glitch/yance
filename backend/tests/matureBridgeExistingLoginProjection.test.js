'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'accountManagerCore.js'), 'utf8');

test('existing mautrix logins are materialized only as thin Product projections', () => {
  const start = source.indexOf('async materializeMatureBridgeAccounts');
  const end = source.indexOf('async listObserved', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /driver\.observe\(probe, \{ matrixUserId: subject \}\)/u);
  assert.match(block, /source: 'mature-bridge-projection'/u);
  assert.match(block, /projectionSource: 'mautrix-whoami'/u);
  assert.match(block, /canonicalCandidates/u, 'mature login projection must recognize an already-active canonical Product account by its real login identity');
  assert.match(block, /observedMatureBridgeLoginId/u, 'canonicalization must compare the mature login id against persisted owner identity evidence');
  assert.match(source, /metadata\.liveUser\?\.id/u, 'Telegram canonicalization must preserve the original active account when its persisted live user id matches whoami');
  assert.match(block, /projectionSource: 'mautrix-whoami-adopted'/u, 'the original account must adopt bridge identity instead of being replaced by a synthetic projection');
  assert.match(block, /projectionMergeReason: 'mature-bridge-login-identity-canonicalized'/u, 'duplicate bridge projections must be retired into the original canonical account');
  assert.match(block, /compatiblePending/u, 'mature login projection must still reconcile stale pending Product projections instead of creating a duplicate');
  assert.match(block, /compatiblePending\.length === 1/u, 'legacy pending-only adoption remains fail-closed');
  assert.match(block, /logins\.length === 1/u, 'a pending projection may adopt a mature login identity only when the mature owner reports exactly one login');
  assert.match(block, /accountStore\.commitConnectedIdentityTx/u, 'canonical identity adoption must reuse the repository connected-identity transaction seam');
  assert.match(block, /accountStore\.commitLifecycleTx/u, 'stale duplicate projection retirement must reuse the repository lifecycle transaction seam');
  assert.match(block, /lifecycleState: 'merged'/u);
  assert.doesNotMatch(block, /accountStore\.remove\(/u, 'projection reconciliation must preserve an auditable alias instead of deleting account state');
  assert.doesNotMatch(block, /beginLogin|submitLogin|waitLogin|disconnect\(|\.connect\(/u);
});

test('observed listing materializes mature bridge projections before reading canonical rows', () => {
  const start = source.indexOf('async listObserved');
  const block = source.slice(start, start + 500);
  assert.match(block, /await this\.materializeMatureBridgeAccounts\(matrixUserId\)/u);
  assert.ok(block.indexOf('materializeMatureBridgeAccounts') < block.indexOf('accountStore.read()'));
});
