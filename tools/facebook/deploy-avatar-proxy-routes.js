#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKER_DIR = path.join(ROOT, 'services', 'facebook-worker');
const WORKER_SOURCE = path.join(WORKER_DIR, 'src', 'index.js');
const WRANGLER_CONFIG = path.join(WORKER_DIR, 'wrangler.jsonc');
const WRANGLER_VERSION = '4.112.0';
const WORKER_NAME = 'yance-facebook-gateway';
const DATABASE_NAME = 'yance-facebook-gateway';
const PRODUCTION_BASE_URL = 'https://yance-facebook-gateway.wangyi198675.workers.dev';
const AVATAR_CONTRACT_VERSION = 11;
const EVIDENCE_CONTRACT_VERSION = 6;
const DEPLOYMENT_MARKER = 'facebook-avatar-translation-persistence-fix13-20260724';

function clean(value) { return value == null ? '' : String(value).trim(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function npxCommand(platform = process.platform) { return platform === 'win32' ? 'npx.cmd' : 'npx'; }
function quoteCmdArg(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function wranglerArgs(...args) { return ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args]; }
function commandInvocation(args, platform = process.platform, env = process.env) {
  const commandArgs = wranglerArgs(...args);
  if (platform !== 'win32') return { command: npxCommand(platform), args: commandArgs };
  const commandLine = [npxCommand(platform), ...commandArgs.map(quoteCmdArg)].join(' ');
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
}
function commandError(label, result) {
  const code = Number.isInteger(result?.status) ? result.status : 1;
  const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
  const error = new Error(`${label}失败（退出代码 ${code}）${output ? `\n${output}` : ''}`);
  error.code = 'FACEBOOK_AVATAR_DEPLOY_COMMAND_FAILED';
  error.exitCode = code;
  return error;
}
function runInherited(label, args) {
  const invocation = commandInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw commandError(label, result);
  return result;
}
function runCapture(label, args) {
  const invocation = commandInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw commandError(label, result);
  return clean(result.stdout);
}
function rowsFromJson(raw) {
  const parsed = JSON.parse(clean(raw));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (Array.isArray(parsed?.databases)) return parsed.databases;
  return parsed && typeof parsed === 'object' ? [parsed] : [];
}
function resolveD1Id(rows) {
  const matches = rows.filter(item => clean(item?.name || item?.database_name) === DATABASE_NAME);
  if (matches.length !== 1) {
    const visible = rows.map(row => clean(row?.name || row?.database_name)).filter(Boolean).join(', ') || '无';
    throw new Error(`必须精确找到一个现有 D1“${DATABASE_NAME}”，实际匹配 ${matches.length} 个。当前可见：${visible}`);
  }
  const id = clean(matches[0]?.uuid || matches[0]?.database_id || matches[0]?.id);
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('现有 D1 ID 格式无效');
  return id;
}
function patchPublicConfig(source, d1Id) {
  let output = String(source || '');
  if (!/"database_id"\s*:/.test(output)) throw new Error('wrangler.jsonc 缺少 database_id');
  if (!/"name"\s*:\s*"yance-facebook-gateway"/.test(output)) throw new Error('Worker 名称不是现有 yance-facebook-gateway，拒绝部署');
  if (!output.includes(PRODUCTION_BASE_URL)) throw new Error('Worker Base URL 与现有生产地址不一致，拒绝部署');
  output = output.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${d1Id}"`);
  return output;
}
function parseArgs(argv = process.argv.slice(2)) {
  const result = { deploy: false, confirmWorker: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--deploy') result.deploy = true;
    else if (argv[index] === '--confirm-worker') result.confirmWorker = clean(argv[++index]);
  }
  return result;
}
function localWorkerContract() {
  if (!fs.existsSync(WORKER_SOURCE)) throw new Error(`缺少 Worker 源码：${WORKER_SOURCE}`);
  const source = fs.readFileSync(WORKER_SOURCE, 'utf8');
  const version = Number(source.match(/avatarProxyContract\s*:\s*\{[\s\S]*?version\s*:\s*(\d+)/u)?.[1] || 0);
  const evidenceContractVersion = Number(source.match(/evidenceContractVersion\s*:\s*(\d+)/u)?.[1] || 0);
  const deploymentMarker = clean(source.match(/deploymentMarker\s*:\s*['"]([^'"]+)['"]/u)?.[1]);
  const pageRoute = source.includes("path === '/api/desktop/avatar/page'");
  const profileRoute = source.includes("path === '/api/desktop/avatar/profile'");
  return {
    version,
    evidenceContractVersion,
    deploymentMarker,
    pageRoute,
    profileRoute,
    sourceSha256: sha256(source),
    expected: {
      version: AVATAR_CONTRACT_VERSION,
      evidenceContractVersion: EVIDENCE_CONTRACT_VERSION,
      deploymentMarker: DEPLOYMENT_MARKER
    },
    matchesExpected: version === AVATAR_CONTRACT_VERSION
      && evidenceContractVersion === EVIDENCE_CONTRACT_VERSION
      && deploymentMarker === DEPLOYMENT_MARKER
      && pageRoute && profileRoute
  };
}
async function probe(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', headers: { accept: 'application/json,image/*' } });
    const contentType = clean(response.headers.get('content-type'));
    let body = null;
    if (contentType.includes('application/json')) body = await response.json().catch(() => null);
    else body = clean(await response.text().catch(() => '')).slice(0, 300);
    return { url, status: response.status, contentType, body };
  } catch (error) {
    return { url, status: 0, contentType: '', body: null, error: error.message };
  }
}
function expectedHealth(health = {}) {
  return health.status === 200
    && health.avatarContractVersion === AVATAR_CONTRACT_VERSION
    && health.evidenceContractVersion === EVIDENCE_CONTRACT_VERSION
    && health.deploymentMarker === DEPLOYMENT_MARKER;
}
async function productionSnapshot() {
  const health = await probe(`${PRODUCTION_BASE_URL}/healthz`);
  const page = await probe(`${PRODUCTION_BASE_URL}/api/desktop/avatar/page`);
  const profile = await probe(`${PRODUCTION_BASE_URL}/api/desktop/avatar/profile?psid=123456`);
  const contract = health.body?.avatarProxyContract || {};
  const snapshot = {
    at: new Date().toISOString(),
    health: {
      status: health.status,
      avatarContractVersion: Number(contract.version || 0),
      evidenceContractVersion: Number(contract.evidenceContractVersion || 0),
      deploymentMarker: clean(contract.deploymentMarker),
      service: clean(health.body?.service),
      graphVersion: clean(health.body?.graphVersion),
      error: clean(health.error)
    },
    page: { status: page.status, routeExists: page.status > 0 && page.status !== 404, code: clean(page.body?.code), error: clean(page.error) },
    profile: { status: profile.status, routeExists: profile.status > 0 && profile.status !== 404, code: clean(profile.body?.code), error: clean(profile.error) }
  };
  snapshot.matchesExpected = expectedHealth(snapshot.health) && snapshot.page.routeExists && snapshot.profile.routeExists;
  return snapshot;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function verifyProduction(attempts = 18, delayMs = 2500) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await productionSnapshot();
    if (last.matchesExpected) return last;
    if (attempt < attempts) {
      process.stdout.write(`生产 Worker 尚未传播 v${AVATAR_CONTRACT_VERSION}/e${EVIDENCE_CONTRACT_VERSION}，${delayMs / 1000} 秒后重试（${attempt}/${attempts}）…\n`);
      await sleep(delayMs);
    }
  }
  const error = new Error(`部署后验证失败：health=${last?.health?.status || 0}/contract=${last?.health?.avatarContractVersion || 0}/evidence=${last?.health?.evidenceContractVersion || 0}/marker=${last?.health?.deploymentMarker || '无'}，page=${last?.page?.status || 0}，profile=${last?.profile?.status || 0}`);
  error.code = 'FACEBOOK_AVATAR_DEPLOY_VERIFY_FAILED';
  error.details = last;
  throw error;
}
function reportPath(mode = 'Preflight') {
  const desktop = path.join(os.homedir(), 'Desktop');
  const base = fs.existsSync(desktop) ? desktop : process.cwd();
  return path.join(base, `Yance-Facebook-Avatar-Worker-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}
function writeReport(output, report) {
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
async function main() {
  const options = parseArgs();
  if (!fs.existsSync(WRANGLER_CONFIG)) throw new Error(`没有找到 Worker 配置：${WRANGLER_CONFIG}`);
  if (options.deploy && options.confirmWorker !== WORKER_NAME) {
    throw new Error(`显式部署必须带 --confirm-worker ${WORKER_NAME}`);
  }
  const report = {
    schemaVersion: 2,
    operation: options.deploy ? 'deploy-existing-facebook-avatar-proxy-routes' : 'preflight-existing-facebook-avatar-proxy-routes',
    workerName: WORKER_NAME,
    productionBaseUrl: PRODUCTION_BASE_URL,
    expectedContract: { version: AVATAR_CONTRACT_VERSION, evidenceContractVersion: EVIDENCE_CONTRACT_VERSION, deploymentMarker: DEPLOYMENT_MARKER },
    startedAt: new Date().toISOString(),
    safety: { readOnlyPreflight: !options.deploy, secretsRead: false, secretsWritten: false, secretsPrinted: false, resourcesCreated: false, migrationsApplied: false, deployed: false },
    local: null,
    before: null,
    after: null,
    status: 'STARTED'
  };
  const output = reportPath(options.deploy ? 'Deploy' : 'Preflight');
  let temporaryConfig = '';
  try {
    process.stdout.write('1/2 校验本地 Worker v11 源码合同…\n');
    report.local = localWorkerContract();
    if (!report.local.matchesExpected) {
      const error = new Error(`本地 Worker 合同不一致：version=${report.local.version}, evidence=${report.local.evidenceContractVersion}, marker=${report.local.deploymentMarker || '无'}`);
      error.code = 'FACEBOOK_AVATAR_LOCAL_CONTRACT_MISMATCH';
      throw error;
    }

    process.stdout.write('2/2 只读检查生产 Worker 当前公开状态…\n');
    report.before = await productionSnapshot();
    process.stdout.write(`线上：health=${report.before.health.status}，contract=${report.before.health.avatarContractVersion}，evidence=${report.before.health.evidenceContractVersion}，page=${report.before.page.status}，profile=${report.before.profile.status}\n`);

    if (!options.deploy) {
      report.status = report.before.health.status !== 200
        ? 'PRODUCTION_HEALTH_UNREACHABLE'
        : (report.before.matchesExpected ? 'ALREADY_DEPLOYED_AND_VERIFIED' : 'DEPLOYMENT_REQUIRED');
      report.completedAt = new Date().toISOString();
      writeReport(output, report);
      if (report.status === 'ALREADY_DEPLOYED_AND_VERIFIED') {
        process.stdout.write('\n[PASS] 生产 Worker 已是准确的 v11/e6 合同，无需部署。\n');
      } else if (report.status === 'PRODUCTION_HEALTH_UNREACHABLE') {
        process.stdout.write('\n[BLOCKED] 无法读取生产 /healthz；未执行部署，也不得据此判断需要部署。\n');
      } else {
        process.stdout.write('\n[SAFE] 只读预检确认线上合同与本地 v11/e6 不一致，未执行部署。\n');
        process.stdout.write('确认报告后，才可双击 DEPLOY_FACEBOOK_AVATAR_PROXY_ROUTES_CONFIRMED.cmd。\n');
      }
      process.stdout.write(`预检报告：${output}\n`);
      return;
    }

    if (report.before.health.status !== 200) {
      const error = new Error('生产 /healthz 不可达，拒绝在无法比较线上合同的情况下部署');
      error.code = 'FACEBOOK_AVATAR_PRODUCTION_HEALTH_UNREACHABLE';
      throw error;
    }
    if (report.before.health.avatarContractVersion > AVATAR_CONTRACT_VERSION) {
      const error = new Error(`线上合同 v${report.before.health.avatarContractVersion} 高于本包 v${AVATAR_CONTRACT_VERSION}，拒绝降级部署`);
      error.code = 'FACEBOOK_AVATAR_DEPLOY_DOWNGRADE_REFUSED';
      throw error;
    }
    if (report.before.matchesExpected) {
      report.after = report.before;
      report.status = 'ALREADY_DEPLOYED_AND_VERIFIED';
      report.completedAt = new Date().toISOString();
      writeReport(output, report);
      process.stdout.write('\n[PASS] 线上合同已经准确，无需重复部署。\n');
      process.stdout.write(`报告：${output}\n`);
      return;
    }

    process.stdout.write('3/8 检查 Cloudflare 登录状态…\n');
    runInherited('Wrangler 登录检查', ['whoami']);

    process.stdout.write('4/8 查询现有 D1，不创建、不删除资源…\n');
    const d1Id = resolveD1Id(rowsFromJson(runCapture('D1 查询', ['d1', 'list', '--json'])));
    report.d1 = { databaseName: DATABASE_NAME, idSuffix: d1Id.slice(-8) };

    process.stdout.write('5/8 生成一次性公开部署配置，不修改源码配置…\n');
    const current = fs.readFileSync(WRANGLER_CONFIG, 'utf8');
    const updated = patchPublicConfig(current, d1Id);
    temporaryConfig = path.join(WORKER_DIR, `wrangler.avatar.deploy.${process.pid}.${Date.now()}.jsonc`);
    fs.writeFileSync(temporaryConfig, updated, 'utf8');
    report.temporaryConfigCreated = path.basename(temporaryConfig);

    process.stdout.write('6/8 检查 Worker 源码语法…\n');
    for (const file of fs.readdirSync(path.join(WORKER_DIR, 'src')).filter(name => name.endsWith('.js')).sort()) {
      const result = spawnSync(process.execPath, ['--check', path.join(WORKER_DIR, 'src', file)], { stdio: 'inherit', windowsHide: true });
      if (result.status !== 0) throw commandError(`源码语法检查 ${file}`, result);
    }

    process.stdout.write('7/8 部署到现有 Worker；不读取或修改 Secret，不创建 D1/R2/Meta App…\n');
    runInherited('Worker 部署', ['deploy', '--config', temporaryConfig]);
    report.safety.deployed = true;

    process.stdout.write('8/8 等待传播并验证 v11/e6/marker 与头像路由…\n');
    report.after = await verifyProduction();
    report.status = 'DEPLOYED_AND_ROUTE_VERIFIED';
    report.completedAt = new Date().toISOString();
    writeReport(output, report);
    process.stdout.write('\n[PASS] 生产 Worker v11 头像代理路由已部署并验证。\n');
    process.stdout.write(`验证：contract=${report.after.health.avatarContractVersion}，evidence=${report.after.health.evidenceContractVersion}，marker=${report.after.health.deploymentMarker}\n`);
    process.stdout.write(`部署报告：${output}\n`);
    process.stdout.write('现在关闭并重新启动言策，在统一账号中心点击“全部同步”，再运行头像专项诊断。\n');
  } catch (error) {
    report.status = 'FAILED';
    report.completedAt = new Date().toISOString();
    report.error = { code: clean(error.code || 'FACEBOOK_AVATAR_DEPLOY_FAILED'), message: error.message, details: error.details || null };
    try { writeReport(output, report); } catch (writeError) { process.stderr.write(`报告写入失败：${writeError.message}\n`); }
    process.stderr.write(`\n操作未完成：${error.message}\n`);
    process.stderr.write(`报告：${output}\n`);
    process.exitCode = 1;
  } finally {
    if (temporaryConfig) {
      try { fs.rmSync(temporaryConfig, { force: true }); }
      catch (cleanupError) { process.stderr.write(`临时配置清理失败：${cleanupError.message}\n`); }
    }
  }
}

if (require.main === module) main();

module.exports = {
  ROOT, WORKER_DIR, WRANGLER_CONFIG, WRANGLER_VERSION, WORKER_NAME, DATABASE_NAME, PRODUCTION_BASE_URL,
  AVATAR_CONTRACT_VERSION, EVIDENCE_CONTRACT_VERSION, DEPLOYMENT_MARKER,
  rowsFromJson, resolveD1Id, patchPublicConfig, parseArgs, localWorkerContract, expectedHealth,
  productionSnapshot, verifyProduction, commandInvocation
};
