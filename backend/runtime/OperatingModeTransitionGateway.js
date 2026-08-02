'use strict';

const crypto = require('node:crypto');
const { AppRuntimeError } = require('./errors');
const { assertOperatingMode, transitionAllowed } = require('./OperatingMode');

class OperatingModeTransitionGateway {
  constructor(options = {}) {
    this.store = options.store;
    this.ownership = options.ownership;
    this.applyMode = options.applyMode || (async () => {});
    this.publishMode = options.publishMode || (async () => {});
    this.clock = options.clock || (() => new Date().toISOString());
    this.inFlight = new Map();
    if (!this.store || !this.ownership) throw new TypeError('store and ownership are required');
  }

  _guard() { return this.ownership.guard(); }

  async transition(input = {}) {
    const targetMode = assertOperatingMode(input.targetMode, { source: input.source || '' });
    const current = this.store.snapshot();
    const commandId = String(input.commandId || crypto.randomUUID());
    const envelope = input.envelope || {
      contractVersion: 2,
      commandId,
      commandType: 'runtime.setOperatingMode',
      expectedStateVersion: Number(current.stateVersion),
      issuedAtUtc: this.clock(),
      payload: { operatingMode: targetMode, reason: String(input.reason || ''), source: String(input.source || 'internal'), metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {} }
    };
    const digest = this.store.commandEnvelopeHash(envelope);
    const active = this.inFlight.get(commandId);
    if (active) {
      if (active.digest !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });
      return active.promise;
    }
    const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
    const reason = Object.prototype.hasOwnProperty.call(input, 'reason') ? String(input.reason || '') : String(payload.reason || '');
    const source = Object.prototype.hasOwnProperty.call(input, 'source') ? String(input.source || '') : String(payload.source || 'internal');
    const metadata = {
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {})
    };
    const promise = this._transition({ ...input, targetMode, commandId, envelope, reason, source, metadata }).finally(() => this.inFlight.delete(commandId));
    this.inFlight.set(commandId, { digest, promise });
    return promise;
  }

  async _transition({ targetMode, commandId, envelope, reason = '', source = 'internal', metadata = {} }) {
    const persisted = this.store.persistOperatingModeCommand({
      ...this._guard(),
      envelope,
      targetMode,
      reason,
      source,
      metadata
    });
    if (persisted.duplicate && persisted.terminal === true) return persisted.response;

    const shouldApply = !persisted.duplicate || ['PERSISTED', 'APPLY_FAILED'].includes(persisted.status);
    const shouldPublish = !persisted.duplicate || ['PERSISTED', 'APPLY_FAILED', 'APPLIED', 'PUBLISH_FAILED'].includes(persisted.status);

    if (!persisted.duplicate && !transitionAllowed(persisted.previousMode, targetMode)) {
      throw new AppRuntimeError('OPERATING_MODE_TRANSITION_INVALID', `Invalid operating mode transition ${persisted.previousMode} -> ${targetMode}`, { status: 409 });
    }

    if (shouldApply) {
      try {
        await this.applyMode(targetMode, { commandId, reason, source, fromMode: persisted.previousMode, stateVersion: persisted.stateVersion, recovering: persisted.duplicate === true });
        this.store.markOperatingModeApplied({ ...this._guard(), commandId, appliedRevision: persisted.stateVersion, recovered: persisted.duplicate === true });
      } catch (cause) {
        this.store.markOperatingModeCommandFailed({ ...this._guard(), commandId, phase: 'APPLY', cause });
        throw new AppRuntimeError('OPERATING_MODE_APPLY_FAILED', 'Operating mode was persisted but could not be applied', {
          status: 503,
          details: { commandId, targetMode, stateVersion: persisted.stateVersion, causeCode: cause?.reasonCode || cause?.code || '' },
          cause
        });
      }
    }

    if (shouldPublish) {
      try {
        await this.publishMode(targetMode, { commandId, reason, source, fromMode: persisted.previousMode, stateVersion: persisted.stateVersion, recovering: persisted.duplicate === true });
        return this.store.markOperatingModePublished({ ...this._guard(), commandId, publishedAtUtc: this.clock(), recovered: persisted.duplicate === true });
      } catch (cause) {
        this.store.markOperatingModeCommandFailed({ ...this._guard(), commandId, phase: 'PUBLISH', cause });
        throw new AppRuntimeError('OPERATING_MODE_PUBLISH_FAILED', 'Operating mode was persisted and applied but publication is incomplete', {
          status: 503,
          details: { commandId, targetMode, stateVersion: persisted.stateVersion, causeCode: cause?.reasonCode || cause?.code || '' },
          cause
        });
      }
    }

    throw new AppRuntimeError('OPERATING_MODE_COMMAND_STATE_INVALID', 'Operating mode command is in an unsupported recovery state', {
      status: 503,
      details: { commandId, status: persisted.status }
    });
  }

  async reconcile() {
    const authority = this.store.validateRuntimeAuthority();
    const mode = assertOperatingMode(authority.operatingMode, { source: 'reconcile' });
    const pending = this.store.listRecoverableOperatingModeCommands();
    if (pending.length > 1) {
      throw new AppRuntimeError('OPERATING_MODE_MULTIPLE_PENDING_COMMANDS', 'More than one operating mode command requires recovery', {
        status: 503,
        details: { commandIds: pending.map(row => row.commandId) }
      });
    }
    for (const command of pending) {
      if (Number(command.committedRevision) !== Number(authority.operatingModeRevision) || command.targetMode !== mode) {
        this.store.markOperatingModeRecoveryBlocked({ ...this._guard(), commandId: command.commandId, reasonCode: 'OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH' });
        throw new AppRuntimeError('OPERATING_MODE_LEDGER_AUTHORITY_MISMATCH', 'Operating mode command history does not match the current mode authority revision', {
          status: 503,
          details: {
            commandId: command.commandId,
            committedRevision: command.committedRevision,
            operatingModeRevision: authority.operatingModeRevision,
            currentStateVersion: authority.stateVersion,
            targetMode: command.targetMode,
            authorityMode: mode
          }
        });
      }
    }

    await this.applyMode(mode, { commandId: pending[0]?.commandId || '', reason: 'startup-reconcile', source: 'reconcile', stateVersion: authority.operatingModeRevision, currentStateVersion: authority.stateVersion, recovering: true });
    for (const command of pending) {
      this.store.markOperatingModeApplied({ ...this._guard(), commandId: command.commandId, appliedRevision: command.committedRevision, recovered: true });
      await this.publishMode(mode, { commandId: command.commandId, reason: 'startup-reconcile', source: 'reconcile', stateVersion: command.committedRevision, currentStateVersion: authority.stateVersion, recovering: true });
      this.store.markOperatingModePublished({ ...this._guard(), commandId: command.commandId, publishedAtUtc: this.clock(), recovered: true });
    }
    return { operatingMode: mode, stateVersion: authority.stateVersion, operatingModeRevision: authority.operatingModeRevision, recoveredCommands: pending.length };
  }

}

module.exports = { OperatingModeTransitionGateway };
