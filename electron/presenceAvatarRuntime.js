'use strict';

const DEFAULT_CYBERVERSE_ENDPOINT = 'http://127.0.0.1:8081';
const AUDIO_FORMATS = new Set(['s16le', 'float32']);

function fail(reasonCode, message, details = undefined) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeEndpoint(rawEndpoint, allowExternalEndpoint = false) {
  const raw = String(rawEndpoint || DEFAULT_CYBERVERSE_ENDPOINT).trim();
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw fail('PRESENCE_ENDPOINT_INVALID', 'CyberVerse endpoint is invalid.'); }
  const host = String(parsed.hostname || '').toLowerCase();
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!loopback && allowExternalEndpoint !== true) throw fail('PRESENCE_EXTERNAL_ENDPOINT_NOT_ALLOWED', 'External CyberVerse endpoint requires explicit user configuration.');
  if (!loopback && parsed.protocol !== 'https:') throw fail('PRESENCE_EXTERNAL_HTTPS_REQUIRED', 'External CyberVerse endpoint must use HTTPS.');
  if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('PRESENCE_ENDPOINT_PROTOCOL_INVALID', 'CyberVerse endpoint must use HTTP(S).');
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  return Object.freeze({ baseUrl: parsed.toString().replace(/\/$/u, ''), loopback });
}

function normalizeVoiceAudioChunk(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('PRESENCE_AUDIO_CHUNK_INVALID', 'Voice audio chunk must be an object.');
  const sessionId = String(input.sessionId || '').trim();
  const replyId = String(input.replyId || '').trim();
  const sequence = Number(input.sequence);
  const sampleRate = Number(input.sampleRate);
  const channels = Number(input.channels);
  const format = String(input.format || '').trim().toLowerCase();
  const timestampMs = Number(input.timestampMs);
  const data = input.data;
  const validData = Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
  if (!sessionId || !replyId || !Number.isInteger(sequence) || sequence < 0 || !validData || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isInteger(channels) || channels < 1 || channels > 8 || !AUDIO_FORMATS.has(format) || !Number.isFinite(timestampMs) || timestampMs < 0) {
    throw fail('PRESENCE_AUDIO_CHUNK_INVALID', 'Voice audio chunk fields are invalid.');
  }
  return Object.freeze({ sessionId, replyId, sequence, data, sampleRate, channels, format, isFinal: input.isFinal === true, timestampMs });
}

function toWireAudioChunk(chunk) {
  const normalized = normalizeVoiceAudioChunk(chunk);
  const bytes = Buffer.isBuffer(normalized.data)
    ? normalized.data
    : normalized.data instanceof ArrayBuffer
      ? Buffer.from(normalized.data)
      : Buffer.from(normalized.data.buffer, normalized.data.byteOffset || 0, normalized.data.byteLength || normalized.data.length || 0);
  return {
    reply_id: normalized.replyId,
    sequence: normalized.sequence,
    data_base64: bytes.toString('base64'),
    sample_rate: normalized.sampleRate,
    channels: normalized.channels,
    format: normalized.format,
    is_final: normalized.isFinal,
    timestamp_ms: normalized.timestampMs
  };
}

async function readJson(response, fallbackReasonCode) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reasonCode = String(payload?.reasonCode || payload?.error?.reasonCode || `${fallbackReasonCode}_HTTP_${response.status}`);
    throw fail(reasonCode, String(payload?.message || payload?.error?.message || `CyberVerse returned HTTP ${response.status}.`));
  }
  return payload;
}

function projectSession(payload = {}) {
  const sessionId = String(payload.session_id || payload.sessionId || '').trim();
  const livekitUrl = String(payload.livekit_url || payload.livekitUrl || '').trim();
  const livekitToken = String(payload.livekit_token || payload.livekitToken || '').trim();
  if (!sessionId || !livekitUrl || !livekitToken) throw fail('PRESENCE_SESSION_RESPONSE_INVALID', 'CyberVerse session response is missing LiveKit projection fields.');
  return Object.freeze({ sessionId, livekitUrl, livekitToken });
}

function projectCharacters(payload) {
  if (!Array.isArray(payload)) return Object.freeze([]);
  return Object.freeze(payload.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const id = String(item.id || '').trim();
    if (!id) return null;
    const name = String(item.name || id).trim() || id;
    return Object.freeze({ id, name });
  }).filter(Boolean));
}

