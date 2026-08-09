'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('SenseVoice Windows runtime manifest is exact and content-addressed', () => {
  const manifestPath = path.join(ROOT, 'runtime/voice-brain/sensevoice/runtime-manifest.json');
  assert.equal(fs.existsSync(manifestPath), true, 'SenseVoice runtime manifest must exist');
  const text = fs.readFileSync(manifestPath, 'utf8');

  for (const token of [
    'runtime-llamacpp-v0.1.9',
    '73ccdd3577db37e92dbf22a4a9fc323b038cf13b',
    'funasr-llamacpp-windows-x64-avx2.zip',
    'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c',
    'sense-voice-small-q8_0.gguf',
    '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5'
  ]) assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `${token} must be sealed`);
});

test('CosyVoice sealed Python runtime uses the authorized exact toolchain and lock closure', () => {
  for (const file of [
    'runtime/voice-brain/cosyvoice/pyproject.toml',
    'runtime/voice-brain/cosyvoice/uv.lock',
    'runtime/voice-brain/cosyvoice/yance_cosyvoice_entrypoint.py',
    'runtime/voice-brain/cosyvoice/generate_runtime_sbom.py'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);

  const pyproject = read('runtime/voice-brain/cosyvoice/pyproject.toml');
  const lock = read('runtime/voice-brain/cosyvoice/uv.lock');
  const entrypoint = read('runtime/voice-brain/cosyvoice/yance_cosyvoice_entrypoint.py');

  assert.match(pyproject, /3\.10/iu, 'CosyVoice runtime must stay on the pinned Python 3.10 family');
  assert.match(lock, /openai-whisper/iu, 'upstream CosyVoice mel dependency must be explicitly locked');
  assert.match(lock, /20231117/u, 'upstream CosyVoice whisper dependency version must be exact');
  assert.match(entrypoint, /CosyVoice/iu);
  assert.doesNotMatch(entrypoint, /\.transcribe\s*\(/u, 'CosyVoice entrypoint must not use Whisper transcription');
});

test('Windows Voice build is sealed from exact CPython and uv artifacts and produces offline runtime evidence', () => {
  const scriptPath = path.join(ROOT, 'tools/voice-brain/build-windows-runtime.ps1');
  assert.equal(fs.existsSync(scriptPath), true, 'Voice Windows runtime builder must exist');
  const script = fs.readFileSync(scriptPath, 'utf8');

  for (const token of [
    'cpython-3.10.20+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    '53391d9e6401c8f91b97aab6daf49200bce0b6eb41dcc1615031e65e9db8bd63',
    'uv-x86_64-pc-windows-msvc.zip',
    'b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e',
    '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',
    '29e01c4e8d000f4bcd70751be16fa94bf3d85a18'
  ]) assert.match(script, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'), `${token} must be verified by the builder`);

  assert.match(script, /--frozen|--offline/iu);
  assert.match(script, /SBOM|generate_runtime_sbom/iu);
});

test('application startup cannot dynamically install or download Voice dependencies/models', () => {
  const runtimePath = path.join(ROOT, 'electron/voiceBrainRuntime.js');
  assert.equal(fs.existsSync(runtimePath), true, 'Voice runtime must exist');
  const runtime = fs.readFileSync(runtimePath, 'utf8');

  assert.doesNotMatch(
    runtime,
    /pip\s+install|uv\s+sync|git\s+clone|huggingface.*download|snapshot_download|Invoke-WebRequest|curl\s+https?:|wget\s+https?:/iu,
    'Voice application startup must be offline and use sealed artifacts only'
  );
});
