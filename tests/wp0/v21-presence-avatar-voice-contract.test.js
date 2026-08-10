'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(ROOT, 'electron/presenceAvatarRuntime.js');

function loadRuntime() {
  assert.equal(fs.existsSync(runtimePath), true, 'Presence runtime must exist');
  return require(runtimePath);
}

test('Presence normalizes a Voice-independent AudioChunk projection without assuming CosyVoice internals', () => {
  const { normalizeVoiceAudioChunk } = loadRuntime();
  assert.equal(typeof normalizeVoiceAudioChunk, 'function');

  const data = Buffer.from([0, 1, 2, 3]);
  const input = {
    sessionId: 'session-1',
    replyId: 'reply-7',
    sequence: 3,
    data,
    sampleRate: 24000,
    channels: 1,
    format: 's16le',
    isFinal: false,
    timestampMs: 123456
  };
  const chunk = normalizeVoiceAudioChunk(input);

  assert.deepEqual(Object.keys(chunk).sort(), [
    'channels',
    'data',
    'format',
    'isFinal',
    'replyId',
    'sampleRate',
    'sequence',
    'sessionId',
    'timestampMs'
  ].sort());
  assert.equal(chunk.sampleRate, 24000);
  assert.equal(chunk.channels, 1);
  assert.equal(chunk.format, 's16le');
  assert.equal(chunk.data, data);
});

test('Presence preserves caller-provided sample rate/format and never resamples inside the Presence boundary', () => {
  const { normalizeVoiceAudioChunk } = loadRuntime();
  const chunk = normalizeVoiceAudioChunk({
    sessionId: 'session-2',
    replyId: 'reply-8',
    sequence: 0,
    data: Buffer.from([0, 0, 0, 0]),
    sampleRate: 48000,
    channels: 2,
    format: 'float32',
    isFinal: true,
    timestampMs: 223344
  });

  assert.equal(chunk.sampleRate, 48000);
  assert.equal(chunk.channels, 2);
  assert.equal(chunk.format, 'float32');
  assert.equal(chunk.isFinal, true);

  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.doesNotMatch(source, /CosyVoice|SenseVoice|16000|16_?000|resampl/iu, 'Presence must not bind Voice implementation or perform sample-rate conversion');
});

test('invalid AudioChunk metadata fails closed instead of silently coercing media semantics', () => {
  const { normalizeVoiceAudioChunk } = loadRuntime();
  assert.throws(
    () => normalizeVoiceAudioChunk({
      sessionId: 'session-3',
      replyId: 'reply-9',
      sequence: 1,
      data: Buffer.from([1, 2]),
      sampleRate: 0,
      channels: 0,
      format: 'mp3',
      isFinal: false,
      timestampMs: 1
    }),
    error => error?.reasonCode === 'PRESENCE_AUDIO_CHUNK_INVALID'
  );
});
