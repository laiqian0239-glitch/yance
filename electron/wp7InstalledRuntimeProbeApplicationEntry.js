'use strict';

const {
  executeInstalledRuntimeProbe,
  readInstalledRuntimeProbeRequest
} = require('./wp7InstalledRuntimeProbe');

async function runInstalledRuntimeProbeApplicationEntry(options = {}) {
  const request = options.request || readInstalledRuntimeProbeRequest(options.env || process.env, {
    isPackaged: options.isPackaged,
    platform: options.platform,
    requirePackaged: options.requirePackaged,
    requireWindows: options.requireWindows,
    allowPreReviewPackagedIntegration: options.allowPreReviewPackagedIntegration
  });
  if (!request) return null;
  const operations = typeof options.createOperations === 'function'
    ? await options.createOperations(request)
    : options.operations;
  return executeInstalledRuntimeProbe(request, {
    releaseIdentity: options.releaseIdentity,
    platform: options.platform,
    producerExecutablePath: options.producerExecutablePath || process.execPath,
    producerMainEntryPath: options.producerMainEntryPath,
    onResultCommitted: options.onResultCommitted,
    operations
  });
}

module.exports = { runInstalledRuntimeProbeApplicationEntry };
