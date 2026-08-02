'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(repoRoot, relativePath), content, 'utf8');
}

function replaceExactlyOnce(relativePath, before, after) {
  const source = read(relativePath);
  const first = source.indexOf(before);
  const second = first < 0 ? -1 : source.indexOf(before, first + before.length);
  if (first < 0 || second >= 0) {
    throw new Error(`${relativePath}: expected exactly one replacement target, found ${first < 0 ? 0 : 2}`);
  }
  write(relativePath, source.slice(0, first) + after + source.slice(first + before.length));
}

const aiGatewayPath = 'backend/services/aiGateway.js';
replaceExactlyOnce(
  aiGatewayPath,
  '    this.loadPersistedCircuits();\n',
  '    // Persistent routing state is hydrated by the production lifecycle only\n' +
  '    // after the broker-owned authority graph is ready. Constructors remain\n' +
  '    // pure and never touch the primary database.\n' +
  '    this.persistedCircuitsHydrated = false;\n'
);

replaceExactlyOnce(
  aiGatewayPath,
  `  loadPersistedCircuits() {\n    const now = this.clock.now();\n    for (const model of this.registry.read().models || []) {\n      const openedUntil = Date.parse(String(model.circuitOpenedUntil || ''));\n      if (!Number.isFinite(openedUntil) || openedUntil <= now) continue;\n      const openedAt = Date.parse(String(model.circuitOpenedAt || '')) || now;\n      this.failures.set(model.id, { count: Math.max(3, Number(model.consecutiveFailureCount || 3)), openedAt });\n      this.cooldowns.set(model.id, openedUntil);\n    }\n  }\n`,
  `  hydratePersistedCircuits() {\n    if (this.persistedCircuitsHydrated) return this.persistedCircuitSnapshot();\n    const state = this.registry.read();\n    const now = this.clock.now();\n    this.failures.clear();\n    this.cooldowns.clear();\n    for (const model of state.models || []) {\n      const openedUntil = Date.parse(String(model.circuitOpenedUntil || ''));\n      if (!Number.isFinite(openedUntil) || openedUntil <= now) continue;\n      const openedAt = Date.parse(String(model.circuitOpenedAt || '')) || now;\n      this.failures.set(model.id, { count: Math.max(3, Number(model.consecutiveFailureCount || 3)), openedAt });\n      this.cooldowns.set(model.id, openedUntil);\n    }\n    this.persistedCircuitsHydrated = true;\n    return this.persistedCircuitSnapshot();\n  }\n\n  prepare() {\n    return this.hydratePersistedCircuits();\n  }\n\n  persistedCircuitSnapshot() {\n    return Object.freeze({\n      hydrated: this.persistedCircuitsHydrated === true,\n      failureCount: this.failures.size,\n      cooldownCount: this.cooldowns.size\n    });\n  }\n`
);

const compositionPath = 'backend/runtime/AppRuntimeComposition.js';
replaceExactlyOnce(
  compositionPath,
  "const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');\n",
  "const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');\nconst aiGateway = require('../services/aiGateway');\n"
);
replaceExactlyOnce(
  compositionPath,
  "      { name: 'security-guard', service: securityGuard, critical: true },\n",
  "      { name: 'security-guard', service: securityGuard, critical: true },\n" +
  "      { name: 'ai-gateway', service: aiGateway, critical: true },\n"
);

const updatedAiGateway = read(aiGatewayPath);
if (updatedAiGateway.includes('this.loadPersistedCircuits();')) {
  throw new Error('AiGateway constructor still performs persistent circuit hydration');
}
if (!updatedAiGateway.includes('prepare() {\n    return this.hydratePersistedCircuits();')) {
  throw new Error('AiGateway lifecycle hydration boundary was not installed');
}

console.log(JSON.stringify({
  ok: true,
  changedFiles: [aiGatewayPath, compositionPath],
  invariant: 'AiGateway constructors perform no primary-database reads; lifecycle prepare hydrates after authority readiness.'
}, null, 2));
