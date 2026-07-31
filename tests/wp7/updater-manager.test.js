'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { UpdateManager } = require('../../electron/updateManager');

function makeExe(name = 'Yance-Setup-1.0.0-x64.exe') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updm-'));
  const file = path.join(dir, name);
  const exe = Buffer.alloc(128);
  exe.write('MZ', 0, 'ascii');
  exe.writeUInt32LE(0x40, 0x3c);
  exe.writeUInt32LE(0x00004550, 0x40);
  exe.writeUInt16LE(0x8664, 0x44);
  fs.writeFileSync(file, exe);
  return { file, exe, sha512: crypto.createHash('sha512').update(exe).digest('base64') };
}

function updateInfo({ version = '29.2.7', file, size, sha512, downloadedFile } = {}) {
  const name = path.basename(file || 'Yance-Setup-1.0.0-x64.exe');
  return {
    version,
    releaseDate: '2026-07-14T00:00:00.000Z',
    releaseNotes: 'fix',
    publicVersion: '1.0.0',
    releaseName: '言策 1.0.0',
    files: [{ url: name, size, sha512 }],
    path: name,
    sha512,
    ...(downloadedFile ? { downloadedFile } : {})
  };
}

class FakeUpdater extends EventEmitter {
  constructor({ info, downloadedFile, emitDownloaded = true } = {}) {
    super();
    this.info = info;
    this.downloadedFilePath = downloadedFile;
    this.emitDownloaded = emitDownloaded;
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.allowDowngrade = true;
    this.allowPrerelease = false;
    this.feed = null;
    this.installCalls = 0;
  }
  setFeedURL(value) { this.feed = value; }
  async checkForUpdates() {
    this.emit('checking-for-update');
    this.emit('update-available', this.info);
    return { updateInfo: this.info, isUpdateAvailable: true };
  }
  async downloadUpdate() {
    this.emit('download-progress', { percent: 50, transferred: 64, total: 128, bytesPerSecond: 1024 });
    if (this.emitDownloaded) this.emit('update-downloaded', { ...this.info, downloadedFile: this.downloadedFilePath });
    return [this.downloadedFilePath];
  }
  quitAndInstall() { this.installCalls += 1; }
}

function makeManager({ updater, extractor, apiRequest, appPackaged = true } = {}) {
  const dialog = { showMessageBox: async () => ({ response: 1 }) };
  const manager = new UpdateManager({
    app: { isPackaged: appPackaged, getAppPath: () => __dirname },
    releaseIdentity: { buildId: 'B', productName: '言策', publicProductName: '言策', publicVersion: '0.9.0', productVersion: '29.2.7', nativeBinaryTargetArch: 'x64' },
    dialog,
    apiRequest: apiRequest || (async () => ({ ok: true, safeToInstall: true, blockers: [] })),
    sendToRenderer: () => {},
    getSettings: () => ({ autoCheckUpdates: false, autoDownloadUpdates: false }),
    getRendererWorkState: () => ({ unsavedChanges: false, pendingReplyApproval: false }),
    log: () => {},
    refreshTray: () => {},
    updater
  });
  if (extractor) manager.extractVersionInfo = extractor;
  return manager;
}

const validIdentity = () => ({ productName: '言策', publisher: '言策科技', productVersion: '29.2.7', signed: true });


test('packaged internal-test client uses manual installer updates and no server', () => {
  const fixture = makeExe();
  const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
  const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
  const manager = makeManager({ updater });
  assert.strictEqual(manager.state.configured, false);
  assert.strictEqual(manager.state.configSource, 'internal-test-manual-installer');
  assert.strictEqual(updater.feed, null);
  assert.strictEqual(updater.allowPrerelease, false);
});


test('real event contract: update-downloaded downloadedFile drives verification', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    await manager.check({ manual: true });
    assert.strictEqual(manager.state.phase, 'available');
    await manager.download();
    assert.strictEqual(manager.state.phase, 'ready', JSON.stringify(manager.state));
    assert.strictEqual(manager.state.verificationSource, 'electron-updater-event-metadata+downloadedFile');
    assert.strictEqual(manager.state.verifiedAssetName, path.basename(fixture.file));
    assert.strictEqual(manager.state.internalTestMode, true);
    assert.strictEqual(manager.state.releaseApproved, false);
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});


test('downloadUpdate returned paths are a safe fallback when event is absent', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file, emitDownloaded: false });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    await manager.check({ manual: true });
    await manager.download();
    assert.strictEqual(manager.state.phase, 'ready', JSON.stringify(manager.state));
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});


test('tampered installer is rejected using UpdateInfo sha512', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: 'WRONGHASH' });
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    await manager.check({ manual: true });
    await manager.download();
    assert.strictEqual(manager.state.phase, 'rejected');
    assert.ok(manager.state.rejectedReasons.includes('UPDATE_REJECTED_HASH_MISMATCH'));
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});


test('missing updater metadata is rejected instead of self-hashing the file', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const info = { version: '29.2.7', releaseNotes: 'fix', releaseDate: '2026-07-14T00:00:00.000Z', files: [] };
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    await manager.check({ manual: true });
    await manager.download();
    assert.strictEqual(manager.state.phase, 'rejected');
    assert.ok(manager.state.rejectedReasons.includes('UPDATE_REJECTED_METADATA_MISMATCH'));
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});


test('available and downloaded metadata drift is rejected', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const available = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
    const updater = new FakeUpdater({ info: available, downloadedFile: fixture.file });
    updater.downloadUpdate = async function () {
      const drift = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: 'DIFFERENT', downloadedFile: fixture.file });
      this.emit('update-downloaded', drift);
      return [fixture.file];
    };
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    await manager.check({ manual: true });
    await manager.download();
    assert.strictEqual(manager.state.phase, 'rejected');
    assert.ok(manager.state.rejectedReasons.includes('UPDATE_REJECTED_METADATA_MISMATCH'));
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});


test('production mode rejects unsigned or unknown Authenticode identity', async () => {
  delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  process.env.YANCE_UPDATE_TEST_TRANSPORT = '1';
  try {
    const fixture = makeExe();
    const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: null }) });
    await manager.check({ manual: true });
    await manager.download();
    assert.strictEqual(manager.state.phase, 'rejected');
    assert.ok(manager.state.rejectedReasons.includes('UPDATE_REJECTED_SIGNATURE_INVALID'));
  } finally {
    delete process.env.YANCE_UPDATE_TEST_TRANSPORT;
  }
});


test('install remains blocked when renderer has unsaved changes', async () => {
  process.env.YANCE_INTERNAL_UPDATE_TEST = '1';
  try {
    const fixture = makeExe();
    const info = updateInfo({ file: fixture.file, size: fixture.exe.length, sha512: fixture.sha512 });
    const updater = new FakeUpdater({ info, downloadedFile: fixture.file });
    const manager = makeManager({ updater, extractor: () => ({ ...validIdentity(), signed: false }) });
    manager.setRendererWorkState({ unsavedChanges: true, detail: 'composer has text' });
    await manager.check({ manual: true });
    await manager.download();
    const result = await manager.install();
    assert.strictEqual(result.installed, false);
    assert.ok(result.blockers.some(item => item.id === 'unsaved-changes'));
    assert.strictEqual(updater.installCalls, 0);
  } finally {
    delete process.env.YANCE_INTERNAL_UPDATE_TEST;
  }
});
