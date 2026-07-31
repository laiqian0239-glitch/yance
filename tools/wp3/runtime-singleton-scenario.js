'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppRuntimeFactory } = require('../../backend/runtime/AppRuntimeFactory');
const { BootCoordinator } = require('../../backend/runtime/BootCoordinator');
const releaseSource = require('../../release/release-source.json');

function temporaryRoot(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
const scenarioBuildIdentity = `${releaseSource.productName}:${releaseSource.productVersion}:${releaseSource.stageVersion}`;
function coordinator(root) { return new BootCoordinator({ context: { buildId: scenarioBuildIdentity }, buildId: scenarioBuildIdentity, dataRoot: root }); }

async function runRuntimeSingletonScenario() {
  const roots = [temporaryRoot('yance-singleton-a-'), temporaryRoot('yance-singleton-b-'), temporaryRoot('yance-singleton-c-')];
  const first = coordinator(roots[0]);
  const second = coordinator(roots[1]);
  const third = coordinator(roots[2]);
  try {
    const firstRuntime = await first.start();
    let secondReason = '';
    try { await second.start(); } catch (error) { secondReason = error.reasonCode || error.code || ''; }
    const afterSecond = AppRuntimeFactory.current();
    await second.stop('duplicate-cleanup');
    const afterSecondCleanup = AppRuntimeFactory.current();
    let thirdReason = '';
    try { await third.start(); } catch (error) { thirdReason = error.reasonCode || error.code || ''; }
    const clearResults = {
      null: AppRuntimeFactory.clear(null),
      undefined: AppRuntimeFactory.clear(undefined),
      other: AppRuntimeFactory.clear({})
    };
    const afterInvalidClears = AppRuntimeFactory.current();
    const firstStillOperational = Boolean(firstRuntime.snapshot()?.runtime?.ownerInstanceId) && first.ownership.mutex.held === true;
    const checks = {
      secondRejected: secondReason === 'APP_RUNTIME_ALREADY_EXISTS',
      singletonPreservedAfterSecondFailure: afterSecond === firstRuntime,
      singletonPreservedAfterFailedCoordinatorCleanup: afterSecondCleanup === firstRuntime,
      thirdRejected: thirdReason === 'APP_RUNTIME_ALREADY_EXISTS',
      clearNullNoop: clearResults.null === false,
      clearUndefinedNoop: clearResults.undefined === false,
      clearOtherNoop: clearResults.other === false,
      singletonPreservedAfterInvalidClears: afterInvalidClears === firstRuntime,
      firstRuntimeStillOperational: firstStillOperational
    };
    const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
    if (failed.length) throw Object.assign(new Error(`Runtime singleton scenario failed: ${failed.join(', ')}`), { reasonCode: 'WP3_RUNTIME_SINGLETON_CORRUPTED', checks });
    return { status: 'PASS', checks, secondReason, thirdReason, factory: AppRuntimeFactory.diagnostics() };
  } finally {
    await third.stop('cleanup').catch(() => {});
    await second.stop('cleanup').catch(() => {});
    await first.stop('cleanup').catch(() => {});
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { runRuntimeSingletonScenario };
if (require.main === module) runRuntimeSingletonScenario().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP3_SINGLETON_SCENARIO_FAILED'} ${error.stack || error.message}\n`); process.exit(1); });
