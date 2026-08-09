'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { randomUUID, createHash } = require('crypto');
const STATIC_RELEASE_SOURCE = require('../release/release-source.json');
const { resolveYanceDataRootSync } = require('./dataRootMigration');
const { fileURLToPath, pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Notification,
  Tray,
  Menu,
  nativeImage,
  session,
  powerMonitor,
  net
} = require('electron');

// Real Windows source UAT must remain launchable on machines where Chromium's
// GPU process repeatedly exits (for example after a driver reset or remote
// desktop transition). This is intentionally scoped to source UAT and can be
// overridden with YANCE_ENABLE_HARDWARE_ACCELERATION=1. Installed production
// builds keep their existing hardware-acceleration policy.
const SOURCE_UAT_SOFTWARE_RENDERING = process.platform === 'win32' &&
  process.env.YANCE_SOURCE_UAT === '1' &&
  process.env.YANCE_DISABLE_GPU !== '0' &&
  process.env.YANCE_ENABLE_HARDWARE_ACCELERATION !== '1';
const EXPLICIT_SOFTWARE_RENDERING = process.env.YANCE_DISABLE_GPU === '1' &&
  process.env.YANCE_ENABLE_HARDWARE_ACCELERATION !== '1';
if (SOURCE_UAT_SOFTWARE_RENDERING || EXPLICIT_SOFTWARE_RENDERING) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
// Ultra-early packaged bootstrap diagnostics. This is initialized before any
// local business module is loaded so a Windows-only require/ABI failure cannot
// disappear before the normal desktop logger exists.
const EARLY_DATA_ROOT_RESOLUTION = resolveYanceDataRootSync({
  appDataPath: app.getPath('appData'),
  explicitDataRoot: process.env.YANCE_DATA_DIR,
  newDirectoryName: STATIC_RELEASE_SOURCE.userDataDirectoryName,
  legacyDirectoryNames: STATIC_RELEASE_SOURCE.legacyCompatibility?.dataDirectoryNames || [],
  allowLegacyFallback: true
});
const EARLY_BOOT_DATA_ROOT = path.resolve(EARLY_DATA_ROOT_RESOLUTION.dataRoot);
const EARLY_BOOT_LOG_FILE = path.join(EARLY_BOOT_DATA_ROOT, 'logs', 'desktop-bootstrap.jsonl');
let earlyBootImportStage = 'electron-core-loaded';
function earlyBootLogSync(event, detail = {}) {
  try {
    fs.mkdirSync(path.dirname(EARLY_BOOT_LOG_FILE), { recursive: true });
    const record = JSON.stringify({ at: new Date().toISOString(), event, pid: process.pid, importStage: earlyBootImportStage, ...detail });
    fs.appendFileSync(EARLY_BOOT_LOG_FILE, `${record}\n`, 'utf8');
  } catch (_) {}
}
earlyBootLogSync('electron-main-module-enter', {
  executablePath: process.execPath,
  resourcesPath: process.resourcesPath || '',
  appDataPath: app.getPath('appData'),
  packaged: app.isPackaged,
  dataRootMigrationStatus: EARLY_DATA_ROOT_RESOLUTION.status,
  dataRootMigrationFallback: EARLY_DATA_ROOT_RESOLUTION.fallbackToLegacy === true,
  dataRootMigrationReviewRequired: EARLY_DATA_ROOT_RESOLUTION.requiresMigrationReview === true,
  dataRootMigrationReasonCode: EARLY_DATA_ROOT_RESOLUTION.reasonCode || null,
  argv: process.argv.slice(0, 8),
  execArgv: process.execArgv.slice(0, 8),
  softwareRendering: SOURCE_UAT_SOFTWARE_RENDERING || EXPLICIT_SOFTWARE_RENDERING,
  softwareRenderingSource: SOURCE_UAT_SOFTWARE_RENDERING ? 'source-uat-default' : EXPLICIT_SOFTWARE_RENDERING ? 'explicit' : 'disabled'
});
process.on('uncaughtExceptionMonitor', error => {
  earlyBootLogSync('electron-main-early-uncaught-exception', {
    code: error?.code || '',
    message: error?.message || String(error || ''),
    stack: String(error?.stack || '').slice(0, 12000)
  });
});
process.on('unhandledRejection', reason => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  earlyBootLogSync('electron-main-early-unhandled-rejection', {
    code: error.code || '',
    message: error.message,
    stack: String(error.stack || '').slice(0, 12000)
  });
});

earlyBootImportStage = 'business-module-imports';
const WebSocket = require('ws');
const { disposeEventSocket } = require('./eventSocketLifecycle');
const { installR32LocalApiHeader } = require('./r32LocalApiSession');
const { installR32WindowSecurity, isTrustedMainFrameIpcEvent } = require('./r32WindowSecurity');
const { CredentialVault } = require('./credentialVault');
const { recoverCredentialVaults } = require('./credentialVaultRecovery');
const { R32DesktopSettings } = require('./r32DesktopSettings');
const { initialsAvatarDataUrl, normalizeNotificationPresentation } = require('./notificationPresentation');
const { installR32StoreBridge } = require('./r32StoreBridge');
const { createBackendStartupSupervisor } = require('./backendStartupSupervisor');
const { UpdateManager } = require('./updateManager');
earlyBootImportStage = 'desktop-host-import';
const { DesktopCredentialApplicationCoordinator, DesktopHost, ReleaseManifestHost } = require('./desktopHost');
const { LegacyRuntimeCutoverGate } = require('./desktopHost/LegacyRuntimeCutoverGate');
const { ApiV2RuntimeClient } = require('./desktopHost/ApiV2RuntimeClient');
const { RuntimeProjectionCoordinator } = require('./desktopHost/RuntimeProjectionCoordinator');
const { backendAuthority, stopOwnedBackend, completeElectronQuit, restartElectronApp } = require('./backendShutdownCoordinator');
const { createLettaAgentRuntime } = require('./lettaAgentRuntime');
const { createParlantRelationshipRuntime, createRelationshipTaskSequencer } = require('./parlantRelationshipRuntime');
const { createGraphitiRelationshipRuntime, createNeo4jPassword } = require('./graphitiRelationshipRuntime');
const { createMediaBrainRuntime, mergeImmichConfiguration, mergeComfyuiConfiguration } = require('./mediaBrainRuntime');
const { SoundNotificationService } = require('./SoundNotificationService');
const { isCustomSoundPattern, soundFileName } = require('../shared/notificationSoundCatalog');
const { runInstalledRuntimeProbeApplicationEntry } = require('./wp7InstalledRuntimeProbeApplicationEntry');
const { createWp7InstalledRuntimeProbeMainAdapter } = require('./wp7InstalledRuntimeProbeMainAdapter');
const { createInstalledRuntimeProbeOperations } = require('./wp7InstalledRuntimeProbeOperations');
const { createMainWindowActivationController } = require('./mainWindowActivationController');
const { createMainWindowRuntimeReadiness } = require('./mainWindowRuntimeReadiness');
const { preserveTaskbarOnMinimize, hideWindowToTray, restoreWindowTaskbar } = require('./windowLifecyclePolicy');
const { getElectronReleaseIdentity } = require('./releaseIdentity');
const { classifyChildProcessGone } = require('./runtimeProcessHealthAuthority');
const { readInstallerIdentityReceipt } = require('../installer/installedIdentityReceipt');
const { isPostInstallReason, writePostInstallLaunchReceipt } = require('./postInstallLaunchReceipt');
const { loadReleasePlatformAuth } = require('../shared/release/releasePlatformAuth');
earlyBootImportStage = 'business-modules-loaded';
earlyBootLogSync('electron-main-business-modules-loaded');
const {
  atomicWriteJson: writeWp7AtomicJson,
  createElectronRendererStorageSession,
  createSafeModeScenarioRunner,
  directTrustedBackendProjection,
  readNetworkIsolationStartupObservation,
  scanDuplicateRuntimeEntrypoints,
  waitForTrustedReplacementOwner
} = require('./wp7InstalledRuntimeProbeProductionHost');

// === M2 Electron Main — 状态机与 IPC 守卫（Commit1 基础层） ===
// 这些引入不修改任何既有行为；mainState 是收敛后的规范生命周期状态对象，
// 后续 M2 commit 将把分散的模块级变量逐步迁移到 transition() 驱动。
const m2StateMachine = require('./m2/stateMachine');
const m2IpcGuard = require('./m2/ipcGuard');
const m2LifecycleRegistry = require('./m2/lifecycleRegistry');
const m2StartupFailure = require('./m2/startupFailure');
const m2TrayController = require('./m2/trayController');
const m2PackagedLaunchResolver = require('./m2/packagedLaunchResolver');
let mainState = m2StateMachine.initialState();

// M2 生命周期注册表（P0-6）：统一登记并清理 timer / eventSocket / tray。
const m2Registry = m2LifecycleRegistry.createRegistry();

// 真契约 manifest（electron/m2/ipcManifest.json），供 ipcGuard 驱动 denylist / 生命周期守卫。
// 加载失败不致命：降级为空契约，所有 channel 经 guardChannel 原样透传，保证既有行为。
let m2Manifest;
let m2IpcIndex;
try {
  m2Manifest = m2IpcGuard.loadManifest();
  m2IpcIndex = m2IpcGuard.indexManifest(m2Manifest);
} catch (err) {
  if (typeof desktopLog === 'function') desktopLog('error', 'm2-manifest-load-failed', { message: err && err.message });
  m2Manifest = { handlers: [], denylist: [] };
  m2IpcIndex = m2IpcGuard.indexManifest(m2Manifest);
}

// IPC 守卫上下文：读取 main.js 现有真实生命周期变量（不迁移全局变量，避免回归）。
// 未声明于契约的 channel 经 guardChannel 原样透传。
function m2GuardCtx() {
  return {
    stateName: mainState.name,
    backendReady,
    quitting,
    relaunchPending,
    backendRestarting
  };
}
// 本会话主接线采用软校验（validateInput:false）：denylist + 生命周期守卫强制生效，
// inputSchema 仅由单元测试覆盖，主进程不拦截（避免破坏既有 renderer 契约）。
// 确认契约后改为 true 即开启严格 inputSchema 校验（需 Windows 本机验证）。
const M2_STRICT_SCHEMA = false;
function m2Guard(channel, fn) {
  return m2IpcGuard.guardChannel(m2IpcIndex, channel, fn, m2GuardCtx, { validateInput: M2_STRICT_SCHEMA });
}
// 包装 ipcMain.handle：把每个桌面 handler 接入 M2 IPC 守卫（denylist / 生命周期守卫 / 软 schema）。
function assertPrivilegedIpcEvent(event, channel) {
  if (!mainWindow || !isTrustedMainFrameIpcEvent(event, {
    webContents: mainWindow.webContents,
    allowedOrigins: [YANCE_ELEMENT_URL]
  })) {
    const error = new Error(`Rejected privileged IPC from an untrusted frame: ${channel}`);
    error.reasonCode = 'DESKTOP_IPC_UNTRUSTED_FRAME';
    throw error;
  }
  return true;
}

function ipcGuardHandle(channel, fn) {
  ipcMain.handle(channel, m2Guard(channel, (event, ...args) => {
    assertPrivilegedIpcEvent(event, channel);
    return fn(event, ...args);
  }));
}

// 调试/诊断通道：暴露 M2 规范状态快照，经 ipcGuard 守卫（自包含 inline manifest，不依赖外部契约文件）。
// 这是一个新增通道，不改动任何既有 IPC handler。
function registerM2DebugIpc() {
  const debugManifest = {
    handlers: [
      {
        channel: 'desktop:m2-state-snapshot',
        direction: 'renderer-to-main',
        phase: 'pre-ready',
        inputSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
        outputSchema: { type: 'object', additionalProperties: true, required: [] },
        requiresBackendReady: false,
        allowedDuringQuitting: true,
        allowedDuringRestart: true,
        reasonCodeOnFailure: 'DESKTOP_IPC_CONTRACT_VIOLATION',
        sensitiveFields: []
      }
    ]
  };
  m2IpcGuard.registerGuardedHandlers(ipcMain, debugManifest, {
    'desktop:m2-state-snapshot': () => ({
      ok: true,
      state: {
        name: mainState.name,
        backendReady: mainState.backendReady,
        quitting: mainState.quitting,
        relaunchPending: mainState.relaunchPending,
        backendRestarting: mainState.backendRestarting,
        backendPid: mainState.backendPid
      }
    })
  }, () => ({
    stateName: mainState.name,
    backendReady: mainState.backendReady,
    quitting: mainState.quitting,
    relaunchPending: mainState.relaunchPending,
    backendRestarting: mainState.backendRestarting
  }));
}

const APP_ROOT = path.resolve(__dirname, '..');
let VERIFIED_RELEASE_IDENTITY = null;
let releaseManifestHost = null;
function controlledResourcesPath() {
  if (process.env.WP7_BOOT_FAILURE_CHILD === '1') {
    const injected = String(process.env.WP7_BOOT_FAILURE_RESOURCES_PATH || '').trim();
    if (!injected) {
      const error = new Error('WP7 boot-failure child requires an explicit resources path');
      error.reasonCode = 'WP7_BOOT_FAILURE_RESOURCES_PATH_REQUIRED';
      throw error;
    }
    return path.resolve(injected);
  }
  if (app.isPackaged) return process.resourcesPath;
  const configured = String(process.env.YANCE_RELEASE_RESOURCES_PATH || '').trim();
  if (!configured) {
    const error = new Error('Source-mode DesktopHost requires explicit YANCE_RELEASE_RESOURCES_PATH');
    error.reasonCode = 'DESKTOP_RELEASE_RESOURCES_PATH_REQUIRED';
    throw error;
  }
  return path.resolve(configured);
}
function releaseIdentity() {
  if (desktopHost) return desktopHost.verifyReleaseIdentity();
  if (!releaseManifestHost) releaseManifestHost = new ReleaseManifestHost({ resourcesPath: controlledResourcesPath() });
  if (!VERIFIED_RELEASE_IDENTITY) VERIFIED_RELEASE_IDENTITY = releaseManifestHost.verify();
  return VERIFIED_RELEASE_IDENTITY;
}

function packagedAppRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app') : APP_ROOT;
}

function packagedNodeModulesPath() {
  return path.join(packagedAppRoot(), 'node_modules');
}

function resolveTrustedNodeRuntime() {
  if (!app.isPackaged) return process.execPath;
  const identity = releaseIdentity();
  const relative = String(identity.nodeRuntimeExecutablePath || 'runtime/node22/node.exe').replace(/\\/g, '/');
  const candidates = [];
  if (relative) candidates.push(path.join(process.resourcesPath, ...relative.split('/')));
  candidates.push(path.join(process.resourcesPath, 'runtime', 'node22', process.platform === 'win32' ? 'node.exe' : 'node'));
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!found) {
    const error = new Error(`Bundled Node runtime is missing: ${candidates.join(' | ')}`);
    error.code = 'NODE_RUNTIME_MISSING';
    error.reasonCode = 'NODE_RUNTIME_MISSING';
    error.candidates = candidates;
    throw error;
  }
  return found;
}

// M8 — Native-binary / runtime-node governance guard rail (diagnostic only, fail-open).
// Probes the bundled runtime node and classifies shipped native addons for ABI compatibility.
// Never alters the launch decision; only logs. Implementation: electron/m2/nativeBinaryGovernance.js.
function governRuntimeNativeBinariesBootCheck() {
  try {
    const govern = require('./m2/nativeBinaryGovernance');
    const nodeExe = resolveTrustedNodeRuntime();
    const report = govern.governRuntimeNodeNativeBinaries(nodeExe, govern.KNOWN_NATIVE_ADDONS, {});
    desktopLog('info', 'native-binary-governance', {
      recommendation: report.recommendation,
      moduleVersion: report.runtimeNode && report.runtimeNode.moduleVersion,
      addonCount: (report.addons || []).length
    });
    if (report.recommendation !== 'ACCEPT') {
      desktopLog('warn', 'native-binary-governance-non-accept', {
        recommendation: report.recommendation,
        summary: report.summary
      });
    }
  } catch (govErr) {
    desktopLog('warn', 'native-binary-governance-error', { message: (govErr && govErr.message) || String(govErr) });
  }
}

const YANCE_BACKEND_URL = `http://127.0.0.1:${Number(process.env.YANCE_PORT || 27632)}`;
const YANCE_ELEMENT_URL = String(process.env.YANCE_ELEMENT_URL || 'http://127.0.0.1:8080').replace(/\/+$/u, '');
const YANCE_ELEMENT_HEALTH_URL = String(process.env.YANCE_ELEMENT_HEALTH_URL || `${YANCE_ELEMENT_URL}/config.json`);
const WP7_APPLICATION_PROCESS_STARTED_AT_UTC = new Date().toISOString();
const WP7_NETWORK_OBSERVED_AT_UTC = new Date().toISOString();
let WP7_NETWORK_ONLINE_AT_PROCESS_START = true;
try { WP7_NETWORK_ONLINE_AT_PROCESS_START = net.isOnline(); } catch (_) {}
const DATA_ROOT = EARLY_BOOT_DATA_ROOT;
const WP7_INITIAL_DATA_ROOT_EXISTED = fs.existsSync(DATA_ROOT);
const WP7_INITIAL_SQLITE_PATH = path.join(DATA_ROOT, 'store', 'yance-r32.db');
const WP7_INITIAL_SQLITE_EXISTED = fs.existsSync(WP7_INITIAL_SQLITE_PATH);
let wp7BackendLaunchStartedAtUtc = '';
process.env.YANCE_DATA_DIR = DATA_ROOT;
const { discoverLegacyDataRoots } = require('./legacyDataRoots');
app.setPath('userData', DATA_ROOT);
app.setName(STATIC_RELEASE_SOURCE.publicProductName);
if (process.platform === 'win32') app.setAppUserModelId(STATIC_RELEASE_SOURCE.appUserModelId);

const PATHS = Object.freeze({
  root: DATA_ROOT,
  store: path.join(DATA_ROOT, 'store'),
  sqlite: path.join(DATA_ROOT, 'store', 'yance-r32.db'),
  logs: path.join(DATA_ROOT, 'logs'),
  secure: path.join(DATA_ROOT, 'secure'),
  portableBackups: path.join(DATA_ROOT, 'portable-backups')
});
for (const dir of [PATHS.root, PATHS.store, PATHS.logs, PATHS.secure, PATHS.portableBackups]) fs.mkdirSync(dir, { recursive: true });

const DESKTOP_LOG_FILE = path.join(PATHS.logs, 'desktop.jsonl');
earlyBootImportStage = 'desktop-log-ready';
earlyBootLogSync('electron-main-desktop-log-ready', { desktopLogFile: DESKTOP_LOG_FILE, dataRootResolution: EARLY_DATA_ROOT_RESOLUTION });
function desktopLog(level, event, detail = {}) {
  const record = JSON.stringify({ at: new Date().toISOString(), level, event, pid: process.pid, ...detail });
  fs.appendFile(DESKTOP_LOG_FILE, `${record}\n`, () => {});
}

function desktopLogSync(level, event, detail = {}) {
  try {
    const record = JSON.stringify({ at: new Date().toISOString(), level, event, pid: process.pid, ...detail });
    fs.appendFileSync(DESKTOP_LOG_FILE, `${record}\n`);
  } catch (_) {}
}

function mirrorBackendOutput(stream, prefix, data) {
  const text = String(data || '');
  desktopLog(prefix === 'stderr' ? 'warn' : 'info', `backend-${prefix}`, { text: text.slice(-16 * 1024) });
  if (!stream?.isTTY || stream.destroyed || !stream.writable) return;
  try { stream.write(`[backend] ${text}`, () => {}); } catch (_) {}
}

process.on('uncaughtExceptionMonitor', error => {
  desktopLogSync('error', 'main-uncaught-exception', { code: error.code || '', error: error.stack || error.message });
});
process.on('unhandledRejection', reason => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  desktopLogSync('error', 'main-unhandled-rejection', { code: error.code || '', error: error.stack || error.message });
  setImmediate(() => { throw error; });
});

const DESKTOP_SMOKE = process.env.YANCE_DESKTOP_SMOKE === '1';
const DESKTOP_SMOKE_OUTPUT = path.resolve(process.env.YANCE_DESKTOP_SMOKE_OUTPUT || path.join(DATA_ROOT, 'desktop-smoke-result.json'));
const MEMORY_SOAK = process.env.YANCE_MEMORY_SOAK === '1';
const MEMORY_SOAK_OUTPUT = path.resolve(process.env.YANCE_MEMORY_SOAK_OUTPUT || path.join(DATA_ROOT, 'windows-memory-soak.json'));
const CREDENTIAL_PERSISTENCE_MODE = String(process.env.YANCE_CREDENTIAL_PERSISTENCE_MODE || '').trim().toLowerCase();
const CREDENTIAL_PERSISTENCE_OUTPUT = path.resolve(process.env.YANCE_CREDENTIAL_PERSISTENCE_OUTPUT || path.join(DATA_ROOT, 'credential-persistence-phase.json'));
const CREDENTIAL_PERSISTENCE_REF = String(process.env.YANCE_CREDENTIAL_PERSISTENCE_REF || 'acceptance:credential-persistence').trim();
const CREDENTIAL_PERSISTENCE_SECRET = String(process.env.YANCE_CREDENTIAL_PERSISTENCE_SECRET || '').trim();
const ACCEPTANCE_CANDIDATE_ID = String(process.env.YANCE_ACCEPTANCE_CANDIDATE_ID || '').trim();
const ACCEPTANCE_SOURCE_FINGERPRINT = String(process.env.YANCE_ACCEPTANCE_SOURCE_FINGERPRINT || '').trim();
const ACCEPTANCE_EXECUTABLE_SHA256 = String(process.env.YANCE_ACCEPTANCE_EXECUTABLE_SHA256 || '').trim().toLowerCase();

