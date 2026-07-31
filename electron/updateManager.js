'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { clean, releaseNotes, runtimeUpdateConfig, githubUpdateConfig } = require('./updatePolicy');
const { normalizeUpdateInfo, compareUpdateMetadata } = require('./updateMetadata');
const { validateUpdatePackage, validateReleaseMetadata, REJECTION_MESSAGES } = require('./updateVerifier');
const { extractInstallerIdentity } = require('../shared/windows/pe-resource-identity');

const SIX_HOURS = 6 * 60 * 60 * 1000;
const EXPECTED_PUBLISHER = '言策科技';

function isInternalTestMode() {
  return process.env.YANCE_INTERNAL_UPDATE_TEST === '1';
}

function trustedMode() {
  return isInternalTestMode() ? 'development' : 'production';
}

function loadDefaultUpdater() {
  return require('electron-updater').autoUpdater;
}

function firstInstallerPath(paths) {
  const values = Array.isArray(paths) ? paths.filter(item => typeof item === 'string' && item.trim()) : [];
  return values.find(item => item.toLowerCase().endsWith('.exe')) || values[0] || '';
}

class UpdateManager extends EventEmitter {
  constructor({ app, releaseIdentity, dialog, apiRequest, sendToRenderer, getSettings, getRendererWorkState, log, refreshTray, updater = null }) {
    super();
    this.app = app;
    this.releaseIdentity = releaseIdentity;
    if (!releaseIdentity?.buildId || !releaseIdentity?.productVersion) {
      throw Object.assign(new Error('Verified release identity is required'), { code: 'BOOT_BUILD_ID_MISMATCH' });
    }
    this.currentVersion = releaseIdentity.productVersion;
    this.currentPublicVersion = releaseIdentity.publicVersion || releaseIdentity.productVersion;
    this.publicProductName = releaseIdentity.publicProductName || releaseIdentity.productName || '言策';
    this.expectedProductName = releaseIdentity.productName;
    this.expectedManifestArch = releaseIdentity.nativeBinaryTargetArch || 'x64';
    this.dialog = dialog;
    this.apiRequest = apiRequest;
    this.sendToRenderer = sendToRenderer;
    this.getSettings = getSettings;
    this.getRendererWorkState = getRendererWorkState;
    this.log = log || (() => {});
    this.refreshTray = refreshTray || (() => {});
    this.updater = updater || loadDefaultUpdater();
    this.extractVersionInfo = extractInstallerIdentity;
    this.interval = null;
    this.startTimer = null;
    this.bound = false;
    this.baseUrl = '';
    this.ghConfig = null;
    this.lifecycleManager = null;
    this.securityGuard = null;
    this.rendererWorkStateOverride = null;
    this.availableUpdateMetadata = null;
    this.downloadedUpdateMetadata = null;
    this.lastDownloadPaths = [];
    this.state = {
      phase: 'idle', configured: false, configSource: 'unconfigured', currentVersion: this.currentVersion,
      currentPublicVersion: this.currentPublicVersion, availableVersion: '', availablePublicVersion: '',
      releaseNotes: '', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0,
      checkedAt: '', downloadedAt: '', error: '', blockers: [], manual: false,
      internalTestMode: isInternalTestMode(), releaseApproved: false
    };
    this.configure();
    this.bindEvents();
  }

  async prepare() { return this.snapshot(); }

  setRendererWorkState(state = {}) {
    this.rendererWorkStateOverride = {
      unsavedChanges: state.unsavedChanges === true,
      pendingReplyApproval: state.pendingReplyApproval === true,
      detail: String(state.detail || '').slice(0, 500)
    };
    return { ...this.rendererWorkStateOverride };
  }

