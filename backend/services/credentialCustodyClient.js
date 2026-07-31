'use strict';

const net = require('node:net');
const crypto = require('node:crypto');
const {
  CREDENTIAL_CUSTODY_ACK_TIMEOUT_MS,
  MAX_CREDENTIAL_CUSTODY_FRAME_BYTES,
  encodeCustodyFrame,
  makeCustodyRequest,
  mutationSha256,
  validateCustodyAck
} = require('../../shared/credentialCustodyProtocol');
const { CREDENTIAL_CUSTODY_PIPE_FD, deriveCustodyPipeName } = require('../../electron/desktopHost/startupProtocol');

const PREPARE_INDETERMINATE = 'WP4_CREDENTIAL_PREPARE_RESULT_INDETERMINATE';
const COMMIT_INDETERMINATE = 'CREDENTIAL_COMMIT_RESULT_INDETERMINATE';

function custodyError(reasonCode, message, details = {}) {
  const error = new Error(message || reasonCode);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  Object.assign(error, details);
  return error;
}

class CredentialCustodyClient {
  constructor(options = {}) {
    this.context = Object.freeze({ ...(options.context || {}) });
    this.generation = Number(options.generation || this.context.credentialGeneration || 0);
    this.timeoutMs = Math.max(25, Number(options.timeoutMs || CREDENTIAL_CUSTODY_ACK_TIMEOUT_MS));
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    // Prefer an explicit net pipe (name derived from fd6PipeInstanceId, shared
    // with the parent) over the inherited stdio fd. On Windows the child->parent
    // stdio fd (CREDENTIAL_CUSTODY_PIPE_FD) never delivers data to the parent
    // under child_process fork/spawn, so it cannot be used for custody.
    const pipeName = options.pipeName || deriveCustodyPipeName(this.context.fd6PipeInstanceId);
    this._custodyPipeName = pipeName;
    this._connected = false;
    this._retryCount = 0;
    this.stream = options.stream || (pipeName ? net.connect(pipeName) : new net.Socket({ fd: Number.isInteger(options.fd) ? options.fd : CREDENTIAL_CUSTODY_PIPE_FD, readable: true, writable: true }));
    this.onIndeterminateCommit = options.onIndeterminateCommit || (() => {});
    // M4: general custody-channel-loss signal (owner restart / pipe end / error)
    // fired once when _failAll runs, independent of any in-flight transaction.
    this.onChannelLost = options.onChannelLost || null;
    this._channelLostEmitted = false;
    this.buffer = '';
    this.bytes = 0;
    this.closed = false;
    this.terminal = false;
    this.pending = new Map();
    this.operation = Promise.resolve();
    this.finalResults = new Map();
    this.requestStates = new Map();
    this.metrics = {
      requestCount: 0,
      acknowledgedCount: 0,
      timeoutCount: 0,
      failedCount: 0,
      queryRecoveryCount: 0,
      prepareRecoveryCount: 0,
      durableReplayCount: 0,
      duplicateResultCount: 0,
      indeterminateCommitCount: 0,
      indeterminatePrepareCount: 0,
      lastReasonCode: ''
    };
    this._onData = chunk => this._consume(chunk);
    this._onError = error => { this._failAll(error?.code || 'CREDENTIAL_VAULT_UNAVAILABLE'); };
    this._onEnd = () => { this._failAll('CREDENTIAL_VAULT_UNAVAILABLE'); };
    this.stream.on('data', this._onData);
    this.stream.on('end', this._onEnd);
    if (pipeName && !options.stream) {
      // Explicit net pipe: retry the connection until the parent's server is
      // accepting, then treat later errors as fatal custody-channel failures.
      this.stream.on('connect', () => { this._connected = true; });
      this.stream.on('error', err => { if (!this._connected) { this._retryConnect(pipeName); return; } this._onError(err); });
    } else {
      this.stream.on('error', this._onError);
    }
    // Keep the custody pipe referenced for the lifetime of the client. On
    // Windows, unref() can let shutdown/recovery races advance while a write is
    // still queued, which presents as a post-owner-exit credential request
    // timeout/reset/refused chain. The backend process lifetime is controlled
    // by the HTTP server and DesktopHost, not by making this socket invisible.
    this.stream.ref?.();
  }

