'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { discoverExistingDataRoots } = require('../runtime-delivery/source-uat-delivery');

const EXPECTED_WORKER_AVATAR_CONTRACT = 11;
const EXPECTED_WORKER_EVIDENCE_CONTRACT = 6;
const EXPECTED_WORKER_DEPLOYMENT_MARKER = 'facebook-avatar-translation-persistence-fix13-20260724';
const EXPECTED_D1_SCHEMA_VERSION = 6;
const DEFAULT_WORKER = 'https://yance-facebook-gateway.wangyi198675.workers.dev';

const REQUIRED_LOCAL_COLUMNS = Object.freeze({
  r32_accounts: ['id', 'platform', 'payload_json'],
  r32_conversations: ['session_key', 'account_id', 'contact_id', 'platform', 'avatar_url', 'avatar_status', 'merged_into', 'merged_at', 'merge_reason', 'payload_json'],
  contacts: ['id', 'platform', 'account_id', 'external_id', 'avatar_url', 'avatar_status', 'canonical_contact_id', 'merged_into_id', 'tombstoned_at'],
  whatsapp_identity_authority: ['account_id', 'alias_jid', 'canonical_jid', 'aliases_json'],
  identity_aliases: ['platform', 'alias_value', 'canonical_account_id', 'canonical_contact_id'],
  identity_merge_audit: ['platform', 'entity_type', 'source_id', 'target_id']
});
const CRITICAL_EMPTY_CATCH_FILES = Object.freeze([
  'backend/services/accountManager.js',
  'backend/services/whatsappAdapter.js',
  'backend/services/whatsappConversationMergeService.js',
  'backend/services/whatsappAccountReconciliationService.js',
  'backend/services/whatsappIdentityAuthority.js',
  'backend/services/avatarService.js',
  'backend/services/facebookAdapter.js',
  'backend/services/facebookOAuthService.js',
  'backend/services/contextAwareReplyBrain.js',
  'backend/services/aiGateway.js',
  'backend/services/openAiCompatibleClient.js',
  'services/facebook-worker/src/desktopApi.js',
  'services/facebook-worker/src/desktopAuth.js',
  'services/facebook-worker/src/media.js'
]);

