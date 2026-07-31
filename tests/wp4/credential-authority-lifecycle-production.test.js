'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { lifecycleSafeStorage, paths, seedLegacyVault } = require('../../tools/wp4/credential-authority-lifecycle-fixture');

test('WP3 multi-reference authority migrates atomically once and keeps a single durable genesis boundary', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-migration-once-'));
  try {
    const p = paths(root);
    seedLegacyVault(root, [['one/ref',{token:'redacted-one'}],['two/ref',{token:'redacted-two'}],['three/ref',{token:'redacted-three'}]]);
    const host = new CredentialVaultHost({ vault: new CredentialVault(p.vaultFile,{safeStorage:lifecycleSafeStorage()}), metadataPath:p.metadataPath, transactionPath:p.transactionPath, lifecycleIntentPath:p.intentPath, lifecycleCompletedPath:p.completedPath });
    const first = host.snapshotMetadata();
    const journal = JSON.parse(fs.readFileSync(p.transactionPath,'utf8'));
    assert.equal(first.lifecycle.operationType,'MIGRATION');
    assert.equal(first.lifecycle.state,'ACTIVE');
    assert.equal(first.referenceCount,3);
    assert.deepEqual(host.refs().slice().sort(),['one/ref','three/ref','two/ref']);
    assert.equal(journal.authorityEvents.filter(row=>row.eventType==='MIGRATION_GENESIS').length,1);
    assert.equal(fs.existsSync(p.intentPath),false);
    const reloaded = new CredentialVaultHost({ vault: new CredentialVault(p.vaultFile,{safeStorage:lifecycleSafeStorage()}), metadataPath:p.metadataPath, transactionPath:p.transactionPath, lifecycleIntentPath:p.intentPath, lifecycleCompletedPath:p.completedPath });
    assert.equal(reloaded.snapshotMetadata().vaultEpoch,first.vaultEpoch);
    assert.equal(JSON.parse(fs.readFileSync(p.transactionPath,'utf8')).authorityEvents.filter(row=>row.eventType==='MIGRATION_GENESIS').length,1);
  } finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50}); }
});