function createPresenceAvatarRuntime(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw fail('PRESENCE_FETCH_UNAVAILABLE', 'A fetch implementation is required.');
  const getConfiguration = typeof options.getConfiguration === 'function'
    ? options.getConfiguration
    : () => ({ endpoint: DEFAULT_CYBERVERSE_ENDPOINT, allowExternalEndpoint: false });
  const activeSessionIds = new Set();

  function configuration() {
    const raw = getConfiguration() || {};
    return normalizeEndpoint(raw.endpoint || DEFAULT_CYBERVERSE_ENDPOINT, raw.allowExternalEndpoint === true);
  }

  function snapshot() {
    const endpoint = configuration();
    return Object.freeze({
      authority: 'cyberverse',
      transportAuthority: 'livekit',
      endpoint: endpoint.baseUrl,
      loopback: endpoint.loopback,
      activeSessionCount: activeSessionIds.size,
      activeSessionIds: Object.freeze([...activeSessionIds])
    });
  }

  async function health() {
    const endpoint = configuration();
    try {
      const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return Object.freeze({ available: false, degraded: true, reasonCode: `PRESENCE_HEALTH_HTTP_${response.status}`, characters: Object.freeze([]) });
      let characters = Object.freeze([]);
      let characterCatalogAvailable = false;
      try {
        const charactersResponse = await fetchImpl(`${endpoint.baseUrl}/api/v1/characters`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
        if (charactersResponse.ok) {
          characters = projectCharacters(await charactersResponse.json().catch(() => []));
          characterCatalogAvailable = true;
        }
      } catch (_) {}
      return Object.freeze({ available: true, degraded: false, endpoint: endpoint.baseUrl, characterCatalogAvailable, characters });
    } catch (error) {
      return Object.freeze({ available: false, degraded: true, reasonCode: String(error?.reasonCode || error?.code || 'PRESENCE_SERVICE_UNAVAILABLE'), characters: Object.freeze([]) });
    }
  }

  async function createSession(input = {}) {
    const endpoint = configuration();
    const characterId = String(input.characterId || '').trim();
    if (characterId) {
      const characterResponse = await fetchImpl(`${endpoint.baseUrl}/api/v1/characters/${encodeURIComponent(characterId)}`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      await readJson(characterResponse, 'PRESENCE_CHARACTER_LOOKUP_FAILED');
    }
    const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'standard', character_id: characterId }),
      signal: AbortSignal.timeout(15000)
    });
    const session = projectSession(await readJson(response, 'PRESENCE_SESSION_CREATE_FAILED'));
    activeSessionIds.add(session.sessionId);
    return session;
  }

  async function closeSession(input = {}) {
    const sessionId = String(input.sessionId || '').trim();
    if (!sessionId) throw fail('PRESENCE_SESSION_ID_REQUIRED', 'Presence sessionId is required.');
    const endpoint = configuration();
    const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 204) await readJson(response, 'PRESENCE_SESSION_CLOSE_FAILED');
    activeSessionIds.delete(sessionId);
    return Object.freeze({ closed: true, sessionId });
  }

  async function pushVoiceAudioChunk(input = {}) {
    const normalized = normalizeVoiceAudioChunk(input);
    if (!activeSessionIds.has(normalized.sessionId)) throw fail('PRESENCE_SESSION_NOT_ACTIVE', 'Voice audio targets an inactive Presence session.');
    const endpoint = configuration();
    const response = await fetchImpl(`${endpoint.baseUrl}/api/v1/sessions/${encodeURIComponent(normalized.sessionId)}/external-audio`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(toWireAudioChunk(normalized)), signal: AbortSignal.timeout(15000)
    });
    const payload = await readJson(response, 'PRESENCE_AUDIO_INGRESS_FAILED');
    return Object.freeze({ accepted: payload.accepted !== false, sessionId: normalized.sessionId, sequence: normalized.sequence, isFinal: normalized.isFinal });
  }

  async function closeAllSessions() {
    const results = [];
    for (const sessionId of [...activeSessionIds]) {
      try { results.push(await closeSession({ sessionId })); }
      catch (error) { results.push(Object.freeze({ closed: false, sessionId, reasonCode: String(error?.reasonCode || 'PRESENCE_SESSION_CLOSE_FAILED') })); }
    }
    return Object.freeze(results);
  }

  return Object.freeze({ health, createSession, closeSession, pushVoiceAudioChunk, closeAllSessions, snapshot, normalizeVoiceAudioChunk });
}

module.exports = { DEFAULT_CYBERVERSE_ENDPOINT, createPresenceAvatarRuntime, normalizeEndpoint, normalizeVoiceAudioChunk, projectCharacters, projectSession };
