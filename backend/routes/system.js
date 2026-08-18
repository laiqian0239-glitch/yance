'use strict';

const express = require('express');
const diagnostics = require('../services/diagnosticsService');
const backup = require('../services/backupService');
const portableBackup = require('../services/portableBackupService');
const eventBus = require('../services/eventBus');
const featureFlags = require('../services/featureFlags');
const migration = require('../services/migrationService');
const transcription = require('../services/transcriptionService');
const speechInstaller = require('../services/speechInstallerService');
const mediaPipeline = require('../services/mediaPipeline');
const notificationPolicy = require('../services/notificationPolicy');
const customNotificationSoundService = require('../services/customNotificationSoundService');
const systemPolicy = require('../services/systemPolicy');
const systemCenter = require('../services/systemCenterService');
const systemHealthAuthority = require('../services/systemHealthAuthority');
const logger = require('../services/logger');
const runtimeRecovery = require('../services/runtimeRecoveryService');
const performancePolicy = require('../services/performancePolicy');
const runtimeSettings = require('../services/runtimeSettings');
const { CONFIG } = require('../config');
const { getReleaseIdentity } = require('../../shared/constants');
const { getAppRuntime } = require('../runtime/runtimeSingleton');
const { getBackendReleaseIdentity } = require('../releaseIdentity');
const { identityTuple } = require('../../shared/release/identityObservation');
const accountManager = require('../services/accountManager');
const platformProductionReadiness = require('../services/platformProductionReadinessAuthority');
const platformCapabilityAuthority = require('../services/platformCapabilityAuthority');
const round12ArchitectureStatus = require('../services/round12ArchitectureStatusService');
const architectureRuntimeHealth = require('../services/architectureRuntimeHealthService');
const architectureRuntimeEvidence = require('../services/architectureRuntimeEvidenceService');

const router = express.Router();

async function coreExecute(req, command, payload = {}) {
  const output = await getAppRuntime().executeBusinessCommand({
    command,
    payload,
    context: { actor: 'system-route', correlationId: req.get('x-correlation-id') || '' }
  });
  return output.result;
}

router.get('/health', (_req, res) => {
  const architectureGovernance = architectureRuntimeHealth.snapshot();
  const releaseIdentity = getReleaseIdentity();
  res.json({
    ok: true,
    healthState: architectureGovernance.state,
    degraded: architectureGovernance.degraded,
    releaseBlocked: architectureGovernance.releaseBlocked,
    product: {
      ...CONFIG.product,
      sourceCommit: releaseIdentity.sourceCommit || releaseIdentity.gitCommit || '',
      sourceTree: releaseIdentity.sourceTree || '',
      artifactClass: releaseIdentity.artifactClass || ''
    },
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    at: new Date().toISOString(),
    architectureGovernance
  });
});
router.get('/release-identity', (_req, res) => res.json({
  schemaVersion: 1,
  documentType: 'YANCE_BACKEND_DIAGNOSTICS_RELEASE_IDENTITY',
  consumer: 'diagnostics',
  producerType: 'backend-diagnostics-endpoint',
  producerProcess: 'backend/routes/system.js',
  producerPid: process.pid,
  sourceKind: 'http-endpoint',
  observedAtUtc: new Date().toISOString(),
  ...identityTuple(getBackendReleaseIdentity())
}));
router.get('/runtime', (_req, res) => res.json({ ok: true, runtime: runtimeRecovery.status() }));
router.get('/update-preflight', async (req, res, next) => { try { const output = await getAppRuntime().executeBusinessCommand({ command: 'update.preflight', payload: {}, context: { actor: 'system-route', correlationId: req.get('x-correlation-id') || '' } }); res.json(output.result); } catch (error) { next(error); } });
router.post('/runtime/recover', async (req, res, next) => { try { res.json({ ok: true, runtime: await runtimeRecovery.recover(req.body?.reason || 'manual') }); } catch (error) { next(error); } });
router.get('/overview', (_req, res) => res.json(systemCenter.snapshot()));
router.get('/diagnostics', (_req, res) => res.json({ ok: true, diagnostics: diagnostics.snapshot() }));
router.get('/platform-readiness', (_req, res) => {
  const accountState = accountManager.list();
  res.json({
    ok: true,
    readiness: platformProductionReadiness.evaluate(accountState),
    capabilityAuthority: platformCapabilityAuthority.evaluate(accountState)
  });
});
router.get('/platform-capabilities', (req, res) => {
  const accountState = accountManager.list();
  res.json({
    ok: true,
    capabilities: platformCapabilityAuthority.evaluate(accountState, {
      platform: req.query.platform,
      accountId: req.query.accountId
    })
  });
});
router.get('/architecture/round12', (_req, res) => {
  const architecture=round12ArchitectureStatus.snapshot(); const runtimeHealth=architectureRuntimeHealth.snapshot(); res.json({ ok: true, releaseBlocked: runtimeHealth.releaseBlocked, architecture:{...architecture,runtimeHealth} });
});
router.get('/architecture/release-gate', (_req, res) => {
  try { res.json({ ok: true, ready: true, architectureHealth: architectureRuntimeHealth.assertReleaseReady() }); }
  catch (error) { res.status(Number(error.status || 409)).json({ ok: false, ready: false, code: error.code || 'ARCHITECTURE_RUNTIME_RELEASE_BLOCKED', error: error.message, architectureHealth: error.architectureHealth || architectureRuntimeHealth.snapshot() }); }
});
router.get('/architecture/runtime-evidence', (req, res) => {
  res.json({ ok: true, evidence: architectureRuntimeEvidence.snapshot({ limit: req.query.limit, offset: req.query.offset }) });
});
router.get('/diagnostics/export', async (req, res, next) => { try { res.json({ ok: true, bundle: await coreExecute(req, 'recovery.exportDiagnostics', { limit: Number(req.query.limit || 200) }) }); } catch (error) { next(error); } });
router.get('/logs', (req, res) => {
  const logs = logger.readRecent({ level: req.query.level || '', channel: req.query.channel || '', limit: Number(req.query.limit || 200) });
  if (String(req.query.raw || '') === '1') return res.json({ ok: true, logs });
  const projection = systemHealthAuthority.projectLogs(logs);
  return res.json({ ok: true, logs: projection.aggregates, logProjection: projection });
});

