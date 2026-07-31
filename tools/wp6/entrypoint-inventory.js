'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, PRODUCTION_ROOTS, rel, walk } = require('./common');
function hits(pattern) {
  const rows = [];
  for (const file of PRODUCTION_ROOTS.flatMap(name => walk(path.join(ROOT, name))).filter(file => /\.js$/i.test(file))) {
    const source = fs.readFileSync(file, 'utf8');
    source.split(/\r?\n/).forEach((line, index) => { pattern.lastIndex = 0; if (pattern.test(line)) rows.push({ file: rel(file), line: index + 1, excerpt: line.trim() }); });
  }
  return rows;
}
function inventoryRuntimeEntrypoints() {
  const inventory = {
    appRuntimeConstructors: hits(/new\s+AppRuntime\b/),
    lifecycleStateMachineConstructors: hits(/new\s+LifecycleStateMachine\b/),
    appRuntimeCompositionFactories: hits(/function\s+createAppRuntimeComposition\b/),
    runtimeAuthorityMigrationConstructors: hits(/new\s+RuntimeAuthorityMigrationCoordinator\b/),
    operatingModeGatewayConstructors: hits(/new\s+OperatingModeTransitionGateway\b/),
    runtimeStateStoreConstructors: hits(/new\s+RuntimeStateStore\b/),
    apiV2ClientConstructors: hits(/new\s+ApiV2RuntimeClient\b/),
    projectionCoordinatorConstructors: hits(/new\s+RuntimeProjectionCoordinator\b/),
    desktopApplicationCoordinatorConstructors: hits(/new\s+DesktopCredentialApplicationCoordinator\b/),
    backendProcessHostConstructors: hits(/new\s+BackendProcessHost\b/),
    apiV2CommandRouters: hits(/router\.post\(['"]\/commands['"]/),
    policyModeHandlers: hits(/safeMode/).filter(row => row.file === 'backend/routes/system.js'),
    executeLegacyHandlers: hits(/\bexecuteLegacy\b/),
    directLifecycleChannels: hits(/desktop:lifecycle/)
  };
  const duplicates = [];
  const exact = [
    ['appRuntimeConstructors', 1], ['lifecycleStateMachineConstructors', 1], ['appRuntimeCompositionFactories', 1],
    ['runtimeAuthorityMigrationConstructors', 1], ['operatingModeGatewayConstructors', 1], ['runtimeStateStoreConstructors', 1],
    ['apiV2ClientConstructors', 1], ['projectionCoordinatorConstructors', 1], ['desktopApplicationCoordinatorConstructors', 1],
    ['backendProcessHostConstructors', 1], ['apiV2CommandRouters', 1], ['executeLegacyHandlers', 0], ['directLifecycleChannels', 0]
  ];
  for (const [name, expected] of exact) if (inventory[name].length !== expected) duplicates.push({ category: name, expected, actual: inventory[name].length, hits: inventory[name] });
  return { schemaVersion: 1, status: duplicates.length ? 'FAIL' : 'PASS', allowedProductionCompositionRoot: 'backend/runtime/AppRuntimeComposition.js', allowedRuntimeFactory: 'backend/runtime/AppRuntimeFactory.js', duplicateExecutableEntrypointCount: duplicates.length, duplicates, inventory };
}
if (require.main === module) { const report = inventoryRuntimeEntrypoints(); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'PASS' ? 0 : 1; }
module.exports = { inventoryRuntimeEntrypoints };