function parseDesktopLaunchIntent(argv = process.argv) {
  const args = Array.isArray(argv) ? argv.map(value => String(value || '')) : [];
  const deepLink = args.find(value => /^yance:\/\//i.test(value)) || args.find(value => /^yance29:\/\//i.test(value)) || '';
  const postInstall = args.includes('--post-install');
  return {
    postInstall,
    deepLink,
    forceVisible: postInstall || Boolean(deepLink),
    payload: { ...(postInstall ? { postInstall: true } : {}), ...(deepLink ? { deepLink } : {}) }
  };
}

const INITIAL_DESKTOP_LAUNCH_INTENT = parseDesktopLaunchIntent(process.argv);

installR32LocalApiHeader({ app, session, baseURL: YANCE_BACKEND_URL, tokenProvider: () => currentApiSessionToken({ required: false }) });
installR32WindowSecurity({
  app,
  allowedNavigationOrigins: [YANCE_ELEMENT_URL],
  allowedWebviewOrigins: ['https://web.whatsapp.com', 'https://web.telegram.org', 'https://www.facebook.com', 'https://business.facebook.com'],
  allowedExternalOrigins: ['https://web.whatsapp.com', 'https://web.telegram.org', 'https://www.facebook.com', 'https://business.facebook.com'],
  allowedWebviewPreloadPaths: [path.join(__dirname, 'webview-preload.js')],
  openExternal: url => shell.openExternal(url)
});

let mainWindow = null;

app.on('child-process-gone', (_event, details = {}) => {
  const health = classifyChildProcessGone(details);
  desktopLog(health.fatal ? 'error' : health.recoverable ? 'warn' : 'info', 'desktop-child-process-gone', health);
  sendToRenderer('desktop:runtime-health', health);
});

// --- P0-A Phase 3b: canonical sound notification gating (OD-003 DI-2=A) ---
// SoundNotificationService is the single decision authority for whether a sound plays.
// Settings are synced from the backend (single source of truth); the active conversation id
// arrives via backend poll + immediate IPC; real window focus/visibility drives suppression.
const soundNotificationService = new SoundNotificationService({
  settings: {},
  presentNotification: (payload) => {
    try { return Promise.resolve(showNotification(payload || {})); }
    catch (error) { return Promise.resolve({ shown: false, reason: String((error && error.message) || 'present-notification-failed') }); }
  },
  playSound: (opts = {}) => {
    try { return requestRendererSound({ pattern: opts.pattern, volume: opts.volume, force: opts.force }); }
    catch (error) { return Promise.resolve({ played: false, reason: String((error && error.message) || 'sound-play-failed'), durationMs: 0, engine: 'sound-notification-service' }); }
  },
  presentTrayUnread: count => presentTrayUnread(count),
  log: (...args) => { try { console.log('[sound-notification]', ...args); } catch (_) {} }
});

function normalizeSoundKind(pattern) {
  const p = String(pattern || '').toLowerCase();
  if (p === 'message' || p === 'message-in' || p === 'incoming') return 'message-in';
  if (p === 'message-sent' || p === 'sent' || p === 'send') return 'message-sent';
  if (p === 'send-failed' || p === 'failed') return 'send-failed';
  if (p === 'contact-online' || p === 'online') return 'contact-online';
  if (p === 'contact-offline' || p === 'offline') return 'contact-offline';
  return p || 'message-in';
}

let soundSettingsSyncTimer = null;
async function refreshNotificationSettings() {
  try {
    const res = await fetch(`${YANCE_BACKEND_URL}/api/r32/system/notifications`);
    if (!res.ok) return;
    const data = await res.json();
    const settings = data && data.settings ? data.settings : null;
    if (!settings) return;
    soundNotificationService.setSettings(settings);
    soundNotificationService.setWindowState({ activeConversationId: String(settings.activeConversationId || '') });
  } catch (_) { /* backend not ready / unreachable: keep last known settings */ }
}
let soundWindow = null;
let tray = null;
let trayContextMenu = null;
let pendingMainWindowPayload = null;
let mainWindowActivationController = null;
let mainWindowRuntimeReadiness = null;
const backendActivationWaiters = new Set();
let lastTrayActivationAt = 0;
let updateManager = null;
let desktopHost = null;
let desktopCredentialApplicationCoordinator = null;
let runtimeApiV2Client = null;
let runtimeProjectionCoordinator = null;
let lettaAgentRuntime = null;
let parlantRelationshipRuntime = null;
let graphitiRelationshipRuntime = null;
let mediaBrainRuntime = null;
const parlantInboundSequencer = createRelationshipTaskSequencer();

function ensureLettaAgentRuntime() {
  if (!lettaAgentRuntime) {
    lettaAgentRuntime = createLettaAgentRuntime({
      nodeExecutablePath: resolveTrustedNodeRuntime(),
      dataRoot: DATA_ROOT
    });
  }
  return lettaAgentRuntime;
}

function projectLettaRendererState(state = {}) {
  return Object.freeze({
    ready: state.ready === true,
    reasonCode: String(state.lastError?.reasonCode || '')
  });
}

const PARLANT_OPENROUTER_CREDENTIAL_REF = 'model:openrouter:default';
const GRAPHITI_OPENROUTER_CREDENTIAL_REF = PARLANT_OPENROUTER_CREDENTIAL_REF;
const GRAPHITI_NEO4J_CREDENTIAL_REF = 'runtime:graphiti:neo4j';
const GRAPHITI_NEO4J_CREDENTIAL_PROVISION = 'GRAPHITI_NEO4J_CREDENTIAL_PROVISION';

function readGraphitiOpenRouterApiKey() {
  const credential = vault?.get?.(GRAPHITI_OPENROUTER_CREDENTIAL_REF) || null;
  const apiKey = String(credential?.apiKey || '').trim();
  if (!apiKey) {
    const error = new Error('OpenRouter credential is not configured for Graphiti relationship memory.');
    error.reasonCode = 'DESKTOP_GRAPHITI_OPENROUTER_CREDENTIAL_MISSING';
    throw error;
  }
  return apiKey;
}

function readGraphitiNeo4jPassword() {
  const credential = vault?.get?.(GRAPHITI_NEO4J_CREDENTIAL_REF) || null;
  const password = String(credential?.password || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/u.test(password)) {
    const error = new Error('Graphiti Neo4j runtime credential is missing or invalid.');
    error.reasonCode = 'DESKTOP_GRAPHITI_NEO4J_CREDENTIAL_MISSING';
    throw error;
  }
  return password;
}

async function ensureGraphitiNeo4jCredentialProvisioned(applicationLeaseToken) {
  const existing = vault?.get?.(GRAPHITI_NEO4J_CREDENTIAL_REF) || null;
  if (existing) {
    const password = String(existing.password || '').trim();
    if (!/^[A-Za-z0-9_-]{43}$/u.test(password)) {
      const error = new Error('Persisted Graphiti Neo4j credential is malformed.');
      error.reasonCode = 'DESKTOP_GRAPHITI_NEO4J_CREDENTIAL_INVALID';
      throw error;
    }
    return { created: false, ref: GRAPHITI_NEO4J_CREDENTIAL_REF };
  }
  if (!vault?.available) {
    const error = new Error('Operating-system secure credential storage is unavailable for Graphiti Neo4j.');
    error.reasonCode = 'DESKTOP_GRAPHITI_SECURE_STORAGE_UNAVAILABLE';
    throw error;
  }
  if (!desktopHost?.credentialVaultHost || !applicationLeaseToken) {
    const error = new Error('Graphiti Neo4j credential provisioning requires the existing credential authority lease.');
    error.reasonCode = 'DESKTOP_GRAPHITI_CREDENTIAL_AUTHORITY_UNAVAILABLE';
    throw error;
  }
  const mutation = await desktopHost.credentialVaultHost.executeDesktopMutation('persist', GRAPHITI_NEO4J_CREDENTIAL_REF, {
    password: createNeo4jPassword()
  }, {
    requestId: `${GRAPHITI_NEO4J_CREDENTIAL_PROVISION.toLowerCase()}:${randomUUID()}`,
    applicationLeaseToken
  });
  if (mutation?.transactionState !== 'COMMITTED' || mutation?.persisted !== true) {
    const error = new Error('Graphiti Neo4j credential did not reach a durable committed state.');
    error.reasonCode = mutation?.reasonCode || 'DESKTOP_GRAPHITI_CREDENTIAL_PERSIST_FAILED';
    throw error;
  }
  return { created: true, ref: GRAPHITI_NEO4J_CREDENTIAL_REF };
}

function ensureGraphitiRelationshipRuntime() {
  if (!graphitiRelationshipRuntime) {
    graphitiRelationshipRuntime = createGraphitiRelationshipRuntime({
      resourcesPath: controlledResourcesPath(),
      dataRoot: DATA_ROOT,
      getOpenRouterApiKey: () => readGraphitiOpenRouterApiKey(),
      getNeo4jPassword: () => readGraphitiNeo4jPassword()
    });
  }
  return graphitiRelationshipRuntime;
}

const MEDIA_IMMICH_CREDENTIAL_REF = 'media:immich:default';
const MEDIA_COMFYUI_CREDENTIAL_REF = 'media:comfyui:default';

function readMediaConfiguration(ref, fallbackEndpoint) {
  const credential = vault?.get?.(ref) || {};
  return Object.freeze({
    endpoint: String(credential.endpoint || fallbackEndpoint || '').trim(),
    apiKey: String(credential.apiKey || '').trim(),
    allowExternalEndpoint: credential.allowExternalEndpoint === true
  });
}

function ensureMediaBrainRuntime() {
  if (!mediaBrainRuntime) {
    mediaBrainRuntime = createMediaBrainRuntime({
      workflowDirectory: path.join(APP_ROOT, 'config', 'comfyui-workflows'),
      getImmichConfiguration: () => readMediaConfiguration(MEDIA_IMMICH_CREDENTIAL_REF, 'http://127.0.0.1:2283'),
      getComfyuiConfiguration: () => readMediaConfiguration(MEDIA_COMFYUI_CREDENTIAL_REF, 'http://127.0.0.1:8188')
    });
  }
  return mediaBrainRuntime;
}

function mediaConfigurationChanged(current, next) {
  return String(current?.endpoint || '') !== String(next?.endpoint || '')
    || String(current?.apiKey || '') !== String(next?.apiKey || '')
    || (current?.allowExternalEndpoint === true) !== (next?.allowExternalEndpoint === true);
}

async function saveMediaBrainSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Media settings input must be an object.'), { reasonCode: 'DESKTOP_MEDIA_SETTINGS_INPUT_INVALID' });
  }
  const currentImmich = readMediaConfiguration(MEDIA_IMMICH_CREDENTIAL_REF, 'http://127.0.0.1:2283');
  const currentComfyui = readMediaConfiguration(MEDIA_COMFYUI_CREDENTIAL_REF, 'http://127.0.0.1:8188');
  const nextImmich = mergeImmichConfiguration(currentImmich, {
    endpoint: input.immichEndpoint,
    apiKey: input.immichApiKey,
    clearApiKey: input.clearImmichApiKey === true,
    allowExternalEndpoint: input.immichAllowExternalEndpoint === true
  });
  const nextComfyui = mergeComfyuiConfiguration(currentComfyui, {
    endpoint: input.comfyuiEndpoint,
    allowExternalEndpoint: input.comfyuiAllowExternalEndpoint === true
  });
  const requestBase = `media-settings:${randomUUID()}`;
  let immichUpdated = false;
  let comfyuiUpdated = false;
  if (mediaConfigurationChanged(currentImmich, nextImmich)) {
    await applyVaultMutationWithRestart('persist', MEDIA_IMMICH_CREDENTIAL_REF, nextImmich, { requestId: `${requestBase}:immich` });
    immichUpdated = true;
  }
  if (mediaConfigurationChanged(currentComfyui, nextComfyui)) {
    await applyVaultMutationWithRestart('persist', MEDIA_COMFYUI_CREDENTIAL_REF, nextComfyui, { requestId: `${requestBase}:comfyui` });
    comfyuiUpdated = true;
  }
  return Object.freeze({
    ok: true,
    immich: Object.freeze({ endpoint: nextImmich.endpoint, allowExternalEndpoint: nextImmich.allowExternalEndpoint, hasApiKey: Boolean(nextImmich.apiKey), updated: immichUpdated }),
    comfyui: Object.freeze({ endpoint: nextComfyui.endpoint, allowExternalEndpoint: nextComfyui.allowExternalEndpoint, updated: comfyuiUpdated })
  });
}

function normalizeMediaSendInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Media send input must be an object.'), { reasonCode: 'DESKTOP_MEDIA_SEND_INPUT_INVALID' });
  }
  const platform = String(input.platform || '').trim().toLowerCase();
  const accountId = String(input.accountId || '').trim();
  const chatJid = String(input.chatJid || '').trim();
  const assetId = String(input.assetId || '').trim();
  if (!['whatsapp', 'telegram', 'facebook'].includes(platform)) throw Object.assign(new Error('Media send platform is invalid.'), { reasonCode: 'DESKTOP_MEDIA_SEND_PLATFORM_INVALID' });
  if (!accountId || accountId.length > 512 || !chatJid || chatJid.length > 1024 || !assetId || assetId.length > 512) throw Object.assign(new Error('Media send target or asset is invalid.'), { reasonCode: 'DESKTOP_MEDIA_SEND_INPUT_INVALID' });
  return Object.freeze({
    platform, accountId, chatJid, assetId,
    sessionKey: String(input.sessionKey || '').trim().slice(0, 1024),
    filename: path.basename(String(input.filename || 'yance-media')).slice(0, 240),
    caption: String(input.caption || '').slice(0, 10000)
  });
}

async function sendMediaAssetThroughExistingAuthority(input = {}) {
  const target = normalizeMediaSendInput(input);
  const original = await ensureMediaBrainRuntime().openAssetOriginalStream({ assetId: target.assetId });
  const mimeType = String(original.mimeType || '').trim().toLowerCase();
  const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : '';
  if (!kind) {
    throw Object.assign(new Error('Immich original media type is unsupported by the Media workspace send contract.'), { reasonCode: 'DESKTOP_MEDIA_SEND_MIME_TYPE_UNSUPPORTED' });
  }
  const encodeHeader = value => encodeURIComponent(String(value || ''));
  const response = await fetch(`${YANCE_BACKEND_URL}/api/r32/messages/${encodeURIComponent(target.platform)}/${encodeURIComponent(target.accountId)}/send-media-stream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${currentApiSessionToken()}`,
      Origin: YANCE_BACKEND_URL,
      'content-type': original.mimeType || 'application/octet-stream',
      'x-yance-chat-jid': encodeHeader(target.chatJid),
      'x-yance-session-key': encodeHeader(target.sessionKey),
      'x-yance-media-kind': encodeHeader(kind),
      'x-yance-mime-type': encodeHeader(original.mimeType || 'application/octet-stream'),
      'x-yance-filename': encodeHeader(target.filename),
      'x-yance-caption': encodeHeader(target.caption)
    },
    body: original.body,
    duplex: 'half',
    signal: AbortSignal.timeout(120000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const error = new Error(String(payload?.error?.message || payload?.message || `Existing Yance media send authority returned HTTP ${response.status}.`));
    error.reasonCode = String(payload?.error?.code || payload?.code || `MEDIA_SEND_HTTP_${response.status}`);
    throw error;
  }
  return payload;
}

function readParlantOpenRouterApiKey() {
  const credential = vault?.get?.(PARLANT_OPENROUTER_CREDENTIAL_REF) || null;
  const apiKey = String(credential?.apiKey || '').trim();
  if (!apiKey) {
    const error = new Error('OpenRouter credential is not configured for the relationship goal runtime.');
    error.reasonCode = 'DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING';
    throw error;
  }
  return apiKey;
}

function ensureParlantRelationshipRuntime() {
  if (!parlantRelationshipRuntime) {
    parlantRelationshipRuntime = createParlantRelationshipRuntime({
      resourcesPath: controlledResourcesPath(),
      dataRoot: DATA_ROOT,
      getOpenRouterApiKey: () => readParlantOpenRouterApiKey()
    });
  }
  return parlantRelationshipRuntime;
}

function normalizeParlantGoalInput(input = {}, allowedKeys = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Parlant relationship goal input must be an object.'), { reasonCode: 'DESKTOP_PARLANT_INPUT_INVALID' });
  }
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(input).filter(key => !allowed.has(key));
  if (unknownKeys.length) {
    throw Object.assign(new Error('Parlant relationship goal input contains unsupported fields.'), { reasonCode: 'DESKTOP_PARLANT_INPUT_INVALID', details: { unknownKeys } });
  }
  const contactId = String(input.contactId || '').trim();
  if (!contactId || contactId.length > 512) {
    throw Object.assign(new Error('Parlant contactId must contain 1 to 512 characters.'), { reasonCode: 'DESKTOP_PARLANT_CONTACT_ID_INVALID' });
  }
  const normalized = { contactId };
  if (allowed.has('goalText')) {
    const goalText = String(input.goalText || '').trim();
    if (!goalText || goalText.length > 4000) {
      throw Object.assign(new Error('Relationship goal must contain 1 to 4000 characters.'), { reasonCode: 'DESKTOP_PARLANT_GOAL_INVALID' });
    }
    normalized.goalText = goalText;
  }
  if (allowed.has('paused')) normalized.paused = input.paused === true;
  return Object.freeze(normalized);
}

function projectParlantRelationshipGoal(payload = {}) {
  const pathProjection = Array.isArray(payload?.progress?.path)
    ? payload.progress.path.map(value => String(value || '').slice(0, 256)).filter(Boolean).slice(-32)
    : [];
  return Object.freeze({
    available: payload.available !== false,
    exists: payload.exists === true ? true : payload.exists === false ? false : null,
    goalText: String(payload.goalText || '').slice(0, 4000),
    paused: payload.paused === true,
    progress: Object.freeze({ path: Object.freeze(pathProjection), completed: payload?.progress?.completed === true }),
    reasonCode: String(payload.reasonCode || '').slice(0, 128)
  });
}

async function readParlantRelationshipGoalProjection(input = {}) {
  const normalized = normalizeParlantGoalInput(input, ['contactId']);
  try {
    return projectParlantRelationshipGoal(await ensureParlantRelationshipRuntime().readRelationshipGoal(normalized));
  } catch (error) {
    return projectParlantRelationshipGoal({
      available: false,
      exists: null,
      reasonCode: error?.reasonCode || error?.code || 'DESKTOP_PARLANT_RUNTIME_UNAVAILABLE'
    });
  }
}

function projectLettaAgentIdentity(agent = {}) {
  return Object.freeze({
    id: String(agent?.id || '').trim().slice(0, 256),
    name: String(agent?.name || '').trim().slice(0, 256)
  });
}

function projectLettaConversationIdentity(conversation = {}, fallbackAgentId = '') {
  return Object.freeze({
    id: String(conversation?.id || '').trim().slice(0, 256),
    agentId: String(conversation?.agentId || conversation?.agent_id || fallbackAgentId || '').trim().slice(0, 256)
  });
}

function normalizeLettaConversationListInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('Letta conversation list input must be an object.'), { reasonCode: 'DESKTOP_LETTA_INPUT_INVALID' });
  }
  const unknownKeys = Object.keys(input).filter(key => !['agentId', 'limit'].includes(key));
  if (unknownKeys.length) {
    throw Object.assign(new Error('Letta conversation list input contains unsupported fields.'), { reasonCode: 'DESKTOP_LETTA_INPUT_INVALID', details: { unknownKeys } });
  }
  const agentId = String(input.agentId || '').trim();
  if (!agentId || agentId.length > 256) {
    throw Object.assign(new Error('Letta agentId must contain 1 to 256 characters.'), { reasonCode: 'DESKTOP_LETTA_AGENT_ID_INVALID' });
  }
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw Object.assign(new Error('Letta conversation limit must be an integer from 1 to 200.'), { reasonCode: 'DESKTOP_LETTA_LIMIT_INVALID' });
  }
  return Object.freeze({ agentId, limit });
}

function lettaOwnershipPresent() {
  const state = lettaAgentRuntime?.snapshot?.() || {};
  return state.ready === true || Number(state.pid || 0) > 0;
}

async function stopLettaAgentRuntime() {
  if (!lettaAgentRuntime) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
  const before = lettaAgentRuntime.snapshot();
  if (!before.ready && !before.pid) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
  const stopped = await lettaAgentRuntime.stop();
  const after = lettaAgentRuntime.snapshot();
  if (after.ready || after.pid) {
    const error = new Error('Letta runtime shutdown was not confirmed');
    error.reasonCode = 'DESKTOP_LETTA_STOP_NOT_CONFIRMED';
    error.details = { before, after, stopped };
    throw error;
  }
  return { stopped: true, exitConfirmed: true, alreadyStopped: false, pid: Number(before.pid || 0), state: stopped };
}

function graphitiOwnershipPresent() {
  const state = graphitiRelationshipRuntime?.snapshot?.() || {};
  return state.ready === true || Number(state.graphitiPid || 0) > 0 || Number(state.neo4jPid || 0) > 0;
}

async function stopGraphitiRelationshipRuntime() {
  if (!graphitiRelationshipRuntime) return { stopped: true, exitConfirmed: true, alreadyStopped: true, graphitiPid: 0, neo4jPid: 0 };
  const before = graphitiRelationshipRuntime.snapshot();
  if (!before.ready && !before.graphitiPid && !before.neo4jPid) return { stopped: true, exitConfirmed: true, alreadyStopped: true, graphitiPid: 0, neo4jPid: 0 };
  const stopped = await graphitiRelationshipRuntime.stop();
  const after = graphitiRelationshipRuntime.snapshot();
  if (after.ready || after.graphitiPid || after.neo4jPid) {
    const error = new Error('Graphiti relationship runtime shutdown was not confirmed');
    error.reasonCode = 'DESKTOP_GRAPHITI_STOP_NOT_CONFIRMED';
    error.details = { before, after, stopped };
    throw error;
  }
  return { stopped: true, exitConfirmed: true, alreadyStopped: false, graphitiPid: Number(before.graphitiPid || 0), neo4jPid: Number(before.neo4jPid || 0), state: stopped };
}

function parlantOwnershipPresent() {
  const state = parlantRelationshipRuntime?.snapshot?.() || {};
  return state.ready === true || Number(state.pid || 0) > 0;
}

