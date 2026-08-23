'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS } = require('../../shared/core/contracts');
const { CHANNELS } = require('../../electron/r32StoreBridge');

function read(repoRoot, file) { return fs.readFileSync(path.join(repoRoot, file), 'utf8'); }
function rel(repoRoot, file) { return path.relative(repoRoot, file).split(path.sep).join('/'); }
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file)); else out.push(file);
  }
  return out;
}

function collectActualIpc(repoRoot) {
  const mainSource = read(repoRoot, 'electron/main.js');
  const rows = [];
  const registrations = [
    { pattern: /\bipcMain\.(handle|on)\(\s*['"]([^'"]+)['"]/g, kind: match => match[1], channel: match => match[2] },
    { pattern: /\bipcGuard(Handle|On)\(\s*['"]([^'"]+)['"]/g, kind: match => match[1].toLowerCase(), channel: match => match[2] }
  ];
  for (const registration of registrations) {
    for (const match of mainSource.matchAll(registration.pattern)) {
      rows.push({
        channel: registration.channel(match),
        registrationKind: registration.kind(match),
        electronIpcRegistration: `electron/main.js:${mainSource.slice(0, match.index).split('\n').length}`
      });
    }
  }
  for (const channel of Object.values(CHANNELS)) rows.push({ channel, registrationKind: 'handle', electronIpcRegistration: 'electron/r32StoreBridge.js#installR32StoreBridge' });
  rows.sort((a, b) => a.channel.localeCompare(b.channel));
  const duplicate = rows.filter((row, index) => rows.findIndex(other => other.channel === row.channel) !== index);
  if (duplicate.length) {
    const error = new Error('Duplicate Electron IPC registration');
    error.reasonCode = 'WP2_DUPLICATE_ELECTRON_IPC';
    error.details = { duplicate };
    throw error;
  }
  return rows;
}

function collectPreloadMappings(repoRoot) {
  const source = read(repoRoot, 'electron/preload.js');
  const mappings = new Map();
  const invoke = /([A-Za-z0-9_]+)\s*:\s*[^\n]*?ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(invoke)) mappings.set(match[2], { method: match[1], location: `electron/preload.js:${source.slice(0, match.index).split('\n').length}` });
  const invokeStore = /([A-Za-z0-9_]+)\s*:\s*[^\n]*?invokeStore\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(invokeStore)) mappings.set(match[2], { method: match[1], location: `electron/preload.js:${source.slice(0, match.index).split('\n').length}` });
  const onCalls = /([A-Za-z0-9_]+)\s*:\s*callback\s*=>\s*on\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(onCalls)) mappings.set(match[2], { method: match[1], location: `electron/preload.js:${source.slice(0, match.index).split('\n').length}` });
  const send = /([A-Za-z0-9_]+)\s*:\s*[^\n]*?ipcRenderer\.send\(\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(send)) mappings.set(match[2], { method: match[1], location: `electron/preload.js:${source.slice(0, match.index).split('\n').length}` });
  return mappings;
}

const ACTIVE_ELEMENT_PRODUCT_ROOT = 'integration/element-module/src';

function rendererLocations(repoRoot, method) {
  if (!method) return [];
  const pattern = new RegExp(`yanceDesktop(?:\\?\\.)?\\.${method}\\b|yanceDesktop(?:\\?\\.)?${method}\\b`);
  const rows = [];
  const roots = [
    {
      dir: path.join(repoRoot, ...ACTIVE_ELEMENT_PRODUCT_ROOT.split('/')),
      include: file => /\.(?:ts|tsx)$/.test(file)
    },
    {
      dir: path.join(repoRoot, 'frontend'),
      include: file => /\.js$/.test(file)
    }
  ];
  for (const root of roots) {
    for (const file of walk(root.dir).filter(root.include)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => { if (pattern.test(line)) rows.push(`${rel(repoRoot, file)}:${index + 1}`); });
    }
  }
  return rows;
}

