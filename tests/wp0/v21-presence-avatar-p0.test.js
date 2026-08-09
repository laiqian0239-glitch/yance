'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(ROOT, 'electron/presenceAvatarRuntime.js');

function read(repositoryPath) {
  return fs.readFileSync(path.join(ROOT, repositoryPath), 'utf8');
}

test('Presence runtime is a thin CyberVerse session/audio adapter and does not recreate WebRTC or avatar authority', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'electron/presenceAvatarRuntime.js must exist');
  const source = fs.readFileSync(runtimePath, 'utf8');

  for (const method of [
    'health',
    'createSession',
    'closeSession',
    'pushVoiceAudioChunk'
  ]) assert.match(source, new RegExp(method, 'u'), `${method} must be part of the Presence runtime contract`);

  assert.match(source, /CyberVerse|cyberverse/u, 'runtime must coordinate the real CyberVerse service');
  assert.match(source, /fetch|net\.request|http\.request|https\.request/u, 'runtime must call a real service endpoint');
  assert.doesNotMatch(source, /new\s+RTCPeerConnection|wrtc|simple-peer|jsonwebtoken|SignJWT|CREATE TABLE|better-sqlite3/iu, 'Presence runtime must not recreate LiveKit/token/storage authority');
  assert.doesNotMatch(source, /lip.?sync|face.?mesh|avatar.?state.?machine|audio.?resampl/iu, 'Presence runtime must not recreate CyberVerse/avatar/audio-processing authority');
});

test('CyberVerse session bootstrap returns only a sanitized LiveKit participant projection', async () => {
  assert.equal(fs.existsSync(runtimePath), true, 'Presence runtime must exist');
  const { createPresenceAvatarRuntime } = require(runtimePath);
  assert.equal(typeof createPresenceAvatarRuntime, 'function');

  const calls = [];
  const runtime = createPresenceAvatarRuntime({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'cyberverse-session-1',
          livekit_url: 'wss://livekit.example.invalid',
          livekit_token: 'participant-token',
          livekit_api_key: 'must-not-project',
          livekit_api_secret: 'must-not-project'
        })
      };
    },
    getConfiguration: () => ({ endpoint: 'http://127.0.0.1:9999' })
  });

  const session = await runtime.createSession({ avatar: 'flash_head' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/sessions/u);
  assert.deepEqual(Object.keys(session).sort(), ['livekitToken', 'livekitUrl', 'sessionId'].sort());
  assert.equal(session.sessionId, 'cyberverse-session-1');
  assert.equal(session.livekitUrl, 'wss://livekit.example.invalid');
  assert.equal(session.livekitToken, 'participant-token');
  assert.equal('livekitApiKey' in session, false);
  assert.equal('livekitApiSecret' in session, false);
});

test('non-loopback CyberVerse endpoints require explicit HTTPS configuration before any request', async () => {
  assert.equal(fs.existsSync(runtimePath), true, 'Presence runtime must exist');
  const { createPresenceAvatarRuntime } = require(runtimePath);
  let fetchCalls = 0;
  const runtime = createPresenceAvatarRuntime({
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('insecure external endpoint must be rejected before fetch');
    },
    getConfiguration: () => ({
      endpoint: 'http://192.0.2.20:9999',
      allowExternalEndpoint: true
    })
  });

  await assert.rejects(
    () => runtime.createSession({ avatar: 'flash_head' }),
    error => error?.reasonCode === 'PRESENCE_EXTERNAL_HTTPS_REQUIRED'
  );
  assert.equal(fetchCalls, 0);
});
