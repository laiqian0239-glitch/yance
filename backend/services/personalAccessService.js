'use strict';

const { getSecurityGuard } = require('../core/securityGuardSingleton');
const { matrixBaseUrl, matrixServerName } = require('./synapseSharedSecretRegistration');

const OWNER_CREDENTIAL_REF = 'personal-access.owner-admin';
const INVITATION_CREDENTIAL_REF = 'personal-access.invitation-key';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeAuthorityUrl(value) {
  const raw = clean(value).replace(/\/+$/u, '');
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return '';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  return parsed.toString().replace(/\/+$/u, '');
}

function fail(code, message, status = 403) {
  const error = new Error(message);
  error.code = code;
  error.reasonCode = code;
  error.status = status;
  return error;
}

function stableEntitlement(fields = {}) {
  return Object.freeze({
    ok: true,
    role: fields.role || 'TESTER',
    usable: fields.usable === true,
    reasonCode: fields.reasonCode || 'PERSONAL_ACCESS_REQUIRED',
    ...(fields.subject ? { subject: fields.subject } : {}),
    ...(fields.keyId ? { keyId: fields.keyId } : {}),
    ...(fields.expires ? { expires: fields.expires } : {}),
    ...(fields.workerRequestId ? { workerRequestId: fields.workerRequestId } : {})
  });
}