const MAIN_IPC = Object.freeze({
  'desktop:preload-ready': ['electron/main.js#MainWindowActivationController.markPreloadReady', false, null, null, 'ELECTRON_DESKTOP_LIFECYCLE'],
  'desktop:renderer-ready': ['electron/main.js#MainWindowActivationController.markRendererReady', false, null, null, 'ELECTRON_DESKTOP_LIFECYCLE'],
  'desktop:activation-probe-complete': ['electron/main.js#MainWindowRuntimeReadiness.complete', false, null, null, 'ELECTRON_DESKTOP_LIFECYCLE'],
  'desktop:get-state': ['electron/main.js#desktopState', false, null, null, 'ELECTRON_DESKTOP_STATE'],
  'desktop:report-runtime-environment': ['electron/main.js#desktopLog(renderer-runtime-environment)', false, null, null, 'ELECTRON_DESKTOP_DIAGNOSTICS'],
  'desktop:get-runtime-projection': ['electron/main.js#RuntimeProjectionCoordinator.snapshot', false, '/api/app/v2/snapshot and /api/app/v2/events', null, 'BACKEND_API_V2_RUNTIME_PROJECTION'],
  'desktop:set-operating-mode': ['electron/main.js#RuntimeProjectionCoordinator.setOperatingMode', true, '/api/app/v2/commands', 'runtime.setOperatingMode', 'BACKEND_RUNTIME_STATE_AUTHORITY'],
  'desktop:get-settings': ['electron/r32DesktopSettings.js#read', false, null, null, 'ELECTRON_DESKTOP_SETTINGS'],
  'desktop:set-titlebar-theme': ['electron/main.js#BrowserWindow.setTitleBarOverlay/setBackgroundColor', false, null, null, 'ELECTRON_DESKTOP_APPEARANCE'],
  'desktop:update-settings': ['electron/r32DesktopSettings.js#update', false, null, null, 'ELECTRON_DESKTOP_SETTINGS'],
  'desktop:update-get-state': ['electron/updateManager.js#snapshot', false, null, null, 'ELECTRON_DESKTOP_UPDATER'],
  'desktop:update-check': ['electron/updateManager.js#check', false, null, null, 'ELECTRON_DESKTOP_UPDATER'],
  'desktop:update-download': ['electron/updateManager.js#download', false, null, null, 'ELECTRON_DESKTOP_UPDATER'],
  'desktop:update-install': ['electron/updateManager.js#install', false, '/api/r32/system/update-preflight', 'update.preflight', 'ELECTRON_DESKTOP_UPDATER'],
  'desktop:update-set-work-state': ['electron/updateManager.js#setRendererWorkState', false, null, null, 'ELECTRON_DESKTOP_UPDATER'],
  'desktop:open-auth-url': ['electron/main.js#openAuthorizedAuthUrl', false, null, null, 'ELECTRON_AUTH_WINDOW'],
  'desktop:open-directory': ['electron/main.js#shell.openPath', false, null, null, 'ELECTRON_DESKTOP_SHELL'],
  'desktop:select-directory': ['electron/main.js#dialog.showOpenDialog', false, null, null, 'ELECTRON_DESKTOP_DIALOG'],
  'desktop:select-portable-backup': ['electron/main.js#dialog.showOpenDialog', false, null, null, 'ELECTRON_DESKTOP_DIALOG'],
  'desktop:save-portable-backup': ['electron/main.js#dialog.showSaveDialog', false, null, null, 'ELECTRON_DESKTOP_DIALOG'],
  'desktop:export-diagnostics': ['electron/main.js#dialog.showSaveDialog', false, null, null, 'ELECTRON_DESKTOP_DIAGNOSTIC_EXPORT'],
  'desktop:export-chat': ['electron/main.js#dialog.showSaveDialog + authenticated backend chat export read', false, '/api/r32/workspace/conversations/:sessionKey/export', null, 'BACKEND_CHAT_EXPORT_AND_ELECTRON_FILE_CUSTODY'],
  'desktop:restart-backend': ['electron/main.js#restartBackend -> DesktopHost', true, null, null, 'DESKTOP_HOST_PROCESS_OWNER'],
  'desktop:restart-app': ['electron/main.js#restartElectronApp -> DesktopHost', true, null, null, 'DESKTOP_HOST_PROCESS_OWNER'],
  'desktop:notify': ['electron/main.js#showNotification', false, null, null, 'ELECTRON_DESKTOP_NOTIFICATION'],
  'desktop:play-sound': ['electron/main.js#requestDesktopSound', false, null, null, 'ELECTRON_DESKTOP_AUDIO'],
  'desktop:report-sound-result': ['electron/main.js#resolveSound', false, null, null, 'ELECTRON_DESKTOP_AUDIO'],
  'sound:result': ['electron/main.js#resolveSound', false, null, null, 'ELECTRON_DESKTOP_AUDIO'],
  'desktop:set-active-conversation': ['electron/main.js#soundNotificationService.setWindowState', false, null, null, 'ELECTRON_DESKTOP_AUDIO'],
  'desktop:save-credential': ['electron/main.js#CredentialVault', false, null, null, 'ELECTRON_CREDENTIAL_CUSTODY'],
  'desktop:delete-credential': ['electron/main.js#CredentialVault', false, null, null, 'ELECTRON_CREDENTIAL_CUSTODY']
});

