'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CredentialVault } = require('../../electron/credentialVault');
const { CredentialVaultHost, JOURNAL_INVALID, JOURNAL_MISSING, RECOVERY_AMBIGUOUS } = require('../../electron/desktopHost/CredentialVaultHost');
const { refreshJournalIntegrity } = require('../../electron/desktopHost/credentialAuthority');
const { makeCustodyRequest } = require('../../shared/credentialCustodyProtocol');
function storage(){const key=crypto.createHash('sha256').update('ambiguous').digest();return{isEncryptionAvailable:()=>true,encryptString(v){const iv=Buffer.alloc(12,4),c=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(String(v),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},decryptString(v){const x=Buffer.from(v),d=crypto.createDecipheriv('aes-256-gcm',key,x.subarray(0,12));d.setAuthTag(x.subarray(12,28));return Buffer.concat([d.update(x.subarray(28)),d.final()]).toString('utf8');}};}
function write(file,value){fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`);}

test('unrecognized vault/metadata/journal combination fails closed before hydration', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wp4-ambiguous-'));
  try {
    const vaultFile=path.join(root,'vault.json'),meta=path.join(root,'meta.json'),journal=path.join(root,'journal.json');
    const vault=new CredentialVault(vaultFile,{safeStorage:storage()});
    const host=new CredentialVaultHost({vault,metadataPath:meta,transactionPath:journal,randomUUID:()=> 'ambiguous-epoch'});
    host.createHydrationFrame({startupNonce:'n',oneTimeToken:'x'.repeat(43),backendPid:process.pid,manifestSha256:'a'.repeat(64)});
    const request=makeCustodyRequest({action:'PREPARE',requestId:'ambiguous-request',operation:'persist',ref:'a',value:{x:1},backendPid:process.pid,manifestSha256:'a'.repeat(64),vaultEpoch:'ambiguous-epoch',generation:1});
    await host.prepareCustodyTransaction(request);
    const journalData=JSON.parse(fs.readFileSync(journal,'utf8'));
    const tx=journalData.transactions['ambiguous-request'];
    tx.state='COMMITTING'; tx.stateHistory.push({state:'COMMITTING',atUtc:new Date().toISOString(),reasonCode:''});
    refreshJournalIntegrity(journalData); write(journal,journalData);
    const unrelatedRaw=vault.prepareMutation('persist','unrelated',{x:2}).after;
    write(vaultFile,unrelatedRaw);
    const reloaded=new CredentialVault(vaultFile,{safeStorage:storage()});
    assert.throws(()=>new CredentialVaultHost({vault:reloaded,metadataPath:meta,transactionPath:journal,randomUUID:()=> 'ambiguous-epoch'}),error=>error.reasonCode===RECOVERY_AMBIGUOUS);
  } finally { fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50}); }
});

test('existing WP3 vault without metadata and journal is migrated once before ACTIVE authority construction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-wp3-migration-'));
  try {
    const vaultFile = path.join(root, 'credentials.safe.json');
    const meta = path.join(root, 'vault-meta.json');
    const journal = path.join(root, 'credential-authority-journal.json');
    const vault = new CredentialVault(vaultFile, { safeStorage: storage() });
    write(vaultFile, vault.prepareMutation('persist','existing/ref',{x:1}).after);
    const reloaded = new CredentialVault(vaultFile, { safeStorage: storage() });
    const host = new CredentialVaultHost({ vault: reloaded, metadataPath: meta, transactionPath: journal });
    const before = host.snapshotMetadata();
    assert.deepEqual(reloaded.getRequired('existing/ref'), { x: 1 });
    assert.equal(before.lifecycle.operationType, 'MIGRATION');
    assert.equal(before.lifecycle.state, 'ACTIVE');
    assert.equal(before.referenceCount, 1);
    assert.equal(before.generation, 0);
    assert.equal(fs.existsSync(before.lifecycleCompletedPath), true);
    assert.equal(fs.existsSync(journal), true);
    assert.equal(fs.existsSync(meta), true);
    const epoch = before.vaultEpoch;
    const second = new CredentialVaultHost({ vault: new CredentialVault(vaultFile, { safeStorage: storage() }), metadataPath: meta, transactionPath: journal });
    assert.equal(second.snapshotMetadata().vaultEpoch, epoch);
    assert.deepEqual(second.vault.getRequired('existing/ref'), { x: 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('journal transaction digest tampering fails closed before transaction recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp4-digest-tamper-'));
  try {
    const vaultFile = path.join(root, 'vault.json'); const meta = path.join(root, 'meta.json'); const journal = path.join(root, 'journal.json');
    const vault = new CredentialVault(vaultFile, { safeStorage: storage() });
    const host = new CredentialVaultHost({ vault, metadataPath: meta, transactionPath: journal, randomUUID: () => 'digest-epoch' });
    host.createHydrationFrame({ startupNonce: 'n', oneTimeToken: 'x'.repeat(43), backendPid: process.pid, manifestSha256: 'a'.repeat(64) });
    const request = makeCustodyRequest({ action: 'PREPARE', requestId: 'digest-request', operation: 'persist', ref: 'digest/ref', value: { x: 1 }, backendPid: process.pid, manifestSha256: 'a'.repeat(64), vaultEpoch: 'digest-epoch', generation: 1 });
    await host.prepareCustodyTransaction(request);
    const journalData = JSON.parse(fs.readFileSync(journal, 'utf8'));
    journalData.transactions['digest-request'].beforeDigest = '0'.repeat(64);
    refreshJournalIntegrity(journalData); write(journal,journalData);
    const reloaded = new CredentialVault(vaultFile, { safeStorage: storage() });
    assert.throws(() => new CredentialVaultHost({ vault: reloaded, metadataPath: meta, transactionPath: journal, randomUUID: () => 'digest-epoch' }), error => error.reasonCode === JOURNAL_INVALID);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