async function stopParlantRelationshipRuntime() {
  if (!parlantRelationshipRuntime) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
  const before = parlantRelationshipRuntime.snapshot();
  if (!before.ready && !before.pid) return { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
  const stopped = await parlantRelationshipRuntime.stop();
  const after = parlantRelationshipRuntime.snapshot();
  if (after.ready || after.pid) {
    const error = new Error('Parlant relationship runtime shutdown was not confirmed');
    error.reasonCode = 'DESKTOP_PARLANT_STOP_NOT_CONFIRMED';
    error.details = { before, after, stopped };
    throw error;
  }
  return { stopped: true, exitConfirmed: true, alreadyStopped: false, pid: Number(before.pid || 0), state: stopped };
}

async function stopApplicationOwnedRuntimes(options = {}) {
  let lettaStop = null;
  let lettaError = null;
  let parlantStop = null;
  let parlantError = null;
  let graphitiStop = null;
  let graphitiError = null;
  let backendStop = null;
  let backendError = null;
  try { lettaStop = await stopLettaAgentRuntime(); } catch (error) { lettaError = error; }
  try { parlantStop = await stopParlantRelationshipRuntime(); } catch (error) { parlantError = error; }
  try { graphitiStop = await stopGraphitiRelationshipRuntime(); } catch (error) { graphitiError = error; }
  try { backendStop = await stopBackend({ forShutdown: true, reason: String(options.reason || 'application-shutdown') }); } catch (error) { backendError = error; }
  if (lettaError || parlantError || graphitiError || backendError) {
    const error = new Error('Application-owned runtime shutdown was not fully confirmed');
    error.reasonCode = lettaError?.reasonCode || parlantError?.reasonCode || graphitiError?.reasonCode || backendError?.reasonCode || 'DESKTOP_RUNTIME_STOP_NOT_CONFIRMED';
    error.details = {
      letta: lettaError ? { reasonCode: lettaError.reasonCode || '', message: lettaError.message } : lettaStop,
      parlant: parlantError ? { reasonCode: parlantError.reasonCode || '', message: parlantError.message } : parlantStop,
      graphiti: graphitiError ? { reasonCode: graphitiError.reasonCode || '', message: graphitiError.message } : graphitiStop,
      backend: backendError ? { reasonCode: backendError.reasonCode || '', message: backendError.message } : backendStop
    };
    throw error;
  }
  return {
    ...(backendStop || { stopped: true, exitConfirmed: true, alreadyStopped: true, backendPid: 0 }),
    stopped: true,
    exitConfirmed: true,
    letta: lettaStop,
    parlant: parlantStop,
    graphiti: graphitiStop
  };
}

function applicationRuntimeAuthoritySnapshot() {
  const backend = authoritativeBackend().backend || {};
  const letta = lettaAgentRuntime?.snapshot?.() || {};
  const parlant = parlantRelationshipRuntime?.snapshot?.() || {};
  const lettaOwned = letta.ready === true || Number(letta.pid || 0) > 0;
  const parlantOwned = parlant.ready === true || Number(parlant.pid || 0) > 0;
  return {
    ...backend,
    ownershipPresent: backend.ownershipPresent === true || lettaOwned || parlantOwned,
    backendPid: Number(backend.backendPid || 0),
    letta,
    parlant
  };
}

function currentApiSessionToken(options = {}) {
  const token = desktopHost?.backendProcessHost?.getApiSessionToken?.() || '';
  if (!token && options.required !== false) {
    const error = new Error('Backend API session is not established');
    error.reasonCode = 'DESKTOP_API_SESSION_UNAVAILABLE';
    throw error;
  }
  return token;
}

function authoritativeBackend() {
  return backendAuthority(desktopHost);
}

function ownedBackendChild() {
  return authoritativeBackend().child;
}

function backendOwnershipPresent() {
  return authoritativeBackend().ownershipPresent;
}
let rendererWorkState = { unsavedChanges: false, pendingReplyApproval: false, detail: '' };
let backendObservationChild = null;
let relaunchPending = false;
let backendReady = false;
let backendPid = 0;
let backendReadySource = '';
let backendRestarting = false;
let backendLaunchPromise = null;
let backendStartupSupervisor = null;
let backendRestartTimer = null;
let backendRestartAttempt = 0;
let backendLastFailure = null;
let quitting = false;
let fatalShutdown = null;
let shutdownInProgress = null;
let exitAfterBackendShutdown = false;
let eventSocket = null;
let eventReconnectTimer = null;
let vault = null;
let settingsStore = null;
let lifecyclePollTimer = null;
let lastNetworkOnline = true;
let lifecycleMonitorsInstalled = false;
let credentialVaultRecoveryReport = { ok: true, scannedFiles: 0, importedRefs: [], unreadableRefs: [], mode: 'not-run' };
let legacyRuntimeCutoverReport = { ok: true, state: 'NOT_RUN', sourceRegistryMutated: false };
const soundWaiters = new Map();
let lastSoundAt = 0;
let trayRefreshTimer = null;
let traySnapshot = { accounts: [], unread: 0, safeMode: false, safeModeReason: '', notifications: { paused: false }, models: { online: false, verified: 0, total: 0, used: 0, lastModel: '', automationEnabled: false, automationLocalOnly: true } };

// WP7 installed-product probe custody. Formal probes are executed only when the
// packaged product receives a sealed request from the release harness. Normal
// desktop startup never creates these sessions or writes probe evidence.
let wp7ProbeRendererStorageSession = null;
let wp7SafeModeScenarioRunner = null;
let wp7LegacyRoot = path.resolve(DATA_ROOT, '..', 'Yance27');
let wp7KnownOwnerPids = new Set();

function wp7ProbeRequested() {
  return Boolean(String(process.env.WP7_PROBE_ID || '').trim());
}

function trustedBackendProjection() {
  return directTrustedBackendProjection(desktopHost);
}

async function wp7ProbeBackendReadyDocument() {
  const ready = await apiRequest('/api/ready');
  const authority = trustedBackendProjection();
  const projection = runtimeProjectionCoordinator?.snapshot?.() || null;
  if (ready.ready !== true || authority.running !== true || authority.ownerTrusted !== true || authority.backendPid < 1 || projection?.trustedOwnerBound !== true || projection?.runtime?.localReady !== true) {
    const error = new Error('WP7 probe requires a directly trusted backend owner and synchronized local-ready projection');
    error.reasonCode = 'WP7_INSTALLED_RUNTIME_PROBE_NOT_READY';
    error.details = { ready: ready.ready === true, authority, projection };
    throw error;
  }
  return ready;
}

function ensureWp7RendererStorageSession() {
  if (wp7ProbeRendererStorageSession) return wp7ProbeRendererStorageSession;
  wp7ProbeRendererStorageSession = createElectronRendererStorageSession({
    BrowserWindow,
    baseUrl: YANCE_BACKEND_URL,
    waitForReady: () => wp7ProbeBackendReadyDocument()
  });
  return wp7ProbeRendererStorageSession;
}

function wp7RunSafeModeScenario(sources) {
  if (!wp7SafeModeScenarioRunner) {
    wp7SafeModeScenarioRunner = createSafeModeScenarioRunner({
      dataRoot: DATA_ROOT,
      legacyRoot: wp7LegacyRoot,
      desktopSettingsPath: settingsStore?.filePath || path.join(DATA_ROOT, 'desktop-settings.json'),
      rendererStorageSession: ensureWp7RendererStorageSession(),
      projectionSnapshot: () => runtimeProjectionCoordinator?.snapshot?.() || {},
      pollOnce: () => runtimeProjectionCoordinator.pollOnce()
    });
  }
  return wp7SafeModeScenarioRunner(sources);
}

function wp7LastOwnerExitAtUtc(pid) {
  const value = Number(pid || 0);
  const history = desktopCredentialApplicationCoordinator?.snapshot?.()?.stateHistory || [];
  const match = [...history].reverse().find((entry) => String(entry?.state || '') === 'OWNER_EXIT_CONFIRMED' && (!value || Number(entry?.backendPid || 0) === value));
  return String(match?.atUtc || '');
}

function wp7BootFailureOutputPath() {
  const root = path.resolve(String(process.env.WP7_PROBE_ROOT || DATA_ROOT));
  return path.join(root, 'boot-failure-diagnostics', 'failed-startup.json');
}

function writeWp7BootFailureDiagnostic(error, failedPhase = 'desktop-bootstrap') {
  if (process.env.WP7_BOOT_FAILURE_CHILD !== '1') return null;
  const outputPath = String(process.env.WP7_BOOT_FAILURE_OUTPUT_PATH || '').trim();
  if (!outputPath) return null;
  const document = {
    schemaVersion: 1,
    documentType: 'WP7_BOOT_FAILURE_DIAGNOSTIC',
    producerPid: process.pid,
    producerParentPid: process.ppid,
    producerExecutablePath: process.execPath,
    failedPhase,
    reasonCode: String(error?.reasonCode || error?.code || 'BOOT_MANIFEST_MISSING'),
    message: String(error?.message || error || 'startup failed'),
    injection: String(process.env.WP7_BOOT_FAILURE_INJECTION || ''),
    buildId: String(process.env.WP7_BOOT_FAILURE_EXPECTED_BUILD_ID || ''),
    sourceCommit: String(process.env.WP7_BOOT_FAILURE_EXPECTED_SOURCE_COMMIT || ''),
    sourceTree: String(process.env.WP7_BOOT_FAILURE_EXPECTED_SOURCE_TREE || ''),
    generatedAtUtc: new Date().toISOString()
  };
  writeWp7AtomicJson(outputPath, document);
  return outputPath;
}

function wp7VerifyNetworkIsolationProof() {
  return readNetworkIsolationStartupObservation({
    applicationProcessStartedAtUtc: WP7_APPLICATION_PROCESS_STARTED_AT_UTC,
    backendLaunchStartedAtUtc: wp7BackendLaunchStartedAtUtc || WP7_APPLICATION_PROCESS_STARTED_AT_UTC,
    networkObservedAtUtc: WP7_NETWORK_OBSERVED_AT_UTC,
    networkOnlineAtProcessStart: WP7_NETWORK_ONLINE_AT_PROCESS_START,
    platform: process.platform,
    env: process.env
  });
}

async function runWp7InstalledRuntimeProbe() {
  const identity = releaseIdentity();
  const adapter = createWp7InstalledRuntimeProbeMainAdapter({
    resourcesPath: () => controlledResourcesPath(),
    getReleaseIdentity: () => identity,
    getBackendReady: () => wp7ProbeBackendReadyDocument(),
    readElectronIdentity: (resourcesPath) => getElectronReleaseIdentity({ resourcesPath, expectedBuildId: identity.buildId, reload: true }),
    readInstallerIdentityReceipt,
    getDiagnosticsIdentity: () => apiRequest('/api/r32/system/release-identity'),
    identityObservationRoot: () => path.join(path.resolve(process.env.WP7_PROBE_ROOT), 'release-identity-observations'),
    ownerSnapshot: () => trustedBackendProjection(),
    knownOwnerPids: () => [...wp7KnownOwnerPids],
    setKnownOwnerPids: (pids) => { wp7KnownOwnerPids = new Set([...pids].map(Number).filter((pid) => pid > 0)); },
    ownedBackendChild: () => desktopHost?.backendProcessHost?.getOwnedChild?.() || null,
    restartBackend: (options) => restartBackend(options),
    waitForReplacementOwner: (oldPid) => waitForTrustedReplacementOwner({
      oldPid,
      ownerSnapshot: () => trustedBackendProjection(),
      projectionSnapshot: () => runtimeProjectionCoordinator?.snapshot?.() || {},
      timeoutMs: 60_000,
      intervalMs: 50
    }),
    credentialApplicationSnapshot: () => desktopCredentialApplicationCoordinator?.snapshot?.() || null,
    lastOwnerExitAtUtc: (pid) => wp7LastOwnerExitAtUtc(pid),
    getStartupObservation: () => wp7VerifyNetworkIsolationProof(),
    runSafeModeScenario: (sources) => wp7RunSafeModeScenario(sources),
    runtimeProjectionCoordinator: () => runtimeProjectionCoordinator,
    runtimeApiClient: () => runtimeApiV2Client,
    bootFailureOutputPath: () => wp7BootFailureOutputPath(),
    bootFailureChildArguments: () => ['no-sandbox', 'disable-gpu']
      .filter((name) => app.commandLine.hasSwitch(name))
      .map((name) => `--${name}`)
  });
  const operations = createInstalledRuntimeProbeOperations({
    ...adapter,
    runtimeSnapshot: () => runtimeApiV2Client.getSnapshot({ requireTrusted: true, expectedBuildId: identity.buildId }),
    projectionSnapshot: () => runtimeProjectionCoordinator.snapshot(),
    stopBackend: (options) => stopBackend(options),
    dataRoot: DATA_ROOT,
    sqlitePath: PATHS.sqlite,
    initialState: {
      dataRootExisted: WP7_INITIAL_DATA_ROOT_EXISTED,
      sqliteExisted: WP7_INITIAL_SQLITE_EXISTED,
      oldProcessesDetected: 0,
      oldProcessesTerminated: 0,
      oldBuildArtifactCount: 0,
      oldStagingArtifactCount: 0
    },
    legacyDataRootConsumed: () => legacyRuntimeCutoverReport?.legacyRead === true || legacyRuntimeCutoverReport?.consumed === true,
    releaseIdentity: identity,
    scanInstalledRuntime: () => scanDuplicateRuntimeEntrypoints(packagedAppRoot())
  });
  return runInstalledRuntimeProbeApplicationEntry({
    releaseIdentity: identity,
    platform: process.platform,
    isPackaged: app.isPackaged,
    allowPreReviewPackagedIntegration: true,
    producerExecutablePath: process.execPath,
    producerMainEntryPath: __filename,
    onResultCommitted: () => completeWp7ProbeAndExit(0),
    operations
  });
}

async function completeWp7ProbeAndExit(exitCode = 0) {
  wp7ProbeRendererStorageSession?.dispose?.();
  wp7ProbeRendererStorageSession = null;
  wp7SafeModeScenarioRunner = null;
  quitting = true;
  stopEventSocket();
  const receiptPath = path.join(String(process.env.WP7_PROBE_ROOT || DATA_ROOT), 'completion-receipt.json');
  let lettaStop = { stopped: true, exitConfirmed: true, alreadyStopped: true, pid: 0 };
  let backendStop = { stopped: true, exitConfirmed: true, alreadyStopped: true, backendPid: 0 };
  try {
    lettaStop = await stopLettaAgentRuntime();
    if (backendOwnershipPresent()) {
      const child = ownedBackendChild();
      const backendPid = Number(child?.pid || 0);
      if (!child || backendPid < 1) throw Object.assign(new Error('owned probe backend child is unavailable'), { reasonCode: 'WP7_PROBE_BACKEND_CUSTODY_MISSING' });
      const waitForExit = (timeoutMs) => new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve(true);
        const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
        const exited = () => { cleanup(); resolve(true); };
        const cleanup = () => { clearTimeout(timer); child.off('exit', exited); child.off('close', exited); };
        child.once('exit', exited); child.once('close', exited);
      });
      const termSent = child.kill('SIGTERM');
      let exitConfirmed = await waitForExit(5000);
      let forced = false;
      if (!exitConfirmed) {
        forced = true;
        if (!child.kill('SIGKILL')) throw Object.assign(new Error('probe backend SIGKILL was not delivered'), { reasonCode: 'WP7_PROBE_BACKEND_KILL_FAILED', details: { backendPid } });
        exitConfirmed = await waitForExit(5000);
      }
      backendStop = { stopped: exitConfirmed, exitConfirmed, alreadyStopped: false, backendPid, termSent, forced };
    }
    if (backendStop.stopped !== true || backendStop.exitConfirmed !== true) {
      throw Object.assign(new Error('probe backend exit was not confirmed'), {
        reasonCode: backendStop.reasonCode || 'WP7_PROBE_BACKEND_EXIT_NOT_CONFIRMED',
        details: { backendStop }
      });
    }
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      schemaVersion: 1,
      documentType: 'WP7_PROBE_COMPLETION_RECEIPT',
      status: 'PASS',
      probeId: String(process.env.WP7_PROBE_ID || ''),
      executionNonce: String(process.env.WP7_PROBE_EXECUTION_NONCE || ''),
      electronPid: process.pid,
      backendStop,
      lettaStop,
      completedAtUtc: new Date().toISOString()
    }, null, 2)}\n`);
    exitAfterBackendShutdown = true;
    app.exit(exitCode);
  } catch (error) {
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      schemaVersion: 1,
      documentType: 'WP7_PROBE_COMPLETION_RECEIPT',
      status: 'FAIL',
      probeId: String(process.env.WP7_PROBE_ID || ''),
      executionNonce: String(process.env.WP7_PROBE_EXECUTION_NONCE || ''),
      electronPid: process.pid,
      reasonCode: error.reasonCode || 'WP7_PROBE_SHUTDOWN_FAILED',
      message: error.message,
      details: error.details || null,
      completedAtUtc: new Date().toISOString()
    }, null, 2)}\n`);
    exitAfterBackendShutdown = true;
    app.exit(71);
  }
}

function iconPath() {
  return path.join(APP_ROOT, 'frontend', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  try {
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/render frame was disposed|webframemain|destroyed/i.test(message)) return false;
    desktopLog('warn', 'renderer-send-skipped', { channel, message });
    return false;
  }
}

function diskSpace(target) {
  try {
    if (typeof fs.statfsSync !== 'function') return { totalBytes: 0, availableBytes: 0 };
    const stat = fs.statfsSync(target);
    const blockSize = Number(stat.bsize || stat.frsize || 0);
    return { totalBytes: Number(stat.blocks || 0) * blockSize, availableBytes: Number(stat.bavail || stat.bfree || 0) * blockSize };
  } catch (_) { return { totalBytes: 0, availableBytes: 0 }; }
}

function desktopState() {
  const settings = settingsStore?.read() || {};
  const memory = process.memoryUsage();
  const identity = releaseIdentity();
  return {
    application: {
      productName: identity.publicProductName || identity.productName || '言策',
      publicProductName: identity.publicProductName || identity.productName || '言策',
      publicProductNameEnglish: identity.publicProductNameEnglish || 'Yance',
      version: identity.publicVersion || identity.productVersion,
      publicVersion: identity.publicVersion || identity.productVersion,
      productVersion: identity.productVersion,
      updateProductName: identity.productName,
      updateVersion: identity.productVersion,
      internalProductId: identity.internalProductId || 'Yance',
      stageVersion: identity.stageVersion || '',
      build: identity.buildId,
      buildId: identity.buildId,
      sourceCommit: identity.sourceCommit || identity.gitCommit || '',
      sourceTree: identity.sourceTree || '',
      manifestSha256: identity.manifestSha256 || '',
      buildTimestampUtc: identity.buildTimestampUtc || '',
      installMode: app.isPackaged ? 'installed' : 'source',
      applicationPath: APP_ROOT,
      permanentDataRoot: PATHS.root,
      electronUserData: app.getPath('userData'),
      logRoot: PATHS.logs,
      settingsFile: PATHS.sqlite
    },
    runtime: {
      mainPid: process.pid,
      packaged: app.isPackaged,
      version: identity.publicVersion || identity.productVersion,
      publicVersion: identity.publicVersion || identity.productVersion,
      updateVersion: identity.productVersion,
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      locale: app.getLocale(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      processUptimeSeconds: Math.round(process.uptime()),
      memory,
      safeStorageAvailable: Boolean(vault?.available),
      dataRoot: PATHS.root
    },
    backend: {
      ready: backendReady,
      pid: backendPid,
      url: YANCE_BACKEND_URL,
      eventStreamConnected: eventSocket?.readyState === WebSocket.OPEN,
      restarting: backendRestarting,
      readySource: backendReadySource,
      startupInProgress: Boolean(backendLaunchPromise),
      lastFailure: backendLastFailure,
      runtimeProjection: runtimeProjectionCoordinator?.snapshot?.() || null
    },
    desktop: {
      settings,
      settingsPersistence: settingsStore?.verify?.() || { ok: false, dbPath: PATHS.sqlite },
      trayAvailable: Boolean(tray),
      windowVisible: Boolean(mainWindow?.isVisible()),
      credentialRefs: vault?.refs() || [],
      credentialRecovery: credentialVaultRecoveryReport,
      legacyRuntimeCutover: legacyRuntimeCutoverReport
    },
    resources: {
      cpuCount: os.cpus()?.length || 0,
      loadAverage: os.loadavg(),
      systemMemoryTotal: os.totalmem(),
      systemMemoryFree: os.freemem(),
      dataVolume: diskSpace(PATHS.root)
    },
    credentials: {
      available: Boolean(vault?.available),
      refs: vault?.refs() || [],
      storagePath: PATHS.secure,
      recovery: credentialVaultRecoveryReport,
      applicationLifecycle: desktopCredentialApplicationCoordinator?.snapshot?.() || null
    },
    coreFramework: { authority: 'backend', legacyElectronBusinessRuntimePresent: false },
    update: updateManager?.snapshot?.() || {
      phase: 'idle', configured: false,
      currentVersion: identity.productVersion,
      currentPublicVersion: identity.publicVersion || identity.productVersion,
      availableVersion: '', availablePublicVersion: '', percent: 0
    }
  };
}

function parseRetryAfterMs(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function localApiError(response, payload, endpoint) {
  const payloadError = payload?.error;
  const message = typeof payloadError === 'string'
    ? payloadError
    : (payload?.message || payloadError?.message || `HTTP ${response.status}`);
  const error = new Error(message);
  error.status = Number(response.status || 0);
  error.code = String(payload?.code || payload?.reasonCode || payloadError?.code || payloadError?.reasonCode || `HTTP_${response.status}`);
  error.reasonCode = error.code;
  error.retryAfterMs = Math.max(
    0,
    Number(payload?.retryAfterMs || payloadError?.retryAfterMs || 0),
    parseRetryAfterMs(response.headers.get('retry-after'))
  );
  error.requestId = String(payload?.requestId || response.headers.get('x-request-id') || '');
  error.endpoint = String(endpoint || '');
  return error;
}

async function apiRequest(endpoint, options = {}) {
  if (relaunchPending) { const error = new Error('Application relaunch is in progress'); error.reasonCode = 'DESKTOP_RELAUNCH_IN_PROGRESS'; throw error; }
  const response = await fetch(`${YANCE_BACKEND_URL}${endpoint}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: `Bearer ${currentApiSessionToken()}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw localApiError(response, payload, endpoint);
  return payload;
}

function updateLoginItem(settings) {
  if (process.platform !== 'win32') return;
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.autoLaunch === true,
      openAsHidden: settings.startMinimized === true,
      args: settings.startMinimized ? ['--hidden'] : []
    });
  } catch (error) {
    console.error('[desktop] setLoginItemSettings failed', error);
  }
}

function signalBackendActivationWaiters() {
  for (const waiter of [...backendActivationWaiters]) waiter();
}

function waitForBackendReadyForActivation(options = {}) {
  if (backendReady) return Promise.resolve({ ready: true, source: backendReadySource });
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 60000));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      backendActivationWaiters.delete(check);
      if (error) reject(error);
      else resolve({ ready: true, source: backendReadySource });
    };
    const check = () => {
      if (backendReady) return finish();
      if (quitting || relaunchPending) {
        const error = new Error('Application shutdown interrupted desktop activation');
        error.reasonCode = 'DESKTOP_ACTIVATION_ABORTED';
        finish(error);
        return;
      }
      if (backendLastFailure && !backendLaunchPromise) {
        const error = new Error(backendLastFailure.message || 'Backend startup failed before desktop activation');
        error.reasonCode = backendLastFailure.code || 'DESKTOP_BACKEND_STARTUP_FAILED';
        finish(error);
      }
    };
    const timer = setTimeout(() => {
      const error = new Error('Backend readiness timed out during desktop activation');
      error.reasonCode = 'DESKTOP_BACKEND_READY_TIMEOUT';
      error.details = { reason: options.reason || '', timeoutMs, backendLastFailure };
      finish(error);
    }, timeoutMs);
    backendActivationWaiters.add(check);
    backendLaunchPromise?.then(check, check);
    check();
  });
}

function focusAndShowMainWindow(window) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  restoreWindowTaskbar(window);
  if (!window.isVisible()) window.show();
  try {
    if (process.platform === 'win32') {
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
      window.focus();
      setTimeout(() => {
        if (!mainWindow || mainWindow !== window || window.isDestroyed()) return;
        window.setAlwaysOnTop(false);
        window.moveTop();
        window.focus();
      }, 140);
    } else {
      app.focus({ steal: true });
      window.moveTop();
      window.focus();
    }
  } catch (error) {
    desktopLog('warn', 'desktop-main-window-focus-fallback', { error: error.message });
    try { window.focus(); } catch (_) {}
  }
}


