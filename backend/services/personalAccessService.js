'use strict';

const { randomUUID } = require('node:crypto');
const { getSecurityGuard } = require('../core/securityGuardSingleton');

const REQUEST_STATES = Object.freeze(['PENDING', 'ASSIGNED', 'APPROVED', 'REJECTED']);
const GRANT_STATES = Object.freeze(['ACTIVE', 'SUSPENDED', 'REVOKED']);
const OWNER_CREDENTIAL_REF = 'personal-access.owner-admin';
const INSTALLATION_CREDENTIAL_REF = 'personal-access.installation';

function clean(value) { return String(value == null ? '' : value).trim(); }

function evaluateEntitlement({ ownerCredentialPresent = false, installationId = '', remoteState = null } = {}) {
  if (ownerCredentialPresent) {
    return Object.freeze({ role: 'OWNER', usable: true, reasonCode: 'OWNER_PERMANENT_ACCESS' });
  }
  if (!remoteState) {
    return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REMOTE_AUTHORITY_UNAVAILABLE' });
  }
  const requestState = clean(remoteState.requestState || remoteState.state).toUpperCase();
  const grantState = clean(remoteState.grantState).toUpperCase();
  const localInstallationId = clean(installationId);
  const remoteInstallationId = clean(remoteState.installationId);
  if (remoteState.role && clean(remoteState.role).toUpperCase() !== 'TESTER') {
    return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REMOTE_ROLE_INVALID', requestState, grantState });
  }
  if (requestState === 'PENDING') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REQUEST_PENDING', requestState, grantState: grantState || null });
  if (requestState === 'ASSIGNED') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REQUEST_ASSIGNED', requestState, grantState: grantState || null });
  if (requestState === 'REJECTED') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REQUEST_REJECTED', requestState, grantState: grantState || null });
  if (requestState !== 'APPROVED') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'REQUEST_NOT_APPROVED', requestState: requestState || null, grantState: grantState || null });
  if (grantState === 'SUSPENDED') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'GRANT_SUSPENDED', requestState, grantState });
  if (grantState === 'REVOKED') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'GRANT_REVOKED', requestState, grantState });
  if (grantState !== 'ACTIVE') return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'GRANT_NOT_ACTIVE', requestState, grantState: grantState || null });
  if (!localInstallationId || !remoteInstallationId || localInstallationId !== remoteInstallationId) {
    return Object.freeze({ role: 'TESTER', usable: false, reasonCode: 'INSTALLATION_MISMATCH', requestState, grantState });
  }
  return Object.freeze({ role: 'TESTER', usable: true, reasonCode: 'TESTER_ACTIVE', requestState, grantState, installationId: localInstallationId });
}

function normalizeAuthorityUrl(value) {
  const raw = clean(value).replace(/\/+$/u, '');
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  return parsed.toString().replace(/\/+$/u, '');
}

function createRemoteError(code, message, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.reasonCode = code;
  error.status = status;
  return error;
}