function clean(value, max = 4000) { return String(value == null ? '' : value).trim().slice(0, max); }
function parseJson(value, fallback = null) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function tableExists(db, table) { return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)); }
function tableColumns(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info("${String(table || '').replace(/"/g, '""')}")`).all().map(row => clean(row.name));
}
function inspectFile(file) {
  try { const stat = fs.statSync(file); return { path: file, exists: stat.isFile(), bytes: stat.isFile() ? stat.size : 0 }; }
  catch (error) { return { path: file, exists: false, bytes: 0, errorCode: error.code || 'FILE_STAT_FAILED' }; }
}
function criticalEmptyCatchAudit(repoRoot) {
  const findings = [];
  const patterns = [
    { kind: 'empty-catch', expression: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/gu },
    { kind: 'empty-promise-catch', expression: /\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{\s*\}\s*\)/gu }
  ];
  for (const relativePath of CRITICAL_EMPTY_CATCH_FILES) {
    const file = path.join(repoRoot, relativePath);
    if (!fs.existsSync(file)) {
      findings.push({ file: relativePath, line: 0, kind: 'critical-file-missing', fragment: '' });
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0;
      let match;
      while ((match = pattern.expression.exec(content))) {
        const line = content.slice(0, match.index).split(/\r?\n/u).length;
        findings.push({ file: relativePath, line, kind: pattern.kind, fragment: clean(match[0], 240) });
      }
    }
  }
  return { files: CRITICAL_EMPTY_CATCH_FILES, findings, count: findings.length };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--data-root') options.dataRoot = argv[++index];
    else if (item === '--worker') options.worker = argv[++index];
    else if (item === '--output') options.output = argv[++index];
    else if (item === '--allow-legacy-healthz') options.allowLegacyHealthz = true;
    else if (item === '--allow-local-migration') options.allowLocalMigration = true;
  }
  return options;
}
function readSourceCheckpoint(repoRoot) {
  const file = path.join(repoRoot, 'YANCE_SOURCE_CHECKPOINT.json');
  return parseJson(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', {});
}
function validGitHash(value) { return /^[0-9a-f]{40}$/iu.test(clean(value)); }

const METADATA_ONLY_DELIVERY_PATH_PATTERNS = Object.freeze([
  /^YANCE_SOURCE_CHECKPOINT\.json$/u,
  /^YANCE_ROUND[0-9_]+_SOURCE_CHECKPOINT(?:_[0-9a-f]{7,40})?\.json$/iu,
  /^YANCE_ROUND[0-9_]+_(?:DELIVERY_STATUS|SHA256SUMS)(?:_[0-9a-f]{7,40})?\.(?:json|txt)$/iu,
  /^ROUND[0-9_]+_[A-Z0-9_-]*(?:CHECKPOINT|CLOSURE_REPORT|DELIVERY_REPORT|STATUS)[A-Z0-9_-]*\.(?:md|json|txt)$/iu
]);
function normalizeGitPath(value) { return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, ''); }
function isMetadataOnlyDeliveryPath(value) {
  const relative = normalizeGitPath(value);
  return Boolean(relative && !relative.includes('/') && METADATA_ONLY_DELIVERY_PATH_PATTERNS.some(pattern => pattern.test(relative)));
}
function deliveryChangedPaths(repoRoot, implementationCommit, deliveryCommit) {
  if (!validGitHash(implementationCommit) || !validGitHash(deliveryCommit) || implementationCommit === deliveryCommit) return [];
  const output = execFileSync('git', [
    'diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACDMRTUXB',
    `${implementationCommit}..${deliveryCommit}`
  ], { cwd: repoRoot, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] });
  return output.toString('utf8').split('\0').map(normalizeGitPath).filter(Boolean);
}
function expectedSourceIdentity(repoRoot) {
  const checkpoint = readSourceCheckpoint(repoRoot);
  if (validGitHash(checkpoint.commit) && validGitHash(checkpoint.tree)) {
    return {
      commit: clean(checkpoint.commit),
      tree: clean(checkpoint.tree),
      branch: clean(checkpoint.branch),
      authority: 'source-checkpoint'
    };
  }
  try {
    return {
      commit: clean(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      tree: clean(execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      branch: clean(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      authority: 'git-head'
    };
  } catch (_) {
    return { commit: '', tree: '', branch: '', authority: 'unavailable' };
  }
}
function gitIdentity(repoRoot, expected = expectedSourceIdentity(repoRoot)) {
  try {
    const workingTreeStatus = clean(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }), 20000);
    const identity = {
      available: true,
      branch: clean(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      commit: clean(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      tree: clean(execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })),
      workingTreeClean: workingTreeStatus === '',
      workingTreeStatus: workingTreeStatus ? workingTreeStatus.split(/\r?\n/u).slice(0, 100) : [],
      identityAuthority: 'git'
    };
    const expectedCommit = clean(expected.commit);
    const expectedTree = clean(expected.tree);
    let expectedCommitTree = '';
    let checkpointTreeMatchesCommit = false;
    let implementationAncestor = false;
    if (validGitHash(expectedCommit)) {
      try {
        expectedCommitTree = clean(execFileSync('git', ['rev-parse', `${expectedCommit}^{tree}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
        checkpointTreeMatchesCommit = !expectedTree || expectedCommitTree === expectedTree;
      } catch (_) {
        checkpointTreeMatchesCommit = false;
      }
      if (checkpointTreeMatchesCommit) {
        const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', expectedCommit, identity.commit], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe']
        });
        implementationAncestor = ancestor.status === 0;
      }
    }
    const expectedBranch = clean(expected.branch);
    const branchCompatible = !expectedBranch || identity.branch === expectedBranch || identity.branch === 'HEAD';
    let changedPaths = [];
    let metadataOnlyPaths = [];
    let functionalChangedPaths = [];
    let metadataOnlyChanges = identity.commit === expectedCommit;
    if (implementationAncestor && identity.commit !== expectedCommit) {
      try {
        changedPaths = deliveryChangedPaths(repoRoot, expectedCommit, identity.commit);
        metadataOnlyPaths = changedPaths.filter(isMetadataOnlyDeliveryPath);
        functionalChangedPaths = changedPaths.filter(value => !isMetadataOnlyDeliveryPath(value));
        metadataOnlyChanges = functionalChangedPaths.length === 0;
      } catch (_) {
        metadataOnlyChanges = false;
      }
    }
    Object.assign(identity, {
      expectedCommitTree,
      checkpointTreeMatchesCommit,
      implementationAncestor,
      branchCompatible,
      deliveryChangedPaths: changedPaths,
      metadataOnlyPaths,
      functionalChangedPaths,
      metadataOnlyChanges,
      metadataOnlyDelivery: identity.commit !== expectedCommit && implementationAncestor && metadataOnlyChanges,
      baselineContained: Boolean(expectedCommit && checkpointTreeMatchesCommit && implementationAncestor && branchCompatible && metadataOnlyChanges && identity.workingTreeClean)
    });
    return identity;
  } catch (error) {
    const checkpoint = readSourceCheckpoint(repoRoot);
    const commit = clean(checkpoint.commit);
    const tree = clean(checkpoint.tree);
    const expectedBranch = clean(expected.branch);
    const branch = clean(checkpoint.branch);
    const branchCompatible = !expectedBranch || branch === expectedBranch;
    return {
      available: false,
      branch,
      commit,
      tree,
      checkpointTreeMatchesCommit: null,
      implementationAncestor: null,
      branchCompatible,
      metadataOnlyDelivery: false,
      baselineContained: Boolean(expected.commit && commit === expected.commit && (!expected.tree || tree === expected.tree) && branchCompatible),
      identityAuthority: 'source-checkpoint',
      errorCode: 'GIT_IDENTITY_UNAVAILABLE'
    };
  }
}
function resolveDataRoot(options = {}) {
  if (clean(options.dataRoot)) return path.resolve(options.dataRoot);
  const selected = discoverExistingDataRoots(process.env).find(row => row.databaseExists);
  return selected?.dataRoot || '';
}
async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Object.assign(new Error('P0_PREFLIGHT_TIMEOUT'), { code: 'P0_PREFLIGHT_TIMEOUT' })), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    const text = await response.text();
    const body = parseJson(text, null);
    if (!response.ok || !body) {
      const error = new Error(`Worker healthz 返回 ${response.status}`);
      error.code = 'P0_WORKER_HEALTH_FAILED';
      error.httpStatus = response.status;
      error.body = text.slice(0, 1000);
      throw error;
    }
    return body;
  } finally { clearTimeout(timer); }
}
function localState(dataRoot) {
  const databasePath = dataRoot ? path.join(dataRoot, 'store', 'yance-r32.db') : '';
  const state = {
    dataRoot,
    database: inspectFile(databasePath),
    schemaVersion: null,
    requiredTables: {},
    requiredColumns: {},
    facebookAccountAvatars: { total: 0, ready: 0 },
    facebookContactAvatars: { total: 0, ready: 0, missingLocalFiles: 0 }
  };
  if (!state.database.exists) return state;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON;');
    for (const [table, requiredColumns] of Object.entries(REQUIRED_LOCAL_COLUMNS)) {
      state.requiredTables[table] = tableExists(db, table);
      const actualColumns = new Set(tableColumns(db, table));
      state.requiredColumns[table] = {
        required: requiredColumns,
        actual: [...actualColumns],
        missing: requiredColumns.filter(column => !actualColumns.has(column))
      };
    }
    if (tableExists(db, 'r32_meta')) {
      const row = db.prepare("SELECT value_json FROM r32_meta WHERE key='schema_version'").get();
      state.schemaVersion = parseJson(row?.value_json, row?.value_json || null);
    }
    if (tableExists(db, 'r32_accounts')) {
      const accountColumns = new Set(tableColumns(db, 'r32_accounts'));
      if (accountColumns.has('platform') && accountColumns.has('payload_json')) {
        const rows = db.prepare("SELECT payload_json FROM r32_accounts WHERE platform='facebook'").all();
        state.facebookAccountAvatars.total = rows.length;
        state.facebookAccountAvatars.ready = rows.filter(row => {
          const payload = parseJson(row.payload_json, {});
          return Boolean(clean(payload.avatarUrl || payload.avatar_url || payload.pagePicture || payload.page_picture || payload.metadata?.avatarUrl));
        }).length;
      }
    }
    if (tableExists(db, 'contacts')) {
      const contactColumns = new Set(tableColumns(db, 'contacts'));
      if (contactColumns.has('platform') && contactColumns.has('avatar_url')) {
        const filters = ["platform='facebook'"];
        if (contactColumns.has('merged_into_id')) filters.push("COALESCE(merged_into_id,'')=''");
        if (contactColumns.has('tombstoned_at')) filters.push("COALESCE(tombstoned_at,'')=''");
        const rows = db.prepare(`SELECT avatar_url FROM contacts WHERE ${filters.join(' AND ')}`).all();
        state.facebookContactAvatars.total = rows.length;
        state.facebookContactAvatars.ready = rows.filter(row => clean(row.avatar_url)).length;
        for (const row of rows) {
          const match = clean(row.avatar_url).match(/^\/api\/r32\/messages\/media\/([^/]+)\/([^/]+)\/([^/?#]+)/u);
          if (!match) continue;
          const file = path.join(dataRoot, 'media', ...match.slice(1).map(value => decodeURIComponent(value).replace(/[^a-zA-Z0-9._-]+/g, '_')));
          if (!inspectFile(file).exists) state.facebookContactAvatars.missingLocalFiles += 1;
        }
      }
    }
    return state;
  } finally { db.close(); }
}
async function runPreflight(options = {}) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const expectedSource = expectedSourceIdentity(repoRoot);
  const source = gitIdentity(repoRoot, expectedSource);
  const dataRoot = resolveDataRoot(options);
  const local = localState(dataRoot);
  const sourceAudit = criticalEmptyCatchAudit(repoRoot);
  const workerBase = clean(options.worker || process.env.YANCE_FACEBOOK_WORKER_BASE_URL || DEFAULT_WORKER).replace(/\/$/u, '');
  let worker = null;
  let workerError = null;
  try { worker = await fetchJson(`${workerBase}/healthz`); }
  catch (error) { workerError = { code: error.code || 'P0_WORKER_HEALTH_FAILED', message: error.message, httpStatus: error.httpStatus || 0 }; }

  const checks = [];
  const add = (id, pass, blocking, evidence, reasonCode) => checks.push({ id, status: pass ? 'pass' : (blocking ? 'blocked' : 'warning'), blocking: Boolean(blocking && !pass), reasonCode: pass ? '' : reasonCode, evidence });
  const sourceIdentityMatches = source.baselineContained === true;
  add('source-baseline', sourceIdentityMatches, true, { ...source, expected: expectedSource }, 'P0_SOURCE_BASELINE_MISMATCH');
  add('local-database', local.database.exists, true, local.database, 'P0_LOCAL_DATABASE_MISSING');
  add('local-required-tables', local.database.exists && Object.keys(local.requiredTables).length === Object.keys(REQUIRED_LOCAL_COLUMNS).length && Object.values(local.requiredTables).every(Boolean), true, local.requiredTables, 'P0_LOCAL_SCHEMA_INCOMPLETE');
  const localColumnsComplete = local.database.exists && Object.values(local.requiredColumns).every(row => row.missing.length === 0);
  const missingLocalColumns = Object.entries(local.requiredColumns).flatMap(([table, row]) => row.missing.map(column => `${table}.${column}`));
  const safelyMigratableColumns = new Set(['r32_conversations.merged_into', 'r32_conversations.merged_at', 'r32_conversations.merge_reason']);
  const safeLocalMigrationPending = missingLocalColumns.length > 0 && missingLocalColumns.every(value => safelyMigratableColumns.has(value));
  add('local-required-columns', localColumnsComplete, !(options.allowLocalMigration && safeLocalMigrationPending), {
    ...local.requiredColumns,
    migrationAllowedAfterBackup: Boolean(options.allowLocalMigration && safeLocalMigrationPending),
    missingLocalColumns
  }, options.allowLocalMigration && safeLocalMigrationPending ? 'P0_LOCAL_MIGRATION_PENDING_BACKUP' : 'P0_LOCAL_MIGRATION_INCOMPLETE');
  add('critical-empty-catches', sourceAudit.count === 0, true, sourceAudit, 'P0_CRITICAL_EMPTY_CATCH_FOUND');
  add('worker-health', Boolean(worker), true, workerError || { workerBase }, 'P0_WORKER_UNREACHABLE');
  const contractVersion = Number(worker?.avatarProxyContract?.version || 0);
  add('worker-avatar-contract', contractVersion === EXPECTED_WORKER_AVATAR_CONTRACT, true, { expected: EXPECTED_WORKER_AVATAR_CONTRACT, actual: contractVersion, workerBase }, 'P0_WORKER_CONTRACT_MISMATCH');
  const evidenceContractVersion = Number(worker?.avatarProxyContract?.evidenceContractVersion || 0);
  add('worker-avatar-evidence-contract', evidenceContractVersion === EXPECTED_WORKER_EVIDENCE_CONTRACT, true, { expected: EXPECTED_WORKER_EVIDENCE_CONTRACT, actual: evidenceContractVersion, workerBase }, 'P0_WORKER_EVIDENCE_CONTRACT_MISMATCH');
  const deploymentMarker = clean(worker?.avatarProxyContract?.deploymentMarker);
  add('worker-avatar-deployment-marker', deploymentMarker === EXPECTED_WORKER_DEPLOYMENT_MARKER, true, { expected: EXPECTED_WORKER_DEPLOYMENT_MARKER, actual: deploymentMarker, workerBase }, 'P0_WORKER_DEPLOYMENT_MARKER_MISMATCH');
  const d1Version = Number(worker?.d1Schema?.version || 0);
  const latestRequiredMigration = clean(worker?.d1Schema?.latestRequiredMigration);
  const permissionAuthorityColumns = worker?.d1Schema?.permissionAuthorityColumns === true;
  const d1Ready = d1Version === EXPECTED_D1_SCHEMA_VERSION
    && latestRequiredMigration === '0006_permission_authority.sql'
    && permissionAuthorityColumns === true
    && worker?.d1Schema?.ready === true
    && worker?.d1Schema?.pagePictureColumn === true;
  const legacyIndirect = options.allowLegacyHealthz === true && worker?.avatarProxyContract?.persistentPageReference === true;
  const d1Evidence = {
    expected: EXPECTED_D1_SCHEMA_VERSION,
    actual: d1Version || null,
    latestRequiredMigration,
    permissionAuthorityColumns,
    ready: worker?.d1Schema?.ready === true,
    pagePictureColumn: worker?.d1Schema?.pagePictureColumn === true,
    legacyIndirect
  };
  if (d1Ready) add('worker-d1-schema', true, true, d1Evidence, '');
  else if (legacyIndirect) checks.push({
    id: 'worker-d1-schema',
    status: 'warning',
    blocking: false,
    reasonCode: 'P0_D1_SCHEMA_EVIDENCE_LEGACY_INDIRECT',
    evidence: d1Evidence
  });
  else add('worker-d1-schema', false, true, d1Evidence, 'P0_D1_SCHEMA_MISMATCH');
  add('facebook-account-avatar-persistence', local.facebookAccountAvatars.total === 0 || local.facebookAccountAvatars.ready === local.facebookAccountAvatars.total, false, local.facebookAccountAvatars, 'P0_FACEBOOK_ACCOUNT_AVATAR_INCOMPLETE');
  add('facebook-contact-avatar-persistence', local.facebookContactAvatars.total === 0 || (local.facebookContactAvatars.ready === local.facebookContactAvatars.total && local.facebookContactAvatars.missingLocalFiles === 0), false, local.facebookContactAvatars, 'P0_FACEBOOK_CONTACT_AVATAR_INCOMPLETE');

  const blockers = checks.filter(row => row.blocking);
  return {
    schemaVersion: 1,
    kind: 'YANCE_SOURCE_UAT_P0_PREFLIGHT',
    generatedAt: new Date().toISOString(),
    status: blockers.length ? 'blocked' : 'ready',
    expected: { sourceCommit: expectedSource.commit, sourceTree: expectedSource.tree, sourceIdentityAuthority: expectedSource.authority, workerAvatarContract: EXPECTED_WORKER_AVATAR_CONTRACT, workerEvidenceContract: EXPECTED_WORKER_EVIDENCE_CONTRACT, workerDeploymentMarker: EXPECTED_WORKER_DEPLOYMENT_MARKER, d1SchemaVersion: EXPECTED_D1_SCHEMA_VERSION },
    source,
    sourceAudit,
    local,
    worker: worker || workerError,
    checks,
    blockers,
    warning: 'P0 preflight 只验证合同、Schema 与头像持久化条件，不替代真实 Windows 四处 UI 和重启验收。'
  };
}
async function main() {
  const options = parseArgs();
  const report = await runPreflight(options);
  const output = path.resolve(options.output || path.join(process.cwd(), `Yance-P0-Preflight-${report.generatedAt.replace(/[:.]/g, '-')}.json`));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: report.status === 'ready', status: report.status, output, blockers: report.blockers }, null, 2)}\n`);
  if (report.status !== 'ready') process.exitCode = 2;
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'P0_PREFLIGHT_FAILED', message: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
module.exports = {
  runPreflight, localState, gitIdentity, expectedSourceIdentity, readSourceCheckpoint, criticalEmptyCatchAudit,
  deliveryChangedPaths, isMetadataOnlyDeliveryPath, METADATA_ONLY_DELIVERY_PATH_PATTERNS,
  EXPECTED_WORKER_AVATAR_CONTRACT, EXPECTED_WORKER_EVIDENCE_CONTRACT, EXPECTED_WORKER_DEPLOYMENT_MARKER, EXPECTED_D1_SCHEMA_VERSION
};