function currentApiSessionFingerprint() {
  const host = desktopHost?.backendProcessHost;
  const token = String(host?.getApiSessionToken?.() || '');
  const binding = host?.getApiSessionBinding?.({ includeToken: false }) || {};
  if (!token) return '';
  return createHash('sha256').update([
    binding.backendPid || backendPid || 0,
    binding.startupNonce || '',
    binding.backendSessionId || '',
    binding.fd6PipeInstanceId || '',
    binding.ownerSessionId || '',
    token
  ].map(value => String(value)).join('|')).digest('hex');
}

function ensureMainWindowRuntimeReadiness() {
  if (mainWindowRuntimeReadiness) return mainWindowRuntimeReadiness;
  mainWindowRuntimeReadiness = createMainWindowRuntimeReadiness({
    timeoutMs: 20000,
    log: (level, event, detail) => desktopLog(level, event, detail)
  });
  return mainWindowRuntimeReadiness;
}

async function waitForMainWindowSessionReady(request = {}) {
  const timeoutMs = 60000;
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    await waitForBackendReadyForActivation({ reason: request.reason || 'desktop-activation-session', timeoutMs: Math.max(500, deadline - Date.now()) });
    const fingerprint = currentApiSessionFingerprint();
    if (backendReady && fingerprint) {
      try {
        await apiRequest('/api/ready');
        return fingerprint;
      } catch (error) {
        lastError = error;
      }
    }
    if (quitting || relaunchPending) {
      const error = new Error('Application shutdown interrupted desktop session recovery');
      error.reasonCode = 'DESKTOP_ACTIVATION_ABORTED';
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  const error = new Error(lastError?.message || 'Backend API session did not become ready during desktop activation');
  error.reasonCode = lastError?.reasonCode || lastError?.code || 'DESKTOP_API_SESSION_READY_TIMEOUT';
  error.details = { reason: request.reason || '', timeoutMs };
  throw error;
}

async function validateMainWindowRuntimeReady(window, request = {}) {
  const sessionBefore = await waitForMainWindowSessionReady(request);
  const result = await ensureMainWindowRuntimeReadiness().probe(window, { ...request, sessionGeneration: sessionBefore.slice(0, 24) });
  await apiRequest('/api/ready');
  const sessionAfter = currentApiSessionFingerprint();
  if (!sessionAfter || sessionAfter !== sessionBefore) {
    const error = new Error('Backend API session changed during desktop activation');
    error.reasonCode = 'DESKTOP_API_SESSION_ROTATED_DURING_ACTIVATION';
    error.details = { reason: request.reason || '', sequence: request.sequence || 0 };
    throw error;
  }
  return result;
}

function ensureMainWindowActivationController() {
  if (mainWindowActivationController) return mainWindowActivationController;
  mainWindowActivationController = createMainWindowActivationController({
    getBackendReady: () => backendReady,
    waitForBackendReady: waitForBackendReadyForActivation,
    getWindow: () => mainWindow,
    createWindow: () => createWindow(),
    showWindow: window => focusAndShowMainWindow(window),
    sendActivation: (window, request) => {
      const payload = request.payload || {};
      if (isPostInstallReason(request.reason)) {
        try {
          const receipt = writePostInstallLaunchReceipt({
            filePath: path.join(PATHS.logs, 'post-install-launch.json'),
            request,
            window,
            processId: process.pid
          });
          desktopLog(receipt?.status === 'PASS' ? 'info' : 'error', 'desktop-post-install-launch-receipt', receipt || {});
        } catch (error) {
          desktopLog('error', 'desktop-post-install-launch-receipt-failed', { reasonCode: error.reasonCode || error.code || '', message: error.message });
        }
      }
      sendToRenderer('desktop:activation', { reason: request.reason, payload, at: new Date().toISOString() });
      if (payload.view) sendToRenderer('desktop:open-view', payload);
      if (payload.conversationId || payload.sessionKey) sendToRenderer('desktop:open-conversation', payload);
    },
    reloadWindow: window => window.webContents.reload(),
    destroyWindow: window => {
      ensureMainWindowRuntimeReadiness().cancelWindow(window, 'activation-controller-destroy');
      if (mainWindow === window) mainWindow = null;
      window.destroy();
    },
    validateRuntimeReady: validateMainWindowRuntimeReady,
    notifyRecovery: (window, request, state, detail = {}) => {
      if (!window || window.isDestroyed?.() || window.webContents?.isDestroyed?.()) return;
      window.webContents.send('desktop:activation-recovery', {
        state,
        reason: request?.reason || 'unknown',
        sequence: Number(request?.sequence || 0),
        requestedAt: Number(request?.requestedAt || Date.now()),
        detail,
        at: new Date().toISOString()
      });
    },
    log: (level, event, detail) => desktopLog(level, event, detail)
  });
  return mainWindowActivationController;
}

function activateMainWindow(reason = 'unknown', payload = {}) {
  pendingMainWindowPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  return ensureMainWindowActivationController().activate(reason, pendingMainWindowPayload).finally(() => {
    pendingMainWindowPayload = null;
  });
}

function logMainWindowActivationFailure(reason, error) {
  desktopLog('error', 'desktop-main-window-activation-failed', {
    activationReason: reason,
    reasonCode: error?.reasonCode || error?.code || 'DESKTOP_ACTIVATION_FAILED',
    message: error?.message || String(error || 'Unknown activation failure')
  });
}

function showMainWindow(payload = {}) {
  activateMainWindow('legacy-show-main-window', payload).catch(error => {
    desktopLog('error', 'desktop-main-window-activation-failed', {
      reasonCode: error.reasonCode || error.code || 'DESKTOP_ACTIVATION_FAILED',
      message: error.message
    });
  });
  return true;
}

function authorizedAuthOrigin(provider) {
  const key = String(provider || '').trim().toLowerCase();
  if (key !== 'facebook') return '';
  let releaseWorkerUrl = '';
  try {
    const releaseConfig = loadReleasePlatformAuth({ resourcesPath: controlledResourcesPath() });
    releaseWorkerUrl = String(releaseConfig.facebook?.workerBaseUrl || releaseConfig.facebook?.oauthBrokerUrl || '').trim();
  } catch (error) {
    desktopLog('warn', 'facebook-release-auth-origin-load-failed', { code: error.code || '', message: error.message });
  }
  // Legacy vault value remains read-only for one migration cycle. New consumer
  // builds never expose a UI or API that can write this developer configuration.
  const legacyApplication = vault?.get?.('platform:facebook:application') || {};
  const configured = String(releaseWorkerUrl || legacyApplication.workerBaseUrl || legacyApplication.oauthBrokerUrl || process.env.YANCE_FACEBOOK_WORKER_URL || process.env.YANCE_FACEBOOK_OAUTH_BROKER_URL || '').trim();
  if (!configured) return '';
  try {
    const parsed = new URL(configured);
    return parsed.protocol === 'https:' ? parsed.origin : '';
  } catch (_) { return ''; }
}

async function openAuthorizedAuthUrl(input = {}) {
  const provider = String(input.provider || '').trim().toLowerCase();
  const raw = String(input.url || '').trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw Object.assign(new Error('授权地址必须使用 HTTPS'), { code: 'AUTH_HTTPS_REQUIRED' });
  const allowedOrigin = authorizedAuthOrigin(provider);
  if (!allowedOrigin || parsed.origin !== allowedOrigin) {
    throw Object.assign(new Error('授权地址不属于已配置的受信任服务'), { code: 'AUTH_ORIGIN_NOT_ALLOWED' });
  }
  await shell.openExternal(parsed.toString());
  return { ok: true, provider, origin: parsed.origin };
}

function initialsNotificationIcon(name) {
  const image = nativeImage.createFromDataURL(initialsAvatarDataUrl(name));
  return image && !image.isEmpty() ? image.resize({ width: 96, height: 96, quality: 'best' }) : nativeImage.createFromPath(iconPath());
}

async function notificationIcon(payload = {}) {
  const presentation = normalizeNotificationPresentation(payload);
  if (presentation.hideAvatar === true) return { image: nativeImage.createFromPath(iconPath()), source: 'application-icon', avatarUrl: '' };
  const value = presentation.avatarUrl;
  if (value) {
    try {
      let buffer = null;
      if (value.startsWith('data:image/')) {
        const separator = value.indexOf(',');
        buffer = Buffer.from(separator >= 0 ? value.slice(separator + 1) : '', value.slice(0, separator).includes(';base64') ? 'base64' : 'utf8');
      } else if (/^https?:\/\//i.test(value) || value.startsWith('/api/')) {
        const url = value.startsWith('/api/') ? `${YANCE_BACKEND_URL}${value}` : value;
        const response = await fetch(url, {
          headers: value.startsWith('/api/') ? { Authorization: `Bearer ${currentApiSessionToken()}`, Origin: YANCE_BACKEND_URL } : {},
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error(`AVATAR_HTTP_${response.status}`);
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.startsWith('image/')) throw new Error('AVATAR_INVALID_CONTENT_TYPE');
        const bytes = Number(response.headers.get('content-length') || 0);
        if (bytes > 4 * 1024 * 1024) throw new Error('AVATAR_TOO_LARGE');
        buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 4 * 1024 * 1024) throw new Error('AVATAR_TOO_LARGE');
      } else {
        let localPath = value;
        if (/^file:/i.test(value)) localPath = fileURLToPath(value);
        if (path.isAbsolute(localPath) && fs.existsSync(localPath)) {
          const stat = fs.statSync(localPath);
          if (!stat.isFile()) throw new Error('AVATAR_NOT_A_FILE');
          if (stat.size > 4 * 1024 * 1024) throw new Error('AVATAR_TOO_LARGE');
          buffer = fs.readFileSync(localPath);
        }
      }
      const image = buffer ? nativeImage.createFromBuffer(buffer) : null;
      if (image && !image.isEmpty()) return { image: image.resize({ width: 96, height: 96, quality: 'best' }), source: 'customer-avatar', avatarUrl: value };
      throw new Error('AVATAR_DECODE_FAILED');
    } catch (error) {
      console.warn('[notification] customer avatar unavailable, using initials fallback:', error.message);
    }
  }
  return { image: initialsNotificationIcon(presentation.avatarName || presentation.title), source: 'initials-fallback', avatarUrl: value };
}

function notificationSoundPath(pattern = 'message-in') {
  const normalized = normalizeSoundKind(pattern);
  if (isCustomSoundPattern(normalized)) {
    const root = path.resolve(DATA_ROOT, 'notification-sounds');
    for (const extension of ['wav', 'mp3', 'm4a', 'aac']) {
      const candidate = path.resolve(root, `${normalized}.${extension}`);
      if (!candidate.startsWith(`${root}${path.sep}`)) continue;
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
      } catch (_) {}
    }
    return '';
  }
  const fileName = soundFileName(normalized, 'message-in');
  const relative = path.join('frontend', 'assets', 'sounds', fileName);
  const candidates = app.isPackaged
    ? [path.join(packagedAppRoot(), relative)]
    : [path.join(APP_ROOT, relative)];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}

function requestWindowsNativeSound(payload = {}) {
  return new Promise((resolve, reject) => {
    const soundFile = notificationSoundPath(payload.pattern);
    if (!soundFile) return reject(new Error('notification-sound-file-missing'));
    const volume = Math.max(0, Math.min(1, Number(payload.volume ?? 0.68)));
    if (volume <= 0) return resolve({ played: false, reason: 'notification-sound-volume-zero', durationMs: 0, engine: 'windows-native' });
    const escapedPath = soundFile.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName PresentationCore',
      '$player=New-Object System.Windows.Media.MediaPlayer',
      `$player.Open([Uri]::new('${escapedPath}'))`,
      `$player.Volume=${volume.toFixed(3)}`,
      '$deadline=[DateTime]::UtcNow.AddSeconds(3)',
      'while((-not $player.NaturalDuration.HasTimeSpan) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 20}',
      '$player.Play()',
      '$duration=900',
      'if($player.NaturalDuration.HasTimeSpan){$duration=[Math]::Max(450,[Math]::Min(3000,[int]$player.NaturalDuration.TimeSpan.TotalMilliseconds+120))}',
      'Start-Sleep -Milliseconds $duration',
      '$player.Close()'
    ].join(';');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const started = Date.now();
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore'
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch (_) {}
      reject(new Error('windows-native-sound-timeout'));
    }, 6500);
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ played: true, reason: '', durationMs: Date.now() - started, engine: 'windows-native' });
      else reject(new Error(`windows-native-sound-exit-${code}`));
    });
  });
}

async function showNotification(payload = {}) {
  if (!Notification.isSupported()) return { shown: false, reason: 'notification-not-supported' };
  const presentation = normalizeNotificationPresentation(payload);
  const visual = await notificationIcon(presentation);
  const notification = new Notification({
    title: presentation.title,
    body: presentation.body,
    icon: visual.image,
    // Always suppress the OS default sound. The dedicated sound engine below is
    // the single source of truth for volume, DND and background playback.
    silent: true
  });
  notification.on('click', () => {
    activateMainWindow('notification-click', {
      view: presentation.view || 'conversation',
      conversationId: presentation.conversationId || '',
      sessionKey: presentation.sessionKey || presentation.conversationId || '',
      accountId: presentation.accountId || ''
    }).catch(error => logMainWindowActivationFailure('notification-click', error));
  });
  notification.show();
  const result = {
    shown: true,
    at: new Date().toISOString(),
    title: presentation.title,
    body: presentation.body,
    avatarSource: visual.source,
    usedCustomerAvatar: visual.source === 'customer-avatar',
    usedInitialsFallback: visual.source === 'initials-fallback'
  };
  sendToRenderer('desktop:notification-result', result);
  return result;
}

function createSoundWindow() {
  if (soundWindow && !soundWindow.isDestroyed()) return soundWindow;
  soundWindow = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'sound-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });
  soundWindow.loadFile(path.join(__dirname, 'sound-player.html')).catch(error => console.error('[sound] player load failed', error));
  soundWindow.webContents.setAudioMuted(false);
  soundWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[sound] player process exited', details);
    soundWindow = null;
    if (!quitting) setTimeout(() => createSoundWindow(), 500);
  });
  soundWindow.on('closed', () => { soundWindow = null; });
  return soundWindow;
}

function requestRendererSound(payload = {}) {
  return new Promise(resolve => {
    const requestId = randomUUID();
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        soundWaiters.delete(requestId);
        resolve({ played: false, reason: 'sound-player-timeout', durationMs: 0, engine: 'electron-audio-service' });
      }, 2500)
    };
    soundWaiters.set(requestId, waiter);
    const target = createSoundWindow();
    const soundFile = notificationSoundPath(payload.pattern);
    const source = soundFile ? pathToFileURL(soundFile).href : '';
    const send = () => target.webContents.send('sound:play', { ...payload, requestId, source });
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send); else send();
  });
}

async function requestDesktopSound(payload = {}) {
  const now = Date.now();
  if (payload.force !== true && now - lastSoundAt < 650) {
    return { played: false, reason: 'notification-sound-throttled', durationMs: 0, engine: 'main-process' };
  }
  lastSoundAt = now;

  // P0-A Phase 3b (OD-003 DI-2=A): route through the canonical SoundNotificationService so that
  // active-conversation suppression (only when the window is focused), muted/paused/DND and
  // per-kind sound toggles are honoured. Suppression short-circuits before any audio attempt.
  const kind = normalizeSoundKind(payload.pattern);
  let allowed = true;
  let suppressReason = '';
  try {
    if (payload.force !== true && !soundNotificationService.soundAllowed(kind, payload)) {
      allowed = false;
      suppressReason = soundNotificationService.suppression(payload) || 'notification-suppressed';
    }
  } catch (_) { allowed = true; }
  if (!allowed) {
    return { played: false, reason: suppressReason, durationMs: 0, engine: 'sound-notification-service' };
  }

  const serviceResult = await soundNotificationService.play(kind, payload, { volume: payload.volume, force: payload.force === true });
  if (serviceResult.played === true || process.platform !== 'win32') return serviceResult;

  // Windows-native playback is a second, independent fallback if Chromium's
  // audio service was restarted, muted by the OS or failed to acknowledge.
  try {
    return await requestWindowsNativeSound({ ...payload, pattern: serviceResult.pattern || kind });
  } catch (error) {
    return { played: false, reason: `${serviceResult.reason || 'audio-service-failed'};${error.message}`, durationMs: serviceResult.durationMs || 0, engine: 'main-process-failed' };
  }
}

function resolveSound(result = {}) {
  const requestId = String(result.requestId || '');
  const waiter = soundWaiters.get(requestId);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  soundWaiters.delete(requestId);
  waiter.resolve({ ...result, engine: result.engine || 'electron-audio-service' });
  return true;
}

function presentTrayUnread(value) {
  const unread = Math.max(0, Math.trunc(Number(value) || 0));
  traySnapshot = { ...traySnapshot, unread };
  if (!tray) return unread;
  const image = nativeImage.createFromPath(iconPath());
  if (image && !image.isEmpty()) tray.setImage(image);
  tray.setToolTip(unread > 0 ? `言策 · ${unread}条未读` : '言策');
  buildTrayMenu();
  return unread;
}

async function refreshTraySnapshot() {
  if (!backendReady) return traySnapshot;
  try {
    const [accounts, notifications, models, coreSnapshot] = await Promise.all([
      apiRequest('/api/r32/accounts'), apiRequest('/api/r32/system/notifications'), apiRequest('/api/r32/models/status'), apiRequest('/api/core/snapshot')
    ]);
    const rows = accounts.accounts || [];
    traySnapshot = {
      accounts: rows,
      unread: rows.reduce((sum, row) => sum + Number(row.unread || 0), 0),
      safeMode: coreSnapshot?.runtime?.operatingMode === 'safeMode',
      safeModeReason: coreSnapshot?.recovery?.safeMode?.reason || '',
      notifications: notifications.settings || notifications,
      models: {
        online: models.ollamaOnline === true || (models.models || []).some(row => row.available !== false),
        verified: (models.models || []).filter(row => ['verified', 'experimental'].includes(row.qualification)).length,
        total: (models.models || []).length,
        used: (models.models || []).filter(row => Number(row.callCount || 0) > 0).length,
        lastModel: (models.models || []).filter(row => row.lastUsedAt).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))[0]?.name || '',
        automationEnabled: models.runtime?.aiAutomation?.config?.enabled === true,
        automationLocalOnly: models.runtime?.aiAutomation?.config?.localOnly !== false
      }
    };
  } catch (_) {}
  soundNotificationService.updateUnreadCount(traySnapshot.unread);
  return traySnapshot;
}

function scheduleTrayRefresh() {
  clearTimeout(trayRefreshTimer);
  trayRefreshTimer = setTimeout(() => refreshTraySnapshot().catch(() => {}), 250);
}

