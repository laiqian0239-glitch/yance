'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const runtimePath = path.join(ROOT, 'electron/voiceBrainRuntime.js');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Voice Brain pins exact SenseVoice and CosyVoice upstream identities', () => {
  const configPath = path.join(ROOT, 'config/upstreams/v21-voice-brain-p0.json');
  assert.equal(fs.existsSync(configPath), true, 'Voice upstream configuration must exist');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const text = JSON.stringify(config);

  for (const token of [
    'QwenAudio/SenseVoice',
    'runtime-llamacpp-v0.1.9',
    '73ccdd3577db37e92dbf22a4a9fc323b038cf13b',
    'FunAudioLLM/SenseVoiceSmall-GGUF',
    '90c1c61912018b70ada0fcc024ea24aca62f2e63',
    'QwenAudio/CosyVoice',
    '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',
    'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    '29e01c4e8d000f4bcd70751be16fa94bf3d85a18'
  ]) assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `${token} must be pinned`);

  assert.match(text, /offline/iu, 'runtime policy must declare offline startup');
});

test('Voice runtime exposes one thin product adapter for ASR, enrollment and cloned speech generation', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'electron/voiceBrainRuntime.js must exist');
  const source = fs.readFileSync(runtimePath, 'utf8');

  for (const method of [
    'health',
    'transcribe',
    'enrollVoiceProfile',
    'deleteVoiceProfile',
    'generateSpeech',
    'projectVoiceOutput'
  ]) assert.match(source, new RegExp(method, 'u'), `${method} must be part of the Voice runtime contract`);

  assert.match(source, /SenseVoice/iu);
  assert.match(source, /CosyVoice/iu);
  assert.doesNotMatch(source, /CREATE TABLE|better-sqlite3|express\(|fastify\(|koa\(|new WebSocketServer/iu, 'Voice runtime must stay a thin adapter, not a new framework/server');
});

test('Presence-facing VoiceOutput is a frozen minimal projection', () => {
  assert.equal(fs.existsSync(runtimePath), true, 'Voice runtime must exist');
  const { projectVoiceOutput } = require(runtimePath);
  assert.equal(typeof projectVoiceOutput, 'function');

  const output = projectVoiceOutput({
    audioArtifact: 'C:\\voice\\reply.wav',
    mimeType: 'audio/wav',
    duration: 1.25,
    sampleRate: 24000,
    language: 'de',
    voiceProfileId: 'vp-local-1',
    provenance: { authority: 'CosyVoice' },
    internalCommand: 'secret',
    rawPromptSample: 'must-not-leak'
  });

  assert.deepEqual(
    Object.keys(output).sort(),
    ['audioArtifact', 'duration', 'language', 'mimeType', 'provenance', 'sampleRate', 'voiceProfileId'].sort()
  );
  assert.equal(output.provenance.authority, 'CosyVoice');
  assert.equal('internalCommand' in output, false);
  assert.equal('rawPromptSample' in output, false);
});

test('Voice runtime keeps enrollment local/private and requires explicit deletion support', () => {
  const source = read('electron/voiceBrainRuntime.js');

  assert.match(source, /voiceProfile|profile/iu);
  assert.match(source, /deleteVoiceProfile/u);
  assert.match(source, /local|private/iu);
  assert.doesNotMatch(source, /upload.*voice.*sample|voice.*sample.*upload/iu, 'voice samples must not be uploaded to a cloud service without separate authority');
});