router.get('/runtime-settings', (_req, res) => res.json({ ok: true, settings: runtimeSettings.read() }));
router.post('/runtime-settings', (req, res, next) => {
  try { res.json({ ok: true, settings: runtimeSettings.update(req.body || {}) }); }
  catch (error) { next(error); }
});

function policyProjection() {
  const policy = systemPolicy.read();
  return { ...policy, safeMode: getAppRuntime().operatingMode === 'safeMode', operatingModeAuthority: 'runtime_state.operating_mode' };
}

router.get('/policy', (_req, res) => res.json({ ok: true, policy: policyProjection() }));
router.post('/policy', async (req, res, next) => {
  try {
    const patch = { ...(req.body || {}) };
    if (Object.prototype.hasOwnProperty.call(patch, 'safeMode')) {
      const error = new Error('Operating mode changes must use POST /api/app/v2/commands with runtime.setOperatingMode');
      error.code = 'OPERATING_MODE_API_V2_REQUIRED';
      error.reasonCode = 'OPERATING_MODE_API_V2_REQUIRED';
      error.status = 409;
      throw error;
    }
    if (Object.keys(patch).length) await systemPolicy.update(patch, 'system-center');
    res.json({ ok: true, policy: policyProjection() });
  } catch (error) { next(error); }
});

router.get('/backups', async (req, res, next) => { try { const state = await coreExecute(req, 'recovery.getState'); res.json({ ok: true, backups: backup.listBackups(), pendingRestore: state.pendingRestore, restoreHistory: state.recentRestoreHistory, retention: backup.retentionState() }); } catch (error) { next(error); } });
router.get('/portable-backups', async (_req, res, next) => {
  try { res.json({ ok: true, packages: await portableBackup.listPortableBackups() }); } catch (error) { next(error); }
});
router.post('/portable-backups', async (req, res, next) => {
  try { res.json(await portableBackup.createPortableBackup({ passphrase: req.body?.passphrase, profile: req.body?.profile, label: req.body?.label })); } catch (error) { next(error); }
});
router.post('/portable-backups/:name/verify', async (req, res, next) => {
  try { res.json(await portableBackup.verifyPortableBackup(req.params.name, req.body?.passphrase)); } catch (error) { next(error); }
});
router.post('/portable-backups/:name/restore', async (req, res, next) => {
  try { res.json(await portableBackup.stagePortableRestore(req.params.name, req.body?.passphrase)); } catch (error) { next(error); }
});
router.delete('/portable-backups/:name', (req, res, next) => {
  try { res.json(portableBackup.deletePortableBackup(req.params.name)); } catch (error) { next(error); }
});
router.post('/backups', async (req, res, next) => {
  try { res.json(await coreExecute(req, 'recovery.createBackup', { label: req.body?.label || 'manual', profile: req.body?.profile, roots: req.body?.roots })); } catch (error) { next(error); }
});
router.post('/backups/:name/verify', async (req, res, next) => { try { res.json(await coreExecute(req, 'recovery.verifyBackup', { name: req.params.name })); } catch (error) { next(error); } });
router.post('/backups/:name/restore', async (req, res, next) => {
  try { res.json(await coreExecute(req, 'recovery.stageRestore', { name: req.params.name })); } catch (error) { next(error); }
});
router.delete('/restore/pending', async (req, res, next) => {
  try { res.json(await coreExecute(req, 'recovery.cancelRestore')); } catch (error) { next(error); }
});
router.get('/restore/history', async (req, res, next) => { try { const output = await coreExecute(req, 'recovery.getHistory', { limit: 50 }); res.json({ ok: true, ...output }); } catch (error) { next(error); } });

