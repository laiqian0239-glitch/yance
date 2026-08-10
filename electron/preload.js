'use strict';

const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed Electron preloads cannot require arbitrary Node built-ins. Use
// the Web Crypto API exposed in the isolated preload world instead.
const randomUUID = () => globalThis.crypto.randomUUID();

ipcRenderer.send('desktop:preload-ready', { at: new Date().toISOString() });
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('desktop:renderer-ready', { at: new Date().toISOString(), readyState: document.readyState });
}, { once: true });

function on(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

async function invokeStore(channel, input) {
  const result = await ipcRenderer.invoke(channel, input || {});
  if (!result?.__yanceBridgeError) return result;
  const error = new Error(String(result.message || 'Local API request failed'));
  error.code = String(result.code || result.reasonCode || 'LOCAL_API_REQUEST_FAILED');
  error.reasonCode = String(result.reasonCode || result.code || 'LOCAL_API_REQUEST_FAILED');
  error.status = Math.max(0, Number(result.status || 0));
  error.retryAfterMs = Math.max(0, Number(result.retryAfterMs || 0));
  error.requestId = String(result.requestId || '');
  throw error;
}

function invokeStoreCancelable(channel, input, options = {}) {
  const signal = options.signal;
  if (!signal) return invokeStore(channel, input);
  if (signal.aborted) return Promise.reject(signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError', code: 'AI_REPLY_GENERATION_SUPERSEDED' }));
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      ipcRenderer.send('store:cancel-request', { requestId });
      finish(reject, signal.reason || Object.assign(new Error('Request aborted'), { name: 'AbortError', code: 'AI_REPLY_GENERATION_SUPERSEDED' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    invokeStore(channel, { ...(input || {}), __yanceBridgeRequestId: requestId })
      .then(value => finish(resolve, value), error => finish(reject, error));
  });
}

contextBridge.exposeInMainWorld('yanceDesktop', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  reportRuntimeEnvironment: input => ipcRenderer.invoke('desktop:report-runtime-environment', input || {}),
  getSettings: () => ipcRenderer.invoke('desktop:get-settings'),
  updateSettings: patch => ipcRenderer.invoke('desktop:update-settings', patch || {}),
  setTitlebarTheme: theme => ipcRenderer.invoke('desktop:set-titlebar-theme', theme || {}),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-directory', 'data'),
  openLogDirectory: () => ipcRenderer.invoke('desktop:open-directory', 'logs'),
  openProgramDirectory: () => ipcRenderer.invoke('desktop:open-directory', 'program'),
  selectDirectory: () => ipcRenderer.invoke('desktop:select-directory'),
  selectPortableBackup: () => ipcRenderer.invoke('desktop:select-portable-backup'),
  savePortableBackup: name => ipcRenderer.invoke('desktop:save-portable-backup', name),
  openPortableBackupDirectory: () => ipcRenderer.invoke('desktop:open-directory', 'portable-backups'),
  exportDiagnostics: bundle => ipcRenderer.invoke('desktop:export-diagnostics', bundle),
  exportChat: input => ipcRenderer.invoke('desktop:export-chat', input || {}),
  getRuntimeProjection: () => ipcRenderer.invoke('desktop:get-runtime-projection'),
  getLettaState: () => ipcRenderer.invoke('desktop:letta-get-state'),
  listLettaAgents: () => ipcRenderer.invoke('desktop:letta-list-agents'),
  listLettaConversations: input => ipcRenderer.invoke('desktop:letta-list-conversations', input || {}),
  getParlantRelationshipGoal: input => ipcRenderer.invoke('desktop:parlant-get-relationship-goal', input || {}),
  upsertParlantRelationshipGoal: input => ipcRenderer.invoke('desktop:parlant-upsert-relationship-goal', input || {}),
  deleteParlantRelationshipGoal: input => ipcRenderer.invoke('desktop:parlant-delete-relationship-goal', input || {}),
  setParlantRelationshipGoalPaused: input => ipcRenderer.invoke('desktop:parlant-set-relationship-goal-paused', input || {}),
  getPresenceHealth: () => ipcRenderer.invoke('desktop:presence-avatar-health'),
  createPresenceSession: input => ipcRenderer.invoke('desktop:presence-avatar-create-session', input || {}),
  closePresenceSession: input => ipcRenderer.invoke('desktop:presence-avatar-close-session', input || {}),
  pushPresenceVoiceAudioChunk: input => ipcRenderer.invoke('desktop:presence-avatar-push-voice-audio-chunk', input || {}),
  getVoiceBrainHealth: () => ipcRenderer.invoke('desktop:voice-brain-health'),
  transcribeVoiceAudio: input => ipcRenderer.invoke('desktop:voice-brain-transcribe', input || {}),
  enrollVoiceProfile: input => ipcRenderer.invoke('desktop:voice-brain-enroll-profile', input || {}),
  deleteVoiceProfile: input => ipcRenderer.invoke('desktop:voice-brain-delete-profile', input || {}),
  generateVoiceSpeech: input => ipcRenderer.invoke('desktop:voice-brain-generate-speech', input || {}),
  sendVoiceArtifact: input => ipcRenderer.invoke('desktop:voice-brain-send-artifact', input || {}),
  getMediaBrainHealth: () => ipcRenderer.invoke('desktop:media-brain-health'),
  saveMediaBrainSettings: input => ipcRenderer.invoke('desktop:media-brain-save-settings', input || {}),
  importMediaAsset: input => ipcRenderer.invoke('desktop:media-brain-import-asset', input || {}),
  searchMediaAssets: input => ipcRenderer.invoke('desktop:media-brain-search-assets', input || {}),
  listMediaPeople: input => ipcRenderer.invoke('desktop:media-brain-list-people', input || {}),
  listMediaAlbums: input => ipcRenderer.invoke('desktop:media-brain-list-albums', input || {}),
  getMediaAssetPreview: input => ipcRenderer.invoke('desktop:media-brain-get-asset-preview', input || {}),
  queueMediaWorkflow: input => ipcRenderer.invoke('desktop:media-brain-queue-workflow', input || {}),
  getMediaWorkflowResult: input => ipcRenderer.invoke('desktop:media-brain-get-workflow-result', input || {}),
  saveMediaWorkflowOutput: input => ipcRenderer.invoke('desktop:media-brain-save-workflow-output', input || {}),
  sendMediaAsset: input => ipcRenderer.invoke('desktop:media-brain-send-asset', input || {}),
  setOperatingMode: (operatingMode, reason = '', authorization = {}) => ipcRenderer.invoke('desktop:set-operating-mode', { operatingMode, reason, exitAuthorizationId: String(authorization?.exitAuthorizationId || ''), exitAuthorizationToken: String(authorization?.exitAuthorizationToken || '') }),
  restartBackend: () => ipcRenderer.invoke('desktop:restart-backend'),
  restartApp: () => ipcRenderer.invoke('desktop:restart-app'),
  notify: payload => ipcRenderer.invoke('desktop:notify', payload || {}),
  playSound: payload => ipcRenderer.invoke('desktop:play-sound', payload || {}),
  reportSoundResult: result => ipcRenderer.invoke('desktop:report-sound-result', result || {}),
  setActiveConversation: conversationId => ipcRenderer.invoke('desktop:set-active-conversation', { activeConversationId: String(conversationId || '') }),
  storeSnapshot: input => invokeStore('store:get-snapshot', input),
  storeSocialContext: input => invokeStore('store:get-social-context', input),
  storeGenerateReply: (input, options = {}) => invokeStoreCancelable('store:generate-reply', input, options),
  storeApproveReply: input => invokeStore('store:approve-reply', input),
  storeRejectReply: input => invokeStore('store:reject-reply', input),
  storeReviseOutbox: input => invokeStore('store:revise-outbox', input),
  storeConfirmSend: input => invokeStore('store:confirm-send', input),
  storeCorrectInference: input => invokeStore('store:correct-inference', input),
  storeSetReadingMode: input => invokeStore('store:set-reading-mode', input),
  storePreviewTheme: input => invokeStore('store:preview-theme', input),
  storeCancelThemePreview: () => invokeStore('store:cancel-theme-preview'),
  storeApplyTheme: input => invokeStore('store:apply-theme', input),
  storeSetMotionLevel: input => invokeStore('store:set-motion-level', input),
  storeSetBackgroundEffect: input => invokeStore('store:set-background-effect', input),
  saveCredential: (ref, value, requestId = randomUUID()) => ipcRenderer.invoke('desktop:save-credential', { ref, value, requestId }),
  deleteCredential: (ref, requestId = randomUUID()) => ipcRenderer.invoke('desktop:delete-credential', { ref, requestId }),
  openAuthUrl: (url, provider) => ipcRenderer.invoke('desktop:open-auth-url', { url, provider }),
  getUpdateState: () => ipcRenderer.invoke('desktop:update-get-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install'),
  setUpdateWorkState: state => ipcRenderer.invoke('desktop:update-set-work-state', state || {}),
  onActivation: callback => on('desktop:activation', callback),
  onActivationRecovery: callback => on('desktop:activation-recovery', callback),
  onActivationProbe: callback => on('desktop:activation-probe', callback),
  completeActivationProbe: payload => ipcRenderer.send('desktop:activation-probe-complete', payload || {}),
  onOpenConversation: callback => on('desktop:open-conversation', callback),
  onOpenView: callback => on('desktop:open-view', callback),
  onBackendState: callback => on('desktop:backend-state', callback),
  onRuntimeProjection: callback => on('desktop:runtime-projection', callback),
  onRuntimeHealth: callback => on('desktop:runtime-health', callback),
  onDesktopEvent: callback => on('desktop:event', callback),
  onPlaySoundRequest: callback => on('desktop:play-sound-request', callback),
  onNotificationResult: callback => on('desktop:notification-result', callback),
  onUpdateState: callback => on('desktop:update-state', callback)
}));
