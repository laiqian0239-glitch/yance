'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isPostInstallReason(reason) {
  return /^post-install(?:$|-)/.test(String(reason || ''));
}

function snapshotWindow(window) {
  const destroyed = !window || window.isDestroyed?.() === true || window.webContents?.isDestroyed?.() === true;
  return {
    id: Number(window?.id || 0),
    destroyed,
    visible: !destroyed && window?.isVisible?.() === true,
    minimized: !destroyed && window?.isMinimized?.() === true,
    focused: !destroyed && window?.isFocused?.() === true
  };
}

function writePostInstallLaunchReceipt(options = {}) {
  const request = options.request && typeof options.request === 'object' ? options.request : {};
  if (!isPostInstallReason(request.reason)) return null;
  const rawFilePath = String(options.filePath || '').trim();
  if (!rawFilePath) throw Object.assign(new Error('Post-install launch receipt path is required'), { reasonCode: 'POST_INSTALL_RECEIPT_PATH_REQUIRED' });
  const filePath = path.resolve(rawFilePath);
  const windowState = snapshotWindow(options.window);
  const status = !windowState.destroyed && windowState.visible && !windowState.minimized ? 'PASS' : 'FAIL';
  const receipt = {
    schemaVersion: 1,
    documentType: 'YANCE_POST_INSTALL_LAUNCH_RECEIPT',
    status,
    reason: String(request.reason || ''),
    sequence: Number(request.sequence || 0),
    requestedAt: Number(request.requestedAt || 0),
    activatedAtUtc: (options.now || (() => new Date().toISOString()))(),
    processId: Number(options.processId || process.pid),
    window: windowState
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);

  const markerPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.pass`);
  if (status === 'PASS') {
    const markerTemporaryPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(markerTemporaryPath, `${receipt.activatedAtUtc}\t${receipt.processId}\n`, 'utf8');
    fs.renameSync(markerTemporaryPath, markerPath);
  } else {
    try { fs.rmSync(markerPath, { force: true }); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { ...receipt, markerPath };
}

module.exports = { isPostInstallReason, snapshotWindow, writePostInstallLaunchReceipt };
