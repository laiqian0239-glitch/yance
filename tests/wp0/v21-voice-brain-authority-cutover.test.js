'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('legacy Whisper ASR authority is retired while the wrapper delegates physical Voice Brain ownership to core', () => {
  const wrapper = read('backend/services/transcriptionService.js');
  const core = read('backend/services/transcriptionServiceCore.js');

  assert.match(wrapper, /require\('\.\/transcriptionServiceCore'\)/u, 'transcriptionService wrapper must delegate to the canonical core');
  assert.match(wrapper, /asynchronousServiceBoundary/u, 'wrapper must preserve the asynchronous service boundary');
  assert.match(wrapper, /executePersistedTranscription/u, 'wrapper must expose only persisted physical execution');
  assert.doesNotMatch(wrapper, /spawn\s*\(|spawnSync\s*\(|SENSEVOICE_EXECUTABLE|SENSEVOICE_MODEL/u, 'wrapper must not duplicate physical ASR authority');

  assert.match(core, /SenseVoice/iu, 'transcriptionServiceCore must name SenseVoice as the ASR authority');
  assert.match(core, /persistedTranscriptionAttempt/u, 'physical transcription must validate a persisted WP-B attempt');
  assert.match(core, /executePersistedTranscription/u, 'core must expose persisted physical execution');
  assert.doesNotMatch(
    `${wrapper}\n${core}`,
    /YANCE_WHISPER_(?:MODEL|COMMAND)|whisper-cpp|openai-whisper-cli|discoverModel|discoverEngine|executeEngine/iu,
    'legacy Whisper model, command, discovery and execution authority must remain removed'
  );

  assert.match(core, /\brunCommand\b/u, 'generic process helper must remain available to existing Media consumers');
  assert.match(core, /\bdiscoverFfmpeg\b/u, 'generic FFmpeg discovery must remain available to existing Media consumers');
});

test('speech installer no longer launches or owns the legacy Whisper installer', () => {
  const installer = read('backend/services/speechInstallerService.js');

  assert.doesNotMatch(installer, /install-local-whisper\.ps1|powershell\.exe|YANCE_WHISPER_/iu);
  assert.match(installer, /voice[- ]brain|voiceBrain|Voice Brain/iu, 'installer facade must report the sealed Voice Brain runtime');
  assert.match(installer, /status/iu, 'installer facade must retain a status projection');
});

test('Voice source does not recreate a fallback ASR or TTS engine', () => {
  const authorizedProductFiles = [
    'backend/services/transcriptionService.js',
    'backend/services/transcriptionServiceCore.js',
    'backend/services/speechInstallerService.js'
  ].map(read).join('\n');

  assert.doesNotMatch(
    authorizedProductFiles,
    /vosk|coqui|piper|espeak|festival|speechrecognition|google-cloud-speech|azure.*speech/iu,
    'Voice cutover must use the authorized mature OSS authorities instead of a second speech engine'
  );
});