class PersonalAccessService {
  constructor(options = {}) {
    this.credentialStoreProvider = typeof options.credentialStoreProvider === 'function'
      ? options.credentialStoreProvider
      : options.credentialStore
        ? () => options.credentialStore
        : () => getSecurityGuard().credentials;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.authorityUrl = normalizeAuthorityUrl(options.authorityUrl ?? process.env.YANCE_PERSONAL_ACCESS_AUTHORITY_URL);
    this.matrixBaseUrl = matrixBaseUrl(options);
    this.matrixServerName = matrixServerName(options);
    this.requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs || 5000));
  }

  resolveCredentialStore() {
    return this.credentialStoreProvider?.() || null;
  }

  ownerMarkerPresent() {
    return Boolean(this.resolveCredentialStore()?.get?.(OWNER_CREDENTIAL_REF));
  }

  storedInvitation() {
    const stored = record(this.resolveCredentialStore()?.get?.(INVITATION_CREDENTIAL_REF));
    return clean(stored.key);
  }

  async persistInvitation(key) {
    const cleanKey = clean(key);
    if (!cleanKey) throw fail('INVITATION_KEY_REQUIRED', 'Invitation key is required', 400);
    const store = this.resolveCredentialStore();
    if (!store || typeof store.persist !== 'function') throw fail('CREDENTIAL_STORE_UNAVAILABLE', 'Credential store is unavailable', 503);
    await store.persist(INVITATION_CREDENTIAL_REF, { key: cleanKey }, { actor: 'backend-core' });
  }

  async boundedFetch(url, options = {}, code = 'REMOTE_AUTHORITY_UNAVAILABLE') {
    if (typeof this.fetchImpl !== 'function') throw fail(code, 'Fetch authority is unavailable', 503);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (_) {
        body = {};
      }
      if (!response.ok || body.ok === false) throw fail(clean(body.reasonCode || body.code || code), 'Authority rejected personal access verification', Number(response.status || 502));
      return body;
    } catch (error) {
      if (error?.reasonCode || error?.code) throw error;
      throw fail(code, error?.name === 'AbortError' ? 'Authority timed out' : 'Authority is unavailable', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async matrixSubject(matrixOpenId = {}) {
    const proof = record(matrixOpenId);
    const accessToken = clean(proof.access_token || proof.accessToken);
    const tokenType = clean(proof.token_type || proof.tokenType);
    const serverName = clean(proof.matrix_server_name || proof.matrixServerName);
    if (!accessToken) throw fail('MATRIX_OPENID_TOKEN_REQUIRED', 'Matrix OpenID token is required', 400);
    if (serverName !== this.matrixServerName) throw fail('MATRIX_OPENID_SERVER_MISMATCH', 'Matrix OpenID token is not from the configured server', 403);
    if (tokenType && tokenType.toLowerCase() !== 'bearer') throw fail('MATRIX_OPENID_TOKEN_TYPE_INVALID', 'Matrix OpenID token type is invalid', 403);
    const url = `${this.matrixBaseUrl.replace(/\/+$/u, '')}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(accessToken)}`;
    const body = await this.boundedFetch(url, { method: 'GET' }, 'MATRIX_OPENID_USERINFO_UNAVAILABLE');
    const subject = clean(body.sub);
    if (!subject) throw fail('MATRIX_OPENID_SUBJECT_MISSING', 'Matrix OpenID userinfo did not return a subject', 502);
    return subject;
  }

  async verifyInvitationForSubject(key, subject) {
    const invitationKey = clean(key);
    const matrixSubject = clean(subject);
    if (!invitationKey) return stableEntitlement({ reasonCode: 'INVITATION_REQUIRED' });
    if (!this.authorityUrl) return stableEntitlement({ reasonCode: 'UNKEY_AUTHORITY_UNAVAILABLE' });
    let body;
    try {
      body = await this.boundedFetch(`${this.authorityUrl}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: invitationKey })
      }, 'UNKEY_AUTHORITY_UNAVAILABLE');
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'UNKEY_AUTHORITY_UNAVAILABLE' });
    }
    const identity = record(body.identity);
    const externalId = clean(identity.externalId);
    if (body.valid !== true) return stableEntitlement({ reasonCode: clean(body.code) || 'UNKEY_ENTITLEMENT_INVALID' });
    if (body.enabled === false) return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_DISABLED' });
    const expires = clean(body.expires);
    if (expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= Date.now()) {
      return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_EXPIRED', expires });
    }
    if (!externalId || externalId !== matrixSubject) return stableEntitlement({ reasonCode: 'MATRIX_SUBJECT_MISMATCH', subject: matrixSubject, keyId: clean(body.keyId) });
    return stableEntitlement({
      role: 'TESTER',
      usable: true,
      reasonCode: 'ENTITLEMENT_VALID',
      subject: matrixSubject,
      keyId: clean(body.keyId),
      expires,
      workerRequestId: clean(body.requestId)
    });
  }

  async status(input = {}) {
    if (this.ownerMarkerPresent()) return stableEntitlement({ role: 'OWNER', usable: true, reasonCode: 'OWNER_PERMANENT_ACCESS' });
    const key = this.storedInvitation();
    if (!key) return stableEntitlement({ reasonCode: 'INVITATION_REQUIRED' });
    let subject;
    try {
      subject = await this.matrixSubject(input.matrixOpenId);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_OPENID_REQUIRED' });
    }
    return this.verifyInvitationForSubject(key, subject);
  }

  async activate(input = {}) {
    if (this.ownerMarkerPresent()) return this.status(input);
    const invitationKey = clean(input.invitationKey);
    if (!invitationKey) return stableEntitlement({ reasonCode: 'INVITATION_KEY_REQUIRED' });
    let subject;
    try {
      subject = await this.matrixSubject(input.matrixOpenId);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_OPENID_REQUIRED' });
    }
    const entitlement = await this.verifyInvitationForSubject(invitationKey, subject);
    if (entitlement.usable !== true) return entitlement;
    await this.persistInvitation(invitationKey);
    return this.verifyInvitationForSubject(invitationKey, subject);
  }

  async authorizeProductRequest(input = {}) {
    return this.status(input);
  }
}

function createPersonalAccessService(options = {}) {
  return new PersonalAccessService(options);
}

module.exports = {
  OWNER_CREDENTIAL_REF,
  INVITATION_CREDENTIAL_REF,
  PersonalAccessService,
  createPersonalAccessService
};
