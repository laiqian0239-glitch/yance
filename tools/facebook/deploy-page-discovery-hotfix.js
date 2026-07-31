#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const formalWorker = require('./verify-formal-worker');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKER_DIR = path.join(ROOT, 'services', 'facebook-worker');
const WRANGLER_CONFIG = path.join(WORKER_DIR, 'wrangler.jsonc');
const WRANGLER_VERSION = '4.112.0';
const DATABASE_NAME = 'yance-facebook-gateway';
const BUSINESS_CONFIG_ID = '4234889550142986';

function npxCommand(platform = process.platform) {
  return platform === 'win32' ? 'npx.cmd' : 'npx';
}

function quoteCmdArg(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function commandInvocation(args, platform = process.platform, env = process.env) {
  const commandArgs = wranglerArgs(...args);
  if (platform !== 'win32') return { command: npxCommand(platform), args: commandArgs };
  // Do not wrap the command name itself in quotes. With cmd.exe /s /c, a
  // command line beginning with "npx.cmd" can be parsed as a quoted string
  // instead of an executable on some Windows/Node combinations. Arguments
  // remain individually quoted.
  const commandLine = [npxCommand(platform), ...commandArgs.map(quoteCmdArg)].join(' ');
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', commandLine] };
}

function wranglerArgs(...args) {
  return ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args];
}

function commandError(label, result) {
  const code = Number.isInteger(result?.status) ? result.status : 1;
  const output = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim();
  const error = new Error(`${label}失败（退出代码 ${code}）${output ? `\n${output}` : ''}`);
  error.code = 'FACEBOOK_WORKER_DEPLOY_COMMAND_FAILED';
  error.exitCode = code;
  return error;
}

function runInherited(label, args, options = {}) {
  const invocation = commandInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, NO_COLOR: '1' },
    ...options
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
  return String(result.stdout || '').trim();
}

function d1RowsFromJson(raw) {
  const parsed = JSON.parse(String(raw || '').trim());
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.result)) return parsed.result;
  if (Array.isArray(parsed?.databases)) return parsed.databases;
  return parsed && typeof parsed === 'object' ? [parsed] : [];
}

function resolveD1Id(rows, databaseName = DATABASE_NAME) {
  const row = rows.find(item => String(item?.name || item?.database_name || '').trim() === databaseName);
  return String(row?.uuid || row?.database_id || row?.id || '').trim();
}

function patchPublicConfig(source, { d1Id, businessConfigId = BUSINESS_CONFIG_ID } = {}) {
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(d1Id || ''))) throw new Error('现有 D1 ID 格式无效');
  if (!/^\d{5,32}$/.test(String(businessConfigId || ''))) throw new Error('Business Login Configuration ID 格式无效');
  let output = String(source || '');
  if (!/"database_id"\s*:/.test(output)) throw new Error('wrangler.jsonc 缺少 database_id');
  if (!/"META_BUSINESS_LOGIN_CONFIG_ID"\s*:/.test(output)) throw new Error('wrangler.jsonc 缺少 META_BUSINESS_LOGIN_CONFIG_ID');
  output = output.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${d1Id}"`);
  output = output.replace(/"META_BUSINESS_LOGIN_CONFIG_ID"\s*:\s*"[^"]*"/, `"META_BUSINESS_LOGIN_CONFIG_ID": "${businessConfigId}"`);
  return output;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function verifyWithRetry(attempts = 12, delayMs = 2500) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await formalWorker.verify(); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) {
        process.stdout.write(`生产 Worker 尚未传播 OAuth 合同 v5，${delayMs / 1000} 秒后重试（${attempt}/${attempts}）…\n`);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

async function main() {
  if (!fs.existsSync(WRANGLER_CONFIG)) throw new Error(`没有找到 Worker 配置：${WRANGLER_CONFIG}`);
  process.stdout.write('1/6 检查 Cloudflare 登录状态…\n');
  runInherited('Wrangler 登录检查', ['whoami']);

  process.stdout.write('2/6 查询现有 D1，不创建新数据库…\n');
  const rows = d1RowsFromJson(runCapture('D1 查询', ['d1', 'list', '--json']));
  const d1Id = resolveD1Id(rows);
  if (!d1Id) {
    const visible = rows.map(row => String(row?.name || row?.database_name || '')).filter(Boolean).join(', ') || '无';
    throw new Error(`当前 Cloudflare 账号没有找到现有 D1：${DATABASE_NAME}。可见数据库：${visible}`);
  }

  process.stdout.write('3/6 更新公开资源 ID 与现有 Configuration ID…\n');
  const current = fs.readFileSync(WRANGLER_CONFIG, 'utf8');
  const updated = patchPublicConfig(current, { d1Id });
  const backup = `${WRANGLER_CONFIG}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(WRANGLER_CONFIG, backup);
  fs.writeFileSync(WRANGLER_CONFIG, updated, 'utf8');
  process.stdout.write(`D1 ID：${d1Id}\nConfiguration ID：${BUSINESS_CONFIG_ID}\n配置备份：${backup}\n`);

  process.stdout.write('4/6 对现有 D1 应用 OAuth 安全诊断 migration…\n');
  runInherited('D1 migration', ['d1', 'migrations', 'apply', DATABASE_NAME, '--remote']);

  process.stdout.write('5/6 部署同一个 Worker（不读取、不修改 Secret）…\n');
  runInherited('Worker 部署', ['deploy']);

  process.stdout.write('6/6 等待并验证生产 OAuth 合同 v5…\n');
  const verified = await verifyWithRetry();
  process.stdout.write(`${JSON.stringify(verified, null, 2)}\n`);
  process.stdout.write('\nFacebook 主页发现热修复已部署。现在启动新源码并重新授权。\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`\n部署未完成：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ROOT, WORKER_DIR, WRANGLER_CONFIG, WRANGLER_VERSION, DATABASE_NAME, BUSINESS_CONFIG_ID,
  npxCommand, quoteCmdArg, commandInvocation, wranglerArgs, d1RowsFromJson, resolveD1Id, patchPublicConfig, verifyWithRetry
};
