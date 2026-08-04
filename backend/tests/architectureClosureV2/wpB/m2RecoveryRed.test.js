'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const recoveryPath = path.join(repoRoot, 'backend', 'services', 'durableExecutionRecoveryAuthority.js');

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('M2-REC-001 one durable recovery authority defines the exact decision vocabulary', () => {
  assert.equal(fs.existsSync(recoveryPath), true, 'WP_B_M2_RECOVERY_AUTHORITY_REQUIRED');
  const text = fs.readFileSync(recoveryPath, 'utf8');
  for (const decision of [
    'REQUEUE_SAFE',
    'RECONCILE_REQUIRED',
    'CANCEL_CONFIRMATION_REQUIRED',
    'DEADLINE_EXPIRED',
    'NO_ACTION'
  ]) assert.match(text, new RegExp(`['"]${decision}['"]`, 'u'));
  assert.match(text, /recoverNonterminalExecutions/u);
  assert.match(text, /recoverExecution/u);
});

test('M2-REC-002 persisted attempts override RUNNING recovery to reconciliation', () => {
  assert.equal(fs.existsSync(recoveryPath), true, 'WP_B_M2_RECOVERY_AUTHORITY_REQUIRED');
  const text = fs.readFileSync(recoveryPath, 'utf8');
  assert.match(text, /RUNNING/u);
  assert.match(text, /attempt/u);
  assert.match(text, /RECONCILE_REQUIRED/u);
  assert.doesNotMatch(text, /RUNNING[^\n]+REQUEUE_SAFE[^\n]+attempt[^\n]+ignored/iu);
});

test('M2-REC-003 runtime composes recovery after write-host acquisition and Schema 23 opening', () => {
  const composition = source('backend/runtime/AppRuntimeComposition.js');
  const factory = source('backend/runtime/AppRuntimeFactory.js');
  const server = source('backend/server.js');
  for (const text of [composition, factory, server]) assert.match(text, /durableExecutionRecoveryAuthority/u);
  assert.match(server, /AuthorityWriteHost|authorityWriteHost/u);
  assert.match(server, /recoverNonterminalExecutions/u);
});

test('M2-REC-004 legacy recovery services structurally delegate instead of writing business truth', () => {
  for (const relativePath of [
    'backend/services/ownerRecovery.js',
    'backend/services/runtimeRecoveryService.js',
    'backend/services/jobQueue.js',
    'backend/services/backgroundJobAuthority.js',
    'backend/services/asyncOperationLifecycleAuthority.js'
  ]) {
    const text = source(relativePath);
    assert.match(text, /durableExecutionRecoveryAuthority|recoverNonterminalExecutions/u, relativePath);
    assert.doesNotMatch(text, /UPDATE\s+durable_executions/iu, relativePath);
  }
});

test('M2-REC-005 process supervision is separated from business recovery', () => {
  for (const relativePath of [
    'electron/backendStartupSupervisor.js',
    'electron/desktopHost/BackendProcessHost.js',
    'electron/main.js'
  ]) {
    const text = source(relativePath);
    assert.doesNotMatch(text, /UPDATE\s+durable_executions|recordDeliveryReceipt|createDeliveryAttempt/iu, relativePath);
  }
  assert.match(source('backend/server.js'), /recoverNonterminalExecutions/u);
});

test('M2-REC-006 unknown remote outcomes cannot enter automatic retry', () => {
  const lifecycle = source('backend/services/durableExecutionLifecycle.js');
  const recovery = fs.existsSync(recoveryPath) ? fs.readFileSync(recoveryPath, 'utf8') : '';
  assert.match(lifecycle, /UNCERTAIN_REMOTE_OUTCOME/u);
  assert.match(recovery, /UNCERTAIN_REMOTE_OUTCOME/u);
  assert.match(recovery, /RECONCILE_REQUIRED/u);
  assert.doesNotMatch(recovery, /UNCERTAIN_REMOTE_OUTCOME[^\n]+REQUEUE_SAFE/iu);
});

require('./durableExecutionRecoveryAuthority.test');
