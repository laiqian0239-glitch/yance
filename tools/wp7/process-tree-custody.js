'use strict';

const { spawnSync } = require('node:child_process');

function processTreeSpawnOptions(platform = process.platform) {
  return Object.freeze({ detached: platform !== 'win32' });
}

function terminateProcessTree(child, options = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return Object.freeze({ attempted: false, method: 'none' });
  const platform = options.platform || process.platform;
  const signal = options.signal || 'SIGKILL';
  const kill = options.kill || process.kill;
  const run = options.spawnSync || spawnSync;

  if (platform === 'win32') {
    const result = run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    if (result?.status === 0) return Object.freeze({ attempted: true, method: 'taskkill-tree' });
    try { child.kill(signal); } catch (_) {}
    return Object.freeze({ attempted: true, method: 'child-kill-fallback' });
  }

  try {
    kill(-child.pid, signal);
    return Object.freeze({ attempted: true, method: 'posix-process-group' });
  } catch (_) {
    try { child.kill(signal); } catch (_) {}
    return Object.freeze({ attempted: true, method: 'child-kill-fallback' });
  }
}

function closeCapturedProcessStreams(child) {
  for (const stream of [child?.stdout, child?.stderr]) {
    try { stream?.removeAllListeners?.('data'); } catch (_) {}
    try { stream?.destroy?.(); } catch (_) {}
  }
}

module.exports = {
  processTreeSpawnOptions,
  terminateProcessTree,
  closeCapturedProcessStreams
};
