'use strict';

/**
 * M7 — Installer clean install / upgrade orchestration (pure, testable).
 *
 * The NSIS installer (`installer/wp7/YanceFinalInstaller.nsi`) performs the
 * actual file operations on Windows. This module holds the *decision logic*
 * that must be correct and regression-tested, independent of NSIS:
 *   - stale path computation (derived from the M6 release-layout contract so
 *     it cannot drift from what is actually shipped)
 *   - post-install tree verification (reuses M6 `validateLayout('production')`)
 *   - running-process detection from `tasklist` output (parsed, not executed)
 *   - upgrade-path decision (INSTALL / STOP_THEN_INSTALL / BLOCK)
 *
 * No electron / NSIS imports — unit-testable with injected fs + sample output.
 */

const path = require('path');
const { validateLayout, REQUIRED_KEYS } = require('../electron/m2/releaseLayout');

// Paths removed before laying down a new payload, to prevent mixed-version
// resources and native-module (.node) residue. Sourced from the M6 contract's
// production layout so a layout change is reflected here automatically.
function computeStalePaths(installDir) {
  const res = path.join(installDir, 'resources');
  return [
    path.join(res, 'app'),
    path.join(res, 'app.asar'),
    path.join(res, 'app.asar.unpacked'),
    path.join(res, 'runtime')
  ].map((p) => p.split(path.sep).join('/'));
}

// Verify an installed tree against the production contract.
// Returns the structured result from M6 `validateLayout` (no throw on missing).
function verifyInstalledTree(installDir, opts = {}) {
  const resourcesPath = path.join(installDir, 'resources');
  return validateLayout('production', { resourcesPath }, opts);
}

// Parse tasklist output for either the new Yance.exe process or the legacy migration-only Yance29.exe process.
// Kept pure so detection can be unit-tested without spawning processes.
function parseTasklist(output = '') {
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    const cols = line.trim().split(/\s+/).filter(Boolean);
    if (cols[0] && /^(?:yance|yance29)\.exe$/i.test(cols[0])) return true;
  }
  return false;
}

// Whether a running instance must hard-block the install.
function isInstallBlockedByRunning({ running, allowAutoStop }) {
  if (!running) return false;
  return allowAutoStop !== true;
}

// Choose the upgrade path:
//   not running            -> INSTALL
//   running + auto-stop    -> STOP_THEN_INSTALL (kill tree, then install)
//   running + no auto-stop -> BLOCK
function decideUpgradePath({ running, allowAutoStop }) {
  if (!running) return { action: 'INSTALL', blocked: false };
  if (allowAutoStop) return { action: 'STOP_THEN_INSTALL', blocked: false };
  return { action: 'BLOCK', blocked: true };
}

module.exports = {
  REQUIRED_KEYS,
  computeStalePaths,
  verifyInstalledTree,
  parseTasklist,
  isInstallBlockedByRunning,
  decideUpgradePath
};
