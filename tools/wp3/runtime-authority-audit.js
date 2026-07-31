'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(row => row.isDirectory() ? walk(path.join(root, row.name)) : [path.join(root, row.name)]);
}

function auditRuntimeAuthority(repoRoot) {
  const root = path.resolve(repoRoot);
  const backendFiles = walk(path.join(root, 'backend')).filter(file => file.endsWith('.js'));
  const findings = [];
  let appRuntimeConstructionPaths = 0;
  let lifecycleConstructionPaths = 0;
  for (const file of backendFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const rel = path.relative(root, file).replaceAll(path.sep, '/');
    if (/new\s+CoreRuntime\b/.test(source)) findings.push({ file: rel, reasonCode: 'WP3_DUPLICATE_PRODUCTION_RUNTIME', pattern: 'new CoreRuntime' });
    if (/new\s+LifecycleManager\b/.test(source)) findings.push({ file: rel, reasonCode: 'WP3_DUPLICATE_LIFECYCLE', pattern: 'new LifecycleManager' });
    if (/new\s+AppRuntime\b/.test(source)) {
      appRuntimeConstructionPaths += 1;
      if (rel !== 'backend/runtime/AppRuntimeFactory.js') findings.push({ file: rel, reasonCode: 'WP3_DUPLICATE_PRODUCTION_RUNTIME', pattern: 'AppRuntime bypasses factory' });
    }
    if (/new\s+LifecycleStateMachine\b/.test(source)) {
      lifecycleConstructionPaths += 1;
      if (rel !== 'backend/runtime/BootCoordinator.js') findings.push({ file: rel, reasonCode: 'WP3_DUPLICATE_LIFECYCLE', pattern: 'Lifecycle bypasses coordinator' });
    }
  }
  const productionEntrypoints = ['backend/server.js','backend/routes/accounts.js','backend/routes/messages.js','backend/routes/system.js','backend/routes/core.js','backend/routes/r32Conversations.js'];
  for (const rel of productionEntrypoints) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    if (/core\/compositionRoot/.test(source)) findings.push({ file: rel, reasonCode: 'WP3_DUPLICATE_PRODUCTION_RUNTIME', pattern: 'legacy compositionRoot import' });
  }
  return {
    status: findings.length ? 'FAIL' : 'PASS',
    findings,
    appRuntimeConstructionPaths,
    lifecycleConstructionPaths,
    legacyCoreRuntimeConstructionPaths: findings.filter(row => row.pattern === 'new CoreRuntime').length,
    legacyLifecycleManagerConstructionPaths: findings.filter(row => row.pattern === 'new LifecycleManager').length,
    factoryPath: 'backend/runtime/AppRuntimeFactory.js',
    coordinatorPath: 'backend/runtime/BootCoordinator.js'
  };
}

module.exports = { auditRuntimeAuthority };
