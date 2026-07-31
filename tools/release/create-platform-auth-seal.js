#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const platformAuthConfig = require('../../backend/services/platformAuthConfig');

const CONFIG_FILE = 'platform-auth.json';
const HASH_FILE = 'platform-auth.sha256';

function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--input') result.input = argv[++index];
    else if (token === '--output-dir') result.outputDir = argv[++index];
    else if (token === '--help' || token === '-h') result.help = true;
    else throw Object.assign(new Error(`未知参数：${token}`), { code: 'PLATFORM_AUTH_SEAL_ARGUMENT_INVALID' });
  }
  return result;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readInput(inputPath) {
  let document;
  try { document = JSON.parse(fs.readFileSync(inputPath, 'utf8')); }
  catch (error) {
    throw Object.assign(new Error(`无法读取平台发行配置：${error.message}`), {
      code: 'PLATFORM_AUTH_SEAL_INPUT_INVALID'
    });
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw Object.assign(new Error('平台发行配置必须是 JSON 对象'), { code: 'PLATFORM_AUTH_SEAL_INPUT_INVALID' });
  }
  return document;
}

function hasConfiguredValue(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some(item => String(item ?? '').trim()));
}

function normalizeDocument(document) {
  const telegramPresent = hasConfiguredValue(document.telegram);
  const facebookPresent = hasConfiguredValue(document.facebook);
  if (!telegramPresent && !facebookPresent) {
    throw Object.assign(new Error('平台发行配置至少必须启用 Telegram 或 Facebook 中的一项'), {
      code: 'PLATFORM_AUTH_NO_PLATFORM_CONFIGURED'
    });
  }
  const telegram = telegramPresent ? platformAuthConfig.normalizeTelegram(document.telegram) : {};
  const facebook = facebookPresent ? platformAuthConfig.normalizeFacebook(document.facebook) : {};
  return {
    schemaVersion: 1,
    releaseManaged: true,
    telegram,
    facebook
  };
}

function writeSeal(inputPath, outputDir) {
  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputDir);
  const normalized = normalizeDocument(readInput(resolvedInput));
  const bytes = Buffer.from(canonicalJson(normalized), 'utf8');
  const digest = sha256(bytes);
  fs.mkdirSync(resolvedOutput, { recursive: true });
  const configPath = path.join(resolvedOutput, CONFIG_FILE);
  const hashPath = path.join(resolvedOutput, HASH_FILE);
  fs.writeFileSync(configPath, bytes, { mode: 0o600 });
  fs.writeFileSync(hashPath, `${digest}  ${CONFIG_FILE}\n`, { mode: 0o600 });
  return {
    status: 'PASS',
    configPath,
    hashPath,
    sha256: digest,
    telegramConfigured: Boolean(normalized.telegram.apiId && normalized.telegram.apiHash),
    facebookConfigured: Boolean(normalized.facebook.workerBaseUrl)
  };
}

function usage() {
  return [
    '用法：',
    '  node tools/release/create-platform-auth-seal.js --input <配置.json> --output-dir <Windows resources 目录>',
    '',
    '说明：',
    '  该工具由发行构建环境使用。普通用户不需要、也不应该填写 API ID、API Hash、Worker 云端同步地址。',
    '  输出 platform-auth.json 与 platform-auth.sha256；两者必须一起放入安装包 resources 目录。'
  ].join('\n');
}

function main() {
  try {
    const args = parseArgs();
    if (args.help) { process.stdout.write(`${usage()}\n`); return; }
    if (!args.input || !args.outputDir) throw Object.assign(new Error('必须提供 --input 和 --output-dir'), { code: 'PLATFORM_AUTH_SEAL_ARGUMENT_REQUIRED' });
    process.stdout.write(`${JSON.stringify(writeSeal(args.input, args.outputDir), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'PLATFORM_AUTH_SEAL_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CONFIG_FILE,
  HASH_FILE,
  canonicalJson,
  normalizeDocument,
  parseArgs,
  readInput,
  sha256,
  writeSeal
};
