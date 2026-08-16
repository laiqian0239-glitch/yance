'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PATHS } = require('../config');
const modelRegistry = require('./modelRegistry');
const modelBrainProjection = require('./modelBrainProjection');
const modelBrainRuntime = require('./modelBrainRuntime');

function clean(value) { return String(value == null ? '' : value).trim(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeStableJson(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return file;
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
  return file;
}
function writeContentAddressedJson(directory, baseName, value) {
  const serialized = stable(value);
  const hash = crypto.createHash('sha256').update(serialized).digest('hex');
  const file = path.join(directory, `${baseName}-${hash.slice(0, 24)}.json`);
  return writeStableJson(file, value);
}
function fileManifest(root, relativeFiles) {
  return relativeFiles.map(relative => {
    const file = path.resolve(root, relative);
    if (!fs.existsSync(file)) return { relative, missing: true };
    const stat = fs.statSync(file);
    return { relative, size: stat.size, sha256: sha256File(file) };
  });
}
function safeJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return {}; }
}
function releaseManifestPath(root) {
  const configured = clean(process.env.YANCE_RELEASE_RESOURCES_PATH);
  const candidates = [
    configured ? path.join(configured, 'release-manifest.json') : '',
    clean(process.env.YANCE_RELEASE_MANIFEST_PATH),
    path.join(root, 'resources', 'release-manifest.json'),
    path.join(root, '.tmp', 'source-uat-resources', 'release-manifest.json')
  ].filter(Boolean);
  return candidates.find(file => fs.existsSync(file)) || path.join(root, 'package.json');
}
function modelBrainSnapshot(registry = modelRegistry) {
  const state = registry?.read?.() || {};
  const runtime = modelBrainRuntime.status();
  const models = (Array.isArray(state.models) ? state.models : [])
    .map(model => modelBrainProjection.projectModel(model))
    .map(model => ({
      id: clean(model.id),
      provider: clean(model.provider),
      name: clean(model.name),
      enabled: model.enabled !== false,
      qualification: clean(model.qualification),
      sourceType: clean(model.sourceType),
      modalities: Array.isArray(model.capabilities?.modalities) ? [...model.capabilities.modalities].sort() : [],
      languages: Array.isArray(model.capabilities?.language) ? [...model.capabilities.language].sort() : [],
      contextLength: Number(model.capabilities?.context || 0),
      privacy: clean(model.capabilities?.privacy) ? [clean(model.capabilities.privacy)] : [],
      tags: Array.isArray(model.tags) ? [...model.tags].sort() : []
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const lastEvidence = runtime.lastEvidence && typeof runtime.lastEvidence === 'object'
    ? {
        selectedModel: clean(runtime.lastEvidence.selectedModel),
        provider: clean(runtime.lastEvidence.provider),
        latencyMs: Number(runtime.lastEvidence.latencyMs || 0),
        inputTokens: Number(runtime.lastEvidence.inputTokens || 0),
        outputTokens: Number(runtime.lastEvidence.outputTokens || 0),
        costUsd: Number(runtime.lastEvidence.costUsd || 0),
        retryCount: Number(runtime.lastEvidence.retryCount || 0)
      }
    : null;
  return {
    schemaVersion: 2,
    authority: 'Model Brain / LiteLLM',
    litellm: 'LiteLLM v1.95.0',
    complexityRouter: 'LiteLLM ComplexityRouter',
    strictTagFiltering: { enabled: true, matchAny: false, semantics: 'AND', failClosed: true },
    hardEligibility: {
      dimensions: ['privacy/local-cloud', 'modality', 'language/native-register', 'context length', 'explicit provider allow/deny'],
      local: models.filter(model => model.sourceType === 'local').length,
      cloud: models.filter(model => model.sourceType === 'cloud').length,
      verified: models.filter(model => model.qualification === 'verified').length
    },
    runtime: { health: clean(runtime.health) || 'unavailable', available: runtime.runtimeAvailable === true },
    executionEvidence: lastEvidence,
    models
  };
}

class RuntimeArtifactBootstrapService {
  constructor(options = {}) {
    this.registry = options.registry;
    this.root = path.resolve(options.root || process.env.YANCE_APP_ROOT || path.join(__dirname, '..', '..'));
    this.cacheRoot = path.resolve(options.cacheRoot || path.join(PATHS.cache, 'runtime-artifacts'));
    this.modelRegistry = options.modelRegistry || modelRegistry;
    this.logger = options.logger || console;
    this.lastResult = null;
  }

  descriptors() {
    const root = this.root;
    const releaseFile = releaseManifestPath(root);
    const release = safeJson(releaseFile);
    const version = clean(release.productVersion || release.version || safeJson(path.join(root, 'package.json')).version);
    const releaseId = clean(release.buildId || release.sourceCommit || release.gitCommit);
    const generatedRoot = this.cacheRoot;
    const adapterManifest = writeContentAddressedJson(generatedRoot, 'platform-adapter', {
      schemaVersion: 1,
      files: fileManifest(root, [
        'backend/services/facebookAdapter.js',
        'backend/services/whatsappAdapter.js',
        'backend/services/telegramAdapter.js',
        'backend/services/platformCapabilities.js',
        'backend/services/platformMessagingService.js'
      ])
    });
    const modelBrainManifest = writeContentAddressedJson(generatedRoot, 'ai-routing', modelBrainSnapshot(this.modelRegistry));
    return [
      { type: 'application', rootPath: releaseFile, version, releaseId, critical: true, source: 'verified-release-manifest' },
      { type: 'frontend-static', rootPath: path.join(root, 'frontend'), version, releaseId, critical: true, source: 'runtime-source' },
      { type: 'platform-adapter', rootPath: adapterManifest, version, releaseId, critical: true, source: 'generated-runtime-manifest' },
      { type: 'facebook-web-companion', rootPath: path.join(root, 'tools', 'facebook-business-suite-avatar-importer'), version, releaseId, critical: false, source: 'runtime-source' },
      { type: 'ai-routing', rootPath: modelBrainManifest, version, releaseId, critical: true, source: 'generated-model-brain-snapshot' },
      { type: 'persona-assets', rootPath: path.join(root, 'backend', 'persona', 'presets'), version, releaseId, critical: true, source: 'runtime-source' },
      { type: 'theme-catalog', rootPath: path.join(root, 'frontend', 'theme-catalog.json'), version, releaseId, critical: true, source: 'runtime-source' },
      { type: 'notification-sound-catalog', rootPath: path.join(root, 'frontend', 'assets', 'sounds'), version, releaseId, critical: true, source: 'runtime-source' }
    ];
  }

  async bootstrap() {
    if (!this.registry || typeof this.registry.registerCurrent !== 'function') {
      this.lastResult = { ok: false, reasonCode: 'ARTIFACT_REGISTRY_UNAVAILABLE', registered: [], skipped: [], failures: [] };
      return this.lastResult;
    }
    const registered = [];
    const skipped = [];
    const failures = [];
    for (const descriptor of this.descriptors()) {
      if (!fs.existsSync(descriptor.rootPath)) {
        const row = { type: descriptor.type, rootPath: descriptor.rootPath, reasonCode: 'ARTIFACT_ROOT_MISSING', critical: descriptor.critical === true };
        if (descriptor.critical) failures.push(row); else skipped.push(row);
        continue;
      }
      try {
        const result = await this.registry.registerCurrent(descriptor);
        registered.push({ type: descriptor.type, artifactId: result.current?.artifactId || '', sha256: result.current?.sha256 || '', changed: result.changed === true });
      } catch (error) {
        failures.push({ type: descriptor.type, reasonCode: clean(error?.code || 'ARTIFACT_BOOTSTRAP_FAILED'), message: clean(error?.message), critical: descriptor.critical === true });
      }
    }
    this.lastResult = {
      ok: failures.every(row => row.critical !== true),
      registered,
      skipped,
      failures,
      fingerprint: crypto.createHash('sha256').update(stable(registered.map(row => ({ type: row.type, sha256: row.sha256 })))).digest('hex')
    };
    return this.lastResult;
  }

  snapshot() { return this.lastResult; }
}

module.exports = { RuntimeArtifactBootstrapService, modelBrainSnapshot, fileManifest, writeStableJson, writeContentAddressedJson, releaseManifestPath };
