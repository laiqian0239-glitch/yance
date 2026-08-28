'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createGenesisJournal, digestRaw, headEvent, metadataDigest, referenceCount, sameMetadataAuthority,
  sha256, validateJournal, validateMetadata
} = require('./credentialAuthority');
const { STATES, transitionLifecycle } = require('../../shared/credentialAuthorityLifecycleStateMachine');
const { atomicWriteJsonAsync, existsAsync, readFileTextAsync, unlinkAsync } = require('./asyncDurability');

const LIFECYCLE_SCHEMA_VERSION = 1;
const INTENT_SCHEMA_VERSION = 1;
const COMPLETED_SCHEMA_VERSION = 1;
const LIFECYCLE_UNAVAILABLE = 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_UNAVAILABLE';
const LIFECYCLE_INVALID = 'WP4_CREDENTIAL_AUTHORITY_LIFECYCLE_INVALID';
const MIGRATION_FAILED = 'WP4_CREDENTIAL_AUTHORITY_MIGRATION_FAILED';
const MIGRATION_SOURCE_INVALID = 'WP4_CREDENTIAL_LEGACY_AUTHORITY_INVALID';
const JOURNAL_MISSING = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_MISSING';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function error(reasonCode, message, details = {}) { const result = new Error(message || reasonCode); result.reasonCode = reasonCode; result.code = reasonCode; Object.assign(result, details); return result; }

async function parseJson(file, fsApi, reasonCode, label) {
  try {
    const text = await readFileTextAsync(file, fsApi);
    if (text === null) throw Object.assign(new Error(`${label} is unreadable`), { code: 'ENOENT' });
    return JSON.parse(text);
  } catch (cause) {
    throw error(reasonCode, `${label} is unreadable`, { file, cause });
  }
}

class CredentialAuthorityLifecycleCoordinator {
  constructor(options = {}) {
    if (!options.vault) throw new TypeError('CredentialAuthorityLifecycleCoordinator requires a vault');
    this.vault = options.vault;
    this.fs = options.fs || fs;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.clock = options.clock || (() => new Date().toISOString());
    this.crashInjector = options.crashInjector || (() => {});
    this.replaceVault = options.replaceVault;
    const vaultFile = path.resolve(options.vaultFile || this.vault.file);
    const directory = path.dirname(vaultFile);
    this.metadataPath = path.resolve(options.metadataPath || path.join(directory, 'vault-meta.json'));
    this.transactionPath = path.resolve(options.transactionPath || path.join(directory, 'credential-authority-journal.json'));
    this.intentPath = path.resolve(options.intentPath || path.join(directory, 'credential-authority-lifecycle-intent.json'));
    this.completedPath = path.resolve(options.completedPath || path.join(directory, 'credential-authority-completed.json'));
    this.lifecycle = {
      schemaVersion: LIFECYCLE_SCHEMA_VERSION,
      state: STATES.UNINITIALIZED,
      reasonCode: '',
      operationId: '',
      operationType: '',
      stateHistory: [{ state: STATES.UNINITIALIZED, atUtc: this.clock(), reasonCode: '' }],
      updatedAtUtc: this.clock()
    };
    this.completedMarker = null;
  }

  _transition(state, reasonCode = '') { transitionLifecycle(this.lifecycle, state, this.clock, reasonCode); }
  _crash(point, detail = {}) { this.crashInjector(point, Object.freeze({ lifecycleState: this.lifecycle.state, operationId: this.lifecycle.operationId, operationType: this.lifecycle.operationType, ...detail })); }
  async _exists(file) { return existsAsync(file, this.fs); }
  async _writeIntent(intent) { await atomicWriteJsonAsync(this.intentPath, intent, { fsApi: this.fs }); }
  async _removeIntent() { try { await unlinkAsync(this.intentPath, this.fs); } catch (cause) { throw error(LIFECYCLE_INVALID, 'Credential authority lifecycle intent could not be removed', { cause }); } }
  async _writeCompleted(marker) { await atomicWriteJsonAsync(this.completedPath, marker, { fsApi: this.fs }); }
  _journalDigest(journal) { return sha256(journal); }
  _fullMetadataDigest(metadata) { return sha256(metadata); }

