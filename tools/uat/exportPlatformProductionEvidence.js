'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

function clean(value, max = 1000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function hash(value) {
  return crypto.createHash('sha256').update(clean(value, 4000)).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requestJson(url, timeoutMs = 15000, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.get(target, { timeout: timeoutMs, headers: { accept: 'application/json' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          if (options.allowHttpError === true) {
            try { return resolve({ ...JSON.parse(text), httpStatus: response.statusCode }); }
            catch (_) { return resolve({ ok: false, httpStatus: response.statusCode, error: text.slice(0, 300) }); }
          }
          return reject(Object.assign(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 300)}`), { code: 'PLATFORM_EVIDENCE_HTTP_FAILED', statusCode: response.statusCode }));
        }
        try { resolve(JSON.parse(text)); }
        catch (error) { reject(Object.assign(new Error(`Invalid JSON from ${target.pathname}: ${error.message}`), { code: 'PLATFORM_EVIDENCE_JSON_INVALID' })); }
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error(`Request timed out: ${target.pathname}`), { code: 'PLATFORM_EVIDENCE_TIMEOUT' })));
    request.on('error', reject);
  });
}

function sanitizeCheck(check = {}) {
  return {
    id: clean(check.id, 120),
    label: clean(check.label, 200),
    status: clean(check.status, 80),
    detail: clean(check.detail, 1200),
    evidence: sanitizeEvidence(check.evidence || {})
  };
}

function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? clean(value, 1200) : value;
  const output = {};
  const preservedHashKeys = new Set();
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (!/hashsha256$/u.test(normalized)) continue;
    output[key] = /^[a-f0-9]{64}$/iu.test(clean(item, 128)) ? clean(item, 64).toLowerCase() : '';
    preservedHashKeys.add(normalized);
  }
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (/hashsha256$/u.test(normalized)) continue;
    if (/(token|secret|cookie|password|credential|authorization|qr|sessiondata)/u.test(normalized)) continue;
    if (/(accountid|peerid|contactid|conversationid|userid|personid|identitylinkid|messageid|eventid|auditid|promotionid|profilecontactid|externalid|phone|username|displayname)/u.test(normalized)) {
      const targetKey = `${key}HashSha256`;
      if (!preservedHashKeys.has(targetKey.toLowerCase())) output[targetKey] = item ? hash(item) : '';
      continue;
    }
    output[key] = sanitizeEvidence(item);
  }
  return output;
}

function sanitizeReadiness(readiness = {}) {
  const platforms = {};
  for (const [platform, projection] of Object.entries(readiness.platforms || {})) {
    platforms[platform] = {
      platform: clean(projection.platform || platform, 40),
      status: clean(projection.status, 80),
      counts: projection.counts || {},
      realUatCompleted: projection.realUatCompleted === true,
      accounts: (projection.accounts || []).map(account => ({
        accountIdHashSha256: account.accountId ? hash(account.accountId) : '',
        displayNameHashSha256: account.displayName ? hash(account.displayName) : '',
        platform: clean(account.platform, 40),
        state: clean(account.state, 80),
        status: clean(account.status, 80),
        counts: account.counts || {},
        checks: (account.checks || []).map(sanitizeCheck)
      }))
    };
  }
  return {
    schemaVersion: Number(readiness.schemaVersion || 1),
    documentType: 'YANCE_SAFE_PLATFORM_PRODUCTION_READINESS',
    generatedAt: clean(readiness.generatedAt, 80),
    platforms,
    summary: readiness.summary || {}
  };
}

function sanitizeHealth(health = {}) {
  const product = health.product || {};
  return {
    schemaVersion: 1,
    documentType: 'YANCE_SAFE_RUNTIME_HEALTH',
    ok: health.ok === true,
    product: {
      name: clean(product.name, 120),
      version: clean(product.version, 80),
      publicVersion: clean(product.publicVersion, 80),
      buildId: clean(product.buildId || product.build, 240),
      sourceCommit: clean(product.sourceCommit || product.gitCommit, 40).toLowerCase(),
      sourceTree: clean(product.sourceTree, 40).toLowerCase(),
      artifactClass: clean(product.artifactClass, 160),
      releaseManifestSha256: clean(product.releaseManifestSha256, 64).toLowerCase(),
      port: Number(product.port || 0)
    },
    pid: Number(health.pid || 0),
    uptimeSeconds: Number(health.uptimeSeconds || 0),
    at: clean(health.at, 80),
    architectureGovernance: sanitizeEvidence(health.architectureGovernance || {})
  };
}


async function collectRuntimeEvidence(baseUrl, timeoutMs) {
  const limit = 500; let offset = 0; let first = null; const queue = [], outbox = []; let truncated = false; let last = null;
  for (let page = 0; page < 100; page += 1) {
    const row = await requestJson(`${baseUrl}/api/r32/system/architecture/runtime-evidence?limit=${limit}&offset=${offset}`, timeoutMs);
    const evidence = row.evidence || row;
    if (!first) first = evidence;
    last = evidence;
    queue.push(...(evidence.queue || [])); outbox.push(...(evidence.outbox || []));
    const anyMore = evidence.pagination?.queueHasMore || evidence.pagination?.outboxHasMore;
    if (!anyMore) break;
    const pageRows = Math.max((evidence.queue || []).length, (evidence.outbox || []).length);
    if (!pageRows) { truncated = true; break; }
    offset += pageRows;
    if (page === 99) truncated = true;
  }
  const queueTotal = Number(first?.pagination?.queueTotal ?? first?.counts?.queueTotal ?? queue.length);
  const outboxTotal = Number(first?.pagination?.outboxTotal ?? first?.counts?.outboxTotal ?? outbox.length);
  const hasMore = last?.pagination?.queueHasMore || last?.pagination?.outboxHasMore;
  const routeRows = [...queue.map(row => row.route), ...outbox.map(row => row.route)].filter(row => row?.receiptHash || row?.modelId || row?.task);
  const activeStates = new Set(['pending','queued','retry','sending','platform_accepted_local_pending','send_outcome_unknown']);
  const commandFailures = queue.filter(row => row?.integrity?.command?.verified === false).length;
  const routeFailures = [...queue, ...outbox].filter(row => row?.integrity?.route?.present === true && row?.integrity?.route?.verified === false).length;
  const releaseBlocking = queue.filter(row => activeStates.has(String(row?.state || '').trim())
    && (row?.integrity?.command?.verified === false || (row?.integrity?.route?.present === true && row?.integrity?.route?.verified === false))).length;
  return { ...(first || {}),
    counts: { ...(first?.counts || {}), queue: queue.length, outbox: outbox.length, routeReceipts: routeRows.length, queueTotal, outboxTotal },
    qualityRouteSummary: {
      highCapability: routeRows.filter(row => row.highCapabilityPath && !row.emergencyMode).length,
      fallback: routeRows.filter(row => row.fallbackUsed && !row.emergencyMode).length,
      emergency: routeRows.filter(row => row.emergencyMode).length,
      learningIneligible: routeRows.filter(row => row.learningEligible === false).length
    },
    integritySummary: { commandFailures, routeFailures, releaseBlocking },
    pagination: { ...(first?.pagination || {}), offset: 0, queueExported: queue.length, outboxExported: outbox.length, allPagesExported: !truncated && !hasMore && queue.length === queueTotal && outbox.length === outboxTotal, truncated, nextOffset: hasMore ? offset : null },
    queue, outbox
  };
}

async function collectProjectionGovernance(baseUrl, timeoutMs) {
  const limit = 500; let offset = 0; let first = null; const items = []; let hasMore = false; let truncated = false;
  for (let page = 0; page < 100; page += 1) {
    const row = await requestJson(`${baseUrl}/api/r32/store/event-projection/governance?limit=${limit}&offset=${offset}`, timeoutMs);
    if (!first) first = row;
    items.push(...(row.items || []));
    hasMore = row.hasMore === true;
    if (!hasMore || !(row.items || []).length) break;
    offset += row.items.length;
    if (page === 99) truncated = true;
  }
  const total = Number(first?.totalBlocking || 0);
  return { ...(first || {}), items, exportedBlockingItems: items.length, allBlockingPagesExported: !truncated && !hasMore && total === items.length, truncated, nextOffset: hasMore ? offset : null };
}
async function collectIdentityGovernance(baseUrl, timeoutMs) {
  const limit = 500; let offset = 0; let first = null; const items = []; let hasMore = false; let truncated = false;
  for (let page = 0; page < 100; page += 1) {
    const row = await requestJson(`${baseUrl}/api/r32/store/identity-governance?limit=${limit}&offset=${offset}`, timeoutMs);
    const governance = row.governance || {};
    if (!first) first = governance;
    items.push(...(governance.items || []));
    hasMore = governance.pagination?.hasMore === true;
    if (!hasMore || !(governance.items || []).length) break;
    offset += governance.items.length;
    if (page === 99) truncated = true;
  }
  return { ok: true, governance: { ...(first || {}), items, pagination: { ...(first?.pagination || {}), offset: 0, exported: items.length, allPagesExported: !truncated && !hasMore, truncated, nextOffset: hasMore ? offset : null } } };
}
async function collectLearningGovernance(baseUrl, timeoutMs) {
  const proposalLimit = 200; const profileLimit = 300; const auditLimit = 300;
  let proposalOffset = 0, profileOffset = 0, auditOffset = 0, first = null;
  let proposalDone = false, profileDone = false, auditDone = false;
  const proposals = [], activeProfiles = [], recentAudits = []; let truncated = false; let stalled = false;
  for (let page = 0; page < 100; page += 1) {
    const row = await requestJson(`${baseUrl}/api/r32/store/learning-governance/automatic-synthesis/overview?limit=${proposalLimit}&offset=${proposalOffset}&profileLimit=${profileLimit}&profileOffset=${profileOffset}&auditLimit=${auditLimit}&auditOffset=${auditOffset}`, timeoutMs);
    if (!first) first = row;
    const pageInfo = row.pagination || {};
    if (!proposalDone) {
      const rows = row.proposals || []; proposals.push(...rows);
      if (pageInfo.proposalHasMore) { if (!rows.length) stalled = true; else proposalOffset += rows.length; }
      else proposalDone = true;
    }
    if (!profileDone) {
      const rows = row.activeProfiles || []; activeProfiles.push(...rows);
      if (pageInfo.profileHasMore) { if (!rows.length) stalled = true; else profileOffset += rows.length; }
      else profileDone = true;
    }
    if (!auditDone) {
      const rows = row.recentAudits || []; recentAudits.push(...rows);
      if (pageInfo.auditHasMore) { if (!rows.length) stalled = true; else auditOffset += rows.length; }
      else auditDone = true;
    }
    if (proposalDone && profileDone && auditDone) break;
    if (stalled) { truncated = true; break; }
    if (page === 99) truncated = true;
  }
  const hasMore = !(proposalDone && profileDone && auditDone);
  return { ...(first || {}), proposals, activeProfiles, recentAudits, pagination: {
    proposalOffset: 0, proposalExported: proposals.length, profileOffset: 0, profileExported: activeProfiles.length, auditOffset: 0, auditExported: recentAudits.length,
    allPagesExported: !truncated && !hasMore, truncated, stalled, nextOffsets: hasMore ? { proposalOffset, profileOffset, auditOffset } : null
  } };
}
async function exportPlatformEvidence(options = {}) {
  const baseUrl = clean(options.baseUrl || 'http://127.0.0.1:27632', 500).replace(/\/$/u, '');
  const outputRoot = path.resolve(options.outputRoot || path.join(process.cwd(), '.tmp', 'platform-production-evidence'));
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  const timeoutMs = Number(options.timeoutMs || 15000);
  const [healthRaw, readinessRaw, architectureRaw, releaseGateRaw, runtimeEvidenceRaw, capabilitiesRaw, projectionRaw, learningRaw, identityRaw] = await Promise.all([
    requestJson(`${baseUrl}/api/r32/system/health`, timeoutMs),
    requestJson(`${baseUrl}/api/r32/system/platform-readiness`, timeoutMs),
    requestJson(`${baseUrl}/api/r32/system/architecture/round12`, timeoutMs),
    requestJson(`${baseUrl}/api/r32/system/architecture/release-gate`, timeoutMs, { allowHttpError: true }),
    collectRuntimeEvidence(baseUrl, timeoutMs),
    requestJson(`${baseUrl}/api/r32/system/platform-capabilities`, timeoutMs),
    collectProjectionGovernance(baseUrl, timeoutMs),
    collectLearningGovernance(baseUrl, timeoutMs),
    collectIdentityGovernance(baseUrl, timeoutMs)
  ]);
  const health = sanitizeHealth(healthRaw);
  const readiness = sanitizeReadiness(readinessRaw.readiness || readinessRaw);
  const architecture = sanitizeEvidence(architectureRaw.architecture || architectureRaw);
  const releaseGate = sanitizeEvidence(releaseGateRaw);
  const runtimeEvidence = sanitizeEvidence(runtimeEvidenceRaw);
  const capabilities = sanitizeEvidence(capabilitiesRaw.capabilities || capabilitiesRaw);
  const projection = sanitizeEvidence(projectionRaw);
  const learning = sanitizeEvidence(learningRaw);
  const identity = sanitizeEvidence(identityRaw);
  writeJson(path.join(outputRoot, 'runtime-health.json'), health);
  writeJson(path.join(outputRoot, 'platform-production-readiness.json'), readiness);
  writeJson(path.join(outputRoot, 'architecture-runtime-governance.json'), architecture);
  writeJson(path.join(outputRoot, 'architecture-release-gate.json'), releaseGate);
  writeJson(path.join(outputRoot, 'ai-route-outbox-runtime-evidence.json'), runtimeEvidence);
  writeJson(path.join(outputRoot, 'platform-capabilities.json'), capabilities);
  writeJson(path.join(outputRoot, 'event-projection-governance.json'), projection);
  writeJson(path.join(outputRoot, 'learning-governance.json'), learning);
  writeJson(path.join(outputRoot, 'identity-governance.json'), identity);

  const platformRows = Object.values(readiness.platforms || {});
  const governanceEvidenceComplete = projectionRaw.allBlockingPagesExported === true
    && identityRaw.governance?.pagination?.allPagesExported === true
    && learningRaw.pagination?.allPagesExported === true
    && runtimeEvidenceRaw.pagination?.allPagesExported === true
    && Number(runtimeEvidenceRaw.integritySummary?.releaseBlocking || 0) === 0;
  const evidenceTruncation = {
    projection: projectionRaw.truncated === true,
    identity: identityRaw.governance?.pagination?.truncated === true,
    learning: learningRaw.pagination?.truncated === true,
    runtimeEvidence: runtimeEvidenceRaw.pagination?.truncated === true
  };
  const report = {
    schemaVersion: 1,
    documentType: 'YANCE_PLATFORM_PRODUCTION_EVIDENCE_SUMMARY',
    generatedAtUtc: new Date().toISOString(),
    runtimeBuildId: health.product.buildId,
    runtimeSourceCommit: health.product.sourceCommit,
    runtimeSourceTree: health.product.sourceTree,
    runtimeArtifactClass: health.product.artifactClass,
    runtimeManifestSha256: health.product.releaseManifestSha256,
    configuredPlatforms: Number(readiness.summary?.configuredPlatforms || 0),
    blockedPlatforms: platformRows.filter(row => row.status === 'blocked').map(row => row.platform),
    degradedPlatforms: platformRows.filter(row => row.status === 'degraded').map(row => row.platform),
    readyForRealUatPlatforms: platformRows.filter(row => row.status === 'ready-for-real-uat').map(row => row.platform),
    architectureReleaseBlocked: releaseGateRaw.ready !== true || health.architectureGovernance?.releaseBlocked === true || !governanceEvidenceComplete,
    architectureReleaseGateHttpStatus: Number(releaseGateRaw.httpStatus || 200),
    eventProjectionBlocking: Number(projectionRaw.totalBlocking || projectionRaw.status?.convergence?.blocking || 0),
    eventProjectionConverged: Boolean(projectionRaw.status?.converged || projectionRaw.status?.convergence?.converged),
    learningSchedulerStarted: learningRaw.status?.started === true,
    learningLastRunOk: learningRaw.status?.lastRun ? learningRaw.status.lastRun.ok !== false : null,
    pendingL3Proposals: Array.isArray(learningRaw.proposals) ? learningRaw.proposals.length : 0,
    identityPersonCountExported: Array.isArray(identityRaw.governance?.items) ? identityRaw.governance.items.length : 0,
    identityAuditCountExported: Array.isArray(identityRaw.governance?.items) ? identityRaw.governance.items.reduce((sum,row)=>sum+Number(row.audits?.length||0),0) : 0,
    aiQualityRouteReceiptsExported: Number(runtimeEvidenceRaw.counts?.routeReceipts || 0),
    outboxCommandsExported: Number(runtimeEvidenceRaw.counts?.queue || 0),
    governanceEvidenceComplete,
    evidenceTruncation,
    runtimeEvidenceIntegrity: runtimeEvidenceRaw.integritySummary || {},
    evidencePromotionAllowed: governanceEvidenceComplete && releaseGateRaw.ready === true && health.architectureGovernance?.releaseBlocked !== true,
    realUatCompleted: false,
    secretValuesExported: false,
    note: '该证据只证明运行状态和自动门禁；真实消息、媒体、登录、断网与Echo仍需人工操作和平台侧证据。'
  };
  writeJson(path.join(outputRoot, 'evidence-summary.json'), report);

  const names = fs.readdirSync(outputRoot).filter(name => fs.statSync(path.join(outputRoot, name)).isFile()).sort();
  const manifest = {
    schemaVersion: 1,
    documentType: 'YANCE_PLATFORM_PRODUCTION_EVIDENCE_MANIFEST',
    generatedAtUtc: new Date().toISOString(),
    baseUrlIncluded: false,
    accountIdentifiersHashed: true,
    secretsExcluded: true,
    files: names.map(name => ({ name, sizeBytes: fs.statSync(path.join(outputRoot, name)).size, sha256: sha256File(path.join(outputRoot, name)) }))
  };
  writeJson(path.join(outputRoot, 'manifest.json'), manifest);
  return { outputRoot, health, readiness, architecture, releaseGate, runtimeEvidence, capabilities, projection, learning, identity, report, manifest };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') options.baseUrl = argv[++index];
    else if (argv[index] === '--output') options.outputRoot = argv[++index];
    else if (argv[index] === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
  }
  return options;
}

async function main() {
  try {
    const result = await exportPlatformEvidence(parseArgs());
    process.stdout.write(`${JSON.stringify({ ok: true, outputRoot: result.outputRoot, summary: result.report }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'PLATFORM_EVIDENCE_EXPORT_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { exportPlatformEvidence, sanitizeReadiness, sanitizeHealth, sanitizeEvidence, requestJson, collectRuntimeEvidence, collectProjectionGovernance, collectIdentityGovernance, collectLearningGovernance };
