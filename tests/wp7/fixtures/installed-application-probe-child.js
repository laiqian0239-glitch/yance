#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { runInstalledRuntimeProbeApplicationEntry } = require('../../../electron/wp7InstalledRuntimeProbeApplicationEntry');

(async () => {
  try {
    const measurements = JSON.parse(fs.readFileSync(process.env.WP7_INTEGRATION_MEASUREMENTS_PATH, 'utf8'));
    const identity = JSON.parse(fs.readFileSync(process.env.WP7_INTEGRATION_IDENTITY_PATH, 'utf8'));
    const probeId = process.env.WP7_PROBE_ID;
    const result = await runInstalledRuntimeProbeApplicationEntry({
      env: process.env,
      isPackaged: true,
      platform: 'win32',
      releaseIdentity: identity,
      operations: { [probeId]: async () => measurements }
    });
    process.stdout.write(`${JSON.stringify({ status: result.status, probeId: result.probeId, producerPid: process.pid })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ reasonCode: error.reasonCode || 'WP7_INSTALLED_APPLICATION_PROBE_INTEGRATION_FAILED', message: error.message })}\n`);
    process.exitCode = 1;
  }
})();