  configure() {
    try {
      const gh = githubUpdateConfig({ env: process.env, isPackaged: this.app.isPackaged });
      if (gh.configured) {
        this.ghConfig = gh;
        this.state.configured = true;
        this.state.configSource = gh.source;
        this.state.channel = gh.channel;
        this.updater.autoDownload = false;
        this.updater.autoInstallOnAppQuit = false;
        this.updater.allowDowngrade = false;
        this.updater.allowPrerelease = gh.allowPrerelease === true;
        this.updater.setFeedURL({
          provider: 'github',
          owner: gh.owner,
          repo: gh.repo,
          channel: gh.channel
        });
        return;
      }
      const config = runtimeUpdateConfig({
        isPackaged: this.app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: this.app.getAppPath?.() || process.cwd()
      });
      this.baseUrl = config.url;
      this.state.configured = Boolean(config.configured && (this.app.isPackaged || process.env.YANCE_UPDATE_DEV_MODE === '1'));
      this.state.configSource = this.state.configured ? config.source : (gh.source || config.source);
      this.state.channel = config.channel || gh.channel;
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.allowDowngrade = false;
      if (this.state.configured) this.updater.setFeedURL({ provider: 'generic', url: this.baseUrl, channel: clean(config.channel || 'latest') });
    } catch (error) {
      this.state.configured = false;
      this.state.phase = 'error';
      this.state.error = this.friendlyError(error);
    }
  }

  bindEvents() {
    if (this.bound) return;
    this.bound = true;
    this.updater.on('checking-for-update', () => this.patch({ phase: 'checking', error: '', blockers: [] }, 'checking-for-update'));
    this.updater.on('update-available', info => {
      this.availableUpdateMetadata = normalizeUpdateInfo(info);
      const asset = this.availableUpdateMetadata.file;
      this.patch({
        phase: 'available',
        availableVersion: clean(info?.version),
        availablePublicVersion: this.availableUpdateMetadata.publicVersion || clean(info?.version),
        releaseNotes: releaseNotes(info?.releaseNotes),
        checkedAt: new Date().toISOString(),
        error: '',
        assetName: asset?.fileName || '',
        assetSize: asset?.size ?? 0,
        metadataSource: 'electron-updater:update-available'
      }, 'update-available');
      if (this.getSettings()?.autoDownloadUpdates === true) this.download().catch(() => {});
    });
    this.updater.on('update-not-available', info => this.patch({
      phase: 'up-to-date',
      availableVersion: clean(info?.version || this.currentVersion),
      availablePublicVersion: this.currentPublicVersion,
      checkedAt: new Date().toISOString(),
      error: ''
    }, 'update-not-available'));
    this.updater.on('download-progress', progress => this.patch({
      phase: 'downloading',
      percent: Number(progress?.percent || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0)
    }, 'download-progress'));
    this.updater.on('update-downloaded', info => {
      const downloadedMetadata = normalizeUpdateInfo(info);
      this.downloadedUpdateMetadata = downloadedMetadata;
      const comparison = compareUpdateMetadata(this.availableUpdateMetadata, downloadedMetadata);
      const downloadedFile = clean(info?.downloadedFile) || firstInstallerPath(this.lastDownloadPaths);
      this.beginVerification({
        version: clean(info?.version || this.state.availableVersion),
        publicVersion: downloadedMetadata.publicVersion || this.state.availablePublicVersion,
        notes: releaseNotes(info?.releaseNotes || this.state.releaseNotes),
        file: downloadedFile,
        updateMetadata: downloadedMetadata.file ? downloadedMetadata : this.availableUpdateMetadata,
        metadataComparison: comparison
      });
    });
    this.updater.on('error', error => this.patch({
      phase: 'error',
      error: this.friendlyError(error),
      checkedAt: new Date().toISOString()
    }, 'update-error'));
  }

  friendlyError(error) {
    const msg = error?.message || String(error);
    if (/ENOTFOUND|ECONNREFUSED|network|timeout/i.test(msg)) return '网络中断或 GitHub 暂时无法访问，请稍后重试。';
    if (/404|not found/i.test(msg)) return '更新文件不存在或版本尚未发布。';
    if (/digest|sha|hash|integrity/i.test(msg)) return '下载内容校验失败，可能被篡改或网络不稳定。';
    if (/space|disk/i.test(msg)) return '磁盘空间不足，无法保存更新包。';
    return '暂时无法完成更新检查，不影响当前工作。';
  }

