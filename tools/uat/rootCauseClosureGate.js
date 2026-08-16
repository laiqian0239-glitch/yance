'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_DOMAINS = Object.freeze([
  'replyLanguage',
  'translation',
  'modelRuntime',
  'customerProfile',
  'relationshipProjection',
  'learningLifecycle',
  'systemHealth',
  'accountRuntime',
  'backgroundJobs',
  'notificationSound',
  'businessPresentation'
]);
const REQUIRED_LEVELS = Object.freeze([
  'SOURCE_CONTRACT_PASS',
  'UNIT_BEHAVIOR_PASS',
  'REAL_DB_REPLAY_PASS',
  'WINDOWS_RENDER_PASS',
  'END_TO_END_TASK_PASS',
  'USER_CONFIRMED_REAL_WINDOWS_PASS',
  'FORMAL_RELEASE_PASS'
]);
const REQUIRED_PROJECTIONS = Object.freeze([
  'relationshipSignal',
  'relationshipEvent',
  'customerProfileEvidence',
  'translationJob',
  'learningEvent',
  'mediaMaterialization',
  'accountAvatarSync'
]);
const REQUIRED_DEFECTS = 18;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function relative(repoRoot, file) {
  return path.relative(repoRoot, file).replace(/\\/gu, '/');
}

