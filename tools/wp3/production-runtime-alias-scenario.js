'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveWindowsShortPath } = require('../release-closure/windows-short-path');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { createInstalledResources } = require('../../tests/wp2/helpers');
const { canonicalizeRuntimePaths } = require('../../backend/runtime/RuntimePathIdentity');

function waitOutcome(child, timeoutMs = 30000) {
  const observed = Array.isArray(child?.__desktopHostLifecycleMessages) ? child.__desktopHostLifecycleMessages : [];
  const failed = observed.find(message => message?.type === 'backend:startup-failed');
  if (failed) return Promise.resolve({ kind: 'failed', message: failed, source: 'lifecycle-backlog' });
  const ready = observed.find(message => message?.type === 'backend:ready');
  if (ready) return Promise.resolve({ kind: 'ready', message: ready, source: 'lifecycle-backlog' });
  if (child?.exitCode !== null && child?.exitCode !== undefined) return Promise.resolve({ kind: 'exit', code: child.exitCode, signal: child.signalCode || null, source: 'pre-observed-exit' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = message => {
      if (message?.type === 'backend:ready') finish(null, { kind: 'ready', message });
      if (message?.type === 'backend:startup-failed') finish(null, { kind: 'failed', message });
    };
    const onExit = (code, signal) => finish(null, { kind: 'exit', code, signal });
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error('backend outcome timeout')), timeoutMs);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function toggleCase(value) {
  return value.split('').map(ch => /[a-z]/.test(ch) ? ch.toUpperCase() : /[A-Z]/.test(ch) ? ch.toLowerCase() : ch).join('');
}

function currentNodeExecutable() {
  const direct = String(process.execPath || '').trim();
  if (path.isAbsolute(direct) && fs.existsSync(direct)) return fs.realpathSync(direct);
  const names = process.platform === 'win32'
    ? [...new Set([direct, `${direct}.exe`, 'node.exe'].filter(Boolean))]
    : [...new Set([direct, 'node'].filter(Boolean))];
  for (const directory of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    }
  }
  throw Object.assign(new Error(`Current Node executable cannot be resolved from process.execPath=${direct || '<empty>'}`), {
    reasonCode: 'WP3_NODE_RUNTIME_UNRESOLVED'
  });
}

function windowsShortPath(target, options = {}) {
  if ((options.platform || process.platform) !== 'win32') throw new Error('Windows short path resolution is only available on Windows');
  const result = resolveWindowsShortPath(target, options);
  if (result.status !== 'PASS') {
    throw Object.assign(new Error(result.stderr || result.error || result.reasonCode || 'Unable to resolve Windows short path'), {
      reasonCode: result.reasonCode === 'WINDOWS_SHORT_PATH_ALIAS_UNAVAILABLE'
        ? 'WP3_WINDOWS_SHORT_PATH_ALIAS_UNAVAILABLE'
        : 'WP3_WINDOWS_SHORT_PATH_RESOLUTION_FAILED',
      details: result
    });
  }
  return result.shortPath;
}