  beginVerification({ version, publicVersion, notes, file, updateMetadata, metadataComparison = { ok: true, reasons: [] } }) {
    const mode = trustedMode();
    const internalTestMode = isInternalTestMode();
    this.patch({
      phase: 'verifying', availableVersion: version, availablePublicVersion: publicVersion || version, releaseNotes: notes, error: '', percent: 100,
      downloadedAt: this.state.downloadedAt || new Date().toISOString(), internalTestMode, releaseApproved: false
    }, 'update-verifying');

    const metadata = updateMetadata || this.downloadedUpdateMetadata || this.availableUpdateMetadata;
    const fileMetadata = metadata?.file || null;
    const metadataResult = validateReleaseMetadata({
      metadata,
      downloadedFilePath: file,
      metadataComparison
    });
    const packageResult = validateUpdatePackage({
      filePath: file,
      expectedSha512: fileMetadata?.sha512 || null,
      expectedVersion: version,
      currentVersion: this.currentVersion,
      expectedProductName: this.expectedProductName,
      expectedPublisher: EXPECTED_PUBLISHER,
      expectedArch: 'x64',
      expectedManifestArch: this.expectedManifestArch || 'x64',
      mode,
      extractVersionInfo: this.extractVersionInfo
    });
    const reasons = [...new Set([...packageResult.reasons, ...metadataResult.reasons])];
    if (reasons.length === 0) {
      this.patch({
        phase: 'ready', availableVersion: version, releaseNotes: notes, verifiedAt: new Date().toISOString(), error: '',
        internalTestMode, releaseApproved: false, packageTrusted: mode === 'production',
        verificationSource: 'electron-updater-event-metadata+downloadedFile',
        differentialIntegrity: 'managed-by-electron-updater',
        verifiedAssetName: fileMetadata?.fileName || path.basename(file || ''),
        verifiedAssetSize: fileMetadata?.size ?? 0,
        rejectedReasons: [], rejectedDetails: null
      }, 'update-ready');
      return this.snapshot();
    }
    const details = { ...packageResult.details, metadata: metadataResult.details, metadataComparison: metadataComparison.reasons || [] };
    this.log('warn', 'update-rejected', { reasons, details });
    this.patch({
      phase: 'rejected', availableVersion: version, releaseNotes: notes,
      error: reasons.map(code => REJECTION_MESSAGES[code] || code).filter(Boolean).join(' '),
      rejectedReasons: reasons, rejectedDetails: details,
      internalTestMode, releaseApproved: false, packageTrusted: false,
      verificationSource: 'electron-updater-event-metadata+downloadedFile'
    }, 'update-rejected');
    return this.snapshot();
  }

  patch(patch, event = 'state') {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    this.log('info', `update-${event}`, { phase: snapshot.phase, version: snapshot.availableVersion, percent: snapshot.percent, error: snapshot.error });
    this.sendToRenderer('desktop:update-state', snapshot);
    this.refreshTray();
    this.emit('state', snapshot);
    return snapshot;
  }

  snapshot() { return { ...this.state }; }

  start() {
    this.stop();
    if (!this.state.configured || this.getSettings()?.autoCheckUpdates === false) return;
    this.startTimer = setTimeout(() => this.check({ manual: false }).catch(() => {}), 60_000);
    this.interval = setInterval(() => this.check({ manual: false }).catch(() => {}), SIX_HOURS);
    this.startTimer.unref?.();
    this.interval.unref?.();
  }

