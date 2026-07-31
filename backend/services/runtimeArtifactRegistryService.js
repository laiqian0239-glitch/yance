'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARTIFACT_TYPES = Object.freeze([
  'application', 'frontend-static', 'platform-adapter', 'facebook-web-companion',
  'ai-routing', 'persona-assets', 'theme-catalog', 'notification-sound-catalog'
]);

function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function nowIso(clock) { return (clock || (() => new Date().toISOString()))(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      position += read;
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function enumerateFiles(root) {
  const absolute = path.resolve(root);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [{ relative: path.basename(absolute), path: absolute, size: stat.size, sha256: hashFile(absolute) }];
  const rows = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const fileStat = fs.statSync(full);
        rows.push({ relative: path.relative(absolute, full).replaceAll(path.sep, '/'), path: full, size: fileStat.size, sha256: hashFile(full) });
      }
    }
  };
  walk(absolute);
  return rows;
}
function artifactIdentity(root) {
  const files = enumerateFiles(root);
  const sha256 = crypto.createHash('sha256').update(stable(files.map(row => ({ relative: row.relative, size: row.size, sha256: row.sha256 })))).digest('hex');
  return { rootPath: path.resolve(root), sha256, fileCount: files.length, totalBytes: files.reduce((sum, row) => sum + row.size, 0), files };
}
function healthSummary(report = {}) {
  const checks = array(report.checks);
  const criticalFailures = checks.filter(row => row?.critical !== false && row?.pass !== true);
  return { pass: report.pass === true && criticalFailures.length === 0, checks, criticalFailures };
}
function defaultDocument() {
  return { schemaVersion: 1, current: {}, lastKnownGood: {}, candidates: {}, history: [], pendingApply: {} };
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

class RuntimeArtifactRegistryService {
  constructor(options = {}) {
    this.store = options.store;
    this.clock = options.clock || (() => new Date().toISOString());
    this.pointerPath = path.resolve(options.pointerPath || process.env.YANCE_RUNTIME_ARTIFACT_POINTER || path.join(process.cwd(), 'data', 'runtime', 'runtime-artifact-selection.json'));
    if (!this.store || typeof this.store.read !== 'function' || typeof this.store.updateAsync !== 'function') throw new TypeError('artifact registry store is required');
  }

  snapshot() { return this.store.read(); }

  async registerCurrent(input = {}) {
    const type = clean(input.type);
    if (!ARTIFACT_TYPES.includes(type)) throw Object.assign(new Error(`Unsupported artifact type: ${type}`), { code: 'ARTIFACT_TYPE_UNSUPPORTED' });
    const identity = artifactIdentity(input.rootPath);
    if (clean(input.expectedSha256) && clean(input.expectedSha256).toLowerCase() !== identity.sha256.toLowerCase()) {
      throw Object.assign(new Error('Artifact SHA256 does not match the expected identity'), { code: 'ARTIFACT_HASH_MISMATCH', expected: clean(input.expectedSha256), actual: identity.sha256 });
    }
    const timestamp = nowIso(this.clock);
    const before = this.snapshot();
    const beforeCurrent = object(before.current)[type] || null;
    const changed = !beforeCurrent || clean(beforeCurrent.sha256) !== identity.sha256;
    const artifactId = clean(input.artifactId) || `${type}:${identity.sha256.slice(0, 24)}`;
    const row = {
      artifactId,
      type,
      version: clean(input.version),
      releaseId: clean(input.releaseId),
      source: clean(input.source || 'runtime-observed'),
      ...identity,
      status: 'current',
      observedAt: timestamp,
      metadata: object(input.metadata)
    };
    const state = await this.store.updateAsync(currentRaw => {
      const document = { ...defaultDocument(), ...object(currentRaw) };
      const previous = object(document.current)[type] || null;
      if (previous && clean(previous.sha256) === identity.sha256) {
        document.current = {
          ...object(document.current),
          [type]: {
            ...previous,
            ...row,
            artifactId: previous.artifactId || artifactId,
            registeredAt: previous.registeredAt || previous.observedAt || timestamp,
            observedAt: timestamp
          }
        };
        return document;
      }
      document.current = {
        ...object(document.current),
        [type]: { ...row, registeredAt: timestamp }
      };
      if (previous) {
        document.lastKnownGood = {
          ...object(document.lastKnownGood),
          [type]: { ...previous, status: 'last-known-good', markedAt: timestamp }
        };
      }
      document.history = [{
        action: previous ? 'runtime-current-changed' : 'runtime-current-registered',
        artifactId,
        type,
        previousArtifactId: previous?.artifactId || '',
        at: timestamp,
        sha256: identity.sha256
      }, ...array(document.history)].slice(0, 500);
      return document;
    });
    this.writePointer(state);
    return {
      current: state.current[type],
      lastKnownGood: state.lastKnownGood[type] || null,
      changed
    };
  }

  async registerCandidate(input = {}) {
    const type = clean(input.type);
    if (!ARTIFACT_TYPES.includes(type)) throw Object.assign(new Error(`Unsupported artifact type: ${type}`), { code: 'ARTIFACT_TYPE_UNSUPPORTED' });
    const identity = artifactIdentity(input.rootPath);
    if (clean(input.expectedSha256) && clean(input.expectedSha256).toLowerCase() !== identity.sha256.toLowerCase()) {
      throw Object.assign(new Error('Artifact SHA256 does not match the expected identity'), { code: 'ARTIFACT_HASH_MISMATCH', expected: clean(input.expectedSha256), actual: identity.sha256 });
    }
    const timestamp = nowIso(this.clock);
    const artifactId = clean(input.artifactId) || `${type}:${identity.sha256.slice(0, 24)}`;
    const row = {
      artifactId, type, version: clean(input.version), releaseId: clean(input.releaseId), source: clean(input.source || 'candidate'),
      ...identity, status: 'verified-candidate', registeredAt: timestamp, metadata: object(input.metadata)
    };
    return this.store.updateAsync(currentRaw => {
      const current = { ...defaultDocument(), ...object(currentRaw) };
      current.candidates = { ...object(current.candidates), [artifactId]: row };
      current.history = [{ action: 'candidate-registered', artifactId, type, at: timestamp, sha256: identity.sha256 }, ...array(current.history)].slice(0, 500);
      return current;
    }).then(() => row);
  }

  async promoteCandidate(artifactId, report = {}) {
    const id = clean(artifactId);
    const current = this.snapshot();
    const candidate = object(current.candidates)[id];
    if (!candidate) throw Object.assign(new Error('Artifact candidate was not found'), { code: 'ARTIFACT_CANDIDATE_NOT_FOUND' });
    const verification = artifactIdentity(candidate.rootPath);
    if (verification.sha256 !== candidate.sha256) throw Object.assign(new Error('Artifact changed after registration'), { code: 'ARTIFACT_CHANGED_AFTER_REGISTRATION' });
    const health = healthSummary(report);
    if (!health.pass) throw Object.assign(new Error('Artifact cannot be promoted because critical capability probes failed'), { code: 'ARTIFACT_HEALTH_GATE_FAILED', health });
    const timestamp = nowIso(this.clock);
    const state = await this.store.updateAsync(currentRaw => {
      const document = { ...defaultDocument(), ...object(currentRaw) };
      const previous = object(document.current)[candidate.type] || null;
      document.current = { ...object(document.current), [candidate.type]: { ...candidate, status: 'current', promotedAt: timestamp, health } };
      if (previous) document.lastKnownGood = { ...object(document.lastKnownGood), [candidate.type]: { ...previous, status: 'last-known-good', markedAt: timestamp } };
      document.pendingApply = { ...object(document.pendingApply), [candidate.type]: { artifactId: candidate.artifactId, action: 'activate', requestedAt: timestamp, requiresRestart: ['application', 'frontend-static', 'platform-adapter', 'facebook-web-companion'].includes(candidate.type) } };
      document.history = [{ action: 'candidate-promoted', artifactId: id, type: candidate.type, previousArtifactId: previous?.artifactId || '', at: timestamp, health }, ...array(document.history)].slice(0, 500);
      return document;
    });
    this.writePointer(state);
    return { current: state.current[candidate.type], lastKnownGood: state.lastKnownGood[candidate.type] || null, pendingApply: state.pendingApply[candidate.type] };
  }

  async rollback(type, options = {}) {
    const target = clean(type);
    if (!ARTIFACT_TYPES.includes(target)) throw Object.assign(new Error(`Unsupported artifact type: ${target}`), { code: 'ARTIFACT_TYPE_UNSUPPORTED' });
    const timestamp = nowIso(this.clock);
    const state = await this.store.updateAsync(currentRaw => {
      const document = { ...defaultDocument(), ...object(currentRaw) };
      const fallback = object(document.lastKnownGood)[target];
      if (!fallback) throw Object.assign(new Error('No last-known-good artifact is available'), { code: 'ARTIFACT_LKG_MISSING' });
      const verification = artifactIdentity(fallback.rootPath);
      if (verification.sha256 !== fallback.sha256) throw Object.assign(new Error('Last-known-good artifact failed hash verification'), { code: 'ARTIFACT_LKG_HASH_MISMATCH' });
      const previous = object(document.current)[target] || null;
      document.current = { ...object(document.current), [target]: { ...fallback, status: 'current', rolledBackAt: timestamp, rollbackReason: clean(options.reason || 'capability-health-failed') } };
      document.pendingApply = { ...object(document.pendingApply), [target]: { artifactId: fallback.artifactId, action: 'rollback', requestedAt: timestamp, requiresRestart: ['application', 'frontend-static', 'platform-adapter', 'facebook-web-companion'].includes(target) } };
      document.history = [{ action: 'artifact-rollback', type: target, fromArtifactId: previous?.artifactId || '', artifactId: fallback.artifactId, reason: clean(options.reason), at: timestamp }, ...array(document.history)].slice(0, 500);
      return document;
    });
    this.writePointer(state);
    return { current: state.current[target], pendingApply: state.pendingApply[target] };
  }

  async acknowledgeApplied(type, artifactId) {
    const target = clean(type);
    const id = clean(artifactId);
    const timestamp = nowIso(this.clock);
    return this.store.updateAsync(currentRaw => {
      const document = { ...defaultDocument(), ...object(currentRaw) };
      const pending = object(document.pendingApply)[target];
      if (!pending || clean(pending.artifactId) !== id) return document;
      document.pendingApply = { ...object(document.pendingApply) };
      delete document.pendingApply[target];
      document.history = [{ action: 'artifact-apply-acknowledged', type: target, artifactId: id, at: timestamp }, ...array(document.history)].slice(0, 500);
      return document;
    });
  }

  writePointer(state = this.snapshot()) {
    atomicWriteJson(this.pointerPath, {
      schemaVersion: 1,
      generatedAt: nowIso(this.clock),
      current: Object.fromEntries(Object.entries(object(state.current)).map(([type, row]) => [type, { artifactId: row.artifactId, version: row.version, releaseId: row.releaseId, rootPath: row.rootPath, sha256: row.sha256 }])),
      pendingApply: object(state.pendingApply)
    });
  }
}

let singleton = null;
function getRuntimeArtifactRegistryService() {
  if (!singleton) {
    const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');
    const { PATHS } = require('../config');
    singleton = new RuntimeArtifactRegistryService({
      store: new SqliteDocumentStore('runtime-artifact-registry', defaultDocument()),
      pointerPath: path.join(PATHS.cache, 'runtime-artifacts', 'runtime-artifact-selection.json')
    });
  }
  return singleton;
}

module.exports = {
  ARTIFACT_TYPES,
  RuntimeArtifactRegistryService,
  getRuntimeArtifactRegistryService,
  artifactIdentity,
  healthSummary,
  atomicWriteJson,
  defaultDocument
};