router.get('/performance', (_req, res) => res.json({ ok: true, settings: performancePolicy.read() }));
router.post('/performance', async (req, res, next) => {
  try { res.json({ ok: true, settings: await performancePolicy.update(req.body || {}) }); } catch (error) { next(error); }
});

router.get('/notifications', (_req, res) => res.json({ ok: true, settings: notificationPolicy.read(), soundCatalog: notificationPolicy.soundCatalog() }));
router.post('/notifications', async (req, res, next) => {
  try { res.json({ ok: true, settings: await notificationPolicy.update(req.body || {}), soundCatalog: notificationPolicy.soundCatalog() }); } catch (error) { next(error); }
});
router.post('/notifications/sounds', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: customNotificationSoundService.MAX_SOUND_BYTES }), async (req, res, next) => {
  try {
    const result = await customNotificationSoundService.createFromBuffer({
      buffer: req.body,
      label: req.query?.label,
      originalFileName: req.query?.fileName,
      mimeType: req.get('content-type')
    });
    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      ...result,
      settings: notificationPolicy.read(),
      soundCatalog: notificationPolicy.soundCatalog()
    });
  } catch (error) { next(error); }
});
router.delete('/notifications/sounds/:id', async (req, res, next) => {
  try {
    const settings = await notificationPolicy.clearCustomSoundReferences(req.params.id);
    const item = await customNotificationSoundService.remove(req.params.id);
    res.json({ ok: true, item, settings, soundCatalog: notificationPolicy.soundCatalog() });
  } catch (error) { next(error); }
});

router.post('/desktop/notify-test', (req, res) => {
  const result = notificationPolicy.notify({
    title: req.body?.title || '言策 测试通知',
    body: req.body?.body || '桌面通知链路已触发。',
    conversationId: req.body?.conversationId || '',
    accountId: req.body?.accountId || 'system-test',
    platform: req.body?.platform || 'system'
  });
  res.json({ ok: result.shown, queued: result.shown, reason: result.reason || '', result });
});

router.get('/feature-flags', (_req, res) => res.json({ ok: true, flags: featureFlags.read() }));
router.post('/feature-flags/:name', async (req, res, next) => {
  try { res.json({ ok: true, flags: await featureFlags.setFlag(req.params.name, req.body?.value, req.body?.accountId || '') }); } catch (error) { next(error); }
});
router.post('/migration/scan', (req, res, next) => {
  try { res.json({ ok: true, plan: migration.createPlan(req.body?.sourceDir) }); } catch (error) { next(error); }
});
router.post('/migration/import', (req, res, next) => {
  try { res.json(migration.executeJsonImport(req.body?.sourceDir, req.body?.confirmToken)); } catch (error) { next(error); }
});
router.post('/media/cleanup', (req, res, next) => {
  try { res.json({ ok: true, result: mediaPipeline.cleanup({ olderThanDays: req.body?.olderThanDays, dryRun: req.body?.dryRun !== false }) }); } catch (error) { next(error); }
});
router.get('/speech/status', (_req, res) => res.json({ ok: true, ...transcription.engineStatus(), installer: speechInstaller.status() }));
router.get('/speech/install/status', (_req, res) => res.json(speechInstaller.status()));
router.post('/speech/install', (_req, res, next) => {
  try { res.status(202).json(speechInstaller.startInstall()); } catch (error) { next(error); }
});
router.post('/speech/transcribe', async (req, res, next) => {
  try {
    const scheduled = await transcription.transcribe({
      filePath: req.body?.filePath,
      mediaReference: req.body?.mediaReference || req.body?.filePath,
      language: req.body?.language || 'auto',
      translateToChinese: req.body?.translateToChinese !== false,
      idempotencyKey: req.body?.idempotencyKey,
      traceId: req.get('x-correlation-id') || req.body?.traceId || '',
      sourceScopeReference: req.body?.sourceScopeReference,
      destinationScopeReference: req.body?.destinationScopeReference,
      custodyReference: req.body?.custodyReference
    });
    res.status(202).json({ ok: true, status: 'scheduled', ...scheduled });
  } catch (error) { next(error); }
});

module.exports = router;