const FIXED_PRODUCT_SYSTEM_STORE = Object.freeze({
  [CHANNELS.productDataProtectionState]: {
    backendRoute: '/api/r32/system/backups + /api/r32/system/portable-backups',
    backendExecutionModule: 'backend/routes/system.js',
    producesBusinessSideEffect: false
  },
  [CHANNELS.productDataProtectionMutation]: {
    backendRoute: 'fixed data-protection actions -> /api/r32/system/backups, /portable-backups, /restore/pending',
    backendExecutionModule: 'backend/routes/system.js',
    producesBusinessSideEffect: true
  },
  [CHANNELS.productModelRuntimeState]: {
    backendRoute: '/api/r32/models/model-brain/status + /adaptive-local/catalog + /hardware + /status',
    backendExecutionModule: 'backend/routes/models.js',
    producesBusinessSideEffect: false
  },
  [CHANNELS.productModelRuntimeMutation]: {
    backendRoute: 'fixed model-runtime actions -> /api/r32/models/adaptive-local/* and /ollama/pull*',
    backendExecutionModule: 'backend/routes/models.js',
    producesBusinessSideEffect: true
  }
});

function storeRoute(channel) {
  const suffix = channel.replace(/^store:/, '');
  return `/api/r32/store/${suffix}`;
}

function backendModule(command) {
  if (command.startsWith('account.') || command.startsWith('message.')) return 'backend/core/accountContext.js';
  if (command.startsWith('recovery.') || command.startsWith('lifecycle.')) return 'backend/core/recoveryManager.js';
  if (command.startsWith('update.')) return 'backend/core/updateManager.js';
  return 'backend/runtime/AppRuntime.js';
}

