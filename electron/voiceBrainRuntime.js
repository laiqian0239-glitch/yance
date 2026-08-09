'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const VOICE_OUTPUT_FIELDS = Object.freeze([
  'audioArtifact', 'mimeType', 'duration', 'sampleRate', 'language', 'voiceProfileId', 'provenance'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function voiceError(reasonCode, message, details = {}) {
  return Object.assign(new Error(message), { code: reasonCode, reasonCode, details });
}
function safeId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id)) throw voiceError('VOICE_PROFILE_ID_INVALID', 'Voice profile id is invalid.');
  return id;
}
function safeLanguage(value) {
  const language = clean(value).toLowerCase() || 'auto';
  if (language !== 'auto' && language !== 'yue' && !/^[a-z]{2,12}(?:-[a-z0-9]{2,12})?$/u.test(language)) {
    throw voiceError('VOICE_LANGUAGE_INVALID', 'Voice language is invalid.');
  }
  return language;
}
function firstExisting(files) {
  return files.find(file => { try { return fs.statSync(file).isFile(); } catch (_) { return false; } }) || '';
}
function firstExistingDirectory(files) {
  return files.find(file => { try { return fs.statSync(file).isDirectory(); } catch (_) { return false; } }) || '';
}
function assertFile(file, reasonCode, label) {
  const resolved = path.resolve(clean(file));
  try { if (fs.statSync(resolved).isFile()) return resolved; } catch (_) {}
  throw voiceError(reasonCode, `${label} is unavailable.`, { file: resolved });
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw voiceError('VOICE_PROFILE_METADATA_INVALID', 'Voice profile metadata is invalid.', { file, cause: error.message });
  }
}
function projectVoiceOutput(input = {}) {
  const projected = {};
  for (const field of VOICE_OUTPUT_FIELDS) projected[field] = input[field];
  return Object.freeze(projected);
}

