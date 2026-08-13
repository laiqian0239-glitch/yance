'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('legacy Whisper ASR discovery and execution authority is retired at source', () => {
  const transcription = read('backend/services/transcriptionService.js');

  assert.match(transcription, /SenseVoice/iu, 'transcriptionService must name SenseVoice as the ASR authority');
  assert.doesNotMatch(
    transcription,
    /YANCE_WHISPER_(?:MODEL|COMMAND)|whisper-cpp|openai-whisper-cli|discoverModel|discoverEngine|executeEngine/iu,
    'legacy Whisper model, command, discovery and execution authority must be removed'
  );

  assert.match(transcription, /\brunCommand\b/u, 'generic process helper must remain available to existing Media consumers');
  assert.match(transcription, /\bdiscoverFfmpeg\b/u, 'generic FFmpeg discovery must remain available to existing Media consumers');
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
    'backend/services/speechInstallerService.js'
  ].map(read).join('\n');

  assert.doesNotMatch(
    authorizedProductFiles,
    /vosk|coqui|piper|espeak|festival|speechrecognition|google-cloud-speech|azure.*speech/iu,
    'Voice cutover must use the authorized mature OSS authorities instead of a second speech engine'
  );
});