function buildTrayMenu() {
  if (!tray || tray.isDestroyed?.() === true || !settingsStore) return;

  const settings = settingsStore.read();
  const safeModeActive = traySnapshot.safeMode === true;
  const accountItems = traySnapshot.accounts.length ? traySnapshot.accounts.map(account => ({
    label: `${account.platform} · ${account.displayName || account.identityLabel || account.id} · ${account.stateLabel || account.state}${account.unread ? ` · ${account.unread}未读` : ''}`,
    submenu: [
      { label: '打开账号中心', click: () => activateMainWindow('tray-menu-account', { view: 'accounts', accountId: account.id })
        .catch(error => logMainWindowActivationFailure('tray-menu-account', error)) },
      {
        label: safeModeActive ? '安全模式已阻止账号连接' : (['connected', 'limited'].includes(account.state) ? '重新连接' : '连接账号'),
        enabled: safeModeActive !== true,
        click: () => forwardBackendCommand('account.reconnect', { id: account.id }, { actor: 'desktop-tray' })
          .then(scheduleTrayRefresh).catch(error => dialog.showErrorBox('账号连接失败', error.message))
      }
    ]
  })) : [{ label: '尚未配置账号', enabled: false }];

  const publicName = releaseIdentity().publicProductName || '言策';
  const template = [
    {
      label: (() => {
        const update = updateManager?.snapshot?.() || {};
        const updateLabel = update.availablePublicVersion || update.availableVersion || '';
        if (safeModeActive) return `${publicName} · 安全模式 · ${traySnapshot.unread}条未读`;
        if (update.phase === 'ready' || update.phase === 'downloaded') return `${publicName} · 更新 ${updateLabel} 已就绪`;
        if (update.phase === 'rejected') return `${publicName} · 更新被拒绝`;
        if (update.phase === 'verifying') return `${publicName} · 正在校验更新`;
        if (update.phase === 'downloading') return `${publicName} · 正在下载更新 · ${Math.round(update.percent || 0)}%`;
        if (update.phase === 'available') return `${publicName} · 发现 ${updateLabel || '新版本'}`;
        return backendReady ? `${publicName} · 服务正常 · ${traySnapshot.unread}条未读` : `${publicName} · 服务连接中`;
      })(),
      enabled: false
    },
    { type: 'separator' },

    // Standard Windows tray actions. Keep these stable and near the top so the
    // menu behaves like a normal desktop application rather than a debug menu.
    {
      id: 'show-main-window',
      label: '显示主窗口',
      accelerator: 'CommandOrControl+Shift+Y',
      click: () => activateMainWindow('tray-menu-show')
        .catch(error => logMainWindowActivationFailure('tray-menu-show', error))
    },
    {
      id: 'launch-at-login',
      label: '开机自启设置',
      type: 'checkbox',
      checked: settings.autoLaunch === true,
      click: item => {
        const next = settingsStore.update({ autoLaunch: item.checked === true });
        updateLoginItem(next);
        buildTrayMenu();
        sendToRenderer('desktop:event', {
          type: 'desktop:settings-updated',
          payload: next,
          at: new Date().toISOString()
        });
      }
    },
    ...(() => {
      const update = updateManager?.snapshot?.() || {};
      const updateLabel = update.availablePublicVersion || update.availableVersion || '';
      if (update.phase === 'ready' || update.phase === 'downloaded') return [{ id: 'install-update', label: `重启并安装 ${updateLabel || '更新'}`, click: () => updateManager.install().catch(error => dialog.showErrorBox('安装更新失败', error.message)) }];
      if (update.phase === 'rejected') return [{ id: 'update-rejected', label: `更新被拒绝：${update.error || '见日志'}`, enabled: false },
        { id: 'check-for-updates', label: '重新检查更新', click: () => updateManager.check({ manual: true }) }];
      if (update.phase === 'verifying') return [{ id: 'verifying-update', label: '正在校验更新…', enabled: false }];
      if (update.phase === 'downloading') return [{ id: 'update-progress', label: `正在下载更新 · ${Math.round(update.percent || 0)}%`, enabled: false }];
      if (update.phase === 'available') return [
        { id: 'download-update', label: `下载更新 ${updateLabel}`, click: () => updateManager.download().catch(error => dialog.showErrorBox('下载更新失败', error.message)) },
        { id: 'check-for-updates', label: '重新检查更新', click: () => updateManager.check({ manual: true }) }
      ];
      if (update.phase === 'checking') return [{ id: 'checking-updates', label: '正在检查更新…', enabled: false }];
      return [{ id: 'check-for-updates', label: '检查更新', click: () => updateManager.check({ manual: true }) }];
    })(),
    { type: 'separator' },

    { label: '打开工作台', click: () => activateMainWindow('tray-menu-show')
        .catch(error => logMainWindowActivationFailure('tray-menu-show', error)) },
    { label: '打开系统中心', click: () => activateMainWindow('tray-menu-system', { view: 'system', tab: 'overview' })
      .catch(error => logMainWindowActivationFailure('tray-menu-system', error)) },
    { label: '打开账号中心', click: () => activateMainWindow('tray-menu-accounts', { view: 'accounts' })
      .catch(error => logMainWindowActivationFailure('tray-menu-accounts', error)) },
    { label: '打开设置与恢复', click: () => activateMainWindow('tray-menu-settings', { view: 'settings', tab: 'desktop' })
      .catch(error => logMainWindowActivationFailure('tray-menu-settings', error)) },
    { label: '账号状态', submenu: accountItems },
    { type: 'separator' },
    {
      label: '暂停所有桌面通知',
      type: 'checkbox',
      checked: traySnapshot.notifications.paused === true,
      click: item => apiRequest('/api/r32/system/notifications', {
        method: 'POST',
        body: JSON.stringify({ paused: item.checked })
      }).then(refreshTraySnapshot).catch(error => dialog.showErrorBox('通知设置失败', error.message))
    },
    {
      label: '创建快速备份',
      click: () => apiRequest('/api/r32/system/backups', {
        method: 'POST',
        body: JSON.stringify({ mode: 'standard' })
      }).then(() => dialog.showMessageBox({
        type: 'info',
        message: '快速备份已创建'
      })).catch(error => dialog.showErrorBox('备份失败', error.message))
    },
    {
      label: `AI模型 · ${traySnapshot.models.verified || 0}/${traySnapshot.models.total || 0} 已验证 · ${traySnapshot.models.used || 0} 已调用`,
      submenu: [
        { label: traySnapshot.models.online ? '模型服务在线' : '模型服务未就绪', enabled: false },
        {
          label: traySnapshot.models.automationEnabled
            ? `自动AI大脑已启用 · ${traySnapshot.models.automationLocalOnly ? '仅本地' : '允许云端'}`
            : '自动AI大脑已关闭',
          enabled: false
        },
        {
          label: traySnapshot.models.lastModel
            ? `最近调用：${traySnapshot.models.lastModel}`
            : '尚无真实模型调用记录',
          enabled: false
        },
        {
          label: '重新扫描本地模型',
          click: () => apiRequest('/api/r32/models/scan', {
            method: 'POST',
            body: '{}'
          }).then(refreshTraySnapshot).catch(error => dialog.showErrorBox('模型扫描失败', error.message))
        },
        { label: '打开AI工作台', click: () => activateMainWindow('tray-menu-ai', { view: 'ai-workbench' })
          .catch(error => logMainWindowActivationFailure('tray-menu-ai', error)) }
      ]
    },
    { type: 'separator' },
    {
      label: settings.closeToTray
        ? '关闭窗口时保留后台运行'
        : '关闭窗口时退出',
      type: 'checkbox',
      checked: settings.closeToTray === true,
      click: item => {
        const next = settingsStore.update({ closeToTray: item.checked });
        buildTrayMenu();
        sendToRenderer('desktop:event', {
          type: 'desktop:settings-updated',
          payload: next,
          at: new Date().toISOString()
        });
      }
    },
    {
      label: '重启本地服务',
      click: () => restartBackend().catch(error => dialog.showErrorBox('服务重启失败', error.message))
    },
    { label: '打开数据目录', click: () => shell.openPath(PATHS.root) },
    { label: '打开日志目录', click: () => shell.openPath(PATHS.logs) },
    { type: 'separator' },
    {
      id: 'quit-yance-28',
      label: '退出言策',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ];

  trayContextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(trayContextMenu);
}

function createTray() {
  if (tray) return tray;

  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image);
  tray.setToolTip('言策');
  m2Registry.registerTray(tray);

  const activate = eventName => {
    const now = Date.now();
    if (now - lastTrayActivationAt < 350) return;
    lastTrayActivationAt = now;
    activateMainWindow(eventName).catch(error => desktopLog('error', 'tray-main-window-activation-failed', { reasonCode: error.reasonCode || error.code || '', message: error.message }));
  };
  tray.on('click', () => activate('tray-click'));
  tray.on('double-click', () => activate('tray-double-click'));

  // setContextMenu is the authoritative Windows right-click binding. Keeping
  // the Menu instance in trayContextMenu also prevents accidental collection
  // when the menu is rebuilt after settings or account-state changes.
  buildTrayMenu();
  return tray;
}


async function routeDesktopLifecycleViaApiV2(event, detail = {}) {
  const at = new Date().toISOString();
  const payload = { event, at, ...detail };
  sendToRenderer('desktop:event', { type: 'runtime:lifecycle-observed', payload, at });
  const projection = runtimeProjectionCoordinator?.snapshot?.();
  if (!projection?.trustedOwnerBound) return { routed: false, reasonCode: 'WP6_RUNTIME_BASELINE_REQUIRED' };
  if (event === 'online' || event === 'offline') {
    return runtimeProjectionCoordinator.setNetwork(event === 'online', detail.reason || `desktop-network-${event}`);
  }
  if (event === 'suspend') return runtimeProjectionCoordinator.suspend(detail.reason || 'desktop-system-suspend');
  if (event === 'resume') {
    const resumed = await runtimeProjectionCoordinator.resume(detail.reason || 'desktop-system-resume');
    const online = detail.online !== false;
    await runtimeProjectionCoordinator.setNetwork(online, 'desktop-network-after-resume');
    return resumed;
  }
  return { routed: false, reasonCode: 'DESKTOP_EVENT_NOT_RUNTIME_CONTROL' };
}

function observeLifecycle(event, detail = {}) {
  routeDesktopLifecycleViaApiV2(event, detail).catch(error => {
    desktopLog('error', 'api-v2-runtime-lifecycle-failed', {
      event,
      reasonCode: error.reasonCode || error.code || 'RUNTIME_API_V2_LIFECYCLE_FAILED',
      message: error.message
    });
  });
}

function installLifecycleMonitors() {
  if (lifecycleMonitorsInstalled) return;
  lifecycleMonitorsInstalled = true;
  lastNetworkOnline = net.isOnline();
  powerMonitor.on('suspend', () => observeLifecycle('suspend'));
  powerMonitor.on('resume', () => observeLifecycle('resume', { online: net.isOnline() }));
  powerMonitor.on('lock-screen', () => observeLifecycle('lock-screen'));
  powerMonitor.on('unlock-screen', () => observeLifecycle('unlock-screen', { online: net.isOnline() }));
  lifecyclePollTimer = setInterval(() => {
    const online = net.isOnline();
    if (online !== lastNetworkOnline) {
      lastNetworkOnline = online;
      observeLifecycle(online ? 'online' : 'offline');
    }
  }, 5000);
  lifecyclePollTimer.unref?.();
}

function handleBackendMessage(message) {
  if (!message || typeof message !== 'object') return;
  // Generic Node IPC is reserved for non-secret lifecycle and startup signals.
}

function packagedBackendNodePath() {
  const paths = [packagedNodeModulesPath()];
  if (!app.isPackaged && process.env.NODE_PATH) paths.push(process.env.NODE_PATH);
  return [...new Set(paths.filter(Boolean))].join(path.delimiter);
}

function backendEnvironment(launch = {}) {
  const allowedPassthrough = ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'ComSpec', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE'];
  const env = {};
  for (const key of allowedPassthrough) if (process.env[key]) env[key] = process.env[key];
  env.WORKBUDDY_DESKTOP = '1';
  env.YANCE_DATA_DIR = PATHS.root;
  if (EARLY_DATA_ROOT_RESOLUTION.legacyRoot && path.resolve(EARLY_DATA_ROOT_RESOLUTION.legacyRoot) !== path.resolve(PATHS.root)) {
    env.YANCE_LEGACY_DATA_DIR = path.resolve(EARLY_DATA_ROOT_RESOLUTION.legacyRoot);
  }
  env.YANCE_APP_ROOT = launch.appRoot || packagedAppRoot();
  env.NODE_PATH = launch.nodeModulesPath || packagedBackendNodePath();
  env.YANCE_RUNTIME_MODE = app.isPackaged ? 'production' : String(process.env.YANCE_RUNTIME_MODE || 'production');
  env.YANCE_ALLOW_DEMO_MODE = app.isPackaged ? '0' : String(process.env.YANCE_ALLOW_DEMO_MODE || '0');
  const releaseResourcesPath = controlledResourcesPath();
  env.YANCE_RELEASE_RESOURCES_PATH = releaseResourcesPath;
  const explicitPlatformAuthConfig = String(process.env.YANCE_PLATFORM_AUTH_CONFIG_PATH || '').trim();
  const explicitPlatformAuthHash = String(process.env.YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH || '').trim();
  const releasePlatformAuthConfig = path.join(releaseResourcesPath, 'platform-auth.json');
  const releasePlatformAuthHash = path.join(releaseResourcesPath, 'platform-auth.sha256');
  if (explicitPlatformAuthConfig || fs.existsSync(releasePlatformAuthConfig)) {
    env.YANCE_PLATFORM_AUTH_CONFIG_PATH = path.resolve(explicitPlatformAuthConfig || releasePlatformAuthConfig);
  }
  if (explicitPlatformAuthHash || fs.existsSync(releasePlatformAuthHash)) {
    env.YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH = path.resolve(explicitPlatformAuthHash || releasePlatformAuthHash);
  }
  env.YANCE_PORT = String(new URL(YANCE_BACKEND_URL).port);
  env.YANCE_AUTO_START_WHATSAPP = '0';
  for (const key of [
    'WP7_PROBE_ID',
    'WP7_PROBE_EXECUTION_CLASS',
    'WP7_PROBE_NETWORK_DISABLED_BEFORE_SPAWN'
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function stopEventSocket() {
  if (eventReconnectTimer) clearTimeout(eventReconnectTimer);
  eventReconnectTimer = null;
  const socket = eventSocket;
  eventSocket = null;
  if (socket) {
    disposeEventSocket(socket, WebSocket);
    m2Registry.unregisterEventSocket(socket);
  }
}

function scheduleEventReconnect() {
  if (quitting || !backendReady || eventReconnectTimer) return;
  eventReconnectTimer = setTimeout(() => {
    eventReconnectTimer = null;
    connectEventSocket();
  }, 1500);
}

function isParlantEligibleInboundMessage(message = {}) {
  const direction = String(message.direction || '').trim().toLowerCase();
  const speaker = String(message.speaker || message.role || '').trim().toLowerCase();
  const contactId = String(message.contactId || '').trim();
  const conversationId = String(message.conversationId || message.sessionKey || '').trim();
  const text = String(message.text || message.transcript || message.translation || '').trim();
  return Boolean(contactId && conversationId && text && direction === 'inbound' && ['peer', 'contact', 'customer'].includes(speaker));
}

async function processParlantInboundEvent(event = {}) {
  const message = event?.payload?.message || {};
  if (!isParlantEligibleInboundMessage(message)) return { handled: false, reasonCode: 'DESKTOP_PARLANT_EVENT_NOT_ELIGIBLE' };
  const contactId = String(message.contactId || '').trim();
  const conversationId = String(message.conversationId || message.sessionKey || '').trim();
  try {
    const runtime = ensureParlantRelationshipRuntime();
    const goal = await runtime.readRelationshipGoal({ contactId });
    if (goal?.exists !== true) return { handled: false, reasonCode: 'DESKTOP_PARLANT_GOAL_NOT_CONFIGURED' };
    if (goal?.paused === true) return { handled: false, reasonCode: 'DESKTOP_PARLANT_GOAL_PAUSED' };
    const inboundText = String(message.text || message.transcript || message.translation || '').trim();
    const ingested = await runtime.ingestCustomerMessage({
      contactId,
      text: inboundText,
      externalMessageId: String(message.externalMessageId || message.messageId || message.id || '').trim()
    });
    const processingTraceId = String(ingested?.traceId || '').trim();
    if (!processingTraceId) throw Object.assign(new Error('Parlant ingest did not return a native processing trace.'), { reasonCode: 'DESKTOP_PARLANT_PROCESSING_TRACE_MISSING' });
    const candidate = await runtime.requestReplyCandidate({
      contactId,
      afterOffset: Number(ingested?.nextOffset || 0),
      processingTraceId: String(ingested?.traceId || '')
    });
    if (String(candidate?.traceId || '').trim() !== processingTraceId) {
      throw Object.assign(new Error('Parlant candidate trace does not match the ingested native processing trace.'), { reasonCode: 'DESKTOP_PARLANT_CANDIDATE_TRACE_MISMATCH' });
    }
    const candidateText = String(candidate?.text || '').trim();
    if (!candidateText) throw Object.assign(new Error('Parlant returned an empty relationship-goal candidate.'), { reasonCode: 'DESKTOP_PARLANT_CANDIDATE_EMPTY' });
    const committed = await apiRequest('/api/r32/store/replies/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contactId,
        conversationId,
        incomingMessage: {
          id: String(message.externalMessageId || message.messageId || message.id || '').trim(),
          text: inboundText,
          type: String(message.type || message.messageType || 'text').trim(),
          sentAt: String(message.sentAt || message.timestamp || '').trim()
        },
        contextMessageIds: [String(message.externalMessageId || message.messageId || message.id || '').trim()].filter(Boolean),
        manualText: candidateText,
        performanceMode: 'rapid',
        source: 'parlant-journey'
      })
    });
    sendToRenderer('desktop:event', {
      type: 'parlant:relationship-goal-candidate-ready',
      payload: { contactId, conversationId, candidateId: String(committed?.candidate?.candidateId || '') }
    });
    return { handled: true, candidateId: String(committed?.candidate?.candidateId || '') };
  } catch (error) {
    const reasonCode = String(error?.reasonCode || error?.code || 'DESKTOP_PARLANT_RUNTIME_UNAVAILABLE');
    desktopLog('error', 'parlant-relationship-goal-degraded', { contactId, conversationId, reasonCode });
    if (reasonCode !== 'DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING') {
      sendToRenderer('desktop:event', { type: 'parlant:relationship-goal-degraded', payload: { contactId, conversationId, reasonCode } });
    }
    return { handled: false, degraded: true, reasonCode };
  }
}

function scheduleParlantInboundEvent(event = {}) {
  const message = event?.payload?.message || {};
  if (!isParlantEligibleInboundMessage(message)) return Promise.resolve({ handled: false, reasonCode: 'DESKTOP_PARLANT_EVENT_NOT_ELIGIBLE' });
  const contactId = String(message.contactId || '').trim();
  return parlantInboundSequencer.run(contactId, () => processParlantInboundEvent(event));
}

function isGraphitiEligibleInboundMessage(message = {}) {
  const direction = String(message.direction || '').trim().toLowerCase();
  const speaker = String(message.speaker || message.role || '').trim().toLowerCase();
  const contactId = String(message.contactId || '').trim();
  const conversationId = String(message.conversationId || message.sessionKey || '').trim();
  const text = String(message.text || message.transcript || message.translation || '').trim();
  return Boolean(contactId && conversationId && text && direction === 'inbound' && ['peer', 'contact', 'customer'].includes(speaker));
}

function mergeGraphitiFacts(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const fact of Array.isArray(group) ? group : []) {
      const factId = String(fact?.factId || '').trim();
      const episodeUuid = String(fact?.episodeUuid || '').trim();
      const groupId = String(fact?.groupId || '').trim();
      if (!factId || !episodeUuid || !groupId) continue;
      byId.set(factId, fact);
    }
  }
  return [...byId.values()];
}

async function processGraphitiInboundEvent(event = {}) {
  const message = event?.payload?.message || {};
  if (!isGraphitiEligibleInboundMessage(message)) return { handled: false, reasonCode: 'DESKTOP_GRAPHITI_EVENT_NOT_ELIGIBLE' };
  const contactId = String(message.contactId || '').trim();
  const conversationId = String(message.conversationId || message.sessionKey || '').trim();
  const inboundText = String(message.text || message.transcript || message.translation || '').trim();
  const externalMessageId = String(message.externalMessageId || message.messageId || message.id || '').trim();
  const referenceTime = String(message.sentAt || message.timestamp || new Date().toISOString()).trim();
  try {
    const runtime = ensureGraphitiRelationshipRuntime();
    const added = await runtime.addRelationshipEpisode({ contactId, text: inboundText, externalMessageId, referenceTime });
    const recalled = await runtime.recallRelationshipFacts({ contactId, query: inboundText, limit: 12 });
    const facts = mergeGraphitiFacts(added?.facts, recalled?.facts);
    if (facts.length) {
      await apiRequest(`/api/r32/workspace/contacts/${encodeURIComponent(contactId)}/graphiti-projection`, {
        method: 'POST',
        body: JSON.stringify({ conversationId, facts })
      });
    }
    return { handled: true, projectedFacts: facts.length };
  } catch (error) {
    const reasonCode = String(error?.reasonCode || error?.code || 'DESKTOP_GRAPHITI_RUNTIME_UNAVAILABLE');
    desktopLog('error', 'graphiti-relationship-memory-degraded', { contactId, conversationId, reasonCode });
    sendToRenderer('desktop:event', { type: 'graphiti:relationship-memory-degraded', payload: { contactId, conversationId, reasonCode } });
    return { handled: false, degraded: true, reasonCode };
  }
}

function scheduleGraphitiInboundEvent(event = {}) {
  const message = event?.payload?.message || {};
  if (!isGraphitiEligibleInboundMessage(message)) return Promise.resolve({ handled: false, reasonCode: 'DESKTOP_GRAPHITI_EVENT_NOT_ELIGIBLE' });
  return processGraphitiInboundEvent(event);
}

function connectEventSocket() {
  stopEventSocket();
  if (!backendReady) return;
  const wsUrl = YANCE_BACKEND_URL.replace(/^http/, 'ws') + '/events';
  eventSocket = new WebSocket(wsUrl, {
    headers: { Authorization: `Bearer ${currentApiSessionToken()}`, Origin: YANCE_BACKEND_URL }
  });
  m2Registry.registerEventSocket(eventSocket);
  eventSocket.on('open', () => {
    sendToRenderer('desktop:backend-state', { ready: true, pid: backendPid, eventStreamConnected: true });
    buildTrayMenu();
  });
  eventSocket.on('message', buffer => {
    let event;
    try { event = JSON.parse(String(buffer)); } catch (_) { return; }
    sendToRenderer('desktop:event', event);
    if (event.type === 'message:inserted') {
      Promise.resolve(scheduleParlantInboundEvent(event))
        .catch(error => desktopLog('error', 'parlant-inbound-processing-failed', { reasonCode: error?.reasonCode || error?.code || '', message: error?.message || String(error) }));
      Promise.resolve(scheduleGraphitiInboundEvent(event))
        .catch(error => desktopLog('error', 'graphiti-inbound-processing-failed', { reasonCode: error?.reasonCode || error?.code || '', message: error?.message || String(error) }));
    }
    if (['sound-notification:event','desktop:notify','send-queue:sent','send-queue:failed','conversation:presence','system:notifications-updated','notification:settings-updated'].includes(event.type)) {
      Promise.resolve(soundNotificationService.handleBackendEvent(event))
        .catch(error => desktopLog('error', 'sound-notification-event-failed', { type: event.type, error: error.message || String(error) }));
    }
    if (['message:inserted','message:updated','accounts:summary','account:state','models:scanned','ai:job-complete','ai:automation-status','system:notifications-updated','notification:settings-updated'].includes(event.type)) scheduleTrayRefresh();
  });
  eventSocket.on('close', () => {
    sendToRenderer('desktop:backend-state', { ready: backendReady, pid: backendPid, eventStreamConnected: false });
    scheduleEventReconnect();
  });
  eventSocket.on('error', () => scheduleEventReconnect());
}

function resolveBackendLaunchPaths() {
  const appRoot = packagedAppRoot();
  const entry = path.join(appRoot, 'backend', 'desktopHostedEntry.js');
  const cwd = appRoot;
  const nodeModulesPath = path.join(appRoot, 'node_modules');
  const nodeRuntimeExecutablePath = resolveTrustedNodeRuntime();

  if (!fs.existsSync(appRoot)) {
    const error = new Error(`应用资源目录不存在：${appRoot}`);
    error.code = 'APP_ROOT_MISSING';
    error.reasonCode = 'APP_ROOT_MISSING';
    throw error;
  }
  if (!fs.existsSync(entry)) {
    const error = new Error(`本地服务入口不存在：${entry}`);
    error.code = 'BACKEND_ENTRY_MISSING';
    error.reasonCode = 'BACKEND_ENTRY_MISSING';
    throw error;
  }
  if (!fs.existsSync(nodeModulesPath)) {
    const error = new Error(`生产依赖目录不存在：${nodeModulesPath}`);
    error.code = 'NODE_MODULES_MISSING';
    error.reasonCode = 'NODE_MODULES_MISSING';
    throw error;
  }
  if (!cwd || !fs.existsSync(cwd)) {
    const error = new Error(`本地服务工作目录不存在：${cwd || '(empty)'}`);
    error.code = 'BACKEND_CWD_MISSING';
    error.reasonCode = 'BACKEND_CWD_MISSING';
    throw error;
  }
  return { entry, cwd, appRoot, nodeModulesPath, nodeRuntimeExecutablePath };
}

function backendStartupTimeoutMs() {
  const configured = Number(process.env.YANCE_BACKEND_STARTUP_TIMEOUT_MS || 60_000);
  if (!Number.isFinite(configured)) return 60_000;
  return Math.min(180_000, Math.max(5_000, Math.floor(configured)));
}

function terminateChild(child, timeoutMs = 7_000) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      child.removeListener('exit', finish);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish();
    }, timeoutMs);
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch (_) { finish(); }
  });
}

function scheduleBackendRestart() {
  if (quitting || backendRestarting || backendRestartTimer) return;
  backendRestartAttempt += 1;
  const delayMs = Math.min(15_000, 1_000 * (2 ** Math.min(backendRestartAttempt - 1, 4)));
  desktopLog('warn', 'backend-restart-scheduled', { attempt: backendRestartAttempt, delayMs });
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = null;
    launchBackend().catch(error => {
      desktopLog('error', 'backend-relaunch-failed', { code: error.code || '', error: error.stack || error.message });
      scheduleBackendRestart();
    });
  }, delayMs);
}