  _newIntent(operationType, raw, sourceSchema) {
    const createdAtUtc = this.clock();
    const isMigration = operationType === 'MIGRATION';
    return {
      schemaVersion: INTENT_SCHEMA_VERSION,
      operationId: this.randomUUID(),
      operationType,
      lifecycleState: isMigration ? STATES.MIGRATION_PREPARING : STATES.BOOTSTRAP_PREPARING,
      migrationId: isMigration ? this.randomUUID() : '',
      sourceSchema,
      sourceVaultDigest: digestRaw(raw),
      targetVaultDigest: digestRaw(raw),
      targetReferenceCount: referenceCount(raw),
      vaultEpoch: this.randomUUID(),
      journalId: this.randomUUID(),
      genesisEventId: this.randomUUID(),
      createdAtUtc,
      updatedAtUtc: createdAtUtc
    };
  }

  _validateIntent(intent) {
    if (!intent || typeof intent !== 'object' || intent.schemaVersion !== INTENT_SCHEMA_VERSION) throw error(LIFECYCLE_INVALID, 'Credential authority lifecycle intent schema is invalid');
    for (const field of ['operationId', 'operationType', 'sourceSchema', 'sourceVaultDigest', 'targetVaultDigest', 'vaultEpoch', 'journalId', 'genesisEventId', 'createdAtUtc']) {
      if (typeof intent[field] !== 'string' || !intent[field]) throw error(LIFECYCLE_INVALID, `Credential authority lifecycle intent ${field} is invalid`);
    }
    if (!['GENESIS', 'MIGRATION', 'WP4_ADOPTION'].includes(intent.operationType)) throw error(LIFECYCLE_INVALID, 'Credential authority lifecycle intent operation is invalid');
    if (intent.operationType === 'MIGRATION' && (typeof intent.migrationId !== 'string' || !intent.migrationId)) throw error(LIFECYCLE_INVALID, 'Credential migration intent has no migrationId');
    if (!Number.isInteger(intent.targetReferenceCount) || intent.targetReferenceCount < 0) throw error(LIFECYCLE_INVALID, 'Credential authority lifecycle reference count is invalid');
    return intent;
  }

  async _readActiveFiles() {
    const journal = await parseJson(this.transactionPath, this.fs, LIFECYCLE_INVALID, 'Credential authority journal');
    const metadata = await parseJson(this.metadataPath, this.fs, LIFECYCLE_INVALID, 'Credential authority metadata');
    validateJournal(journal);
    validateMetadata(metadata);
    return { journal, metadata };
  }

  _makeCompletedMarker(intent, journal, metadata) {
    const head = headEvent(journal);
    return {
      schemaVersion: COMPLETED_SCHEMA_VERSION,
      authorityLifecycleState: STATES.ACTIVE,
      operationId: intent.operationId,
      operationType: intent.operationType,
      migrationId: intent.migrationId || '',
      migrationSourceSchema: intent.sourceSchema,
      sourceVaultDigest: intent.sourceVaultDigest,
      migratedVaultDigest: intent.targetVaultDigest,
      vaultEpoch: head.vaultEpoch,
      generation: head.generation,
      journalId: journal.journalId,
      initialAuthorityEventId: head.eventId,
      initialAuthorityHeadDigest: head.eventDigest,
      journalDigestAtCompletion: this._journalDigest(journal),
      metadataDigestAtCompletion: this._fullMetadataDigest(metadata),
      referenceCount: head.referenceCount,
      completedAtUtc: this.clock()
    };
  }

  _validateCompletedMarker(marker, journal, metadata) {
    if (!marker || typeof marker !== 'object' || marker.schemaVersion !== COMPLETED_SCHEMA_VERSION || marker.authorityLifecycleState !== STATES.ACTIVE) throw error(LIFECYCLE_INVALID, 'Credential authority completed marker is invalid');
    for (const field of ['operationId', 'operationType', 'migrationSourceSchema', 'sourceVaultDigest', 'migratedVaultDigest', 'vaultEpoch', 'journalId', 'initialAuthorityEventId', 'initialAuthorityHeadDigest']) {
      if (typeof marker[field] !== 'string' || !marker[field]) throw error(LIFECYCLE_INVALID, `Credential authority completed marker ${field} is invalid`);
    }
    if (marker.journalId !== journal.journalId) throw error(LIFECYCLE_INVALID, 'Credential authority completed marker journalId mismatch');
    const initial = journal.authorityEvents.find(event => event.eventId === marker.initialAuthorityEventId);
    if (!initial || initial.eventDigest !== marker.initialAuthorityHeadDigest || initial.vaultEpoch !== marker.vaultEpoch) throw error(LIFECYCLE_INVALID, 'Credential authority completed marker is not connected to durable authority history');
    return marker;
  }

