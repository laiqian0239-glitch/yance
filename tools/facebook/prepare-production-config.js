#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXPECTED = Object.freeze({
  workerName: 'yance-facebook-gateway',
  workerBaseUrl: 'https://yance-facebook-gateway.wangyi198675.workers.dev',
  callbackPath: '/oauth/facebook/callback',
  webhookPath: '/webhooks/facebook',
  graphVersion: 'v25.0',
  businessLoginConfigurationId: '4234889550142986',
  d1Binding: 'DB',
  d1DatabaseName: 'yance-facebook-gateway',
  r2Binding: 'MEDIA',
  r2BucketName: 'yance-facebook-media'
});
const SECRET_KEY_PATTERN = /(secret|access[_-]?token|verify[_-]?token|app[_-]?secret|private[_-]?key|password)/iu;

function clean(value) { return String(value == null ? '' : value).trim(); }
function stripJsonComments(text) {
  const source = String(text);
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n' || char === '\r') { lineComment = false; output += char; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      else if (char === '\n' || char === '\r') output += char;
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    output += char;
  }
  return output.replace(/,\s*([}\]])/gu, '$1');
}
function readJsonc(filePath) { return JSON.parse(stripJsonComments(fs.readFileSync(filePath, 'utf8'))); }
function safeUrl(base, suffix) { return `${clean(base).replace(/\/+$/u, '')}${suffix}`; }
function check(name, pass, actual, expected, detail = '') { return { name, pass: pass === true, actual, expected, detail }; }
function publicVariables(vars = {}) {
  return Object.fromEntries(Object.entries(vars).filter(([key]) => !SECRET_KEY_PATTERN.test(key)));
}
function parseWranglerRows(stdout) {
  const parsed = JSON.parse(clean(stdout) || '[]');
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.result)) return parsed.result;
  if (Array.isArray(parsed.databases)) return parsed.databases;
  return [];
}
function runWranglerD1List(workerDir, runner = spawnSync) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = runner(executable, ['wrangler', 'd1', 'list', '--json'], { cwd: workerDir, encoding: 'utf8', windowsHide: true, timeout: 30_000, killSignal: 'SIGTERM' });
  if (result.error) throw Object.assign(new Error(`Wrangler D1 查询失败：${result.error.message}`), { code: 'FACEBOOK_WRANGLER_D1_QUERY_FAILED' });
  if (Number(result.status) !== 0) throw Object.assign(new Error(`Wrangler D1 查询失败：${clean(result.stderr) || `退出码 ${result.status}`}`), { code: 'FACEBOOK_WRANGLER_D1_QUERY_FAILED' });
  return parseWranglerRows(result.stdout);
}
function resolveD1Id(rows, databaseName = EXPECTED.d1DatabaseName) {
  const row = rows.find(item => clean(item.name || item.database_name) === databaseName);
  return clean(row?.uuid || row?.id || row?.database_id);
}
function buildPreflight(config, options = {}) {
  const vars = config.vars || {};
  const d1 = Array.isArray(config.d1_databases) ? config.d1_databases.find(row => clean(row.binding) === EXPECTED.d1Binding) : null;
  const r2 = Array.isArray(config.r2_buckets) ? config.r2_buckets.find(row => clean(row.binding) === EXPECTED.r2Binding) : null;
  const resolvedD1Id = clean(options.resolvedD1Id);
  const configuredD1Id = clean(d1?.database_id);
  const deploymentD1Id = resolvedD1Id || (configuredD1Id && !/^REPLACE_/u.test(configuredD1Id) ? configuredD1Id : '');
  const workerBaseUrl = clean(vars.WORKER_BASE_URL);
  const checks = [
    check('Worker 名称', clean(config.name) === EXPECTED.workerName, clean(config.name), EXPECTED.workerName),
    check('Worker URL', workerBaseUrl === EXPECTED.workerBaseUrl, workerBaseUrl, EXPECTED.workerBaseUrl),
    check('OAuth Callback', safeUrl(workerBaseUrl, EXPECTED.callbackPath) === safeUrl(EXPECTED.workerBaseUrl, EXPECTED.callbackPath), safeUrl(workerBaseUrl, EXPECTED.callbackPath), safeUrl(EXPECTED.workerBaseUrl, EXPECTED.callbackPath)),
    check('Facebook Webhook', safeUrl(workerBaseUrl, EXPECTED.webhookPath) === safeUrl(EXPECTED.workerBaseUrl, EXPECTED.webhookPath), safeUrl(workerBaseUrl, EXPECTED.webhookPath), safeUrl(EXPECTED.workerBaseUrl, EXPECTED.webhookPath)),
    check('Graph Version', clean(vars.FACEBOOK_GRAPH_VERSION) === EXPECTED.graphVersion, clean(vars.FACEBOOK_GRAPH_VERSION), EXPECTED.graphVersion),
    check('Business Login Configuration ID', clean(vars.META_BUSINESS_LOGIN_CONFIG_ID) === EXPECTED.businessLoginConfigurationId, clean(vars.META_BUSINESS_LOGIN_CONFIG_ID), EXPECTED.businessLoginConfigurationId),
    check('D1 Binding', Boolean(d1) && clean(d1.binding) === EXPECTED.d1Binding, clean(d1?.binding), EXPECTED.d1Binding),
    check('D1 Database Name', clean(d1?.database_name) === EXPECTED.d1DatabaseName, clean(d1?.database_name), EXPECTED.d1DatabaseName),
    check('D1 Database ID', Boolean(deploymentD1Id), deploymentD1Id || '未解析', '从已登录 Wrangler 查询真实 D1 ID', resolvedD1Id ? '来自 wrangler d1 list --json' : '未使用 Wrangler 实际查询或配置仍为占位符'),
    check('R2 Binding', Boolean(r2) && clean(r2.binding) === EXPECTED.r2Binding, clean(r2?.binding), EXPECTED.r2Binding),
    check('R2 Bucket Name', clean(r2?.bucket_name) === EXPECTED.r2BucketName, clean(r2?.bucket_name), EXPECTED.r2BucketName)
  ];
  const publicConfig = {
    name: EXPECTED.workerName,
    main: clean(config.main),
    compatibility_date: clean(config.compatibility_date),
    workers_dev: config.workers_dev !== false,
    observability: config.observability || {},
    vars: publicVariables(vars),
    d1_databases: [{ binding: EXPECTED.d1Binding, database_name: EXPECTED.d1DatabaseName, database_id: deploymentD1Id || 'UNRESOLVED_D1_DATABASE_ID', migrations_dir: clean(d1?.migrations_dir || 'migrations') }],
    r2_buckets: [{ binding: EXPECTED.r2Binding, bucket_name: EXPECTED.r2BucketName }],
    triggers: config.triggers || {}
  };
  const failed = checks.filter(row => !row.pass);
  return {
    schemaVersion: 1,
    documentType: 'YANCE_FACEBOOK_PRODUCTION_PUBLIC_PREFLIGHT',
    createdAtUtc: new Date().toISOString(),
    status: failed.length ? 'INCOMPLETE' : 'READY_FOR_SECRET_CONFIGURATION_AND_DEPLOYMENT',
    checks,
    counts: { passed: checks.length - failed.length, failed: failed.length, total: checks.length },
    endpoints: { workerBaseUrl: EXPECTED.workerBaseUrl, oauthCallbackUrl: safeUrl(EXPECTED.workerBaseUrl, EXPECTED.callbackPath), webhookUrl: safeUrl(EXPECTED.workerBaseUrl, EXPECTED.webhookPath), healthUrl: safeUrl(EXPECTED.workerBaseUrl, '/healthz') },
    capabilities: { newMessagingReadyAfterOAuth: true, historySyncRequiresPagesReadEngagement: true, historySyncAuthorized: false, historySyncReason: 'pages_read_engagement 必须在真实 OAuth 后按实际授权结果判断；预检不会冒充已授权。' },
    safety: { secretsRead: false, secretsWritten: false, secretsPrinted: false, deployed: false, resourcesCreated: false, wranglerD1Queried: Boolean(options.wranglerD1Queried) },
    publicDeploymentConfig: publicConfig
  };
}
function writeOutputs(report, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const configPath = path.join(outputDir, 'facebook-production-public-config.json');
  const reportPath = path.join(outputDir, 'facebook-production-preflight.json');
  fs.writeFileSync(configPath, `${JSON.stringify(report.publicDeploymentConfig, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify({ ...report, publicDeploymentConfig: undefined }, null, 2)}\n`);
  return { configPath, reportPath };
}
function parseArgs(argv) {
  const options = { resolveD1: false, outputDir: '', configPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--resolve-d1') options.resolveD1 = true;
    else if (arg === '--output-dir') options.outputDir = argv[++index] || '';
    else if (arg === '--config') options.configPath = argv[++index] || '';
  }
  return options;
}
function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '../..');
  const workerDir = path.join(root, 'services/facebook-worker');
  const args = parseArgs(argv);
  const configPath = path.resolve(args.configPath || path.join(workerDir, 'wrangler.jsonc'));
  const outputDir = path.resolve(args.outputDir || path.join(root, 'artifacts/facebook-production-preflight'));
  const config = readJsonc(configPath);
  let resolvedD1Id = '';
  if (args.resolveD1) resolvedD1Id = resolveD1Id(runWranglerD1List(workerDir));
  const report = buildPreflight(config, { resolvedD1Id, wranglerD1Queried: args.resolveD1 });
  const paths = writeOutputs(report, outputDir);
  process.stdout.write(`${JSON.stringify({ status: report.status, counts: report.counts, ...paths, safety: report.safety }, null, 2)}\n`);
  if (report.counts.failed) process.exitCode = 2;
  return { report, paths };
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'BLOCKED', code: error.code || 'FACEBOOK_PRODUCTION_PREFLIGHT_FAILED', message: error.message, safety: { secretsRead: false, secretsWritten: false, secretsPrinted: false, deployed: false, resourcesCreated: false } }, null, 2)}\n`);
    process.exitCode = 3;
  }
}
module.exports = { EXPECTED, SECRET_KEY_PATTERN, stripJsonComments, readJsonc, publicVariables, parseWranglerRows, runWranglerD1List, resolveD1Id, buildPreflight, writeOutputs, parseArgs, main };