async function runProductionRuntimeAliasScenario(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '../..'));
  const shortPathTempRoot = path.resolve(process.env.YANCE_WP3_SHORT_PATH_TEMP_ROOT || os.tmpdir());
  fs.mkdirSync(shortPathTempRoot, { recursive: true });
  const base = fs.mkdtempSync(path.join(shortPathTempRoot, 'yance-wp3-alias-'));
  const physical = path.join(base, 'Physical Runtime Data');
  const child = path.join(physical, 'nested');
  fs.mkdirSync(child, { recursive: true });
  const release = createInstalledResources({ gitCommit: '5'.repeat(40), sourceTree: '6'.repeat(40) });
  const startOptions = dataRoot => ({
    entry: path.join(repoRoot, 'backend', 'desktopHostedEntry.js'),
    cwd: repoRoot,
    execPath: currentNodeExecutable(),
    // Production boot rejects the legacy YANCE_SAFE_MODE environment switch.
    // This alias scenario must exercise the normal authority path.
    env: { ...process.env, YANCE_DATA_DIR: dataRoot, YANCE_PORT: '0', YANCE_HOST: '127.0.0.1', YANCE_MODEL_TIMEOUT_MS: '5000', YANCE_APP_ROOT: repoRoot, YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1' },
    releaseStartupConfig: { resourcesPath: release.resourcesPath, expectedBuildId: release.manifest.buildId, manifestSha256: release.manifestSha256 },
    // desktopHostedEntry always requires an initial credential hydration frame.
    // This scenario deliberately avoids the full custody handshake because it is
    // testing runtime-path mutex aliasing, but it must still satisfy the same
    // production boot contract as the other real-backend probes.
    credentialFrameRequired: true
  });
  const aliases = [
    { kind: 'trailing-separator', value: `${physical}${path.sep}` },
    { kind: 'dot-segment', value: `${physical}${path.sep}.` },
    { kind: 'dotdot-segment', value: `${child}${path.sep}..` }
  ];
  const symlink = path.join(base, 'physical-link');
  try { fs.symlinkSync(physical, symlink, process.platform === 'win32' ? 'junction' : 'dir'); aliases.push({ kind: process.platform === 'win32' ? 'junction-alias' : 'symlink-alias', value: symlink }); } catch (error) {
    throw Object.assign(new Error(`Unable to create runtime path alias: ${error.message}`), { reasonCode: 'WP3_RUNTIME_PATH_ALIAS_SETUP_FAILED' });
  }
  if (process.platform === 'win32') {
    aliases.push({ kind: 'case-variant', value: toggleCase(physical) });
    const secondJunction = path.join(base, 'second-junction');
    fs.symlinkSync(physical, secondJunction, 'junction');
    aliases.push({ kind: 'junction-alias-secondary', value: secondJunction });
    aliases.push({ kind: 'short-path-alias', value: windowsShortPath(physical) });
  }

  const firstHost = new BackendProcessHost();
  const results = [];
  try {
    const first = await firstHost.start(startOptions(physical));
    const firstOutcome = await waitOutcome(first.child);
    if (firstOutcome.kind !== 'ready') throw Object.assign(new Error(`Primary backend did not become ready: ${JSON.stringify(firstOutcome)}`), { reasonCode: 'WP3_ALIAS_PRIMARY_BACKEND_FAILED' });
    const aliasResults = await Promise.all(aliases.map(async alias => {
      const secondHost = new BackendProcessHost();
      try {
        let outcome;
        try {
          const second = await secondHost.start(startOptions(alias.value));
          outcome = await waitOutcome(second.child);
        } catch (error) {
          outcome = { kind: 'failed', message: { type: 'backend:startup-failed', reasonCode: error.reasonCode || error.code || '', message: error.message || String(error) }, source: 'host-start-rejection' };
        }
        const pass = outcome.kind === 'failed' && outcome.message?.reasonCode === 'BOOT_RUNTIME_MUTEX_HELD';
        return {
          kind: alias.kind,
          suppliedPath: alias.value,
          canonical: canonicalizeRuntimePaths({ dataRoot: alias.value }).dataRoot,
          outcome: outcome.kind,
          reasonCode: outcome.message?.reasonCode || '',
          readyObserved: outcome.kind === 'ready',
          apiPortOpened: outcome.kind === 'ready' && Number(outcome.message?.port || 0) > 0,
          pass,
          diagnostic: pass ? null : outcome
        };
      } finally {
        await secondHost.stop({ gracefulMs: 1500, forceMs: 3000 }).catch(() => {});
      }
    }));
    results.push(...aliasResults);
    const failedAlias = results.find(row => !row.pass);
    if (failedAlias) throw Object.assign(new Error(`Alias ${failedAlias.kind} allowed a second backend: ${JSON.stringify(failedAlias.diagnostic)}`), { reasonCode: 'WP3_RUNTIME_PATH_ALIAS_DUAL_OWNER' });
    return {
      status: 'PASS',
      platform: process.platform,
      provider: process.platform === 'win32' ? 'WINDOWS_SYSTEM_THREADING_MUTEX' : 'PORTABLE_LOOPBACK_KERNEL_LOCK',
      primaryDataRoot: physical,
      canonicalDataRoot: canonicalizeRuntimePaths({ dataRoot: physical }).dataRoot,
      results,
      checks: {
        twoRealBackendProcessHostsUsed: true,
        everyAliasRejectedWithRuntimeMutexHeld: results.every(row => row.pass),
        noSecondBackendReady: results.every(row => row.readyObserved === false),
        noSecondApiPortOpened: results.every(row => row.apiPortOpened === false)
      }
    };
  } finally {
    await firstHost.stop({ gracefulMs: 8000, forceMs: 8000 }).catch(() => {});
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(release.resourcesPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

module.exports = { runProductionRuntimeAliasScenario, waitOutcome, windowsShortPath, currentNodeExecutable };
if (require.main === module) runProductionRuntimeAliasScenario().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP3_ALIAS_SCENARIO_FAILED'} ${error.stack || error.message}\n`); process.exit(1); });