  _strictLegacySnapshot() {
    if (this.vault.loadError) throw error(MIGRATION_SOURCE_INVALID, 'WP3 credential vault structure is unreadable', { cause: this.vault.loadError });
    let entries;
    try { entries = this.vault.entriesStrict(); }
    catch (cause) { throw error(cause.reasonCode || cause.code || MIGRATION_FAILED, 'WP3 credential vault cannot be fully decrypted for migration', { cause }); }
    const raw = this.vault.snapshotRaw();
    if (entries.length !== referenceCount(raw)) throw error('WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH', 'WP3 credential vault references cannot be fully decrypted');
    return raw;
  }

  _expectedGenesis(intent, raw) {
    return createGenesisJournal({
      journalId: intent.journalId,
      eventId: intent.genesisEventId,
      vaultEpoch: intent.vaultEpoch,
      raw,
      createdAtUtc: intent.createdAtUtc,
      eventType: intent.operationType === 'MIGRATION' ? 'MIGRATION_GENESIS' : 'GENESIS',
      migration: intent.operationType === 'MIGRATION' ? {
        migrationId: intent.migrationId,
        sourceSchema: intent.sourceSchema,
        sourceVaultDigest: intent.sourceVaultDigest,
        targetVaultDigest: intent.targetVaultDigest
      } : null
    });
  }

  async _resumeGenesisOrMigration(intent) {
    this._validateIntent(intent);
    const migration = intent.operationType === 'MIGRATION';
    const raw = migration ? this._strictLegacySnapshot() : {};
    if (digestRaw(raw) !== intent.sourceVaultDigest || digestRaw(raw) !== intent.targetVaultDigest || referenceCount(raw) !== intent.targetReferenceCount) throw error(MIGRATION_FAILED, 'Credential authority lifecycle source vault changed after intent persistence');
    this.lifecycle.operationId = intent.operationId;
    this.lifecycle.operationType = intent.operationType;
    this._transition(migration ? STATES.MIGRATION_PREPARING : STATES.BOOTSTRAP_PREPARING);
    if (migration) this._crash('MIGRATION_AFTER_LEGACY_READ', { migrationId: intent.migrationId });

    const expected = this._expectedGenesis(intent, raw);
    if (!migration && !(await this._exists(this.vault.file))) {
      if (typeof this.replaceVault !== 'function') throw error(LIFECYCLE_UNAVAILABLE, 'Genesis cannot write the formal credential vault');
      await this.replaceVault(raw);
      this._crash('GENESIS_AFTER_VAULT_ATOMIC_REPLACE');
    } else if (digestRaw(this.vault.snapshotRaw()) !== intent.targetVaultDigest) {
      throw error(MIGRATION_FAILED, 'Credential vault no longer matches lifecycle intent');
    }

    this._transition(migration ? STATES.MIGRATION_COMMITTING : STATES.BOOTSTRAP_COMMITTING);
    intent.lifecycleState = this.lifecycle.state;
    intent.updatedAtUtc = this.clock();
    await this._writeIntent(intent);

    if (await this._exists(this.transactionPath)) {
      const actual = await parseJson(this.transactionPath, this.fs, LIFECYCLE_INVALID, 'Credential authority journal');
      validateJournal(actual);
      if (this._journalDigest(actual) !== this._journalDigest(expected.journal)) throw error(LIFECYCLE_INVALID, 'Existing lifecycle journal does not match the durable intent');
    } else await atomicWriteJsonAsync(this.transactionPath, expected.journal, { fsApi: this.fs });
    this._crash(migration ? 'MIGRATION_AFTER_JOURNAL' : 'GENESIS_AFTER_JOURNAL');

    this._crash(migration ? 'MIGRATION_BEFORE_METADATA' : 'GENESIS_BEFORE_METADATA');
    if (await this._exists(this.metadataPath)) {
      const actual = await parseJson(this.metadataPath, this.fs, LIFECYCLE_INVALID, 'Credential authority metadata');
      validateMetadata(actual);
      if (!sameMetadataAuthority(actual, expected.metadata)) throw error(LIFECYCLE_INVALID, 'Existing lifecycle metadata does not match the durable intent');
    } else await atomicWriteJsonAsync(this.metadataPath, expected.metadata, { fsApi: this.fs });
    this._crash(migration ? 'MIGRATION_AFTER_METADATA' : 'GENESIS_AFTER_METADATA');

    const marker = this._makeCompletedMarker(intent, expected.journal, expected.metadata);
    this._crash(migration ? 'MIGRATION_BEFORE_COMPLETED_MARKER' : 'GENESIS_BEFORE_COMPLETED_MARKER');
    if (await this._exists(this.completedPath)) {
      const actual = await parseJson(this.completedPath, this.fs, LIFECYCLE_INVALID, 'Credential authority completed marker');
      if (actual.operationId !== marker.operationId || actual.initialAuthorityHeadDigest !== marker.initialAuthorityHeadDigest) throw error(LIFECYCLE_INVALID, 'Credential authority completed marker conflicts with lifecycle intent');
    } else await this._writeCompleted(marker);
    this._crash(migration ? 'MIGRATION_AFTER_COMPLETED_MARKER' : 'GENESIS_AFTER_COMPLETED_MARKER');
    await this._removeIntent();
    this.completedMarker = marker;
    this._transition(STATES.ACTIVE);
    return { state: STATES.ACTIVE, operationType: intent.operationType, marker: clone(marker), migratedReferenceCount: intent.targetReferenceCount };
  }