  _retryConnect(pipeName) {
    if (this.closed || this._connected) return;
    if (this._retryCount >= 80) {
      this._onError(Object.assign(new Error('credential custody pipe never connected'), { reasonCode: 'CREDENTIAL_VAULT_UNAVAILABLE' }));
      return;
    }
    this._retryCount += 1;
    setTimeout(() => {
      if (this.closed || this._connected) return;
      const prev = this.stream;
      const next = net.connect(pipeName);
      next.on('data', this._onData);
      next.on('end', this._onEnd);
      next.once('connect', () => { this._connected = true; this.stream = next; });
      next.on('error', err => { if (!this._connected) this._retryConnect(pipeName); else this._onError(err); });
      try { prev.destroy(); } catch (_) {}
    }, 50);
  }

  _record(requestId, fields = {}) {
    const id = String(requestId || '');
    const current = this.requestStates.get(id) || { requestId: id, state: 'NEW', indeterminateHandled: false };
    Object.assign(current, fields);
    this.requestStates.set(id, current);
    return current;
  }

  _indeterminate(record, reasonCode, state = 'COMMIT_RESULT_UNKNOWN') {
    if (!record || record.indeterminateHandled) return record?.indeterminatePromise || Promise.resolve();
    record.state = state;
    record.indeterminateHandled = true;
    record.reasonCode = reasonCode || (state === 'PREPARE_RESULT_UNKNOWN' ? PREPARE_INDETERMINATE : COMMIT_INDETERMINATE);
    this.terminal = true;
    this.closed = true;
    if (state === 'PREPARE_RESULT_UNKNOWN') this.metrics.indeterminatePrepareCount += 1;
    else this.metrics.indeterminateCommitCount += 1;
    this.metrics.lastReasonCode = record.reasonCode;
    let result;
    try {
      result = this.onIndeterminateCommit({
        requestId: record.requestId,
        operation: record.operation,
        ref: record.ref,
        state: record.state,
        reasonCode: record.reasonCode
      });
    } catch (error) {
      result = Promise.reject(error);
    }
    record.indeterminatePromise = Promise.resolve(result).catch(() => {});
    try { this.stream.destroy?.(); } catch (_) {}
    return record.indeterminatePromise;
  }

