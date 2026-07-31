'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PATHS } = require('../config');
const modelRegistry = require('./modelRegistry');

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
function routingSnapshot(registry = modelRegistry) {
  const state = registry?.read?.() || {};
  const models = (Array.isArray(state.models) ? state.models : []).map(model => ({
    id: clean(model.id),
    provider: clean(model.provider),
    name: clean(model.name),
    enabled: model.enabled !== false,
    available: model.available !== false,
    qualification: clean(model.qualification),
    allowedTasks: Array.isArray(model.allowedTasks) ? [...model.allowedTasks].sort() : [],
    capabilityClass: clean(model.capabilityClass || model.catalogMetadata?.capabilityClass),
    commercialBenchmarkScore: Number(model.commercialBenchmark?.score || model.commercialScore || 0)
  })).sort((a, b) => a.id.localeCompare(b.id));
  const routes = Object.fromEntries(Object.entries(state.routes && typeof state.routes === 'object' ? state.routes : {}).sort(([a], [b]) => a.localeCompare(b)).map(([task, route]) => [task, {
    enabled: route?.enabled !== false,
    primaryModelId: clean(route?.primaryModelId),
    fallbackModelId: clean(route?.fallbackModelId),
    source: clean(route?.source),
    timeoutMs: Number(route?.timeoutMs || 0),
    outputLimit: Number(route?.outputLimit || route?.maxOutputTokens || 0)
  }]));
  return { schemaVersion: 1, models, routes };
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
    const routingManifest = writeContentAddressedJson(generatedRoot, 'ai-routing', routingSnapshot(this.modelRegistry));
    return [
      { type: 'application', rootPath: releaseFile, version, releaseId, critical: true, source: 'verified-release-manifest' },
      { type: 'frontend-static', rootPath: path.join(root, 'frontend'), version, releaseId, critical: true, source: 'runtime-source' },
      { type: 'platform-adapter', rootPath: adapterManifest, version, releaseId, critical: true, source: 'generated-runtime-manifest' },
      { type: 'facebook-web-companion', rootPath: path.join(root, 'tools', 'facebook-business-suite-avatar-importer'), version, releaseId, critical: false, source: 'runtime-source' },
      { type: 'ai-routing', rootPath: routingManifest, version, releaseId, critical: true, source: 'generated-routing-snapshot' },
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

module.exports = { RuntimeArtifactBootstrapService, routingSnapshot, fileManifest, writeStableJson, writeContentAddressedJson, releaseManifestPath };