async function handleBackendExit(child, code, signal) {
  const isCurrent = backendObservationChild === child;
  const wasReady = isCurrent && backendReady;
  if (isCurrent && backendStartupSupervisor) backendStartupSupervisor.observeExit(code, signal);
  desktopLog(wasReady ? 'error' : 'warn', 'backend-exit', {
    childPid: child.pid || 0,
    code,
    signal: signal || '',
    wasReady
  });
  if (!isCurrent) return;

  stopEventSocket();
  runtimeProjectionCoordinator?.discardBaseline?.('WP6_BACKEND_EXIT_OBSERVED');
  backendObservationChild = null;
  backendPid = 0;
  backendReady = false;
  backendReadySource = '';
  signalBackendActivationWaiters();
  sendToRenderer('desktop:backend-state', { ready: false, pid: 0, eventStreamConnected: false, code, signal });
  buildTrayMenu();
  let ownerRecovery;
  try {
    ownerRecovery = desktopCredentialApplicationCoordinator
      ? await desktopCredentialApplicationCoordinator.recoverAfterBackendExit(child, { unexpected: !quitting && !backendRestarting })
      : await desktopHost?.waitForBackendOwnerExitRecovery?.(child);
    desktopLog('info', 'credential-owner-exit-recovery-complete', { childPid: child.pid || 0, recovered: ownerRecovery?.recovered !== false });
  } catch (error) {
    backendLastFailure = { at: new Date().toISOString(), code: error.reasonCode || error.code || 'WP4_CREDENTIAL_OWNER_EXIT_RECOVERY_FAILED', message: error.message };
    desktopLog('error', 'credential-owner-exit-recovery-failed', { childPid: child.pid || 0, ...backendLastFailure });
    sendToRenderer('desktop:backend-state', { ready: false, pid: 0, eventStreamConnected: false, reasonCode: backendLastFailure.code });
    return;
  }
  if (!quitting && !backendRestarting && wasReady && ownerRecovery?.suppressAutomaticRestart !== true) scheduleBackendRestart();
}

function markBackendProcessReady(child, readyResult) {
  if (ownedBackendChild() !== child || authoritativeBackend().state !== 'RUNNING') {
    throw Object.assign(new Error('本地服务启动结果已过期。'), { code: 'BACKEND_STALE_STARTUP_RESULT' });
  }
  backendReady = false;
  backendReadySource = 'owner-validation-pending';
  backendLastFailure = null;
  desktopLog('info', 'backend-process-ready-owner-untrusted', {
    childPid: backendPid,
    source: readyResult.source || 'backend-ready',
    elapsedMs: readyResult.elapsedMs || 0
  });
  return readyResult;
}

async function finalizeTrustedBackendReady(result = {}) {
  if (!runtimeProjectionCoordinator) {
    const error = new Error('RuntimeProjectionCoordinator is unavailable');
    error.reasonCode = 'WP6_RUNTIME_PROJECTION_COORDINATOR_REQUIRED';
    throw error;
  }
  await runtimeProjectionCoordinator.bindTrustedOwnerBaseline(result.runtimeProjection?.runtimeApiV2 || null);
  runtimeProjectionCoordinator.startPolling();
  backendReady = true;
  backendReadySource = result.source || 'trusted-owner-api-v2-baseline';
  signalBackendActivationWaiters();
  backendRestarting = false;
  backendRestartAttempt = 0;
  backendLastFailure = null;
  await routeDesktopLifecycleViaApiV2(net.isOnline() ? 'online' : 'offline', { source: backendReadySource });
  connectEventSocket();
  sendToRenderer('desktop:backend-state', {
    ready: true,
    pid: backendPid,
    eventStreamConnected: false,
    source: backendReadySource,
    runtimeProjection: runtimeProjectionCoordinator.snapshot()
  });
  buildTrayMenu();
  desktopLog('info', 'backend-trusted-owner-api-v2-ready', {
    childPid: backendPid,
    source: backendReadySource,
    authorityTriple: runtimeProjectionCoordinator.snapshot().authorityTriple
  });
  return { ...result, runtimeProjection: runtimeProjectionCoordinator.snapshot() };
}

function startBackendProcessForCoordinator(options = {}) {
  if (backendReady && authoritativeBackend().state === 'RUNNING' && ownedBackendChild()) {
    return Promise.resolve({ ok: true, source: 'already-ready', pid: backendPid, elapsedMs: 0 });
  }
  if (backendLaunchPromise) return backendLaunchPromise;
  if (relaunchPending || quitting) { const error = new Error('Backend start blocked during application shutdown or relaunch'); error.reasonCode = 'DESKTOP_BACKEND_START_BLOCKED_BY_SHUTDOWN'; return Promise.reject(error); }

  const task = (async () => {
    if (backendOwnershipPresent() && !backendReady) {
      desktopLog('warn', 'backend-stale-process-cleanup', { childPid: authoritativeBackend().backend.backendPid || 0 });
      await stopBackendProcessForCoordinator({ applicationLeaseToken: options.applicationLeaseToken || null });
    }

    backendReady = false;
    backendReadySource = '';
    if (wp7ProbeRequested() && !wp7BackendLaunchStartedAtUtc) wp7BackendLaunchStartedAtUtc = new Date().toISOString();
    sendToRenderer('desktop:backend-state', { ready: false, pid: 0, eventStreamConnected: false });
    const launch = resolveBackendLaunchPaths();

    desktopLog('info', 'backend-launch', {
      execPath: launch.nodeRuntimeExecutablePath,
      entry: launch.entry,
      cwd: launch.cwd,
      appRoot: launch.appRoot,
      nodeModulesPath: launch.nodeModulesPath,
      packaged: app.isPackaged,
      buildId: releaseIdentity().buildId
    });

    let child;
    let startupNonce;
    let started;
    try {
      if (!desktopHost) {
        const error = new Error('DesktopHost has not been initialized');
        error.reasonCode = 'DESKTOP_HOST_NOT_INITIALIZED';
        throw error;
      }
      const startupTimeoutMs = backendStartupTimeoutMs();
      started = await desktopHost.startBackend({
        entry: launch.entry,
        execPath: launch.nodeRuntimeExecutablePath,
        nodeRuntimeExecutablePath: launch.nodeRuntimeExecutablePath,
        cwd: launch.cwd,
        env: backendEnvironment(launch),
        windowsHide: true,
        readyTimeoutMs: startupTimeoutMs,
        launchTimeoutMs: startupTimeoutMs,
        applicationLeaseToken: options.applicationLeaseToken || null
      });
      child = started.child;
      startupNonce = started.startupNonce;
    } catch (error) {
      backendLastFailure = { at: new Date().toISOString(), code: error.reasonCode || error.code || 'BACKEND_FORK_FAILED', message: error.message };
      desktopLog('error', 'backend-fork-failed', { ...backendLastFailure, entry: launch.entry, cwd: launch.cwd });
      throw error;
    }

    backendObservationChild = child;
    backendPid = child.pid || 0;
    const supervisor = createBackendStartupSupervisor({
      baseUrl: YANCE_BACKEND_URL,
      apiToken: started.apiSessionToken,
      expectedPid: backendPid,
      startupNonce,
      startupAttemptId: started.startupAttemptId,
      backendSessionId: started.backendSessionId,
      timeoutMs: backendStartupTimeoutMs(),
      pollIntervalMs: 400,
      requestTimeoutMs: 1_500,
      log: (event, detail) => desktopLog('warn', `backend-startup-${event}`, detail)
    });
    backendStartupSupervisor = supervisor;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', data => {
      supervisor.observeStdout(data);
      mirrorBackendOutput(process.stdout, 'stdout', data);
    });
    child.stderr?.on('data', data => {
      supervisor.observeStderr(data);
      mirrorBackendOutput(process.stderr, 'stderr', data);
    });
    child.on('message', message => {
      supervisor.observeMessage(message);
      handleBackendMessage(message);
    });
    child.once('error', error => {
      desktopLog('error', 'backend-child-error', {
        childPid: child.pid || 0,
        code: error.code || '',
        error: error.stack || error.message,
        path: error.path || launch.nodeRuntimeExecutablePath,
        spawnargs: error.spawnargs || [],
        entry: launch.entry,
        cwd: launch.cwd
      });
      supervisor.observeError(error);
    });
    child.once('exit', (code, signal) => { handleBackendExit(child, code, signal).catch(error => desktopLog('error', 'backend-exit-handler-failed', { code: error.reasonCode || error.code || '', error: error.message })); });

    try {
      const readyResult = await supervisor.start();
      return markBackendProcessReady(child, readyResult);
    } catch (error) {
      const details = error.details || supervisor.snapshot();
      backendLastFailure = {
        at: new Date().toISOString(),
        code: error.code || 'BACKEND_STARTUP_FAILED',
        message: error.message,
        details
      };
      desktopLog('error', 'backend-startup-failed', backendLastFailure);
      if (ownedBackendChild() === child && child.exitCode === null && !child.signalCode) {
        await stopBackendProcessForCoordinator({ applicationLeaseToken: options.applicationLeaseToken || null });
      }
      throw error;
    } finally {
      if (backendStartupSupervisor === supervisor) backendStartupSupervisor = null;
    }
  })();

  backendLaunchPromise = task;
  task.then(
    () => { if (backendLaunchPromise === task) backendLaunchPromise = null; },
    () => { if (backendLaunchPromise === task) backendLaunchPromise = null; }
  );
  return task;
}

async function launchBackend(options = {}) {
  if (!desktopCredentialApplicationCoordinator || !runtimeProjectionCoordinator) {
    const error = new Error('WP6 production lifecycle coordinators are unavailable');
    error.reasonCode = 'WP6_DESKTOP_COORDINATOR_REQUIRED';
    throw error;
  }
  const result = await desktopCredentialApplicationCoordinator.startBackend(options);
  return finalizeTrustedBackendReady(result);
}

async function stopBackendProcessForCoordinator(options = {}) {
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  backendRestartTimer = null;
  backendStartupSupervisor?.cancel('本地服务启动已取消。');
  const authorityBefore = authoritativeBackend();
  const child = authorityBefore.child || backendObservationChild;
  try {
    const result = await stopOwnedBackend({
      desktopHost,
      getChild: () => backendObservationChild || ownedBackendChild(),
      timeoutMs: Number(options.timeoutMs || 7000),
      clearReferences: stoppedChild => {
        if (!backendOwnershipPresent()) {
          if (!stoppedChild || backendObservationChild === stoppedChild) backendObservationChild = null;
          backendPid = 0;
          backendReady = false;
          backendReadySource = '';
        }
      }
    });
    fatalShutdown = null;
    return result;
  } catch (error) {
    fatalShutdown = {
      at: new Date().toISOString(),
      reasonCode: error.reasonCode || 'DESKTOP_BACKEND_STOP_FAILED',
      backendPid: child?.pid || authoritativeBackend().backend.backendPid || backendPid || 0
    };
    desktopLog('error', 'backend-stop-not-confirmed', fatalShutdown);
    throw error;
  }
}

async function requestApiV2Stop(options = {}) {
  const projection = runtimeProjectionCoordinator?.snapshot?.();
  if (!projection?.trustedOwnerBound) {
    return { requested: false, confirmed: false, reasonCode: 'WP6_RUNTIME_BASELINE_REQUIRED' };
  }
  const reason = options.reason || 'desktop-runtime-stop';
  try {
    const response = await runtimeProjectionCoordinator.requestStop(reason, {
      timeoutMs: options.apiTimeoutMs || 5000
    });
    return { requested: true, confirmed: response?.accepted === true, commandId: response?.commandId || '', response };
  } catch (error) {
    if ((error.reasonCode || error.code) !== 'TRANSPORT_OUTCOME_UNKNOWN') throw error;
    const retained = runtimeProjectionCoordinator.snapshot().stopOperation;
    desktopLog('warn', 'runtime-stop-transport-outcome-unknown', {
      commandId: retained?.commandId || '',
      envelopeDigest: retained?.envelopeDigest || '',
      backendStartInstance: retained?.ownerBinding?.backendSessionId || '',
      ownerSession: retained?.ownerBinding?.ownerSessionId || ''
    });
    const recovery = await runtimeProjectionCoordinator.recoverStopOperation({
      timeoutMs: options.recoveryTimeoutMs || options.apiTimeoutMs || 5000
    });
    return {
      requested: true,
      confirmed: recovery?.accepted === true,
      commandId: recovery?.commandId || retained?.commandId || '',
      recovered: true,
      backendExited: recovery?.backendExited === true,
      exitRecoveryRequired: recovery?.exitRecoveryRequired === true,
      reasonCode: recovery?.reasonCode || null,
      response: recovery
    };
  }
}

async function stopBackend(options = {}) {
  if (!desktopCredentialApplicationCoordinator || !runtimeProjectionCoordinator) {
    const error = new Error('WP6 production lifecycle coordinators are unavailable');
    error.reasonCode = 'WP6_DESKTOP_COORDINATOR_REQUIRED';
    throw error;
  }
  let runtimeStop;
  try {
    runtimeStop = await requestApiV2Stop(options);
  } catch (error) {
    runtimeStop = {
      requested: true,
      confirmed: false,
      reasonCode: error.reasonCode || error.code || 'WP6_RUNTIME_STOP_UNCONFIRMED',
      message: error.message
    };
    if (options.forShutdown !== true && options.forceProcessCustody !== true) throw error;
  }
  runtimeProjectionCoordinator.discardBaseline(runtimeStop.confirmed ? 'WP6_RUNTIME_STOP_ACCEPTED' : 'WP6_FORCED_PROCESS_CUSTODY');
  const processResult = await desktopCredentialApplicationCoordinator.stopBackend(options);
  const stopResolution = runtimeProjectionCoordinator.resolveStopAfterProcessExit(processResult);
  return {
    ...processResult,
    runtimeStop,
    stopResolution,
    forcedProcessCustody: runtimeStop.confirmed !== true,
    runtimeSuccessReported: runtimeStop.confirmed === true
  };
}

async function restartBackend(options = {}) {
  if (!desktopCredentialApplicationCoordinator || !runtimeProjectionCoordinator) {
    const error = new Error('WP6 production lifecycle coordinators are unavailable');
    error.reasonCode = 'WP6_DESKTOP_COORDINATOR_REQUIRED';
    throw error;
  }
  backendRestarting = true;
  stopEventSocket();
  try {
    const runtimeStop = await requestApiV2Stop({ ...options, reason: options.reason || 'desktop-controlled-restart' });
    if (runtimeStop.confirmed !== true && runtimeStop.backendExited !== true) {
      const error = new Error('Runtime API v2 stop outcome remains unresolved; restart is blocked');
      error.reasonCode = runtimeStop.reasonCode || 'WP6_RUNTIME_STOP_UNCONFIRMED';
      throw error;
    }
    runtimeProjectionCoordinator.discardBaseline('WP6_CONTROLLED_RESTART');
    const result = await desktopCredentialApplicationCoordinator.restartBackend(options);
    const stopResolution = runtimeProjectionCoordinator.resolveStopAfterProcessExit({
      stopped: true,
      exitConfirmed: true,
      alreadyStopped: runtimeStop.backendExited === true,
      forced: runtimeStop.confirmed !== true,
      backendPid: Number(runtimeProjectionCoordinator.snapshot().stopOperation?.ownerBinding?.backendPid || 0)
    });
    return finalizeTrustedBackendReady({ ...result, runtimeStop, stopResolution });
  } finally { backendRestarting = false; }
}

