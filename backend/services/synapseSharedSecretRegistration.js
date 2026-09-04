'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function clean(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.reasonCode = code;
  error.status = status;
  error.details = details;
  return error;
}

function env(name, fallback = '') {
  return clean(process.env[name], fallback);
}

function secretFile(name) {
  const filePath = env(name);
  if (!filePath) return '';
  try {
    return clean(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw fail('PLATFORM_RUNTIME_SECRET_FILE_UNAVAILABLE', `Runtime secret file ${name} is unavailable.`, 503, { name, causeCode: clean(error?.code) });
  }
}

function matrixBaseUrl(input = {}) {
  return clean(input.matrixBaseUrl || env('YANCE_MATRIX_BASE_URL'), 'http://127.0.0.1:8008');
}

function matrixServerName(input = {}) {
  return clean(input.matrixServerName || env('YANCE_MATRIX_SERVER_NAME'), 'yance.local');
}

async function jsonResponse(response, code) {
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = { message: text };
  }
  if (!response.ok) throw fail(code, clean(body.error || body.message, `HTTP ${response.status}`), response.status, { body });
  return body;
}

async function registerSynapseUserWithSharedSecret(input = {}) {
  const sharedSecret = clean(input.sharedSecret) || secretFile(input.sharedSecretFileEnv || 'YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE');
  if (!sharedSecret) throw fail('MATRIX_REGISTRATION_SHARED_SECRET_REQUIRED', 'Synapse registration shared secret is required to provision an isolated Matrix identity.', 503);
  const baseUrl = matrixBaseUrl(input);
  const username = clean(input.username);
  const password = String(input.password == null ? '' : input.password);
  if (!username) throw fail('MATRIX_REGISTRATION_USERNAME_REQUIRED', 'Matrix registration username is required.', 400);
  if (!password) throw fail('MATRIX_REGISTRATION_PASSWORD_REQUIRED', 'Matrix registration password is required.', 400);
  const signal = input.signal || null;
  const nonceBody = await jsonResponse(await fetch(`${baseUrl}/_synapse/admin/v1/register`, { signal }), 'MATRIX_REGISTRATION_NONCE_FAILED');
  const nonce = clean(nonceBody.nonce);
  if (!nonce) throw fail('MATRIX_REGISTRATION_NONCE_MISSING', 'Synapse registration did not return a nonce.', 502);
  const mac = crypto.createHmac('sha1', sharedSecret).update(`${nonce}\0${username}\0${password}\0notadmin`).digest('hex');
  const body = await jsonResponse(await fetch(`${baseUrl}/_synapse/admin/v1/register`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nonce, username, password, admin: false, mac })
  }), 'MATRIX_ACCOUNT_REGISTRATION_FAILED');
  const fallbackUserId = `@${username}:${matrixServerName(input)}`;
  return { matrixUserId: clean(body.user_id, fallbackUserId), matrixAccessToken: clean(body.access_token), matrixBaseUrl: baseUrl };
}

module.exports = {
  registerSynapseUserWithSharedSecret,
  matrixBaseUrl,
  matrixServerName
};
