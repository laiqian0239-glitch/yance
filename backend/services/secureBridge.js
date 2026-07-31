'use strict';

const { EventEmitter } = require('node:events');
const { payloadBytes } = require('../../shared/credentialCustodyProtocol');
const { CredentialCustodyClient } = require('./credentialCustodyClient');

class SecureBridge extends EventEmitter {
  constructor() {
    super();
    this.runtime = new Map();
    this.custodyClient = null;
    this.authorityUpdater = null;
    this.candidates = new Map();
    this.custodyContext = null;
    this.ownerRecovery = null;
    this._onChannelLost = null;
    this._onIndeterminate = null;
  }

  configureCustody(context, options = {}) {
    this.custodyClient?.close?.();
    this.custodyContext = Object.freeze({ ...(context || {}) });
    this._onChannelLost = typeof options.onChannelLost === 'function' ? options.onChannelLost : null;
    this._onIndeterminate = typeof options.onIndeterminateCommit === 'function' ? options.onIndeterminateCommit : null;
    this.custodyClient = new CredentialCustodyClient({ context, generation: context?.credentialGeneration, ...options });
    return this.custodyClient.snapshot();
  }

  // M4: register the backend-side owner recovery coordinator. The relaunched
  // owner's re-attach handshake (loopback control route) drives attachNewOwner.
  setOwnerRecovery(coordinator) {
    if (!coordinator || typeof coordinator.markOwnerExited !== 'function' || typeof coordinator.attachNewOwner !== 'function') {
      throw new TypeError('Owner recovery coordinator must implement markOwnerExited/attachNewOwner');
    }
    this.ownerRecovery = coordinator;
    return () => { if (this.ownerRecovery === coordinator) this.ownerRecovery = null; };
  }

  // M4: rebuild the custody client against the re-attached owner's new pipe and
  // resume normal operation. Called by the /api/desktop/owner-recover route.
  recoverOwner(context = {}) {
    if (!this.ownerRecovery) throw Object.assign(new Error('Owner recovery coordinator is not installed'), { reasonCode: 'OWNER_RECOVERY_NOT_INSTALLED' });
    const result = this.ownerRecovery.attachNewOwner(context);
    const merged = { ...(this.custodyContext || {}), ...context };
    this.custodyClient?.close?.();
    this.custodyClient = new CredentialCustodyClient({
      context: merged,
      generation: Number(context.credentialGeneration || merged.credentialGeneration || 0),
      onChannelLost: this._onChannelLost || undefined,
      onIndeterminateCommit: this._onIndeterminate || undefined
    });
    this.emit('owner-recovered', { state: result.state, ownerContext: result.ownerContext });
    return Object.freeze({ accepted: result.accepted, state: result.state, custody: this.custodyClient.snapshot() });
  }

  bindCredentialAuthority(updater) {
    if (typeof updater === 'function') updater = { prepare: async metadata => metadata, commit: async (_token, metadata) => updater(metadata), rollback: async () => {} };
    if (!updater || typeof updater.prepare !== 'function' || typeof updater.commit !== 'function') throw new TypeError('Credential authority updater must provide prepare and commit');
    this.authorityUpdater = updater;
    return () => { if (this.authorityUpdater === updater) this.authorityUpdater = null; };
  }

  get(ref) { return this.runtime.get(String(ref || '')) || null; }
  has(ref) { return this.runtime.has(String(ref || '')); }
  listRefs() { return [...this.runtime.keys()]; }
  setRuntime(ref, value) { const key = String(ref || '').trim(); if (!key) throw Object.assign(new Error('Credential reference is required'), { reasonCode: 'INVALID_CREDENTIAL_REF' }); this.runtime.set(key, value || {}); this.emit('changed', { ref: key, action: 'startup-set', source: 'credential-snapshot' }); return true; }
  removeRuntime(ref) { const key = String(ref || '').trim(); if (!key) return false; const removed = this.runtime.delete(key); if (removed) this.emit('changed', { ref: key, action: 'startup-delete', source: 'credential-snapshot' }); return removed; }
  _applyRuntimeCandidate(next) { this.runtime = next; return this.runtime; }