  async _adoptExistingWp4() {
    const { journal, metadata } = await this._readActiveFiles();
    const head = headEvent(journal);
    const raw = this.vault.snapshotRaw();
    if (digestRaw(raw) !== head.vaultDigest || referenceCount(raw) !== head.referenceCount || !sameMetadataAuthority(metadata, { ...head.metadata, authorityHeadDigest: head.eventDigest })) throw error(LIFECYCLE_INVALID, 'Existing WP4 authority is not internally consistent');
    const now = this.clock();
    const intent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      operationId: this.randomUUID(),
      operationType: 'WP4_ADOPTION',
      lifecycleState: STATES.MIGRATION_PREPARING,
      migrationId: this.randomUUID(),
      sourceSchema: 'WP4_AUTHORITY_PRE_LIFECYCLE_MARKER',
      sourceVaultDigest: head.vaultDigest,
      targetVaultDigest: head.vaultDigest,
      targetReferenceCount: head.referenceCount,
      vaultEpoch: head.vaultEpoch,
      journalId: journal.journalId,
      genesisEventId: journal.authorityEvents[0].eventId,
      createdAtUtc: now,
      updatedAtUtc: now
    };
    await this._writeIntent(intent);
    this.lifecycle.operationId = intent.operationId;
    this.lifecycle.operationType = intent.operationType;
    this._transition(STATES.MIGRATION_PREPARING);
    this._transition(STATES.MIGRATION_COMMITTING);
    const marker = this._makeCompletedMarker(intent, journal, metadata);
    await this._writeCompleted(marker);
    await this._removeIntent();
    this.completedMarker = marker;
    this._transition(STATES.ACTIVE);
    return { state: STATES.ACTIVE, operationType: 'WP4_ADOPTION', marker: clone(marker), migratedReferenceCount: head.referenceCount };
  }

  async ensureActive() {
    try {
      this._crash('AUTHORITY_LIFECYCLE_BEFORE_DETECTION');
      const completedExists = await this._exists(this.completedPath);
      const intentExists = await this._exists(this.intentPath);
      const metadataExists = await this._exists(this.metadataPath);
      const journalExists = await this._exists(this.transactionPath);
      const vaultExists = Boolean(this.vault.loadExists || await this._exists(this.vault.file));

      if (completedExists) {
        if (!metadataExists || !journalExists || !vaultExists) throw error(JOURNAL_MISSING, 'Completed credential authority is missing a required durable file');
        const { journal, metadata } = await this._readActiveFiles();
        const marker = await parseJson(this.completedPath, this.fs, LIFECYCLE_INVALID, 'Credential authority completed marker');
        this._validateCompletedMarker(marker, journal, metadata);
        if (intentExists) {
          const intent = this._validateIntent(await parseJson(this.intentPath, this.fs, LIFECYCLE_INVALID, 'Credential authority lifecycle intent'));
          if (intent.operationId !== marker.operationId) throw error(LIFECYCLE_INVALID, 'A foreign lifecycle intent remains beside the completed authority');
          await this._removeIntent();
        }
        this.completedMarker = marker;
        this.lifecycle.operationId = marker.operationId;
        this.lifecycle.operationType = marker.operationType;
        this._transition(STATES.ACTIVE);
        return { state: STATES.ACTIVE, operationType: marker.operationType, marker: clone(marker), migratedReferenceCount: marker.referenceCount };
      }

      if (intentExists) {
        const intent = this._validateIntent(await parseJson(this.intentPath, this.fs, LIFECYCLE_INVALID, 'Credential authority lifecycle intent'));
        if (intent.operationType === 'WP4_ADOPTION') return this._adoptExistingWp4();
        return this._resumeGenesisOrMigration(intent);
      }

      if (metadataExists || journalExists) {
        if (!metadataExists || !journalExists || !vaultExists) throw error(JOURNAL_MISSING, 'Credential authority files are incomplete before lifecycle activation');
        return this._adoptExistingWp4();
      }

      if (vaultExists) {
        this._transition(STATES.LEGACY_AUTHORITY_DETECTED);
        const raw = this._strictLegacySnapshot();
        this._crash('MIGRATION_AFTER_LEGACY_READ');
        const intent = this._newIntent('MIGRATION', raw, 'WP3_CREDENTIAL_VAULT_V1');
        this.lifecycle.operationId = intent.operationId;
        this.lifecycle.operationType = intent.operationType;
        this._transition(STATES.MIGRATION_PREPARING);
        await this._writeIntent(intent);
        this._crash('MIGRATION_AFTER_INTENT', { migrationId: intent.migrationId });
        return this._resumeGenesisOrMigration(intent);
      }

      this._crash('GENESIS_BEFORE_ANY_FILE');
      const intent = this._newIntent('GENESIS', {}, 'NEW_INSTALLATION');
      this.lifecycle.operationId = intent.operationId;
      this.lifecycle.operationType = intent.operationType;
      this._transition(STATES.BOOTSTRAP_PREPARING);
      await this._writeIntent(intent);
      this._crash('GENESIS_AFTER_INTENT');
      return this._resumeGenesisOrMigration(intent);
    } catch (cause) {
      if (this.lifecycle.state !== STATES.UNAVAILABLE) {
        try { this._transition(STATES.UNAVAILABLE, cause.reasonCode || cause.code || LIFECYCLE_UNAVAILABLE); } catch (_) { this.lifecycle.state = STATES.UNAVAILABLE; }
      }
      throw cause;
    }
  }

  beginOwnerExitRecovery(owner) {
    if (this.lifecycle.state !== STATES.ACTIVE) throw error(LIFECYCLE_UNAVAILABLE, 'Credential authority is not ACTIVE for owner-exit recovery');
    this._transition(STATES.OWNER_EXIT_RECOVERY);
    this.lifecycle.ownerContext = clone(owner || {});
  }
  completeOwnerExitRecovery() {
    if (this.lifecycle.state !== STATES.OWNER_EXIT_RECOVERY) throw error(LIFECYCLE_INVALID, 'Credential authority is not in owner-exit recovery');
    delete this.lifecycle.ownerContext;
    this._transition(STATES.ACTIVE);
  }
  markUnavailable(reasonCode) {
    if (this.lifecycle.state !== STATES.UNAVAILABLE) {
      try { this._transition(STATES.UNAVAILABLE, reasonCode || LIFECYCLE_UNAVAILABLE); } catch (_) { this.lifecycle.state = STATES.UNAVAILABLE; }
    }
  }
  snapshot() { return Object.freeze({ ...clone(this.lifecycle), intentPath: this.intentPath, completedPath: this.completedPath, completedMarker: this.completedMarker ? clone(this.completedMarker) : null }); }
}

module.exports = {
  COMPLETED_SCHEMA_VERSION, CredentialAuthorityLifecycleCoordinator, INTENT_SCHEMA_VERSION,
  LIFECYCLE_INVALID, LIFECYCLE_SCHEMA_VERSION, LIFECYCLE_UNAVAILABLE, MIGRATION_FAILED,
  MIGRATION_SOURCE_INVALID
};