  stop() {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.interval) clearInterval(this.interval);
    this.startTimer = null;
    this.interval = null;
  }

  async check({ manual = false } = {}) {
    if (['checking', 'downloading', 'verifying'].includes(this.state.phase)) return this.snapshot();
    if (!this.state.configured) {
      const state = this.patch({ phase: 'unconfigured', manual, error: '当前为内部测试版本，暂不提供在线更新。请使用经过校验的新版安装包手动覆盖升级。' }, 'unconfigured');
      if (manual) await this.dialog.showMessageBox({ type: 'info', title: '检查更新', message: `当前版本：${this.currentPublicVersion}`, detail: state.error });
      return state;
    }
    this.availableUpdateMetadata = null;
    this.downloadedUpdateMetadata = null;
    this.lastDownloadPaths = [];
    this.patch({ phase: 'checking', manual, error: '', blockers: [], rejectedReasons: [] }, 'manual-check');
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      const message = this.friendlyError(error);
      this.patch({ phase: 'error', error: message, checkedAt: new Date().toISOString() }, 'check-failed');
      if (manual) await this.dialog.showMessageBox({ type: 'error', title: '检查更新失败', message: '暂时无法完成更新检查', detail: message });
    }
    return this.snapshot();
  }

  async download() {
    if (this.state.phase !== 'available') throw Object.assign(new Error('当前没有可下载的新版本'), { code: 'UPDATE_NOT_AVAILABLE' });
    this.patch({ phase: 'downloading', percent: 0, error: '' }, 'download-started');
    try {
      const paths = await this.updater.downloadUpdate();
      this.lastDownloadPaths = Array.isArray(paths) ? paths.filter(item => typeof item === 'string' && item.trim()) : [];
      if (this.state.phase === 'downloading') {
        const file = firstInstallerPath(this.lastDownloadPaths);
        if (!file) throw Object.assign(new Error('更新下载完成但没有返回安装包路径'), { code: 'UPDATE_DOWNLOADED_PATH_MISSING' });
        this.beginVerification({
          version: this.state.availableVersion,
          publicVersion: this.state.availablePublicVersion,
          notes: this.state.releaseNotes,
          file,
          updateMetadata: this.availableUpdateMetadata,
          metadataComparison: { ok: true, reasons: [] }
        });
      }
    } catch (error) {
      this.patch({ phase: 'error', error: this.friendlyError(error) }, 'download-failed');
      throw error;
    }
    return this.snapshot();
  }

  async preflight() {
    const backend = await this.apiRequest('/api/r32/system/update-preflight').catch(error => ({
      ok: false, safeToInstall: false,
      blockers: [{ id: 'preflight-unavailable', severity: 'high', label: '无法确认后台任务状态', detail: error.message }]
    }));
    const renderer = this.rendererWorkStateOverride || this.getRendererWorkState?.() || {};
    const blockers = [...(backend.blockers || [])];
    if (renderer.unsavedChanges) blockers.push({ id: 'unsaved-changes', severity: 'high', label: '主窗口存在未保存内容', detail: renderer.detail || '请先保存或取消当前编辑' });
    if (renderer.pendingReplyApproval) blockers.push({ id: 'reply-approval', severity: 'medium', label: '存在待确认的 AI 候选回复', detail: '完成确认或关闭候选后再安装' });
    return { safeToInstall: blockers.length === 0, blockers, backend, renderer, checkedAt: new Date().toISOString() };
  }

  async install() {
    if (this.state.phase !== 'ready') throw Object.assign(new Error('更新尚未准备就绪'), { code: 'UPDATE_NOT_READY' });
    const internalTestMode = isInternalTestMode();
    const preflight = await this.preflight();
    if (!preflight.safeToInstall) {
      this.patch({ blockers: preflight.blockers }, 'install-blocked');
      await this.dialog.showMessageBox({
        type: 'warning', title: '暂时不能安装更新', message: '请先完成当前任务',
        detail: preflight.blockers.map(item => `• ${item.label}${item.detail ? `：${item.detail}` : ''}`).join('\n')
      });
      return { installed: false, ...preflight };
    }
    const warning = internalTestMode ? '\n\n这是内部未签名测试更新，不代表正式可信发布。' : '';
    const result = await this.dialog.showMessageBox({
      type: 'question', title: '重启并安装更新', message: `安装${this.publicProductName} ${this.state.availablePublicVersion || this.state.availableVersion}`,
      detail: `应用将安全关闭并安装已验证的更新。此操作需要你的明确确认。${warning}`,
      buttons: ['重启并安装', '稍后'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (result.response !== 0) return { installed: false, cancelled: true };
    if (this.lifecycleManager) await this.lifecycleManager.beginUpdate('user-confirmed-update-install');
    this.patch({ phase: 'installing', blockers: [] }, 'install-confirmed');
    setImmediate(() => this.updater.quitAndInstall(false, true));
    return { installed: true };
  }
}

module.exports = { UpdateManager, firstInstallerPath, isInternalTestMode };
