'use strict';

const fs = require('node:fs');
const jwt = require('jsonwebtoken');
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
    ...(fields.localpart ? { localpart: fields.localpart } : {}),
    ...(fields.keyId ? { keyId: fields.keyId } : {}),
    ...(fields.expires ? { expires: fields.expires } : {}),
    ...(fields.workerRequestId ? { workerRequestId: fields.workerRequestId } : {})
  });
}

function matrixUserFromExternalId(value, expectedServerName) {
  const externalId = clean(value);
  const serverName = clean(expectedServerName);
  if (!serverName) {
    throw fail('MATRIX_INVITATION_EXTERNAL_ID_INVALID', 'Configured Matrix server name is unavailable', 403);
  }
  if (!/^[a-z0-9][a-z0-9._=-]{2,63}$/u.test(externalId) || externalId !== externalId.toLowerCase()) {
    throw fail('MATRIX_INVITATION_EXTERNAL_ID_INVALID', 'Invitation identity must be one canonical Matrix localpart', 403);
  }
  return Object.freeze({ userId: `@${externalId}:${serverName}`, localpart: externalId });
}

function unkeyExpiryMs(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw fail('UNKEY_ENTITLEMENT_EXPIRY_INVALID', 'Unkey expiry must be a Unix timestamp in milliseconds', 403);
  }
  return numeric;
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
    this.matrixJwtSecret = clean(options.matrixJwtSecret);
    this.matrixRegistrationSharedSecretFile = clean(options.matrixRegistrationSharedSecretFile || process.env.YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE);
    this.requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs || 5000));
  }

  resolveCredentialStore() {
    return this.credentialStoreProvider?.() || null;
  }

  ownerMarkerPresent() {
    return Boolean(this.resolveCredentialStore()?.get?.(OWNER_CREDENTIAL_REF));
  }

  storedEntitlementKeyId() {
    const stored = record(this.resolveCredentialStore()?.get?.(INVITATION_CREDENTIAL_REF));
    return clean(stored.keyId);
  }

  async persistEntitlementKeyId(keyId) {
    const cleanKeyId = clean(keyId);
    if (!cleanKeyId) throw fail('INVITATION_KEY_ID_REQUIRED', 'Invitation key id is required', 400);
    const store = this.resolveCredentialStore();
    if (!store || typeof store.persist !== 'function') throw fail('CREDENTIAL_STORE_UNAVAILABLE', 'Credential store is unavailable', 503);
    await store.persist(INVITATION_CREDENTIAL_REF, { keyId: cleanKeyId }, { actor: 'backend-core' });
  }

  async clearEntitlementReceipt() {
    const store = this.resolveCredentialStore();
    if (!store) throw fail('CREDENTIAL_STORE_UNAVAILABLE', 'Credential store is unavailable', 503);
    if (typeof store.remove === 'function') await store.remove(INVITATION_CREDENTIAL_REF, { actor: 'backend-core' });
    else if (typeof store.persist === 'function') await store.persist(INVITATION_CREDENTIAL_REF, {}, { actor: 'backend-core' });
    else throw fail('CREDENTIAL_STORE_UNAVAILABLE', 'Credential store is unavailable', 503);
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

  async verifyInvitationForLogin(key) {
    const invitationKey = clean(key);
    if (!invitationKey) return stableEntitlement({ reasonCode: 'INVITATION_KEY_REQUIRED' });
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
    if (body.valid !== true) return stableEntitlement({ reasonCode: clean(body.code) || 'UNKEY_ENTITLEMENT_INVALID' });
    if (body.enabled === false) return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_DISABLED' });
    let expires;
    try {
      expires = unkeyExpiryMs(body.expires);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || 'UNKEY_ENTITLEMENT_EXPIRY_INVALID' });
    }
    if (expires !== null && expires <= Date.now()) {
      return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_EXPIRED', expires });
    }
    const keyId = clean(body.keyId);
    if (!keyId) return stableEntitlement({ reasonCode: 'UNKEY_KEY_ID_MISSING' });
    let matrixUser;
    try {
      matrixUser = matrixUserFromExternalId(record(body.identity).externalId, this.matrixServerName);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_INVITATION_EXTERNAL_ID_INVALID' });
    }
    return stableEntitlement({
      role: 'TESTER',
      usable: true,
      reasonCode: 'ENTITLEMENT_VALID',
      subject: matrixUser.userId,
      localpart: matrixUser.localpart,
      keyId,
      expires,
      workerRequestId: clean(body.requestId)
    });
  }

  async verifyKeyIdForSubject(keyId, subject) {
    const cleanKeyId = clean(keyId);
    const matrixSubject = clean(subject);
    if (!cleanKeyId) return stableEntitlement({ reasonCode: 'INVITATION_REQUIRED' });
    if (!this.authorityUrl) return stableEntitlement({ reasonCode: 'UNKEY_AUTHORITY_UNAVAILABLE' });
    let body;
    try {
      body = await this.boundedFetch(`${this.authorityUrl}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyId: cleanKeyId })
      }, 'UNKEY_AUTHORITY_UNAVAILABLE');
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'UNKEY_AUTHORITY_UNAVAILABLE' });
    }
    if (body.enabled === false) return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_DISABLED', keyId: cleanKeyId });
    let expires;
    try {
      expires = unkeyExpiryMs(body.expires);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || 'UNKEY_ENTITLEMENT_EXPIRY_INVALID', keyId: cleanKeyId });
    }
    if (expires !== null && expires <= Date.now()) {
      return stableEntitlement({ reasonCode: 'UNKEY_ENTITLEMENT_EXPIRED', keyId: cleanKeyId, expires });
    }
    let matrixUser;
    try {
      matrixUser = matrixUserFromExternalId(record(body.identity).externalId, this.matrixServerName);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_INVITATION_EXTERNAL_ID_INVALID', keyId: cleanKeyId });
    }
    if (matrixUser.userId !== matrixSubject) {
      return stableEntitlement({ reasonCode: 'MATRIX_SUBJECT_MISMATCH', subject: matrixSubject, keyId: cleanKeyId });
    }
    return stableEntitlement({
      role: 'TESTER',
      usable: true,
      reasonCode: 'ENTITLEMENT_VALID',
      subject: matrixSubject,
      keyId: cleanKeyId,
      expires,
      workerRequestId: clean(body.requestId)
    });
  }

  readMatrixJwtSecret() {
    if (this.matrixJwtSecret) return this.matrixJwtSecret;
    if (!this.matrixRegistrationSharedSecretFile) throw fail('MATRIX_JWT_SECRET_UNAVAILABLE', 'Matrix JWT secret authority is unavailable', 503);
    let secret;
    try {
      secret = fs.readFileSync(this.matrixRegistrationSharedSecretFile, 'utf8').trim();
    } catch (_) {
      throw fail('MATRIX_JWT_SECRET_UNAVAILABLE', 'Matrix JWT secret authority is unavailable', 503);
    }
    if (!secret) throw fail('MATRIX_JWT_SECRET_UNAVAILABLE', 'Matrix JWT secret authority is unavailable', 503);
    return secret;
  }

  async login(input = {}) {
    const entitlement = await this.verifyInvitationForLogin(input.invitationKey);
    if (entitlement.usable !== true) return entitlement;
    const token = jwt.sign(
      { sub: entitlement.localpart },
      this.readMatrixJwtSecret(),
      {
        algorithm: 'HS256',
        expiresIn: '2m',
        issuer: 'yance-personal-access',
        audience: this.matrixServerName
      }
    );
    const login = await this.boundedFetch(`${this.matrixBaseUrl.replace(/\/+$/u, '')}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'org.matrix.login.jwt', token })
    }, 'MATRIX_JWT_LOGIN_UNAVAILABLE');
    const userId = clean(login.user_id || login.userId);
    const accessToken = clean(login.access_token || login.accessToken);
    const deviceId = clean(login.device_id || login.deviceId);
    if (userId !== entitlement.subject || !accessToken || !deviceId) {
      throw fail('MATRIX_JWT_LOGIN_RESPONSE_INVALID', 'Matrix JWT login response did not match the invitation identity', 502);
    }
    return Object.freeze({
      ok: true,
      usable: true,
      reasonCode: 'ENTITLEMENT_VALID',
      accountAuth: {
        userId,
        deviceId,
        accessToken,
        homeserverUrl: this.matrixBaseUrl
      },
      subject: entitlement.subject,
      keyId: entitlement.keyId,
      expires: entitlement.expires
    });
  }

  async status(input = {}) {
    if (this.ownerMarkerPresent()) return stableEntitlement({ role: 'OWNER', usable: true, reasonCode: 'OWNER_PERMANENT_ACCESS' });
    const keyId = this.storedEntitlementKeyId();
    if (!keyId) return stableEntitlement({ reasonCode: 'INVITATION_REQUIRED' });
    let subject;
    try {
      subject = await this.matrixSubject(input.matrixOpenId);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_OPENID_REQUIRED' });
    }
    return this.verifyKeyIdForSubject(keyId, subject);
  }

  async activate(input = {}) {
    if (this.ownerMarkerPresent()) return this.status(input);
    const keyId = clean(input.keyId);
    if (!keyId) return stableEntitlement({ reasonCode: 'INVITATION_KEY_ID_REQUIRED' });
    let subject;
    try {
      subject = await this.matrixSubject(input.matrixOpenId);
    } catch (error) {
      return stableEntitlement({ reasonCode: error?.reasonCode || error?.code || 'MATRIX_OPENID_REQUIRED' });
    }
    const entitlement = await this.verifyKeyIdForSubject(keyId, subject);
    if (entitlement.usable !== true) return entitlement;
    await this.persistEntitlementKeyId(keyId);
    return this.verifyKeyIdForSubject(keyId, subject);
  }

  async logout() {
    await this.clearEntitlementReceipt();
    return Object.freeze({ ok: true, usable: false, reasonCode: 'INVITATION_REQUIRED' });
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