  replaceRuntimeSnapshot(entries) {
    const rows = Array.isArray(entries) ? entries : [];
    const next = new Map();
    for (const row of rows) {
      const ref = String(row?.ref || '').trim();
      if (!ref || next.has(ref) || !row?.value || typeof row.value !== 'object' || Array.isArray(row.value)) {
        const error = new Error('Credential runtime snapshot is invalid'); error.reasonCode = 'WP4_CREDENTIAL_HYDRATION_REFERENCE_MISMATCH'; throw error;
      }
      next.set(ref, row.value);
    }
    this._applyRuntimeCandidate(next);
    const refs = [...next.keys()].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
    this.emit('changed', { action: 'snapshot-replaced', source: 'credential-snapshot', referenceCount: refs.length });
    return Object.freeze({ entryCount: refs.length, refs: Object.freeze(refs) });
  }

  _candidate(operation, ref, value) {
    const next = new Map(this.runtime);
    if (operation === 'persist') next.set(ref, value || {}); else next.delete(ref);
    const entries = [...next.entries()].sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b))).map(([entryRef, entryValue]) => ({ ref: entryRef, value: entryValue }));
    return { next, entryCount: entries.length, payloadBytes: payloadBytes({ entries }) };
  }

  async _mutate(operation, ref, value, options = {}) {
    const key = String(ref || '').trim();
    if (!key) throw Object.assign(new Error('Credential reference is required'), { reasonCode: 'INVALID_CREDENTIAL_REF' });
    if (!this.custodyClient || !this.authorityUpdater) throw Object.assign(new Error('Credential vault custody channel is unavailable'), { reasonCode: 'CREDENTIAL_VAULT_UNAVAILABLE' });
    const candidate = this._candidate(operation, key, value);
    const requestId = options.requestId;
    let authorityToken = null;
    const ack = await this.custodyClient.request(operation, key, value, {
      requestId,
      prepareAuthority: async binding => {
        const metadata = { operation, ref: key, vaultEpoch: binding.vaultEpoch, previousGeneration: binding.previousGeneration, generation: binding.generation, entryCount: candidate.entryCount, payloadBytes: candidate.payloadBytes };
        authorityToken = await this.authorityUpdater.prepare(metadata);
        this.candidates.set(binding.requestId, { candidate, metadata, authorityToken });
        return { requestId: binding.requestId, metadata, authorityToken };
      },
      commitAuthority: async (token, binding) => {
        const row = this.candidates.get(token.requestId);
        if (!row) { const error = new Error('Credential runtime candidate is missing'); error.reasonCode = 'CREDENTIAL_STATE_AUTHORITY_SPLIT'; throw error; }
        const committedMetadata = { ...row.metadata, authorityEventId: binding?.authorityEventId || '', authorityHeadDigest: binding?.authorityHeadDigest || '' };
        const runtimeBefore = this.runtime;
        try {
          this._applyRuntimeCandidate(row.candidate.next);
          await this.authorityUpdater.commit(row.authorityToken, committedMetadata);
          this.candidates.delete(token.requestId);
        } catch (cause) {
          this.runtime = runtimeBefore;
          throw cause;
        }
      },
      rollbackAuthority: async token => {
        if (token?.requestId) this.candidates.delete(token.requestId);
        await this.authorityUpdater.rollback?.(token?.authorityToken, token?.metadata);
      }
    });
    this.emit('changed', { ref: key, action: operation, source: 'credential-custody', generation: ack.generation, requestId: ack.requestId });
    return true;
  }

  persist(ref, value, options = {}) { return this._mutate('persist', ref, value || {}, options); }
  remove(ref, options = {}) { return this._mutate('remove', ref, undefined, options); }
  snapshot() { return Object.freeze({ available: this.available, credentialRefs: this.runtime.size, approvedTransport: this.custodyClient ? 'DEDICATED_INHERITED_PIPE_FD6_TRANSACTIONAL_CUSTODY' : 'UNAVAILABLE', custody: this.custodyClient?.snapshot?.() || null, pendingCandidates: this.candidates.size }); }
  close() { this.custodyClient?.close?.(); this.custodyClient = null; this.authorityUpdater = null; this.candidates.clear(); }
  get available() { return Boolean(this.custodyClient && !this.custodyClient.closed); }
}

module.exports = new SecureBridge();