class PersonalAccessService {
  constructor(options = {}) {
    this.credentialStore = options.credentialStore || getSecurityGuard().credentials;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.authorityUrl = normalizeAuthorityUrl(options.authorityUrl ?? process.env.YANCE_PERSONAL_ACCESS_AUTHORITY_URL);
    this.ownerAdminSecretEnv = clean(options.ownerAdminSecret ?? process.env.YANCE_PERSONAL_ACCESS_OWNER_ADMIN_SECRET);
    this.requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs || 5000));
  }

  ownerCredential() {
    const stored = this.credentialStore?.get?.(OWNER_CREDENTIAL_REF) || null;
    const secret = clean(stored?.secret || stored?.value || this.ownerAdminSecretEnv);
    return secret ? Object.freeze({ secret, source: stored ? 'credentialStore' : 'environment' }) : null;
  }

  installationReceipt() {
    const stored = this.credentialStore?.get?.(INSTALLATION_CREDENTIAL_REF) || null;
    const installationId = clean(stored?.installationId || process.env.YANCE_PERSONAL_ACCESS_INSTALLATION_ID);
    const requestId = clean(stored?.requestId);
    return Object.freeze({ installationId, requestId });
  }

  async ensureInstallationReceipt() {
    const current = this.installationReceipt();
    if (current.installationId) return current;
    const next = { installationId: randomUUID(), requestId: '' };
    await this.credentialStore.persist(INSTALLATION_CREDENTIAL_REF, next, { actor: 'backend-core' });
    return Object.freeze(next);
  }

  async persistReceipt(receipt) {
    const next = { installationId: clean(receipt?.installationId), requestId: clean(receipt?.requestId) };
    if (!next.installationId) throw createRemoteError('INSTALLATION_ID_REQUIRED', 'Installation id is required', 400);
    await this.credentialStore.persist(INSTALLATION_CREDENTIAL_REF, next, { actor: 'backend-core' });
    return Object.freeze(next);
  }

  async remote(pathname, options = {}) {
    if (!this.authorityUrl || typeof this.fetchImpl !== 'function') throw createRemoteError('REMOTE_AUTHORITY_UNAVAILABLE', 'Personal access authority is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetchImpl(`${this.authorityUrl}${pathname}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(options.headers || {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      throw createRemoteError('REMOTE_AUTHORITY_UNAVAILABLE', error?.name === 'AbortError' ? 'Personal access authority timed out' : 'Personal access authority is unavailable');
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw createRemoteError(clean(payload.code || payload.reasonCode || 'REMOTE_AUTHORITY_REJECTED'), clean(payload.message || 'Personal access authority rejected the request'), Number(response.status || 502));
    }
    return payload;
  }

  async status() {
    const owner = this.ownerCredential();
    const receipt = this.installationReceipt();
    if (owner) return { ok: true, ...evaluateEntitlement({ ownerCredentialPresent: true, installationId: receipt.installationId }), installationId: receipt.installationId || null };
    if (!receipt.installationId) return { ok: true, role: 'TESTER', usable: false, reasonCode: 'INSTALLATION_UNREGISTERED', installationId: null, requestId: null };
    if (!receipt.requestId) return { ok: true, role: 'TESTER', usable: false, reasonCode: 'REQUEST_NOT_SUBMITTED', installationId: receipt.installationId, requestId: null };
    try {
      const remoteState = await this.remote(`/status?requestId=${encodeURIComponent(receipt.requestId)}&installationId=${encodeURIComponent(receipt.installationId)}`);
      return { ok: true, ...evaluateEntitlement({ installationId: receipt.installationId, remoteState }), installationId: receipt.installationId, requestId: receipt.requestId, remoteState };
    } catch (error) {
      return { ok: true, ...evaluateEntitlement({ installationId: receipt.installationId, remoteState: null }), installationId: receipt.installationId, requestId: receipt.requestId, remoteErrorCode: error.code || 'REMOTE_AUTHORITY_UNAVAILABLE' };
    }
  }

  async submitRequest(input = {}) {
    if (this.ownerCredential()) return { ok: true, ...(await this.status()) };
    const receipt = await this.ensureInstallationReceipt();
    const payload = await this.remote('/requests', {
      method: 'POST',
      body: { installationId: receipt.installationId, displayName: clean(input.displayName).slice(0, 120) }
    });
    const requestId = clean(payload.id || payload.requestId);
    if (!requestId) throw createRemoteError('REMOTE_AUTHORITY_INVALID_RESPONSE', 'Personal access authority did not return a request id', 502);
    await this.persistReceipt({ installationId: receipt.installationId, requestId });
    return this.status();
  }

  async refreshRequest() { return this.status(); }
  async authorizeProductRequest() { return this.status(); }

  async ownerRemote(pathname, options = {}) {
    const owner = this.ownerCredential();
    if (!owner) throw createRemoteError('OWNER_ACCESS_REQUIRED', 'OWNER credential is required', 403);
    return this.remote(pathname, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${owner.secret}` } });
  }

  async listOwnerRequests() { return this.ownerRemote('/owner/requests'); }
  async mutateOwnerRequest(requestId, action) {
    const id = clean(requestId);
    const op = clean(action).toLowerCase();
    if (!id || !['assign', 'approve', 'reject'].includes(op)) throw createRemoteError('INVALID_OWNER_REQUEST_MUTATION', 'Invalid request mutation', 400);
    return this.ownerRemote(`/owner/requests/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: {} });
  }
  async mutateOwnerGrant(grantId, action) {
    const id = clean(grantId);
    const op = clean(action).toLowerCase();
    if (!id || !['suspend', 'revoke'].includes(op)) throw createRemoteError('INVALID_OWNER_GRANT_MUTATION', 'Invalid grant mutation', 400);
    return this.ownerRemote(`/owner/grants/${encodeURIComponent(id)}/${op}`, { method: 'POST', body: {} });
  }
}

function createPersonalAccessService(options = {}) { return new PersonalAccessService(options); }

module.exports = {
  REQUEST_STATES,
  GRANT_STATES,
  OWNER_CREDENTIAL_REF,
  INSTALLATION_CREDENTIAL_REF,
  evaluateEntitlement,
  PersonalAccessService,
  createPersonalAccessService
};