function runGate(repoRoot = path.resolve(__dirname, '..', '..')) {
  const root = path.join(repoRoot, 'governance', 'root-cause-closure');
  const files = {
    authority: path.join(root, 'authority-and-writer-matrix.json'),
    acceptance: path.join(root, 'acceptance-levels.json'),
    idempotency: path.join(root, 'idempotency-contract.json'),
    evidence: path.join(root, 'evidence-whitelist.json'),
    defects: path.join(root, 'real-windows-defect-baseline.json'),
    replyLanguageClosure: path.join(root, 'reply-language-closure.json'),
    componentReadabilityClosure: path.join(root, 'component-readability-closure.json'),
    relationshipProjectionClosure: path.join(root, 'relationship-projection-idempotency-closure.json'),
    customerProfileEvidenceClosure: path.join(root, 'customer-profile-evidence-projection-closure.json'),
    relationshipStateClosure: path.join(root, 'relationship-state-authority-closure.json'),
    modelRuntimeClosure: path.join(root, 'model-runtime-authority-closure.json'),
    systemHealthClosure: path.join(root, 'system-health-authority-closure.json'),
    backgroundJobClosure: path.join(root, 'background-job-authority-closure.json'),
    dataProtectionClosure: path.join(root, 'data-protection-presentation-closure.json'),
    notificationSoundClosure: path.join(root, 'notification-sound-authority-closure.json'),
    businessPresentationClosure: path.join(root, 'business-presentation-authority-closure.json'),
    design: path.join(repoRoot, 'docs', 'architecture', 'YANCE_ROOT_CAUSE_CLOSURE_DESIGN_ZH.md')
  };
  const checks = [];
  const add = (id, pass, evidence = {}) => checks.push({ id, pass: Boolean(pass), evidence });

  for (const [id, file] of Object.entries(files)) add(`file:${id}`, fs.existsSync(file), { path: relative(repoRoot, file) });
  if (checks.some(row => row.pass === false)) return { schemaVersion: 1, status: 'BLOCKED', checks, blockers: checks.filter(row => !row.pass) };

  const authority = readJson(files.authority);
  const acceptance = readJson(files.acceptance);
  const idempotency = readJson(files.idempotency);
  const evidence = readJson(files.evidence);
  const defects = readJson(files.defects);
  const replyLanguageClosure = readJson(files.replyLanguageClosure);
  const componentReadabilityClosure = readJson(files.componentReadabilityClosure);
  const relationshipProjectionClosure = readJson(files.relationshipProjectionClosure);
  const customerProfileEvidenceClosure = readJson(files.customerProfileEvidenceClosure);
  const relationshipStateClosure = readJson(files.relationshipStateClosure);
  const modelRuntimeClosure = readJson(files.modelRuntimeClosure);
  const systemHealthClosure = readJson(files.systemHealthClosure);
  const backgroundJobClosure = readJson(files.backgroundJobClosure);
  const dataProtectionClosure = readJson(files.dataProtectionClosure);
  const notificationSoundClosure = readJson(files.notificationSoundClosure);
  const businessPresentationClosure = readJson(files.businessPresentationClosure);

  const domainIds = authority.domains.map(row => row.id);
  add('authority:required-domains', REQUIRED_DOMAINS.every(id => domainIds.includes(id)), { required: REQUIRED_DOMAINS, actual: domainIds });
  add('authority:single-writer', authority.domains.every(row => typeof row.singleWriter === 'string' && row.singleWriter.trim() && Array.isArray(row.sourceReferences) && row.sourceReferences.length > 0), { domains: authority.domains.length });
  const missingReferences = authority.domains.flatMap(row => row.sourceReferences.filter(file => !fs.existsSync(path.join(repoRoot, file))).map(file => ({ domain: row.id, file })));
  add('authority:source-references-exist', missingReferences.length === 0, { missingReferences });

  const levelIds = acceptance.levels.map(row => row.id);
  add('acceptance:exact-order', JSON.stringify(levelIds) === JSON.stringify(REQUIRED_LEVELS), { required: REQUIRED_LEVELS, actual: levelIds });
  add('acceptance:user-pass-owned-by-user', acceptance.promotionRules.some(row => /只能由用户真实验收产生/u.test(row)), { promotionRules: acceptance.promotionRules });

  const projectionIds = idempotency.projections.map(row => row.id);
  add('idempotency:required-projections', REQUIRED_PROJECTIONS.every(id => projectionIds.includes(id)), { required: REQUIRED_PROJECTIONS, actual: projectionIds });
  add('idempotency:database-enforcement', idempotency.projections.every(row => /required_/u.test(row.databaseEnforcement) && Array.isArray(row.idempotencyKey) && row.idempotencyKey.length >= 3), { projections: idempotency.projections.length });

  const forbiddenNames = new Set(evidence.forbiddenFileNames.map(value => String(value).toLowerCase()));
  add('evidence:platform-auth-forbidden', forbiddenNames.has('platform-auth.json'), { forbiddenFileNames: evidence.forbiddenFileNames });
  add('evidence:sqlite-forbidden', [...forbiddenNames].some(value => value.includes('yance-r32.db')), { forbiddenFileNames: evidence.forbiddenFileNames });
  add('evidence:secret-keys-defined', evidence.forbiddenJsonKeys.includes('apiHash') && evidence.forbiddenJsonKeys.includes('accessToken') && evidence.forbiddenJsonKeys.includes('session'), { forbiddenJsonKeys: evidence.forbiddenJsonKeys });

  add('defects:source-commit', defects.sourceCommit === '334f3622d244a7438679973a6ffa1e90306cb169', { sourceCommit: defects.sourceCommit });
  add('defects:count', defects.defects.length === REQUIRED_DEFECTS, { expected: REQUIRED_DEFECTS, actual: defects.defects.length });
  add('defects:p0-present', defects.defects.filter(row => row.priority === 'P0').length === 2, { p0: defects.defects.filter(row => row.priority === 'P0').map(row => row.id) });

  const openBlockers = [];
  const safeExporterPath = path.join(repoRoot, 'tools', 'uat', 'exportSourceUatEvidence.js');
  const safeExporter = fs.existsSync(safeExporterPath) ? fs.readFileSync(safeExporterPath, 'utf8') : '';
  const safeEvidenceExporterReady = Boolean(
    safeExporter
    && /FORBIDDEN_FILE_NAMES/u.test(safeExporter)
    && /platform-auth\.json/u.test(safeExporter)
    && /recursiveCopyUsed:\s*false/u.test(safeExporter)
    && /rawConfigExported:\s*false/u.test(safeExporter)
  );
  if (!safeEvidenceExporterReady) openBlockers.push({ id: 'P0_EVIDENCE_SAFE_EXPORTER_MISSING', file: 'tools/uat/exportSourceUatEvidence.js' });
  add('known-root-cause:safe-evidence-exporter-ready', safeEvidenceExporterReady, { openBlockers });

  const replyAuthorityPath = path.join(repoRoot, 'backend', 'services', 'replyLanguageAuthority.js');
  const replyBrainPath = path.join(repoRoot, 'backend', 'services', 'contextAwareReplyBrain.js');
  const replyCommandsPath = path.join(repoRoot, 'backend', 'store', 'commands', 'registerAiReplyCommands.js');
  const replyAuthoritySource = fs.existsSync(replyAuthorityPath) ? fs.readFileSync(replyAuthorityPath, 'utf8') : '';
  const replyBrainSource = fs.existsSync(replyBrainPath) ? fs.readFileSync(replyBrainPath, 'utf8') : '';
  const replyCommandsSource = fs.existsSync(replyCommandsPath) ? fs.readFileSync(replyCommandsPath, 'utf8') : '';
  const replyLanguageAuthorityReady = Boolean(
    /function resolve\(/u.test(replyAuthoritySource)
    && /function validateCandidate\(/u.test(replyAuthoritySource)
    && /latest_incoming_detected/u.test(replyAuthoritySource)
    && /applyReplyLanguageQuality/u.test(replyBrainSource)
    && (replyCommandsSource.match(/AI_REPLY_LANGUAGE_MISMATCH/gu) || []).length >= 3
    && replyLanguageClosure.status === 'UNIT_BEHAVIOR_PASS'
    && replyLanguageClosure.windowsRenderStatus === 'PENDING'
  );
  if (!replyLanguageAuthorityReady) openBlockers.push({ id: 'P0_REPLY_LANGUAGE_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/reply-language-closure.json' });
  add('known-root-cause:reply-language-authority-ready', replyLanguageAuthorityReady, {
    status: replyLanguageClosure.status,
    windowsRenderStatus: replyLanguageClosure.windowsRenderStatus,
    blockingGates: replyLanguageClosure.blockingGates
  });

  const componentCssPath = path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'ProductExperienceShell.css');
  const productShellPath = path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'ProductExperienceShell.tsx');
  const componentCss = fs.existsSync(componentCssPath) ? fs.readFileSync(componentCssPath, 'utf8') : '';
  const productShellSource = fs.existsSync(productShellPath) ? fs.readFileSync(productShellPath, 'utf8') : '';
  const componentReadabilityReady = Boolean(
    componentReadabilityClosure.status === 'UNIT_BEHAVIOR_PASS'
    && componentReadabilityClosure.windowsRenderStatus === 'PENDING'
    && /\.yance-assistant-actions button/u.test(componentCss)
    && /\.yance-person-copy/u.test(componentCss)
    && /min-width:\s*0/u.test(componentCss)
    && /overflow:\s*auto/u.test(componentCss)
    && /<PeopleSurface/u.test(productShellSource)
    && /<RelationshipWorld/u.test(productShellSource)
    && /<LearningWorkspace/u.test(productShellSource)
  );
  if (!componentReadabilityReady) openBlockers.push({ id: 'P1_COMPONENT_READABILITY_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/component-readability-closure.json' });
  add('known-root-cause:component-readability-authority-ready', componentReadabilityReady, {
    status: componentReadabilityClosure.status,
    windowsRenderStatus: componentReadabilityClosure.windowsRenderStatus,
    defectIds: componentReadabilityClosure.defectIds
  });

  const relationshipSchemaPath = path.join(repoRoot, 'backend', 'lib', 'r32SqliteStore.js');
  const relationshipEnginePath = path.join(repoRoot, 'backend', 'store', 'social', 'relationTrailEngine.js');
  const relationshipSchemaSource = fs.existsSync(relationshipSchemaPath) ? fs.readFileSync(relationshipSchemaPath, 'utf8') : '';
  const relationshipEngineSource = fs.existsSync(relationshipEnginePath) ? fs.readFileSync(relationshipEnginePath, 'utf8') : '';
  const relationshipProjectionReady = Boolean(
    relationshipProjectionClosure.status === 'REAL_DB_REPLAY_PASS'
    && relationshipProjectionClosure.windowsRenderStatus === 'PENDING'
    && /idx_relationship_signals_idempotency/u.test(relationshipSchemaSource)
    && /idx_relationship_timeline_idempotency/u.test(relationshipSchemaSource)
    && /mergeProjectionRows/u.test(relationshipEngineSource)
    && /effectiveSignals/u.test(relationshipEngineSource)
  );
  if (!relationshipProjectionReady) openBlockers.push({ id: 'P1_RELATIONSHIP_PROJECTION_IDEMPOTENCY_INCOMPLETE', file: 'governance/root-cause-closure/relationship-projection-idempotency-closure.json' });
  add('known-root-cause:relationship-projection-idempotency-ready', relationshipProjectionReady, {
    status: relationshipProjectionClosure.status,
    windowsRenderStatus: relationshipProjectionClosure.windowsRenderStatus,
    defectIds: relationshipProjectionClosure.defectIds
  });

  const customerEvidenceAuthorityPath = path.join(repoRoot, 'backend', 'services', 'customerProfileEvidenceAuthority.js');
  const customerEvidenceAuthoritySource = fs.existsSync(customerEvidenceAuthorityPath) ? fs.readFileSync(customerEvidenceAuthorityPath, 'utf8') : '';
  const customerProfileEvidenceReady = Boolean(
    customerProfileEvidenceClosure.status === 'REAL_DB_REPLAY_PASS'
    && customerProfileEvidenceClosure.windowsRenderStatus === 'PENDING'
    && /CREATE TABLE IF NOT EXISTS customer_profile_evidence/u.test(relationshipSchemaSource)
    && /idempotency_key TEXT NOT NULL UNIQUE/u.test(relationshipSchemaSource)
    && /function persistProjection/u.test(customerEvidenceAuthoritySource)
    && /lastSuccessfulTranslatedZh/u.test(customerEvidenceAuthoritySource)
    && /customerProfileEvidenceAuthority\.persistProjection/u.test(fs.readFileSync(path.join(repoRoot, 'backend', 'repositories', 'workspaceRepository.js'), 'utf8'))
  );
  if (!customerProfileEvidenceReady) openBlockers.push({ id: 'P1_CUSTOMER_PROFILE_EVIDENCE_PROJECTION_INCOMPLETE', file: 'governance/root-cause-closure/customer-profile-evidence-projection-closure.json' });
  add('known-root-cause:customer-profile-evidence-projection-ready', customerProfileEvidenceReady, {
    status: customerProfileEvidenceClosure.status,
    windowsRenderStatus: customerProfileEvidenceClosure.windowsRenderStatus,
    defectIds: customerProfileEvidenceClosure.defectIds
  });

  const relationshipAuthorityPath = path.join(repoRoot, 'backend', 'services', 'relationshipProjectionAuthority.js');
  const relationshipAuthoritySource = fs.existsSync(relationshipAuthorityPath) ? fs.readFileSync(relationshipAuthorityPath, 'utf8') : '';
  const workspaceRepositorySource = fs.readFileSync(path.join(repoRoot, 'backend', 'repositories', 'workspaceRepository.js'), 'utf8');
  const workspaceServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'workspaceService.js'), 'utf8');
  const productExperienceProjectionSource = fs.readFileSync(path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'experienceProjection.ts'), 'utf8');
  const relationshipWorldSource = fs.readFileSync(path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'RelationshipWorld.tsx'), 'utf8');
  const relationshipStateAuthorityReady = Boolean(
    relationshipStateClosure.status === 'REAL_DB_REPLAY_PASS'
    && relationshipStateClosure.windowsRenderStatus === 'PENDING'
    && /const STATES = Object\.freeze/u.test(relationshipAuthoritySource)
    && /function projectFromStore/u.test(relationshipAuthoritySource)
    && /relationshipProjectionAuthority\.projectFromStore/u.test(workspaceRepositorySource)
    && /authorityTrajectory/u.test(workspaceServiceSource)
    && /loadRelationshipProjections/u.test(productExperienceProjectionSource)
    && /storeSnapshot\(\{ domains: \["customers"\] \}\)/u.test(productExperienceProjectionSource)
    && /export function RelationshipWorld/u.test(relationshipWorldSource)
  );
  const relationshipStateGraphitiOnlyReady = Boolean(
    relationshipStateAuthorityReady
    && /graphiti_temporal_inference/u.test(relationshipAuthoritySource)
    && /user_annotation/u.test(relationshipAuthoritySource)
    && /source = 'ai_analysis'/u.test(relationshipAuthoritySource)
    && /source = 'empty'/u.test(relationshipAuthoritySource)
    && !/function ruleProjection/u.test(relationshipAuthoritySource)
    && !/legacy_projection/u.test(relationshipAuthoritySource)
    && !/social_rule_projection/u.test(relationshipAuthoritySource)
    && !/message_baseline/u.test(relationshipAuthoritySource)
  );
  if (!relationshipStateAuthorityReady) openBlockers.push({ id: 'P1_RELATIONSHIP_STATE_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/relationship-state-authority-closure.json' });
  if (!relationshipStateGraphitiOnlyReady) openBlockers.push({ id: 'P1_RELATIONSHIP_STATE_GRAPHITI_AUTHORITY_INCOMPLETE', file: 'backend/services/relationshipProjectionAuthority.js' });
  add('known-root-cause:relationship-state-authority-ready', relationshipStateAuthorityReady, {
    status: relationshipStateClosure.status,
    windowsRenderStatus: relationshipStateClosure.windowsRenderStatus,
    defectIds: relationshipStateClosure.defectIds
  });
  add('known-root-cause:relationship-state-graphiti-only-ready', relationshipStateGraphitiOnlyReady, {
    inferenceAuthority: 'Graphiti/Neo4j',
    timelineAuthority: 'graphiti_temporal_inference',
    explicitUserAnnotationsPreserved: true,
    aiAnalysisRemainsDistinct: true,
    localFallbackAuthorityRetired: relationshipStateGraphitiOnlyReady
  });

  const modelRuntimeAuthorityPath = path.join(repoRoot, 'backend', 'services', 'modelRuntimeAuthority.js');
  const modelRuntimeAuthoritySource = fs.existsSync(modelRuntimeAuthorityPath) ? fs.readFileSync(modelRuntimeAuthorityPath, 'utf8') : '';
  const modelRegistrySource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'modelRegistry.js'), 'utf8');
  const modelProjectionSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'modelStatusProjection.js'), 'utf8');
  const modelRuntimeAuthorityReady = Boolean(
    modelRuntimeClosure.status === 'REAL_DB_REPLAY_PASS'
    && modelRuntimeClosure.windowsRenderStatus === 'PENDING'
    && /const STATES = Object\.freeze/u.test(modelRuntimeAuthoritySource)
    && /DEGRADED_WITH_FALLBACK/u.test(modelRuntimeAuthoritySource)
    && /lastQualificationTest/u.test(modelRegistrySource)
    && /lastInvocationStatus/u.test(modelRegistrySource)
    && /authority: 'Model Brain \/ LiteLLM'/u.test(modelProjectionSource)
    && /taskReadiness/u.test(modelProjectionSource)
    && /replyBrain/u.test(modelProjectionSource)
  );
  if (!modelRuntimeAuthorityReady) openBlockers.push({ id: 'P1_MODEL_RUNTIME_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/model-runtime-authority-closure.json' });
  add('known-root-cause:model-runtime-authority-ready', modelRuntimeAuthorityReady, {
    status: modelRuntimeClosure.status,
    windowsRenderStatus: modelRuntimeClosure.windowsRenderStatus,
    defectIds: modelRuntimeClosure.defectIds
  });


  const systemHealthAuthorityPath = path.join(repoRoot, 'backend', 'services', 'systemHealthAuthority.js');
  const systemHealthAuthoritySource = fs.existsSync(systemHealthAuthorityPath) ? fs.readFileSync(systemHealthAuthorityPath, 'utf8') : '';
  const systemCenterSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'systemCenterService.js'), 'utf8');
  const systemHealthAuthorityReady = Boolean(
    systemHealthClosure.status === 'UNIT_BEHAVIOR_PASS'
    && systemHealthClosure.windowsRenderStatus === 'PENDING'
    && /const STATE = Object\.freeze/u.test(systemHealthAuthoritySource)
    && /function projectLogs\(/u.test(systemHealthAuthoritySource)
    && /function projectHealth\(/u.test(systemHealthAuthoritySource)
    && /activeErrorAggregates/u.test(systemHealthAuthoritySource)
    && /systemHealthAuthority\.projectLogs/u.test(systemCenterSource)
  );
  if (!systemHealthAuthorityReady) openBlockers.push({ id: 'P1_SYSTEM_HEALTH_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/system-health-authority-closure.json' });
  add('known-root-cause:system-health-authority-ready', systemHealthAuthorityReady, {
    status: systemHealthClosure.status,
    windowsRenderStatus: systemHealthClosure.windowsRenderStatus,
    defectIds: systemHealthClosure.defectIds,
    relatedOpenDefectIds: systemHealthClosure.relatedOpenDefectIds
  });

  const backgroundJobAuthorityPath = path.join(repoRoot, 'backend', 'services', 'backgroundJobAuthority.js');
  const backgroundJobAuthoritySource = fs.existsSync(backgroundJobAuthorityPath) ? fs.readFileSync(backgroundJobAuthorityPath, 'utf8') : '';
  const avatarServiceSource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'avatarService.js'), 'utf8');
  const mediaRecoverySource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'whatsappHistoryMediaRecovery.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(repoRoot, 'backend', 'server.js'), 'utf8');
  const backgroundJobAuthorityReady = Boolean(
    backgroundJobClosure.status === 'REAL_DB_REPLAY_PASS'
    && backgroundJobClosure.windowsRenderStatus === 'PENDING'
    && /CREATE TABLE IF NOT EXISTS background_job_state/u.test(relationshipSchemaSource)
    && /idempotency_key TEXT NOT NULL UNIQUE/u.test(backgroundJobAuthoritySource)
    && /const STATES = Object\.freeze/u.test(backgroundJobAuthoritySource)
    && /recoverInterrupted/u.test(backgroundJobAuthoritySource)
    && /backgroundJobs\.begin/u.test(avatarServiceSource)
    && /backgroundJobs\.begin/u.test(mediaRecoverySource)
    && /interruptedBackgroundJobs/u.test(serverSource)
    && /backgroundJobs: backgroundJobSummary/u.test(systemCenterSource)
  );
  if (!backgroundJobAuthorityReady) openBlockers.push({ id: 'P1_BACKGROUND_JOB_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/background-job-authority-closure.json' });
  add('known-root-cause:background-job-authority-ready', backgroundJobAuthorityReady, {
    status: backgroundJobClosure.status,
    windowsRenderStatus: backgroundJobClosure.windowsRenderStatus,
    defectIds: backgroundJobClosure.defectIds
  });


  const dataProtectionAuthorityPath = path.join(repoRoot, 'backend', 'services', 'dataProtectionAuthority.js');
  const dataProtectionAuthoritySource = fs.existsSync(dataProtectionAuthorityPath) ? fs.readFileSync(dataProtectionAuthorityPath, 'utf8') : '';
  const dataProtectionReady = Boolean(
    dataProtectionClosure.status === 'UNIT_BEHAVIOR_PASS'
    && dataProtectionClosure.windowsRenderStatus === 'PENDING'
    && /function projectDataRoot/u.test(dataProtectionAuthoritySource)
    && /function backupCoveragePresentation/u.test(dataProtectionAuthoritySource)
    && /sizeLabel/u.test(dataProtectionAuthoritySource)
    && /dataProtectionAuthority\.projectDataRoot/u.test(systemCenterSource)
    && !/files, label: bytes\(total\)/u.test(systemCenterSource)
  );
  if (!dataProtectionReady) openBlockers.push({ id: 'P1_DATA_PROTECTION_PRESENTATION_INCOMPLETE', file: 'governance/root-cause-closure/data-protection-presentation-closure.json' });
  add('known-root-cause:data-protection-presentation-ready', dataProtectionReady, {
    status: dataProtectionClosure.status,
    windowsRenderStatus: dataProtectionClosure.windowsRenderStatus,
    defectIds: dataProtectionClosure.defectIds
  });


  const notificationSoundAuthorityPath = path.join(repoRoot, 'shared', 'notificationSoundCatalog.js');
  const notificationSoundAuthoritySource = fs.existsSync(notificationSoundAuthorityPath) ? fs.readFileSync(notificationSoundAuthorityPath, 'utf8') : '';
  const notificationPolicySource = fs.readFileSync(path.join(repoRoot, 'backend', 'services', 'notificationPolicy.js'), 'utf8');
  const electronSoundSource = fs.readFileSync(path.join(repoRoot, 'electron', 'SoundNotificationService.js'), 'utf8');
  const soundPlayerSource = fs.readFileSync(path.join(repoRoot, 'electron', 'sound-player.js'), 'utf8');
  const notificationSoundReady = Boolean(
    notificationSoundClosure.status === 'UNIT_BEHAVIOR_PASS'
    && notificationSoundClosure.windowsRenderStatus === 'PENDING'
    && /NotificationSoundAuthority/u.test(notificationSoundAuthoritySource)
    && /Yance Classic/u.test(notificationSoundAuthoritySource)
    && /EVENT_SOUND_OPTIONS/u.test(notificationSoundAuthoritySource)
    && !/notificationSoundLibrary\.json/u.test(notificationSoundAuthoritySource)
    && /soundCatalog/u.test(notificationPolicySource)
    && /shared\/notificationSoundCatalog/u.test(electronSoundSource)
    && /\.\/assets\/sounds\//u.test(soundPlayerSource)
    && !/frontend\/assets\/sounds/u.test(soundPlayerSource)
  );
  if (!notificationSoundReady) openBlockers.push({ id: 'P2_NOTIFICATION_SOUND_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/notification-sound-authority-closure.json' });
  add('known-root-cause:notification-sound-authority-ready', notificationSoundReady, {
    status: notificationSoundClosure.status,
    windowsRenderStatus: notificationSoundClosure.windowsRenderStatus,
    defectIds: notificationSoundClosure.defectIds
  });

  const businessPresentationAuthorityPath = path.join(repoRoot, 'backend', 'services', 'socialAnalysisPresentationService.js');
  const businessPresentationAuthoritySource = fs.existsSync(businessPresentationAuthorityPath) ? fs.readFileSync(businessPresentationAuthorityPath, 'utf8') : '';
  const productProjectionSource = fs.readFileSync(path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'experienceProjection.ts'), 'utf8');
  const peopleSurfaceSource = fs.readFileSync(path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'PeopleSurface.tsx'), 'utf8');
  const relationshipWorldPresentationSource = fs.readFileSync(path.join(repoRoot, 'integration', 'element-module', 'src', 'product-experience', 'RelationshipWorld.tsx'), 'utf8');
  const businessPresentationReady = Boolean(
    businessPresentationClosure.status === 'UNIT_BEHAVIOR_PASS'
    && businessPresentationClosure.windowsRenderStatus === 'PENDING'
    && /buildSocialAnalysisPresentation/u.test(businessPresentationAuthoritySource)
    && /buildRelationshipPresentation/u.test(businessPresentationAuthoritySource)
    && /localizedScalar/u.test(businessPresentationAuthoritySource)
    && /loadRelationshipProjections/u.test(productProjectionSource)
    && /export function PeopleSurface/u.test(peopleSurfaceSource)
    && /relationship\.name/u.test(peopleSurfaceSource)
    && /export function RelationshipWorld/u.test(relationshipWorldPresentationSource)
  );
  if (!businessPresentationReady) openBlockers.push({ id: 'P2_BUSINESS_PRESENTATION_AUTHORITY_INCOMPLETE', file: 'governance/root-cause-closure/business-presentation-authority-closure.json' });
  add('known-root-cause:business-presentation-authority-ready', businessPresentationReady, {
    status: businessPresentationClosure.status,
    windowsRenderStatus: businessPresentationClosure.windowsRenderStatus,
    defectIds: businessPresentationClosure.defectIds
  });

  const closureDocuments = [
    replyLanguageClosure,
    componentReadabilityClosure,
    relationshipProjectionClosure,
    customerProfileEvidenceClosure,
    relationshipStateClosure,
    modelRuntimeClosure,
    systemHealthClosure,
    backgroundJobClosure,
    dataProtectionClosure,
    notificationSoundClosure,
    businessPresentationClosure,
    readJson(path.join(root, 'evidence-export-closure.json'))
  ];
  const closedDefectIds = new Set();
  for (const closure of closureDocuments) {
    for (const id of Array.isArray(closure.defectIds) ? closure.defectIds : closure.defectId ? [closure.defectId] : []) {
      if (closure.status && closure.status !== 'PENDING') closedDefectIds.add(id);
    }
  }
  const remainingDefects = defects.defects.filter(row => !closedDefectIds.has(row.id)).map(row => ({ id: row.id, priority: row.priority, domain: row.domain, summary: row.summary }));
  add('defects:closure-coverage-truthful', remainingDefects.length === 0, { closedDefectIds: [...closedDefectIds].sort(), remainingDefects });

  const blockers = checks.filter(row => !row.pass);
  return {
    schemaVersion: 1,
    documentType: 'YANCE_ROOT_CAUSE_CLOSURE_GATE',
    generatedAt: new Date().toISOString(),
    status: blockers.length ? 'BLOCKED' : 'DESIGN_BASELINE_READY',
    acceptanceLevel: 'SOURCE_CONTRACT_PASS',
    checks,
    blockers,
    openRootCauses: openBlockers,
    remainingDefects,
    warning: `DESIGN_BASELINE_READY 只表示 18 项已登记缺陷均已有源码关闭检查点；不代表真实 Windows 已通过。仍有 ${remainingDefects.length} 项未登记关闭缺陷，所有 WINDOWS_RENDER_PASS、END_TO_END_TASK_PASS 与用户确认仍待执行。`
  };
}

function main() {
  const report = runGate();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'BLOCKED') process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { runGate, REQUIRED_DOMAINS, REQUIRED_LEVELS, REQUIRED_PROJECTIONS };