function collectMenuAndTrayEntries(repoRoot) {
  const source = read(repoRoot, 'electron/main.js');
  const known = [
    ['tray.backend.restart', /restartBackend\(\)/, 'electron/main.js#buildTrayMenu', 'DesktopHost process control'],
    ['tray.account.reconnect', /forwardBackendCommand\('account\.reconnect'/, 'electron/main.js#buildTrayMenu', 'authenticated backend API'],
    ['tray.notification.update', /apiRequest\('\/api\/r32\/system\/notifications'/, 'electron/main.js#buildTrayMenu', 'authenticated backend API'],
    ['tray.backup.create', /apiRequest\('\/api\/r32\/system\/backups'/, 'electron/main.js#buildTrayMenu', 'authenticated backend API'],
    ['tray.model.scan', /apiRequest\('\/api\/r32\/models\/scan'/, 'electron/main.js#buildTrayMenu', 'authenticated backend API'],
    ['menu.update.check', /updateManager\.check/, 'electron/main.js#buildTrayMenu', 'Electron UpdateManager'],
    ['menu.update.download', /updateManager\.download/, 'electron/main.js#buildTrayMenu', 'Electron UpdateManager'],
    ['menu.update.install', /updateManager\.install/, 'electron/main.js#buildTrayMenu', 'Electron UpdateManager']
  ];
  return known.filter(([, pattern]) => pattern.test(source)).map(([commandName, , entry, authority]) => ({
    entryKind: 'MENU_OR_TRAY', channelOrCommandName: commandName, commandName, authorityKind: authority.includes('backend') ? 'BACKEND_BUSINESS_RUNTIME' : 'ELECTRON_DESKTOP_CONTROL', rendererCallLocations: [], preloadExposure: null,
    electronIpcRegistration: null, electronExecutionModule: entry, forwardingOnly: authority.includes('backend'),
    backendRoute: authority.includes('backend') ? 'authenticated mapped route' : null, backendExecutionModule: authority.includes('backend') ? 'backend route/service' : null,
    stateAuthorityOwner: authority, producesBusinessSideEffect: authority.includes('backend'), finalAuthoritativePath: `${entry} -> ${authority}`
  }));
}

function buildCommandPathInventory(repoRoot) {
  const actualIpc = collectActualIpc(repoRoot);
  const preload = collectPreloadMappings(repoRoot);
  const ipcRows = actualIpc.map(row => {
    const mapping = preload.get(row.channel) || null;
    const main = MAIN_IPC[row.channel];
    const isStore = row.channel.startsWith('store:');
    if (!main && !isStore) {
      const error = new Error(`Unclassified Electron IPC channel: ${row.channel}`);
      error.reasonCode = 'WP2_UNREGISTERED_CONTROL_PATH';
      error.details = { channel: row.channel };
      throw error;
    }
    const [module, forwardingOnly, backendRoute, backendCommand, authority] = main || ['electron/r32StoreBridge.js', true, storeRoute(row.channel), null, 'BACKEND_BUSINESS_RUNTIME'];
    const fixedProductSystem = FIXED_PRODUCT_SYSTEM_STORE[row.channel] || null;
    const resolvedBackendRoute = fixedProductSystem?.backendRoute || backendRoute;
    const resolvedBackendExecutionModule = fixedProductSystem?.backendExecutionModule
      || (resolvedBackendRoute ? (isStore ? 'backend/routes/store.js or mapped store service' : row.channel === 'desktop:export-chat' ? 'backend/services/chatExportService.js' : 'backend/core/updateManager.js') : null);
    const producesBusinessSideEffect = fixedProductSystem?.producesBusinessSideEffect
      ?? (authority === 'BACKEND_BUSINESS_RUNTIME' || Boolean(backendCommand));
    return {
      entryKind: 'ELECTRON_IPC',
      channelOrCommandName: row.channel,
      authorityKind: authority,
      commandName: row.channel,
      registrationKind: row.registrationKind,
      rendererCallLocations: rendererLocations(repoRoot, mapping?.method),
      preloadExposure: mapping ? `${mapping.location}#${mapping.method}` : null,
      electronIpcRegistration: row.electronIpcRegistration,
      electronExecutionModule: module,
      forwardingOnly,
      backendRoute: resolvedBackendRoute,
      backendCoreCommand: backendCommand,
      backendExecutionModule: resolvedBackendExecutionModule,
      stateAuthorityOwner: authority,
      producesBusinessSideEffect,
      finalAuthoritativePath: forwardingOnly ? `${mapping?.location || 'renderer'} -> ${row.electronIpcRegistration} -> authenticated backend route ${resolvedBackendRoute || ''}` : `${mapping?.location || row.channel} -> ${row.electronIpcRegistration} -> ${module}`,
      deletedOrDisabledLegacyPath: 'Electron business CoreRuntime and generic desktop:core-command removed'
    };
  });

  const backendRows = Object.values(COMMANDS).sort().map(command => ({
    entryKind: 'BACKEND_COMMAND', channelOrCommandName: command, commandName: command, authorityKind: 'BACKEND_BUSINESS_RUNTIME',
    rendererCallLocations: ['renderer authenticated backend HTTP client'], preloadExposure: null,
    electronIpcRegistration: null, electronExecutionModule: null, forwardingOnly: false,
    backendRoute: command === 'update.preflight' ? '/api/r32/system/update-preflight or /api/core/command' : '/api/core/command or mapped /api/r32 route',
    backendCoreCommand: command, backendExecutionModule: backendModule(command), stateAuthorityOwner: 'BACKEND_BUSINESS_RUNTIME',
    producesBusinessSideEffect: true, finalAuthoritativePath: `renderer -> authenticated backend API -> ${backendModule(command)}`,
    deletedOrDisabledLegacyPath: 'Electron business CoreRuntime and desktop:core-command removed'
  }));
  const rows = [...ipcRows, ...collectMenuAndTrayEntries(repoRoot), ...backendRows];
  const inventoryIpc = new Set(ipcRows.map(row => row.channelOrCommandName));
  const actualSet = new Set(actualIpc.map(row => row.channel));
  const missing = [...actualSet].filter(channel => !inventoryIpc.has(channel));
  const extra = [...inventoryIpc].filter(channel => !actualSet.has(channel));
  if (missing.length || extra.length) {
    const error = new Error('Control-path inventory does not match actual Electron IPC registration set');
    error.reasonCode = 'WP2_CONTROL_PATH_INVENTORY_MISMATCH';
    error.details = { actualCount: actualSet.size, inventoryCount: inventoryIpc.size, missing, extra };
    throw error;
  }
  Object.defineProperty(rows, 'coverage', { value: { actualIpcCount: actualSet.size, inventoryIpcCount: inventoryIpc.size, missingChannels: missing, extraChannels: extra }, enumerable: false });
  return rows;
}

module.exports = { collectActualIpc, collectPreloadMappings, buildCommandPathInventory };