async function waitForElementShellReady(options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 60000));
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs || 400));
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline && !quitting && !relaunchPending) {
    try {
      const response = await fetch(YANCE_ELEMENT_HEALTH_URL, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(Math.min(5000, Math.max(500, deadline - Date.now())))
      });
      if (response.ok) return { ready: true, status: response.status, url: YANCE_ELEMENT_HEALTH_URL };
      lastError = new Error(`Element shell health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  const error = new Error(lastError?.message || 'Element shell readiness timed out');
  error.reasonCode = 'YANCE_ELEMENT_SHELL_READY_TIMEOUT';
  error.details = { url: YANCE_ELEMENT_HEALTH_URL, timeoutMs };
  throw error;
}

function loadElementShell(window) {
  return waitForElementShellReady()
    .then(() => window.loadURL(YANCE_ELEMENT_URL));
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const settings = settingsStore.read();
  const createdWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#0B1416',
    title: STATIC_RELEASE_SOURCE.publicProductName,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : {
      titleBarOverlay: { color: '#0B1416', symbolColor: '#E6ECEC', height: 40 }
    }),
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged
    }
  });
  mainWindow = createdWindow;

  createdWindow.on('close', event => {
    if (quitting) return;
    const current = settingsStore.read();
    if (current.closeToTray) {
      hideWindowToTray(createdWindow, event);
    } else {
      quitting = true;
      app.quit();
    }
  });

  const activationController = ensureMainWindowActivationController();
  activationController.reset(createdWindow, 'window-created');
  createdWindow.webContents.on('did-start-loading', () => {
    if (mainWindow === createdWindow && !createdWindow.isDestroyed()) {
      activationController.reset(createdWindow, 'did-start-loading');
    }
  });
  createdWindow.webContents.on('did-finish-load', () => {
    if (mainWindow === createdWindow && !createdWindow.isDestroyed()) {
      activationController.markDidFinishLoad(createdWindow, { url: createdWindow.webContents.getURL() });
    }
  });
  createdWindow.webContents.on('render-process-gone', (_event, details) => {
    ensureMainWindowRuntimeReadiness().cancelWindow(createdWindow, 'render-process-gone');
    if (mainWindow === createdWindow) activationController.reset(createdWindow, 'render-process-gone');
    desktopLog('error', 'desktop-renderer-process-gone', { windowId: createdWindow.id, ...(details || {}) });
  });
  createdWindow.on('unresponsive', () => {
    if (mainWindow !== createdWindow || createdWindow.isDestroyed()) return;
    activationController.reset(createdWindow, 'renderer-unresponsive');
    desktopLog('error', 'desktop-renderer-unresponsive', { windowId: createdWindow.id });
    activateMainWindow('renderer-unresponsive-recovery').catch(error => desktopLog('error', 'desktop-renderer-unresponsive-recovery-failed', { reasonCode: error.reasonCode || '', message: error.message }));
  });
  createdWindow.on('closed', () => {
    ensureMainWindowRuntimeReadiness().cancelWindow(createdWindow, 'window-closed');
    if (mainWindow === createdWindow) {
      mainWindow = null;
      activationController.reset(null, 'window-closed');
    }
  });
  createdWindow.on('minimize', () => {
    preserveTaskbarOnMinimize(createdWindow);
  });

  const syncSoundWindowState = () => {
    if (mainWindow !== createdWindow || createdWindow.isDestroyed()) return;
    soundNotificationService.setWindowState({
      visible: createdWindow.isVisible(),
      focused: createdWindow.isFocused(),
      minimized: createdWindow.isMinimized()
    });
  };
  createdWindow.on('focus', syncSoundWindowState);
  createdWindow.on('blur', syncSoundWindowState);
  createdWindow.on('show', syncSoundWindowState);
  createdWindow.on('hide', syncSoundWindowState);
  createdWindow.on('minimize', syncSoundWindowState);
  createdWindow.on('restore', syncSoundWindowState);
  createdWindow.once('ready-to-show', syncSoundWindowState);
  syncSoundWindowState();
  loadElementShell(createdWindow).catch(error => {
    desktopLog('error', 'element-shell-load-failed', { reasonCode: error.reasonCode || '', message: error.message, url: YANCE_ELEMENT_URL });
    if (mainWindow === createdWindow) dialog.showErrorBox('工作台加载失败', error.message);
  });
  return createdWindow;
}

async function runDesktopSmoke() {
  const result = { ok: false, at: new Date().toISOString(), platform: process.platform, checks: {}, errors: [] };
  try {
    if (!mainWindow) throw new Error('主窗口未创建');
    await new Promise((resolve, reject) => {
      if (!mainWindow.webContents.isLoading()) return resolve();
      const timer = setTimeout(() => reject(new Error('工作台页面加载超时')), 30000);
      mainWindow.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
      mainWindow.webContents.once('did-fail-load', (_event, code, description) => { clearTimeout(timer); reject(new Error(`页面加载失败 ${code}: ${description}`)); });
    });
    const health = await apiRequest('/api/health');
    const ready = await apiRequest('/api/ready');
    const runtimeBefore = await apiRequest('/api/r32/system/runtime');
    const bridge = await mainWindow.webContents.executeJavaScript(`({
      present: Boolean(window.yanceDesktop),
      getState: typeof window.yanceDesktop?.getState === 'function',
      getSettings: typeof window.yanceDesktop?.getSettings === 'function',
      updateSettings: typeof window.yanceDesktop?.updateSettings === 'function',
      notify: typeof window.yanceDesktop?.notify === 'function',
      eventBridge: typeof window.yanceDesktop?.onDesktopEvent === 'function'
    })`, true);
    await routeDesktopLifecycleViaApiV2('offline', { source: 'desktop-smoke' });
    await new Promise(resolve => setTimeout(resolve, 150));
    const offline = await apiRequest('/api/r32/system/runtime');
    await routeDesktopLifecycleViaApiV2('online', { source: 'desktop-smoke' });
    await new Promise(resolve => setTimeout(resolve, 250));
    const online = await apiRequest('/api/r32/system/runtime');
    result.checks = {
      backendHealth: health.ok === true,
      backendReadiness: ready.ready === true && Number(ready.pid || 0) === Number(desktopState().backend.pid || 0),
      backendPid: Number(desktopState().backend.pid || 0) > 0,
      startupHandshake: ['ipc-ready', 'http-ready', 'stdout-ready'].includes(backendReadySource),
      startupSettled: backendLaunchPromise === null && backendLastFailure === null,
      rendererBridge: Object.values(bridge).every(Boolean),
      lifecycleOffline: offline.runtime?.online === false && offline.runtime?.queue?.paused === true,
      lifecycleOnline: online.runtime?.online === true && online.runtime?.queue?.paused === false,
      eventStream: desktopState().backend.eventStreamConnected === true,
      sandbox: mainWindow.webContents.getLastWebPreferences?.().sandbox !== false
    };
    result.runtimeBefore = runtimeBefore.runtime;
    result.desktop = desktopState();
    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.errors.push({ message: error.message, stack: error.stack || '' });
  }
  fs.mkdirSync(path.dirname(DESKTOP_SMOKE_OUTPUT), { recursive: true });
  fs.writeFileSync(DESKTOP_SMOKE_OUTPUT, JSON.stringify(result, null, 2), 'utf8');
  if (!result.ok) process.exitCode = 1;
  return result;
}

function waitForWindowLoaded(timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    if (!mainWindow || mainWindow.isDestroyed()) return reject(new Error('主窗口未创建'));
    if (!mainWindow.webContents.isLoading()) return resolve();
    const timer = setTimeout(() => reject(new Error('工作台页面加载超时')), timeoutMs);
    const done = () => { clearTimeout(timer); resolve(); };
    const failed = (_event, code, description) => { clearTimeout(timer); reject(new Error(`页面加载失败 ${code}: ${description}`)); };
    mainWindow.webContents.once('did-finish-load', done);
    mainWindow.webContents.once('did-fail-load', failed);
  });
}

function memoryMetricBytes(memory = {}, key) {
  const value = Number(memory?.[key] || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Electron app.getAppMetrics() reports process memory in KiB.
  return value * 1024;
}

function collectElectronMemory(label = '') {
  const processes = app.getAppMetrics().map(metric => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name || '',
    workingSetBytes: memoryMetricBytes(metric.memory, 'workingSetSize'),
    peakWorkingSetBytes: memoryMetricBytes(metric.memory, 'peakWorkingSetSize'),
    privateBytes: memoryMetricBytes(metric.memory, 'privateBytes'),
    cpuPercent: Number(metric.cpu?.percentCPUUsage || 0)
  }));
  const sum = key => processes.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    label,
    at: new Date().toISOString(),
    mainPid: process.pid,
    backendPid,
    processCount: processes.length,
    workingSetBytes: sum('workingSetBytes'),
    privateBytes: sum('privateBytes'),
    workingSetMb: Number((sum('workingSetBytes') / 1024 / 1024).toFixed(2)),
    privateMb: Number((sum('privateBytes') / 1024 / 1024).toFixed(2)),
    processes
  };
}

function linearSlope(rows = [], key = 'privateMb') {
  const points = rows.map((row, index) => ({ x: Number(row.switches ?? index), y: Number(row[key] || 0) }));
  if (points.length < 2) return 0;
  const n = points.length;
  const sx = points.reduce((sum, point) => sum + point.x, 0);
  const sy = points.reduce((sum, point) => sum + point.y, 0);
  const sxy = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sxx = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = n * sxx - sx * sx;
  return denominator ? (n * sxy - sx * sy) / denominator : 0;
}

async function runMemorySoak() {
  const maxColdMb = Math.max(100, Number(process.env.YANCE_MEMORY_MAX_COLD_MB || 300));
  const maxGrowthMb = Math.max(10, Number(process.env.YANCE_MEMORY_MAX_GROWTH_MB || 50));
  const maxSlopeMbPerSwitch = Math.max(0.05, Number(process.env.YANCE_MEMORY_MAX_SLOPE_MB || 0.75));
  const switchesPerRound = Math.max(10, Number(process.env.YANCE_MEMORY_SWITCH_COUNT || 50));
  const chunkSize = Math.max(1, Math.min(10, Number(process.env.YANCE_MEMORY_SAMPLE_EVERY || 5)));
  const settleMs = Math.max(1000, Number(process.env.YANCE_MEMORY_SETTLE_MS || 60000));
  const idleMs = Math.max(1000, Number(process.env.YANCE_MEMORY_IDLE_MS || 15000));
  const report = {
    schemaVersion: 2,
    kind: 'windows-memory-soak',
    product: releaseIdentity().publicProductName || '言策',
    version: releaseIdentity().publicVersion || releaseIdentity().productVersion,
    updateVersion: releaseIdentity().productVersion,
    generatedAt: new Date().toISOString(),
    metric: 'electron-process-tree-private-working-set',
    candidate: {
      candidateId: ACCEPTANCE_CANDIDATE_ID,
      sourceFingerprint: ACCEPTANCE_SOURCE_FINGERPRINT,
      executableSha256: ACCEPTANCE_EXECUTABLE_SHA256
    },
    limits: { maxColdPrivateMb: maxColdMb, maxRoundPrivateGrowthMb: maxGrowthMb, maxPrivateSlopeMbPerSwitch: maxSlopeMbPerSwitch, switchesPerRound, rounds: 2, settleMs, idleMs },
    checks: {},
    samples: [],
    renderer: [],
    errors: []
  };
  try {
    await waitForWindowLoaded();
    await mainWindow.webContents.executeJavaScript(`new Promise(resolve=>{if(window.__Y27?.getState){resolve(true);return}window.addEventListener('yance:r32-data-ready',()=>resolve(true),{once:true});setTimeout(()=>resolve(false),30000)})`, true);
    await new Promise(resolve => setTimeout(resolve, settleMs));
    const baseline = collectElectronMemory('cold-stable');
    baseline.switches = 0;
    report.samples.push(baseline);
    let switches = 0;
    for (let round = 1; round <= 2; round += 1) {
      for (let offset = 0; offset < switchesPerRound; offset += chunkSize) {
        const count = Math.min(chunkSize, switchesPerRound - offset);
        const renderer = await mainWindow.webContents.executeJavaScript(`window.YanceMemorySoak?.switchChats(${count}, 60)`, true);
        switches += count;
        report.renderer.push({ round, switches, ...renderer });
        await new Promise(resolve => setTimeout(resolve, 250));
        const sample = collectElectronMemory(`round-${round}-${switches}`);
        sample.round = round;
        sample.switches = switches;
        report.samples.push(sample);
      }
      await new Promise(resolve => setTimeout(resolve, idleMs));
      const idle = collectElectronMemory(`round-${round}-idle`);
      idle.round = round;
      idle.switches = switches;
      report.samples.push(idle);
    }
    const rowsForRound = round => report.samples.filter(row => row.round === round && !row.label.endsWith('-idle'));
    const idleForRound = round => report.samples.find(row => row.round === round && row.label.endsWith('-idle'));
    const firstRows = rowsForRound(1);
    const secondRows = rowsForRound(2);
    const firstIdle = idleForRound(1);
    const secondIdle = idleForRound(2);
    const firstPeakPrivate = Math.max(...firstRows.map(row => Number(row.privateMb || 0)), baseline.privateMb);
    const secondPeakPrivate = Math.max(...secondRows.map(row => Number(row.privateMb || 0)), firstIdle?.privateMb || baseline.privateMb);
    const firstPeakGrowth = Number((firstPeakPrivate - baseline.privateMb).toFixed(2));
    const firstIdleGrowth = Number(((firstIdle?.privateMb || baseline.privateMb) - baseline.privateMb).toFixed(2));
    const secondPeakGrowth = Number((secondPeakPrivate - (firstIdle?.privateMb || baseline.privateMb)).toFixed(2));
    const secondIdleGrowth = Number(((secondIdle?.privateMb || firstIdle?.privateMb || baseline.privateMb) - (firstIdle?.privateMb || baseline.privateMb)).toFixed(2));
    const cumulativeIdleGrowth = Number(((secondIdle?.privateMb || baseline.privateMb) - baseline.privateMb).toFixed(2));
    const firstSlope = Number(linearSlope(firstRows, 'privateMb').toFixed(4));
    const secondSlope = Number(linearSlope(secondRows, 'privateMb').toFixed(4));
    report.summary = {
      baselinePrivateMb: baseline.privateMb,
      baselineWorkingSetMb: baseline.workingSetMb,
      firstPeakPrivateMb: Number(firstPeakPrivate.toFixed(2)),
      firstIdlePrivateMb: Number((firstIdle?.privateMb || 0).toFixed(2)),
      secondPeakPrivateMb: Number(secondPeakPrivate.toFixed(2)),
      secondIdlePrivateMb: Number((secondIdle?.privateMb || 0).toFixed(2)),
      firstPeakGrowthMb: firstPeakGrowth,
      firstIdleGrowthMb: firstIdleGrowth,
      secondPeakGrowthMb: secondPeakGrowth,
      secondIdleGrowthMb: secondIdleGrowth,
      cumulativeIdleGrowthMb: cumulativeIdleGrowth,
      firstSlopeMbPerSwitch: firstSlope,
      secondSlopeMbPerSwitch: secondSlope,
      totalSwitches: switches
    };
    report.checks = {
      candidateBound: Boolean(ACCEPTANCE_CANDIDATE_ID && ACCEPTANCE_SOURCE_FINGERPRINT && ACCEPTANCE_EXECUTABLE_SHA256),
      coldPrivateWithinLimit: baseline.privateMb <= maxColdMb,
      firstRoundPeakGrowthWithinLimit: firstPeakGrowth <= maxGrowthMb,
      secondRoundPeakGrowthWithinLimit: secondPeakGrowth <= maxGrowthMb,
      cumulativeIdleGrowthWithinLimit: cumulativeIdleGrowth <= maxGrowthMb,
      firstRoundNotLinear: firstSlope <= maxSlopeMbPerSwitch,
      secondRoundNotLinear: secondSlope <= maxSlopeMbPerSwitch,
      secondRoundDoesNotAccelerate: secondSlope <= Math.max(maxSlopeMbPerSwitch, firstSlope + 0.15),
      idleSamplesCaptured: Boolean(firstIdle && secondIdle),
      rendererCompleted: report.renderer.every(row => row.ok !== false),
      conversationFixtureAvailable: report.renderer.some(row => Number(row.uniqueConversations || 0) >= 2)
    };
    report.ok = Object.values(report.checks).every(Boolean);
    report.releaseReady = report.ok;
  } catch (error) {
    report.ok = false;
    report.releaseReady = false;
    report.errors.push({ code: error.code || '', message: error.message, stack: error.stack || '' });
  }
  fs.mkdirSync(path.dirname(MEMORY_SOAK_OUTPUT), { recursive: true });
  fs.writeFileSync(MEMORY_SOAK_OUTPUT, JSON.stringify(report, null, 2), 'utf8');
  if (!report.ok) process.exitCode = 1;
  return report;
}

async function runCredentialPersistenceProbe() {
  const sha256 = value => createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
  const report = {
    schemaVersion: 2,
    kind: 'credential-persistence-phase',
    mode: CREDENTIAL_PERSISTENCE_MODE,
    product: releaseIdentity().publicProductName || '言策',
    version: releaseIdentity().publicVersion || releaseIdentity().productVersion,
    updateVersion: releaseIdentity().productVersion,
    generatedAt: new Date().toISOString(),
    dataRoot: DATA_ROOT,
    ref: CREDENTIAL_PERSISTENCE_REF,
    candidate: {
      candidateId: ACCEPTANCE_CANDIDATE_ID,
      sourceFingerprint: ACCEPTANCE_SOURCE_FINGERPRINT,
      executableSha256: ACCEPTANCE_EXECUTABLE_SHA256
    },
    safeStorageAvailable: Boolean(vault?.available),
    checks: {},
    observations: {},
    errors: []
  };
  try {
    if (!['write', 'read', 'delete'].includes(CREDENTIAL_PERSISTENCE_MODE)) throw new Error(`未知凭据持久化阶段：${CREDENTIAL_PERSISTENCE_MODE}`);
    if (!vault?.available) throw Object.assign(new Error('Windows安全存储不可用'), { code: 'WINDOWS_SECURE_STORAGE_UNAVAILABLE' });
    if (CREDENTIAL_PERSISTENCE_MODE === 'write') {
      if (!CREDENTIAL_PERSISTENCE_SECRET) throw new Error('缺少测试密钥');
      const value = { secret: CREDENTIAL_PERSISTENCE_SECRET, marker: 'yance-persistence', writtenAt: new Date().toISOString() };
      await applyVaultMutationWithRestart('persist', CREDENTIAL_PERSISTENCE_REF, value, { requestId: `persistence-write:${ACCEPTANCE_CANDIDATE_ID || 'candidate'}` });
      const stored = vault.get(CREDENTIAL_PERSISTENCE_REF);
      const raw = fs.readFileSync(path.join(PATHS.secure, 'credentials.safe.json'), 'utf8');
      report.checks = { candidateBound: Boolean(ACCEPTANCE_CANDIDATE_ID && ACCEPTANCE_SOURCE_FINGERPRINT && ACCEPTANCE_EXECUTABLE_SHA256), saved: stored?.secret === CREDENTIAL_PERSISTENCE_SECRET, notPlaintextOnDisk: !raw.includes(CREDENTIAL_PERSISTENCE_SECRET), refPresent: vault.refs().includes(CREDENTIAL_PERSISTENCE_REF) };
      report.observations.secretSha256 = sha256(CREDENTIAL_PERSISTENCE_SECRET);
    } else if (CREDENTIAL_PERSISTENCE_MODE === 'read') {
      const stored = vault.get(CREDENTIAL_PERSISTENCE_REF);
      report.checks = { candidateBound: Boolean(ACCEPTANCE_CANDIDATE_ID && ACCEPTANCE_SOURCE_FINGERPRINT && ACCEPTANCE_EXECUTABLE_SHA256), decrypted: Boolean(stored?.secret), markerValid: ['yance-persistence', 'yance29-persistence'].includes(stored?.marker), legacyMarkerAccepted: stored?.marker === 'yance29-persistence', canonicalRefStable: vault.refs().filter(ref => ref === CREDENTIAL_PERSISTENCE_REF).length === 1 };
      report.observations.secretSha256 = stored?.secret ? sha256(stored.secret) : '';
      report.observations.writtenAt = stored?.writtenAt || '';
    } else {
      const existed = desktopHost.credentialVaultHost.refs().includes(CREDENTIAL_PERSISTENCE_REF);
      await applyVaultMutationWithRestart('remove', CREDENTIAL_PERSISTENCE_REF, undefined, { requestId: `persistence-delete:${ACCEPTANCE_CANDIDATE_ID || 'candidate'}` });
      const removed = existed;
      report.checks = { candidateBound: Boolean(ACCEPTANCE_CANDIDATE_ID && ACCEPTANCE_SOURCE_FINGERPRINT && ACCEPTANCE_EXECUTABLE_SHA256), removed: removed === true || !vault.refs().includes(CREDENTIAL_PERSISTENCE_REF), absentAfterDelete: vault.get(CREDENTIAL_PERSISTENCE_REF) == null };
    }
    report.ok = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.ok = false;
    report.errors.push({ code: error.code || '', message: error.message, stack: error.stack || '' });
  }
  fs.mkdirSync(path.dirname(CREDENTIAL_PERSISTENCE_OUTPUT), { recursive: true });
  fs.writeFileSync(CREDENTIAL_PERSISTENCE_OUTPUT, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function forwardBackendCommand(command, payload = {}, context = {}) {
  const response = await apiRequest('/api/core/command', {
    method: 'POST',
    body: JSON.stringify({ command, payload, context: { actor: 'desktop-forwarder', ...context } })
  });
  return response.result || {};
}

async function applyVaultMutationWithRestart(operation, ref, value, options = {}) {
  const key = String(ref || '').trim();
  if (!key) throw Object.assign(new Error('Credential reference is required'), { reasonCode: 'INVALID_CREDENTIAL_REF' });
  if (!vault?.available) throw Object.assign(new Error('Windows secure credential vault is unavailable'), { reasonCode: 'CREDENTIAL_VAULT_UNAVAILABLE' });
  if (!desktopCredentialApplicationCoordinator) throw Object.assign(new Error('Desktop credential application coordinator is unavailable'), { reasonCode: 'WP4_DESKTOP_CREDENTIAL_APPLICATION_UNAVAILABLE' });
  return desktopCredentialApplicationCoordinator.applyVaultMutationWithRestart(operation, key, value, options);
}

async function saveCredentialFromDesktop(ref, value, options = {}) {
  const requestId = String(options.requestId || '');
  try {
    const result = await applyVaultMutationWithRestart('persist', ref, value, options);
    return {
      ...result,
      ok: true,
      mutationCommitted: result?.mutation?.transactionState === 'COMMITTED' || result?.mutationCommitted === true,
      runtimeConfirmed: true,
      requestId: String(result?.requestId || requestId),
      reasonCode: '',
      message: ''
    };
  } catch (error) {
    return {
      ok: false,
      mutationCommitted: error?.mutationCommitted === true,
      runtimeConfirmed: false,
      requestId: String(error?.requestId || requestId),
      reasonCode: String(error?.reasonCode || error?.code || 'CREDENTIAL_APPLICATION_FAILED'),
      message: String(error?.message || 'Credential application failed')
    };
  }
}

async function deleteCredentialFromDesktop(ref, options = {}) {
  const key = String(ref || '').trim();
  if (!key) return { ok: true, removed: false, ref: '' };
  const existed = vault.refs().includes(key);
  const result = await applyVaultMutationWithRestart('remove', key, undefined, options);
  return { ...result, removed: existed };
}

function registerIpc() {
  installR32StoreBridge({ ipcMain, apiRequest });
  registerM2DebugIpc();
  ipcGuardHandle('desktop:get-state', () => desktopState());
  ipcGuardHandle('desktop:letta-get-state', () => projectLettaRendererState(ensureLettaAgentRuntime().snapshot()));
  ipcGuardHandle('desktop:letta-list-agents', async () => {
    const agents = await ensureLettaAgentRuntime().listAgents();
    return (Array.isArray(agents) ? agents : []).map(projectLettaAgentIdentity).filter(agent => agent.id);
  });
  ipcGuardHandle('desktop:letta-list-conversations', async (_event, input = {}) => {
    const normalized = normalizeLettaConversationListInput(input);
    const conversations = await ensureLettaAgentRuntime().listConversations(normalized);
    return (Array.isArray(conversations) ? conversations : [])
      .map(conversation => projectLettaConversationIdentity(conversation, normalized.agentId))
      .filter(conversation => conversation.id);
  });
  ipcGuardHandle('desktop:parlant-get-relationship-goal', (_event, input = {}) => readParlantRelationshipGoalProjection(input));
  ipcGuardHandle('desktop:parlant-upsert-relationship-goal', async (_event, input = {}) => {
    const normalized = normalizeParlantGoalInput(input, ['contactId', 'goalText']);
    return projectParlantRelationshipGoal(await ensureParlantRelationshipRuntime().upsertRelationshipGoal(normalized));
  });
  ipcGuardHandle('desktop:parlant-delete-relationship-goal', async (_event, input = {}) => {
    const normalized = normalizeParlantGoalInput(input, ['contactId']);
    const result = await ensureParlantRelationshipRuntime().deleteRelationshipGoal(normalized);
    return Object.freeze({ deleted: result?.deleted === true });
  });
  ipcGuardHandle('desktop:parlant-set-relationship-goal-paused', async (_event, input = {}) => {
    const normalized = normalizeParlantGoalInput(input, ['contactId', 'paused']);
    return projectParlantRelationshipGoal(await ensureParlantRelationshipRuntime().setRelationshipGoalPaused(normalized));
  });
  ipcGuardHandle('desktop:media-brain-health', () => ensureMediaBrainRuntime().health());
  ipcGuardHandle('desktop:media-brain-save-settings', (_event, input = {}) => saveMediaBrainSettings(input));
  ipcGuardHandle('desktop:media-brain-import-asset', (_event, input = {}) => ensureMediaBrainRuntime().importAsset(input));
  ipcGuardHandle('desktop:media-brain-search-assets', (_event, input = {}) => ensureMediaBrainRuntime().searchAssets(input));
  ipcGuardHandle('desktop:media-brain-list-people', (_event, input = {}) => ensureMediaBrainRuntime().listPeople(input));
  ipcGuardHandle('desktop:media-brain-list-albums', (_event, input = {}) => ensureMediaBrainRuntime().listAlbums(input));
  ipcGuardHandle('desktop:media-brain-get-asset-preview', (_event, input = {}) => ensureMediaBrainRuntime().getAssetPreview(input));
  ipcGuardHandle('desktop:media-brain-queue-workflow', async (_event, input = {}) => {
    const runtime = ensureMediaBrainRuntime();
    const kind = String(input?.kind || '').trim().toLowerCase();
    const queueInput = {
      kind,
      prompt: String(input?.prompt || ''),
      negativePrompt: String(input?.negativePrompt || ''),
      checkpoint: String(input?.checkpoint || ''),
      clientId: String(input?.clientId || ''),
      seed: input?.seed,
      width: input?.width,
      height: input?.height,
      denoise: input?.denoise
    };
    if (kind === 'edit') {
      const assetId = String(input?.assetId || '').trim();
      if (!assetId || assetId.length > 512) {
        throw Object.assign(new Error('Edit workflow requires an Immich asset id.'), { reasonCode: 'IMMICH_ASSET_REQUIRED' });
      }
      const uploaded = await runtime.uploadImmichAssetAsWorkflowInput({
        assetId,
        filename: path.basename(String(input?.filename || `immich-${assetId}`)).slice(0, 240)
      });
      queueInput.inputImage = String(uploaded?.name || uploaded?.filename || '').trim();
      if (!queueInput.inputImage) {
        throw Object.assign(new Error('ComfyUI did not return an uploaded image name.'), { reasonCode: 'COMFYUI_INPUT_IMAGE_UPLOAD_INVALID' });
      }
    }
    return runtime.queueWorkflow(queueInput);
  });
  ipcGuardHandle('desktop:media-brain-get-workflow-result', (_event, input = {}) => ensureMediaBrainRuntime().getWorkflowOutput({ promptId: String(input?.promptId || '').trim() }));
  ipcGuardHandle('desktop:media-brain-save-workflow-output', (_event, input = {}) => ensureMediaBrainRuntime().saveWorkflowOutputToImmich(input));
  ipcGuardHandle('desktop:media-brain-send-asset', (_event, input = {}) => sendMediaAssetThroughExistingAuthority(input));
  ipcGuardHandle('desktop:report-runtime-environment', (_event, input = {}) => {
    const state = desktopState();
    const finite = (value, min, max) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : 0;
    };
    const renderer = {
      devicePixelRatio: finite(input.devicePixelRatio, 0.25, 16),
      visualViewportScale: finite(input.visualViewportScale, 0.25, 16),
      viewportWidth: Math.round(finite(input.viewportWidth, 0, 100000)),
      viewportHeight: Math.round(finite(input.viewportHeight, 0, 100000)),
      screenWidth: Math.round(finite(input.screenWidth, 0, 100000)),
      screenHeight: Math.round(finite(input.screenHeight, 0, 100000)),
      readingMode: String(input.readingMode || '').slice(0, 32),
      density: String(input.density || '').slice(0, 32)
    };
    desktopLog('info', 'renderer-runtime-environment', {
      productName: state.application.productName,
      productVersion: state.application.productVersion,
      buildId: state.application.buildId,
      sourceCommit: state.application.sourceCommit,
      sourceTree: state.application.sourceTree,
      electron: state.runtime.electron,
      chrome: state.runtime.chrome,
      node: state.runtime.node,
      ...renderer
    });
    return { ok: true, application: state.application, runtime: state.runtime, renderer };
  });
  ipcGuardHandle('desktop:get-settings', () => settingsStore.read());
  ipcGuardHandle('desktop:set-titlebar-theme', (_event, input = {}) => {
    const color = /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color) : '#0B1416';
    const symbolColor = /^#[0-9a-f]{6}$/i.test(String(input.symbolColor || '')) ? String(input.symbolColor) : '#E6ECEC';
    if (process.platform !== 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
      if (typeof mainWindow.setTitleBarOverlay === 'function') mainWindow.setTitleBarOverlay({ color, symbolColor, height: 40 });
      if (typeof mainWindow.setBackgroundColor === 'function') mainWindow.setBackgroundColor(color);
    }
    return { ok: true, color, symbolColor, backgroundApplied: Boolean(mainWindow && !mainWindow.isDestroyed()) };
  });
  ipcGuardHandle('desktop:update-settings', (_event, patch) => {
    const next = settingsStore.update(patch || {});
    updateLoginItem(next);
    updateManager?.start?.();
    buildTrayMenu();
    return next;
  });
  ipcGuardHandle('desktop:update-get-state', () => updateManager.snapshot());
  ipcGuardHandle('desktop:update-check', () => updateManager.check({ manual: true }));
  ipcGuardHandle('desktop:update-download', () => updateManager.download());
  ipcGuardHandle('desktop:update-install', () => updateManager.install());
  ipcGuardHandle('desktop:update-set-work-state', (_event, state) => {
    rendererWorkState = {
      unsavedChanges: state?.unsavedChanges === true,
      pendingReplyApproval: state?.pendingReplyApproval === true,
      detail: String(state?.detail || '').slice(0, 500)
    };
    updateManager?.setRendererWorkState?.(rendererWorkState);
    return { ...rendererWorkState };
  });
  ipcGuardHandle('desktop:open-auth-url', (_event, input) => openAuthorizedAuthUrl(input || {}));
  ipcGuardHandle('desktop:open-directory', async (_event, kind) => {
    const target = kind === 'logs' ? PATHS.logs : kind === 'program' ? APP_ROOT : kind === 'portable-backups' ? PATHS.portableBackups : PATHS.root;
    fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    return { ok: !error, error, path: target };
  });
  ipcGuardHandle('desktop:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: '选择旧版本数据目录' });
    return result.canceled ? '' : result.filePaths[0] || '';
  });
  ipcGuardHandle('desktop:select-portable-backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: '导入言策可迁移备份',
      filters: [{ name: '言策可迁移备份', extensions: ['yancebackup', 'yance28backup', 'yance32backup'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { imported: false };
    const source = path.resolve(result.filePaths[0]);
    const stat = fs.statSync(source);
    if (!stat.isFile()) throw new Error('选择的可迁移备份不是文件');
    const rawName = path.basename(source).replace(/[^A-Za-z0-9_.-]/g, '_');
    const lowerName = rawName.toLowerCase();
    const legacySuffix = ['.yancebackup', '.yance28backup', '.yance32backup'].find(extension => lowerName.endsWith(extension)) || '';
    const base = legacySuffix ? rawName.slice(0, -legacySuffix.length) : rawName;
    const name = `${base || 'Yance-Portable'}-import-${Date.now()}.yancebackup`;
    fs.mkdirSync(PATHS.portableBackups, { recursive: true });
    const destination = path.join(PATHS.portableBackups, name);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    return { imported: true, name, bytes: stat.size };
  });
  ipcGuardHandle('desktop:save-portable-backup', async (_event, packageName) => {
    const name = path.basename(String(packageName || ''));
    if (!/^[A-Za-z0-9_.-]+\.(?:yancebackup|yance28backup|yance32backup)$/i.test(name) || name !== String(packageName || '')) throw new Error('可迁移备份文件名无效');
    const source = path.resolve(PATHS.portableBackups, name);
    const allowed = `${path.resolve(PATHS.portableBackups)}${path.sep}`;
    if (!source.startsWith(allowed) || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('找不到可迁移备份文件');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存言策可迁移备份',
      defaultPath: name,
      filters: [{ name: '言策可迁移备份', extensions: ['yancebackup'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.copyFileSync(source, result.filePath);
    return { saved: true, filePath: result.filePath };
  });
  ipcGuardHandle('desktop:export-diagnostics', async (_event, bundle) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出言策诊断包',
      defaultPath: `Yance-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: true, saved: false, cancelled: true, canceled: true, path: '', filePath: '' };
    }
    fs.writeFileSync(result.filePath, JSON.stringify(bundle || {}, null, 2), 'utf8');
    return {
      ok: true,
      saved: true,
      cancelled: false,
      canceled: false,
      path: result.filePath,
      filePath: result.filePath
    };
  });

  ipcGuardHandle('desktop:export-chat', async (_event, input = {}) => {
    const conversationId = String(input.conversationId || '').trim();
    if (!conversationId || conversationId.length > 512 || /[\u0000-\u001f\u007f]/.test(conversationId)) {
      const error = new Error('会话标识无效');
      error.reasonCode = 'CHAT_EXPORT_CONVERSATION_ID_INVALID';
      throw error;
    }
    const payload = await apiRequest(`/api/r32/workspace/conversations/${encodeURIComponent(conversationId)}/export`);
    if (typeof payload.content !== 'string' || !payload.fileName || payload.encoding !== 'utf8') {
      const error = new Error('聊天记录导出响应无效');
      error.reasonCode = 'CHAT_EXPORT_RESPONSE_INVALID';
      throw error;
    }
    const bytes = Buffer.byteLength(payload.content, 'utf8');
    if (bytes !== Number(payload.contentBytes) || bytes > 128 * 1024 * 1024) {
      const error = new Error('聊天记录导出大小校验失败');
      error.reasonCode = 'CHAT_EXPORT_SIZE_INVALID';
      throw error;
    }
    const sha256 = createHash('sha256').update(payload.content, 'utf8').digest('hex');
    if (sha256 !== String(payload.sha256 || '')) {
      const error = new Error('聊天记录导出完整性校验失败');
      error.reasonCode = 'CHAT_EXPORT_SHA256_MISMATCH';
      throw error;
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出完整聊天记录',
      defaultPath: path.basename(String(payload.fileName)),
      filters: [{ name: '离线HTML聊天记录', extensions: ['html'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, payload.content, { encoding: 'utf8' });
    desktopLog('info', 'chat-export-saved', {
      conversationIdHash: createHash('sha256').update(conversationId).digest('hex').slice(0, 16),
      messageCount: Number(payload.messageCount || 0),
      bytes,
      sha256
    });
    return {
      saved: true,
      filePath: result.filePath,
      messageCount: Number(payload.messageCount || 0),
      bytes,
      sha256
    };
  });

  ipcGuardHandle('desktop:get-runtime-projection', () => runtimeProjectionCoordinator?.snapshot?.() || null);
  ipcGuardHandle('desktop:set-operating-mode', (_event, input = {}) => {
    if (!runtimeProjectionCoordinator) {
      const error = new Error('RuntimeProjectionCoordinator is unavailable');
      error.reasonCode = 'WP6_RUNTIME_PROJECTION_COORDINATOR_REQUIRED';
      throw error;
    }
    const operatingMode = String(input.operatingMode || '');
    if (!['normal', 'safeMode'].includes(operatingMode)) {
      const error = new Error('operatingMode must be normal or safeMode');
      error.reasonCode = 'OPERATING_MODE_INVALID';
      throw error;
    }
    return runtimeProjectionCoordinator.setOperatingMode(operatingMode, String(input.reason || 'desktop-renderer-mode-change'), { exitAuthorizationId: String(input.exitAuthorizationId || ''), exitAuthorizationToken: String(input.exitAuthorizationToken || '') });
  });
  ipcGuardHandle('desktop:restart-backend', () => restartBackend());
  ipcGuardHandle('desktop:restart-app', async () => restartElectronApp({
    setRelaunchIntent: () => { relaunchPending = true; quitting = true; backendRestarting = true; stopEventSocket(); },
    clearRelaunchIntent: () => { relaunchPending = false; quitting = false; backendRestarting = false; },
    stop: () => stopApplicationOwnedRuntimes({ reason: 'application-relaunch' }),
    authoritySnapshot: () => applicationRuntimeAuthoritySnapshot(),
    appRelaunch: () => app.relaunch(),
    appExit: code => { exitAfterBackendShutdown = true; app.exit(code); },
    onFailure: error => {
      fatalShutdown = { at: new Date().toISOString(), reasonCode: error.reasonCode || 'DESKTOP_RELAUNCH_BACKEND_STOP_FAILED', backendPid: authoritativeBackend().backend.backendPid || 0 };
      desktopLog('error', 'desktop-relaunch-blocked', fatalShutdown);
    }
  }));
  ipcGuardHandle('desktop:notify', (_event, payload) => showNotification(payload || {}));
  ipcGuardHandle('desktop:play-sound', (_event, payload) => requestDesktopSound(payload || {}));
ipcGuardHandle('desktop:set-active-conversation', (_event, data = {}) => {
  const activeConversationId = typeof data === 'string' ? data : data && data.activeConversationId;
  soundNotificationService.setWindowState({ activeConversationId: String(activeConversationId || '') });
  return { ok: true };
});
  ipcMain.on('desktop:preload-ready', (event, payload = {}) => {
    if (!mainWindow || !isTrustedMainFrameIpcEvent(event, { webContents: mainWindow.webContents, allowedOrigins: [YANCE_ELEMENT_URL] })) return;
    ensureMainWindowActivationController().markPreloadReady(mainWindow, payload);
  });
  ipcMain.on('desktop:renderer-ready', (event, payload = {}) => {
    if (!mainWindow || !isTrustedMainFrameIpcEvent(event, { webContents: mainWindow.webContents, allowedOrigins: [YANCE_ELEMENT_URL] })) return;
    ensureMainWindowActivationController().markRendererReady(mainWindow, payload);
  });
  ipcMain.on('desktop:activation-probe-complete', (event, payload = {}) => {
    if (!mainWindow || !isTrustedMainFrameIpcEvent(event, { webContents: mainWindow.webContents, allowedOrigins: [YANCE_ELEMENT_URL] })) return;
    ensureMainWindowRuntimeReadiness().complete(event.sender, payload);
  });
  ipcGuardHandle('desktop:report-sound-result', (_event, result) => ({ accepted: resolveSound(result || {}) }));
  ipcMain.on('sound:result', (event, result) => {
    if (!mainWindow || !isTrustedMainFrameIpcEvent(event, { webContents: mainWindow.webContents, allowedOrigins: [YANCE_ELEMENT_URL] })) return;
    resolveSound(result || {});
  });
  ipcGuardHandle('desktop:save-credential', (_event, input) => saveCredentialFromDesktop(input?.ref, input?.value || {}, { requestId: input?.requestId }));
  ipcGuardHandle('desktop:delete-credential', (_event, input) => typeof input === 'string'
    ? deleteCredentialFromDesktop(input)
    : deleteCredentialFromDesktop(input?.ref, { requestId: input?.requestId }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const intent = parseDesktopLaunchIntent(argv);
    activateMainWindow(intent.postInstall ? 'post-install-second-instance' : intent.deepLink ? 'deep-link-second-instance' : 'second-instance', intent.payload)
      .catch(error => desktopLog('error', 'second-instance-activation-failed', { reasonCode: error.reasonCode || '', message: error.message }));
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    activateMainWindow('deep-link', { deepLink: String(url || '') }).catch(error => desktopLog('error', 'deep-link-activation-failed', { reasonCode: error.reasonCode || '', message: error.message }));
  });

  app.whenReady().then(async () => {
    settingsStore = new R32DesktopSettings(path.join(PATHS.root, 'desktop-settings.json'));
    updateLoginItem(settingsStore.read());
    const legacyDiscovery = discoverLegacyDataRoots({ currentRoot: DATA_ROOT });
    const legacyRoot = legacyDiscovery.expectedLegacyRoot;
    legacyRuntimeCutoverReport = await new LegacyRuntimeCutoverGate({
      legacyDataRoot: legacyRoot,
      log: (event, detail) => desktopLog('info', event, detail)
    }).execute();
    const credentialFile = path.join(PATHS.secure, 'credentials.safe.json');
    vault = new CredentialVault(credentialFile);
    releaseManifestHost = releaseManifestHost || new ReleaseManifestHost({ resourcesPath: controlledResourcesPath() });
    desktopHost = new DesktopHost({
      releaseManifestHost,
      vault,
      backendOwnerRecordPath: path.join(PATHS.secure, 'desktop-backend-owner.json'),
      autoRecoverRejectedOwner: true,
      log: (event, detail) => desktopLog('info', `desktop-host-${event}`, detail)
    });
    const acceptedRelease = releaseManifestHost.verify();
    desktopLogSync('info', 'runtime-identity-verified', {
      productName: acceptedRelease.productName || '言策',
      productVersion: acceptedRelease.productVersion,
      stageVersion: acceptedRelease.stageVersion || '',
      buildId: acceptedRelease.buildId,
      sourceCommit: acceptedRelease.sourceCommit || acceptedRelease.gitCommit || '',
      sourceTree: acceptedRelease.sourceTree || '',
      manifestSha256: acceptedRelease.manifestSha256 || '',
      buildTimestampUtc: acceptedRelease.buildTimestampUtc || '',
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      packaged: app.isPackaged
    });
    try { governRuntimeNativeBinariesBootCheck(); } catch (_) { /* never block startup */ }
    runtimeApiV2Client = new ApiV2RuntimeClient({
      baseURL: YANCE_BACKEND_URL,
      sessionProvider: options => desktopHost.backendProcessHost.getApiSessionBinding(options),
      expectedBuildId: acceptedRelease.buildId
    });
    runtimeProjectionCoordinator = new RuntimeProjectionCoordinator({
      client: runtimeApiV2Client,
      backendSnapshot: () => authoritativeBackend().backend,
      expectedBuildId: acceptedRelease.buildId,
      onProjection: projection => sendToRenderer('desktop:runtime-projection', projection),
      onFailure: (error, projection) => desktopLog('error', 'runtime-projection-failed', {
        reasonCode: error.reasonCode || error.code || 'WP6_RUNTIME_PROJECTION_FAILED',
        message: error.message,
        state: projection?.state || ''
      })
    });
    desktopCredentialApplicationCoordinator = new DesktopCredentialApplicationCoordinator({
      desktopHost,
      startBackend: options => startBackendProcessForCoordinator(options),
      stopBackend: options => stopBackendProcessForCoordinator(options),
      backendSnapshot: () => authoritativeBackend().backend,
      waitForOwnerExitRecovery: child => desktopHost.waitForBackendOwnerExitRecovery(child),
      getOwnedBackendChild: () => desktopHost.backendProcessHost?.getOwnedChild?.() || null,
      validateRuntimeProjection: async context => {
        const credentialProjection = await apiRequest('/api/desktop/credential-authority-state');
        const runtimeApiV2 = await runtimeProjectionCoordinator.validateCandidateProjection(context);
        return { ...credentialProjection, runtimeApiV2 };
      },
      isShutdownPending: () => relaunchPending || quitting,
      journalPath: path.join(PATHS.secure, 'desktop-credential-application-lifecycle.json'),
      containmentSentinelPath: path.join(PATHS.secure, 'desktop-credential-application-containment.json'),
      automaticStartupContainmentRecovery: true,
      failStopApplication: detail => {
        fatalShutdown = {
          at: new Date().toISOString(),
          reasonCode: detail?.reasonCode || 'WP4_DESKTOP_CREDENTIAL_FATAL_CONTAINMENT',
          backendPid: Number(detail?.containment?.backendPid || authoritativeBackend().backend.backendPid || 0),
          containment: detail?.containment || null
        };
        quitting = true;
        backendReady = false;
        backendReadySource = '';
        stopEventSocket();
        sendToRenderer('desktop:backend-state', { ready: false, pid: 0, eventStreamConnected: false, fatal: true, reasonCode: fatalShutdown.reasonCode });
        desktopLog('error', 'credential-application-fail-stop', fatalShutdown);
        setImmediate(() => { try { app.exit(70); } catch (_) { app.quit(); } });
      },
      log: (event, detail) => desktopLog('info', event, detail)
    });
    desktopHost.setCredentialApplicationCoordinator(desktopCredentialApplicationCoordinator);
    VERIFIED_RELEASE_IDENTITY = desktopHost.verifyReleaseIdentity();
    try {
      const startupContainmentRecovery = await desktopCredentialApplicationCoordinator.recoverStartupContainment({
        reason: 'desktop-bootstrap-before-credential-migration'
      });
      desktopLog('info', 'desktop-bootstrap-containment-recovery-complete', startupContainmentRecovery);
      credentialVaultRecoveryReport = {
        ...await desktopCredentialApplicationCoordinator.runExclusive('LEGACY_CREDENTIAL_MIGRATION', async applicationLeaseToken => {
          const recovery = await recoverCredentialVaults({
            legacyRoots: legacyDiscovery.legacyRoots,
            destinationFile: credentialFile,
            destinationVault: vault,
            credentialVaultHost: desktopHost.credentialVaultHost,
            applicationLeaseToken,
            createVault: file => new CredentialVault(file)
          });
          const graphitiNeo4jCredential = await ensureGraphitiNeo4jCredentialProvisioned(applicationLeaseToken);
          return { ...recovery, graphitiNeo4jCredential };
        }),
        mode: 'same-machine-safe-storage-reencryption',
        legacyRoots: legacyDiscovery.legacyRoots
      };
    } catch (error) {
      credentialVaultRecoveryReport = { ok: false, scannedFiles: 0, importedRefs: [], unreadableRefs: [], mode: 'failed', error: error.message, code: error.code || error.reasonCode || 'WP5_CREDENTIAL_MIGRATION_FAILED' };
      throw Object.assign(error, { code: credentialVaultRecoveryReport.code });
    }
    updateManager = new UpdateManager({
      app,
      releaseIdentity: releaseIdentity(),
      dialog,
      apiRequest,
      sendToRenderer,
      getSettings: () => settingsStore.read(),
      getRendererWorkState: () => ({ ...rendererWorkState }),
      log: desktopLog,
      refreshTray: buildTrayMenu
    });
    updateManager.start();
    if (CREDENTIAL_PERSISTENCE_MODE) {
      const report = await runCredentialPersistenceProbe();
      console.log(`[credential-persistence] ${report.ok ? 'PASS' : 'FAIL'} ${CREDENTIAL_PERSISTENCE_OUTPUT}`);
      quitting = true;
      app.exit(report.ok ? 0 : 1);
      return;
    }
    registerIpc();
    installLifecycleMonitors();
    createTray();
    createSoundWindow();
    try {
      await ensureLettaAgentRuntime().start();
      await launchBackend();
      if (wp7ProbeRequested()) {
        const probeResult = await runWp7InstalledRuntimeProbe();
        desktopLog('info', 'wp7-installed-runtime-probe-complete', {
          probeId: probeResult?.probeId || String(process.env.WP7_PROBE_ID || ''),
          status: probeResult?.status || 'PASS'
        });
        await completeWp7ProbeAndExit(0);
        return;
      }
      await refreshTraySnapshot();
      createWindow();
      if (!DESKTOP_SMOKE && !MEMORY_SOAK) {
        const settings = settingsStore.read();
        const hidden = process.argv.includes('--hidden');
        if (INITIAL_DESKTOP_LAUNCH_INTENT.forceVisible || (!settings.startMinimized && !hidden)) {
          await activateMainWindow(INITIAL_DESKTOP_LAUNCH_INTENT.postInstall ? 'post-install' : INITIAL_DESKTOP_LAUNCH_INTENT.deepLink ? 'deep-link-initial' : 'initial-launch', INITIAL_DESKTOP_LAUNCH_INTENT.payload);
        }
      }
      refreshNotificationSettings();
      if (soundSettingsSyncTimer) clearInterval(soundSettingsSyncTimer);
      soundSettingsSyncTimer = setInterval(refreshNotificationSettings, 20000);
      if (DESKTOP_SMOKE) {
        const report = await runDesktopSmoke();
        console.log(`[desktop-smoke] ${report.ok ? 'PASS' : 'FAIL'} ${DESKTOP_SMOKE_OUTPUT}`);
        quitting = true;
        app.quit();
      } else if (MEMORY_SOAK) {
        const report = await runMemorySoak();
        console.log(`[memory-soak] ${report.ok ? 'PASS' : 'FAIL'} ${MEMORY_SOAK_OUTPUT}`);
        quitting = true;
        app.quit();
      }
    } catch (error) {
      desktopLog('error', 'desktop-startup-failed', { code: error.code || '', error: error.stack || error.message, details: error.details || null });
      signalBackendActivationWaiters();
      // M2 P0-3：经统一启动失败工厂产出符合契约的对象（脱敏），供 diagnostics / renderer 复用。
      try {
        const failure = m2StartupFailure.launchFailure({
          developerMessage: error.message || '本地服务启动失败',
          backendPid: backendPid || 0,
          startupAttemptId: mainState.startupAttemptId
        });
        desktopLog('error', 'm2-startup-failure', m2StartupFailure.serializeForRenderer(failure));
      } catch (_) { /* 启动失败工厂自身异常不得阻断退出流程 */ }
      if (!quitting) {
        dialog.showErrorBox(
          '言策启动失败',
          `${error.message || '本地服务启动失败'}\n\n错误代码：${error.code || 'BACKEND_STARTUP_FAILED'}\n主进程日志：${DESKTOP_LOG_FILE}\n后端日志：${path.join(PATHS.logs, 'server.jsonl')}`
        );
      }
      quitting = true;
      app.quit();
    }
    app.on('activate', () => {
      activateMainWindow('app-activate').catch(error => desktopLog('error', 'app-activate-main-window-failed', { reasonCode: error.reasonCode || '', message: error.message }));
    });
  }).catch(error => {
    desktopLog('error', 'desktop-bootstrap-failed', { code: error.code || '', error: error.stack || error.message });
    if (process.env.WP7_BOOT_FAILURE_CHILD === '1') {
      try { writeWp7BootFailureDiagnostic(error, 'release-manifest-verification'); } catch (diagnosticError) {
        desktopLogSync('error', 'wp7-boot-failure-diagnostic-write-failed', { error: diagnosticError.message });
      }
      quitting = true;
      exitAfterBackendShutdown = true;
      app.exit(72);
      return;
    }
    if (!quitting) dialog.showErrorBox('言策启动失败', `${error.message || error}\n\n主进程日志：${DESKTOP_LOG_FILE}`);
    quitting = true;
    app.quit();
  });
}

app.on('before-quit', () => {
  quitting = true;
  if (trayRefreshTimer) clearTimeout(trayRefreshTimer);
  if (lifecyclePollTimer) clearInterval(lifecyclePollTimer);
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  trayRefreshTimer = null;
  lifecyclePollTimer = null;
  backendRestartTimer = null;
  // M2 P0-6：统一清理 tray / eventSocket / 注册表中的残留 timer，避免主进程退出后残留。
  m2Registry.cleanupAll('before-quit');
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settingsStore?.read().closeToTray) app.quit();
});
app.on('will-quit', event => {
  if (exitAfterBackendShutdown || (!backendOwnershipPresent() && !lettaOwnershipPresent() && !parlantOwnershipPresent() && !graphitiOwnershipPresent())) return;
  event.preventDefault();
  stopEventSocket();
  if (shutdownInProgress) return;
  shutdownInProgress = completeElectronQuit({
    stop: () => stopApplicationOwnedRuntimes({ reason: 'application-quit' }),
    appExit: code => { exitAfterBackendShutdown = true; app.exit(code); },
    onFailure: error => {
      quitting = false;
      desktopLog('error', 'fatal-backend-shutdown-failed', { reasonCode: error.reasonCode || 'DESKTOP_BACKEND_STOP_FAILED', backendPid: authoritativeBackend().backend.backendPid || backendPid || 0 });
      dialog.showErrorBox('无法安全退出言策', `后台服务仍在运行，应用不会伪装为已退出。

错误代码：${error.reasonCode || 'DESKTOP_BACKEND_STOP_FAILED'}`);
    }
  }).finally(() => { shutdownInProgress = null; });
});
