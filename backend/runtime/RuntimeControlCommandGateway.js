'use strict';

const { AppRuntimeError } = require('./errors');

class RuntimeControlCommandGateway {
  constructor(options = {}) {
    this.store = options.store;
    this.ownership = options.ownership;
    this.apply = options.apply;
    this.inFlight = new Map();
    if (!this.store || !this.ownership || typeof this.apply !== 'function') throw new TypeError('RuntimeControlCommandGateway requires store, ownership, and apply');
  }

  _guard() { return this.ownership.guard(); }

  execute(envelope) {
    const digest = this.store.commandEnvelopeHash(envelope);
    const active = this.inFlight.get(envelope.commandId);
    if (active) {
      if (active.digest !== digest) throw new AppRuntimeError('COMMAND_ID_REUSE_MISMATCH', 'commandId was reused with a different envelope', { status: 409 });
      return active.promise;
    }
    const promise = this._execute(envelope).finally(() => this.inFlight.delete(envelope.commandId));
    this.inFlight.set(envelope.commandId, { digest, promise });
    return promise;
  }

  async _execute(envelope) {
    const persisted = this.store.persistRuntimeControlCommand({ ...this._guard(), envelope });
    if (persisted.terminal) return persisted.response;
    try {
      const outcome = await this.apply(envelope.commandType, envelope.payload || {}, {
        commandId: envelope.commandId,
        recovering: persisted.duplicate === true,
        committedRevision: persisted.committedRevision
      });
      return this.store.completeRuntimeControlCommand({
        ...this._guard(),
        commandId: envelope.commandId,
        patch: outcome?.patch || {},
        eventType: outcome?.eventType,
        eventPayload: outcome?.eventPayload || {},
        result: outcome?.result || {},
        recovered: persisted.duplicate === true
      });
    } catch (cause) {
      this.store.markRuntimeControlCommandFailed({ ...this._guard(), commandId: envelope.commandId, cause });
      throw new AppRuntimeError('RUNTIME_CONTROL_APPLY_FAILED', 'Runtime control command was persisted but could not be applied', {
        status: 503,
        details: { commandId: envelope.commandId, commandType: envelope.commandType, causeCode: cause?.reasonCode || cause?.code || '' },
        cause
      });
    }
  }

  async reconcile() {
    const pending = this.store.listRecoverableRuntimeControlCommands();
    if (pending.length > 1) {
      throw new AppRuntimeError('RUNTIME_CONTROL_MULTIPLE_PENDING_COMMANDS', 'More than one runtime control command requires recovery', {
        status: 503,
        details: { commandIds: pending.map(row => row.commandId) }
      });
    }
    if (!pending.length) return { recoveredCommands: 0 };
    await this.execute(pending[0].envelope);
    return { recoveredCommands: 1, commandId: pending[0].commandId, commandType: pending[0].commandType };
  }
}

module.exports = { RuntimeControlCommandGateway };