function createVoiceBrainRuntime(options = {}) {
  const dataRoot = path.resolve(clean(options.dataRoot) || clean(process.env.YANCE_DATA_DIR) || path.join(os.homedir(), '.yance'));
  const appRoot = path.resolve(clean(options.appRoot) || path.join(__dirname, '..'));
  const runtimeRoot = path.resolve(clean(options.runtimeRoot) || clean(process.env.YANCE_VOICE_BRAIN_RUNTIME_DIR) || path.join(appRoot, 'runtime', 'voice-brain'));
  const spawnImpl = options.spawnImpl || spawn;
  const transcribeImpl = options.transcribeImpl || (input => require('../backend/services/transcriptionService').transcribe(input));
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
  const profileRoot = path.join(dataRoot, 'voice-brain', 'profiles');
  const generatedRoot = path.join(dataRoot, 'voice-brain', 'generated');

  function resolveCosyVoiceLayout() {
    const pythonName = process.platform === 'win32' ? 'python.exe' : 'python';
    const python = firstExisting([
      path.join(runtimeRoot, 'cosyvoice', 'python', pythonName),
      path.join(runtimeRoot, 'cosyvoice', 'runtime', pythonName),
      path.join(runtimeRoot, 'python', pythonName)
    ]);
    const sourceDir = firstExistingDirectory([
      path.join(runtimeRoot, 'cosyvoice', 'source'),
      path.join(runtimeRoot, 'source', 'cosyvoice')
    ]);
    const modelDir = firstExistingDirectory([
      path.join(runtimeRoot, 'cosyvoice', 'models', 'Fun-CosyVoice3-0.5B-2512'),
      path.join(runtimeRoot, 'cosyvoice', 'model', 'Fun-CosyVoice3-0.5B-2512'),
      path.join(runtimeRoot, 'models', 'Fun-CosyVoice3-0.5B-2512')
    ]);
    const entrypoint = firstExisting([
      path.join(runtimeRoot, 'cosyvoice', 'yance_cosyvoice_entrypoint.py'),
      path.join(appRoot, 'runtime', 'voice-brain', 'cosyvoice', 'yance_cosyvoice_entrypoint.py')
    ]);
    return Object.freeze({
      authority: 'CosyVoice', python, sourceDir, modelDir, entrypoint,
      available: Boolean(python && sourceDir && modelDir && entrypoint)
    });
  }

  function profilePaths(profileId) {
    const id = safeId(profileId);
    const directory = path.join(profileRoot, id);
    return Object.freeze({ id, directory, metadata: path.join(directory, 'profile.json'), sample: path.join(directory, 'prompt.wav') });
  }
  function readProfile(profileId) {
    const locations = profilePaths(profileId);
    const metadata = readJson(locations.metadata);
    if (!metadata) throw voiceError('VOICE_PROFILE_NOT_FOUND', 'Local voice profile was not found.', { voiceProfileId: locations.id });
    assertFile(locations.sample, 'VOICE_PROFILE_SAMPLE_MISSING', 'Local/private voice profile sample');
    return Object.freeze({ ...metadata, samplePath: locations.sample });
  }

  async function health() {
    const cosyVoice = resolveCosyVoiceLayout();
    let senseVoice;
    try { senseVoice = require('../backend/services/transcriptionService').engineStatus(); }
    catch (error) { senseVoice = { authority: 'SenseVoice', available: false, reasonCode: clean(error.code) || 'SENSEVOICE_STATUS_UNAVAILABLE' }; }
    const available = senseVoice.available === true && cosyVoice.available === true;
    return Object.freeze({
      available, degraded: !available, localPrivateProfiles: true,
      authorities: { asr: 'SenseVoice', tts: 'CosyVoice' }, senseVoice, cosyVoice,
      reasonCode: !senseVoice.available ? clean(senseVoice.reasonCode) || 'SENSEVOICE_RUNTIME_MISSING' : !cosyVoice.available ? 'COSYVOICE_RUNTIME_MISSING' : ''
    });
  }
  async function transcribe(input = {}) {
    return transcribeImpl({
      filePath: input.filePath,
      language: safeLanguage(input.language || 'auto'),
      translateToChinese: input.translateToChinese === true
    });
  }
  async function enrollVoiceProfile(input = {}) {
    const samplePath = assertFile(input.samplePath, 'VOICE_PROFILE_SAMPLE_REQUIRED', 'Voice profile sample');
    const voiceProfileId = safeId(input.voiceProfileId || `voice-${randomUUID()}`);
    const locations = profilePaths(voiceProfileId);
    if (fs.existsSync(locations.directory)) throw voiceError('VOICE_PROFILE_ALREADY_EXISTS', 'Voice profile already exists.', { voiceProfileId });
    fs.mkdirSync(locations.directory, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(samplePath, locations.sample);
      try { fs.chmodSync(locations.sample, 0o600); } catch (_) {}
      let promptText = clean(input.promptText);
      let sampleLanguage = safeLanguage(input.language || 'auto');
      if (!promptText) {
        const result = await transcribe({ filePath: locations.sample, language: sampleLanguage, translateToChinese: false });
        promptText = clean(result.transcript);
        sampleLanguage = clean(result.detectedLanguage || result.language || sampleLanguage).toLowerCase() || sampleLanguage;
      }
      if (!promptText) throw voiceError('VOICE_PROFILE_PROMPT_EMPTY', 'SenseVoice did not produce prompt text for the local voice profile.');
      const metadata = {
        schemaVersion: 1, voiceProfileId, label: clean(input.label).slice(0, 160) || 'My voice',
        storage: 'local-private', sampleLanguage, promptText, createdAt: now()
      };
      atomicWriteJson(locations.metadata, metadata);
      return Object.freeze({ ...metadata, samplePath: locations.sample, local: true, private: true });
    } catch (error) {
      fs.rmSync(locations.directory, { recursive: true, force: true });
      throw error;
    }
  }
  function deleteVoiceProfile(input = {}) {
    const locations = profilePaths(input.voiceProfileId);
    const existed = fs.existsSync(locations.directory);
    fs.rmSync(locations.directory, { recursive: true, force: true });
    return Object.freeze({ ok: true, voiceProfileId: locations.id, deleted: existed, local: true, private: true });
  }

  function runCosyVoice(payload, timeoutMs = 180000) {
    const layout = resolveCosyVoiceLayout();
    if (!layout.available) throw voiceError('COSYVOICE_RUNTIME_MISSING', 'CosyVoice sealed runtime/source/model is unavailable.', { runtimeRoot });
    return new Promise((resolve, reject) => {
      const child = spawnImpl(layout.python, [layout.entrypoint, '--model-dir', layout.modelDir, '--source-dir', layout.sourceDir], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: '' }
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (callback, value) => { if (settled) return; settled = true; clearTimeout(timer); callback(value); };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        finish(reject, voiceError('COSYVOICE_TIMEOUT', 'CosyVoice generation timed out.'));
      }, Math.max(1000, Number(timeoutMs || 180000)));
      child.stdout.on('data', chunk => { stdout += String(chunk); });
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.on('error', error => finish(reject, error));
      child.on('close', code => {
        if (code !== 0) return finish(reject, voiceError('COSYVOICE_GENERATION_FAILED', stderr.trim() || `CosyVoice exited with code ${code}.`));
        try { finish(resolve, JSON.parse(stdout.trim())); }
        catch (error) { finish(reject, voiceError('COSYVOICE_RESPONSE_INVALID', 'CosyVoice returned invalid JSON.', { cause: error.message })); }
      });
      child.stdin.end(`${JSON.stringify(payload)}\n`, 'utf8');
    });
  }
  async function generateSpeech(input = {}) {
    const text = clean(input.text);
    if (!text || text.length > 20000) throw voiceError('VOICE_TEXT_INVALID', 'Speech text is required and must be at most 20,000 characters.');
    const profile = readProfile(input.voiceProfileId);
    const language = safeLanguage(input.language || 'auto');
    fs.mkdirSync(generatedRoot, { recursive: true, mode: 0o700 });
    const audioArtifact = path.join(generatedRoot, `${Date.now()}-${randomUUID()}.wav`);
    const result = await runCosyVoice({
      operation: 'generate', text, language, outputPath: audioArtifact,
      promptAudio: profile.samplePath, promptText: profile.promptText || '', sampleLanguage: profile.sampleLanguage || 'auto'
    }, Number(input.timeoutMs || 180000));
    assertFile(audioArtifact, 'COSYVOICE_OUTPUT_MISSING', 'Generated voice artifact');
    try { fs.chmodSync(audioArtifact, 0o600); } catch (_) {}
    return projectVoiceOutput({
      audioArtifact, mimeType: 'audio/wav', duration: Number(result.duration || 0), sampleRate: Number(result.sampleRate || 0),
      language: clean(result.language || language), voiceProfileId: profile.voiceProfileId,
      provenance: Object.freeze({ authority: 'CosyVoice', mode: clean(result.mode) || 'cross-lingual-zero-shot', sourceCommit: '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc', modelRevision: '29e01c4e8d000f4bcd70751be16fa94bf3d85a18' })
    });
  }

  return Object.freeze({ health, transcribe, enrollVoiceProfile, deleteVoiceProfile, generateSpeech, projectVoiceOutput, resolveCosyVoiceLayout });
}

module.exports = { createVoiceBrainRuntime, projectVoiceOutput, VOICE_OUTPUT_FIELDS };