  _consume(chunk) {
    if (this.closed && !this.pending.size) return;
    this.bytes += Buffer.byteLength(chunk);
    if (this.bytes > MAX_CREDENTIAL_CUSTODY_FRAME_BYTES) return this._failAll('CREDENTIAL_MESSAGE_TOO_LARGE');
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.bytes = Buffer.byteLength(this.buffer);
      if (!line.trim()) continue;
      let frame;
      try { frame = JSON.parse(line); }
      catch (_) { this._failAll('CREDENTIAL_CUSTODY_PROTOCOL_INTERRUPTED'); return; }
      const pending = this.pending.get(`${frame.requestId}:${frame.action}`);
      if (!pending) continue;
      this.pending.delete(`${frame.requestId}:${frame.action}`);
      clearTimeout(pending.timer);
      try {
        const ack = validateCustodyAck(frame, pending.request);
        const state = ack.payload?.transactionState;
        if (pending.record) {
          if (frame.action === 'PREPARE') pending.record.state = state === 'COMMITTED' ? 'COMMIT_ACKNOWLEDGED' : state;
          else if (frame.action === 'COMMIT') pending.record.state = state === 'COMMITTED' ? 'COMMIT_ACKNOWLEDGED' : state;
          else if (frame.action === 'ABORT') pending.record.state = state;
          else if (frame.action === 'QUERY' && state !== 'UNKNOWN') pending.record.state = state === 'COMMITTED' ? 'COMMIT_ACKNOWLEDGED' : state;
        }
        if (ack.success !== true) {
          throw custodyError(ack.reasonCode || 'CREDENTIAL_VAULT_PERSIST_FAILED', 'Credential vault rejected custody request', {
            transactionState: state,
            payload: ack.payload,
            ack,
            definite: true,
            retryable: ack.retryable === true
          });
        }
        this.metrics.acknowledgedCount += 1;
        pending.resolve(ack);
      } catch (error) {
        this.metrics.failedCount += 1;
        this.metrics.lastReasonCode = error.reasonCode || error.code || 'CREDENTIAL_VAULT_PERSIST_FAILED';
        pending.reject(error);
      }
    }
  }

  _failAll(reasonCode) {
    if (typeof this.onChannelLost === 'function' && !this._channelLostEmitted) {
      this._channelLostEmitted = true;
      try { this.onChannelLost(reasonCode); } catch (_) {}
    }
    const pendingEntries = [...this.pending.values()];
    const atRiskRecords = [...this.requestStates.values()].filter(record => [
      'PREPARE_SENT', 'PREPARE_RESULT_UNKNOWN', 'PREPARED', 'COMMIT_SENT', 'COMMIT_RESULT_UNKNOWN'
    ].includes(record.state));
    if (this.closed && !pendingEntries.length && !atRiskRecords.some(record => !record.indeterminateHandled)) return;
    this.closed = true;
    this.metrics.lastReasonCode = reasonCode;

    for (const pending of pendingEntries) {
      clearTimeout(pending.timer);
      const record = pending.record;
      const commitAtRisk = pending.request.action === 'COMMIT' || ['COMMIT_SENT', 'COMMIT_RESULT_UNKNOWN'].includes(record?.state);
      const prepareAtRisk = !commitAtRisk && (pending.request.action === 'PREPARE' || ['PREPARE_SENT', 'PREPARE_RESULT_UNKNOWN', 'PREPARED'].includes(record?.state));
      if (commitAtRisk) {
        this._indeterminate(record, reasonCode || COMMIT_INDETERMINATE, 'COMMIT_RESULT_UNKNOWN');
        pending.reject(custodyError(COMMIT_INDETERMINATE, 'Credential commit result is indeterminate because the custody channel closed', {
          originalReasonCode: reasonCode,
          requestId: record?.requestId,
          state: 'COMMIT_RESULT_UNKNOWN'
        }));
      } else if (prepareAtRisk) {
        this._indeterminate(record, PREPARE_INDETERMINATE, 'PREPARE_RESULT_UNKNOWN');
        pending.reject(custodyError(PREPARE_INDETERMINATE, 'Credential prepare result is indeterminate because the custody channel closed', {
          originalReasonCode: reasonCode,
          requestId: record?.requestId,
          state: 'PREPARE_RESULT_UNKNOWN'
        }));
      } else {
        pending.reject(custodyError(reasonCode, 'Credential vault custody channel is unavailable', { requestId: record?.requestId, state: record?.state }));
      }
    }
    this.pending.clear();

    for (const record of atRiskRecords) {
      if (record.indeterminateHandled) continue;
      if (['COMMIT_SENT', 'COMMIT_RESULT_UNKNOWN'].includes(record.state)) this._indeterminate(record, reasonCode || COMMIT_INDETERMINATE, 'COMMIT_RESULT_UNKNOWN');
      else this._indeterminate(record, PREPARE_INDETERMINATE, 'PREPARE_RESULT_UNKNOWN');
    }
  }

  _frame(action, context) {
    return makeCustodyRequest({
      action,
      operation: context.operation,
      ref: context.ref,
      value: context.value,
      requestId: context.requestId,
      mutationSha256: context.mutationSha256,
      backendPid: this.context.backendPid,
      startupNonce: this.context.startupNonce,
      backendSessionId: this.context.backendSessionId,
      fd6PipeInstanceId: this.context.fd6PipeInstanceId,
      hydrationGeneration: this.context.credentialGeneration,
      manifestSha256: this.context.manifestSha256,
      vaultEpoch: this.context.credentialVaultEpoch,
      generation: context.generation
    });
  }

  _send(frame, timeoutMs = this.timeoutMs, record = null) {
    if (this.closed || this.terminal || !this.stream.writable) {
      return Promise.reject(custodyError(this.terminal ? COMMIT_INDETERMINATE : 'CREDENTIAL_VAULT_UNAVAILABLE', 'Credential vault custody channel is unavailable'));
    }
    this.metrics.requestCount += 1;
    if (record) {
      if (frame.action === 'PREPARE') record.state = 'PREPARE_SENT';
      else if (frame.action === 'COMMIT') record.state = 'COMMIT_SENT';
      else if (frame.action === 'QUERY' && ['COMMIT_SENT', 'COMMIT_RESULT_UNKNOWN'].includes(record.state)) record.state = 'COMMIT_RESULT_UNKNOWN';
    }
    return new Promise((resolve, reject) => {
      const key = `${frame.requestId}:${frame.action}`;
      const timer = setTimeout(() => {
        this.pending.delete(key);
        this.metrics.timeoutCount += 1;
        this.metrics.lastReasonCode = 'CREDENTIAL_VAULT_ACK_TIMEOUT';
        reject(custodyError('CREDENTIAL_VAULT_ACK_TIMEOUT', 'Credential vault acknowledgement timed out', {
          action: frame.action,
          requestId: frame.requestId,
          state: record?.state
        }));
      }, timeoutMs);
      this.pending.set(key, { request: frame, resolve, reject, timer, record });
      try {
        this.stream.write(encodeCustodyFrame(frame), error => {
          if (!error) return;
          clearTimeout(timer);
          this.pending.delete(key);
          reject(custodyError('CREDENTIAL_VAULT_UNAVAILABLE', 'Credential custody request write failed', {
            cause: error,
            action: frame.action,
            requestId: frame.requestId,
            state: record?.state
          }));
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(custodyError(error.reasonCode || 'CREDENTIAL_VAULT_UNAVAILABLE', error.message, {
          cause: error,
          action: frame.action,
          requestId: frame.requestId,
          state: record?.state
        }));
      }
    });
  }

  request(operation, ref, value, options = {}) {
    if (this.terminal) return Promise.reject(custodyError(COMMIT_INDETERMINATE, 'Credential custody client is terminating after an indeterminate transaction'));
    const next = this.operation.catch(() => {}).then(() => this._request(operation, ref, value, options));
    this.operation = next.catch(() => {});
    return next;
  }

  _cachedResult(requestId, fingerprint) {
    const cached = this.finalResults.get(requestId);
    if (!cached) return null;
    if (cached.mutationSha256 !== fingerprint) throw custodyError('CREDENTIAL_CUSTODY_REQUEST_ID_CONFLICT', 'requestId was already used for a different credential mutation');
    this.metrics.duplicateResultCount += 1;
    return cached.result;
  }

  _cacheResult(requestId, fingerprint, ack) {
    const result = Object.freeze({ ...ack, requestId, persisted: true, transactionState: 'COMMITTED' });
    this.finalResults.set(requestId, { mutationSha256: fingerprint, result });
    return result;
  }

  async _recoverPrepareOutcome(context, record, originalError) {
    record.state = 'PREPARE_RESULT_UNKNOWN';
    try {
      const queryAck = await this._send(this._frame('QUERY', context), this.timeoutMs, record);
      const state = queryAck.payload?.transactionState;
      if (state === 'COMMITTED' && queryAck.payload?.persisted === true) {
        record.state = 'COMMIT_ACKNOWLEDGED';
        this.metrics.prepareRecoveryCount += 1;
        this.metrics.queryRecoveryCount += 1;
        return queryAck;
      }
      if (state === 'PREPARED') {
        const abortAck = await this._send(this._frame('ABORT', context), this.timeoutMs, record);
        if (abortAck.payload?.transactionState !== 'ROLLED_BACK') throw custodyError(PREPARE_INDETERMINATE, 'Prepared transaction could not be released', { transactionState: abortAck.payload?.transactionState });
        record.state = 'ROLLED_BACK';
        this.metrics.prepareRecoveryCount += 1;
        throw custodyError(originalError.reasonCode || 'CREDENTIAL_VAULT_ACK_TIMEOUT', 'PREPARE acknowledgement was lost; the prepared transaction was automatically rolled back', {
          transactionState: 'ROLLED_BACK',
          definite: true,
          recovered: true,
          requestId: context.requestId
        });
      }
      if (state === 'ROLLED_BACK' || state === 'FAILED') {
        record.state = state;
        throw custodyError(queryAck.reasonCode || originalError.reasonCode || 'CREDENTIAL_TRANSACTION_PREPARE_FAILED', 'Credential prepare reached a definite terminal failure', {
          transactionState: state,
          definite: true,
          requestId: context.requestId
        });
      }
      if (state === 'UNKNOWN') {
        record.state = 'NOT_CREATED';
        throw custodyError(originalError.reasonCode || 'CREDENTIAL_VAULT_ACK_TIMEOUT', 'Credential prepare was not created', {
          transactionState: 'UNKNOWN',
          definite: true,
          requestId: context.requestId
        });
      }
      throw custodyError(PREPARE_INDETERMINATE, 'Credential prepare query did not establish a recoverable state', { transactionState: state });
    } catch (queryError) {
      if (queryError.definite) throw queryError;
      this._indeterminate(record, PREPARE_INDETERMINATE, 'PREPARE_RESULT_UNKNOWN');
      throw custodyError(PREPARE_INDETERMINATE, 'Credential prepare result is indeterminate after communication failure', {
        cause: queryError,
        originalReasonCode: originalError.reasonCode || originalError.code || '',
        requestId: record.requestId,
        state: record.state
      });
    }
  }

  async _recoverCommitOutcome(context, record, originalError) {
    try {
      const queryAck = await this._send(this._frame('QUERY', context), this.timeoutMs, record);
      const state = queryAck.payload?.transactionState;
      if (state === 'COMMITTED' && queryAck.payload?.persisted === true) {
        record.state = 'COMMIT_ACKNOWLEDGED';
        this.metrics.queryRecoveryCount += 1;
        return queryAck;
      }
      if (state === 'ROLLED_BACK' || state === 'FAILED') {
        throw custodyError(queryAck.reasonCode || originalError.reasonCode || 'CREDENTIAL_VAULT_PERSIST_FAILED', 'Credential transaction reached a definite non-committed state', { transactionState: state, definite: true });
      }
      if (state === 'PREPARED') {
        const abortAck = await this._send(this._frame('ABORT', context), this.timeoutMs, record);
        if (abortAck.payload?.transactionState === 'ROLLED_BACK') {
          throw custodyError(originalError.reasonCode || 'CREDENTIAL_VAULT_UNAVAILABLE', 'Credential commit was not applied and the prepared transaction was rolled back', { transactionState: 'ROLLED_BACK', definite: true });
        }
      }
      throw custodyError(COMMIT_INDETERMINATE, 'Credential transaction query did not establish a final state', { transactionState: state });
    } catch (queryError) {
      if (queryError.definite) throw queryError;
      this._indeterminate(record, queryError.reasonCode || originalError.reasonCode || COMMIT_INDETERMINATE, 'COMMIT_RESULT_UNKNOWN');
      throw custodyError(COMMIT_INDETERMINATE, 'Credential transaction result is indeterminate after commit communication failure', {
        cause: queryError,
        originalReasonCode: originalError.reasonCode || originalError.code || '',
        requestId: record.requestId,
        state: record.state
      });
    }
  }

  async _request(operation, ref, value, options = {}) {
    const requestId = String(options.requestId || this.randomUUID());
    const normalizedRef = String(ref || '').trim();
    const fingerprint = mutationSha256(operation, normalizedRef, value);
    const cached = this._cachedResult(requestId, fingerprint);
    if (cached) return cached;

    const context = { operation, ref: normalizedRef, value, requestId, mutationSha256: fingerprint, generation: this.generation };
    const record = this._record(requestId, { operation, ref: normalizedRef, generation: context.generation, mutationSha256: fingerprint, state: 'NEW', indeterminateHandled: false });
    let authorityToken = null;
    let commitAck = null;
    let prepared = false;
    try {
      let prepareAck;
      try { prepareAck = await this._send(this._frame('PREPARE', context), this.timeoutMs, record); }
      catch (error) {
        if (error.definite) throw error;
        prepareAck = await this._recoverPrepareOutcome(context, record, error);
      }

      if (prepareAck.payload?.transactionState === 'COMMITTED' && prepareAck.payload?.persisted === true) {
        if (prepareAck.payload?.durableReplay !== true) throw custodyError('WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_FAILED', 'Historical committed result was not marked as durable replay');
        this.metrics.durableReplayCount += 1;
        record.state = 'COMMITTED';
        return this._cacheResult(requestId, fingerprint, prepareAck);
      }
      if (prepareAck.payload?.transactionState !== 'PREPARED') throw custodyError('CREDENTIAL_TRANSACTION_PREPARE_FAILED', 'Credential transaction did not enter PREPARED state', { transactionState: prepareAck.payload?.transactionState });
      prepared = true;
      record.state = 'PREPARED';

      if (typeof options.prepareAuthority === 'function') {
        authorityToken = await options.prepareAuthority({ requestId, vaultEpoch: prepareAck.vaultEpoch, previousGeneration: prepareAck.previousGeneration, generation: prepareAck.generation });
      }
      if (this.terminal || record.state === 'PREPARE_RESULT_UNKNOWN') {
        throw custodyError(PREPARE_INDETERMINATE, 'Credential prepare result became indeterminate before COMMIT could be sent', { requestId, state: record.state });
      }
      try { commitAck = await this._send(this._frame('COMMIT', context), this.timeoutMs, record); }
      catch (error) { commitAck = await this._recoverCommitOutcome(context, record, error); }
      if (commitAck.payload?.transactionState !== 'COMMITTED' || commitAck.payload?.persisted !== true) throw custodyError('CREDENTIAL_TRANSACTION_PARTIAL_COMMIT', 'Credential transaction did not reach COMMITTED state');

      try {
        if (typeof options.commitAuthority === 'function') await options.commitAuthority(authorityToken, { requestId, vaultEpoch: commitAck.vaultEpoch, previousGeneration: commitAck.previousGeneration, generation: commitAck.generation, authorityEventId: commitAck.authorityEventId, authorityHeadDigest: commitAck.authorityHeadDigest });
      } catch (cause) {
        try {
          const abortAck = await this._send(this._frame('ABORT', context), this.timeoutMs, record);
          if (abortAck.payload?.transactionState !== 'ROLLED_BACK') throw custodyError('CREDENTIAL_VAULT_ROLLBACK_FAILED', 'Credential transaction rollback did not reach ROLLED_BACK', { transactionState: abortAck.payload?.transactionState });
        } catch (abortError) {
          this._indeterminate(record, abortError.reasonCode || 'WP4_CREDENTIAL_STATE_AUTHORITY_SPLIT', 'COMMIT_RESULT_UNKNOWN');
          await Promise.resolve(options.rollbackAuthority?.(authorityToken, cause)).catch(() => {});
          throw custodyError('WP4_CREDENTIAL_STATE_AUTHORITY_SPLIT', 'Credential authority update failed and Electron rollback could not be confirmed', { cause, abortError });
        }
        await Promise.resolve(options.rollbackAuthority?.(authorityToken, cause)).catch(() => {});
        throw custodyError(cause.reasonCode || cause.code || 'CREDENTIAL_STATE_AUTHORITY_UPDATE_FAILED', 'Credential authority update failed; vault transaction was rolled back', { cause });
      }

      this.generation = commitAck.generation;
      record.state = 'COMMITTED';
      return this._cacheResult(requestId, fingerprint, commitAck);
    } catch (error) {
      if (prepared && !commitAck && !['COMMIT_RESULT_UNKNOWN', 'COMMIT_SENT', 'PREPARE_RESULT_UNKNOWN'].includes(record.state) && !record.indeterminateHandled) {
        await this._send(this._frame('ABORT', context), this.timeoutMs, record).catch(() => {});
      }
      await Promise.resolve(options.rollbackAuthority?.(authorityToken, error)).catch(() => {});
      this.metrics.failedCount += 1;
      this.metrics.lastReasonCode = error.reasonCode || error.code || 'CREDENTIAL_VAULT_PERSIST_FAILED';
      throw error;
    }
  }

  async query(requestId, operation, ref, value, generation = this.generation) {
    const context = { requestId, operation, ref, value, mutationSha256: mutationSha256(operation, ref, value), generation };
    const record = this._record(requestId, { operation, ref, generation, mutationSha256: context.mutationSha256 });
    return this._send(this._frame('QUERY', context), this.timeoutMs, record);
  }

  snapshot() {
    const requestStates = {};
    for (const [id, record] of this.requestStates) {
      requestStates[id] = { state: record.state, reasonCode: record.reasonCode || '', indeterminateHandled: Boolean(record.indeterminateHandled) };
    }
    return Object.freeze({ dedicatedPipeActive: !this.closed && !this.terminal, generation: this.generation, finalResultCount: this.finalResults.size, terminal: this.terminal, requestStates, ...this.metrics });
  }

  close() {
    this._failAll('CREDENTIAL_VAULT_UNAVAILABLE');
    try {
      this.stream.removeListener?.('data', this._onData);
      this.stream.removeListener?.('error', this._onError);
      this.stream.removeListener?.('end', this._onEnd);
      this.stream.destroy?.();
    } catch (_) {}
  }
}

module.exports = { COMMIT_INDETERMINATE, CredentialCustodyClient, PREPARE_INDETERMINATE, custodyError };
