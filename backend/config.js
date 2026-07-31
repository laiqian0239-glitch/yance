'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PRODUCT } = require('../shared/constants');

function resolveDataRoot() {
  const explicit = process.env.YANCE_DATA_DIR || process.env.WORKBUDDY_DATA_DIR;
  if (explicit) return path.resolve(explicit);
  const nodeTestContext = String(process.env.NODE_TEST_CONTEXT || '').trim();
  if (nodeTestContext || process.env.NODE_ENV === 'test') {
    const testIdentity = [process.pid, process.argv[1] || '', nodeTestContext || 'node-test'].join('|');
    const digest = crypto.createHash('sha256').update(testIdentity).digest('hex').slice(0, 16);
    const isolated = path.join(os.tmpdir(), 'yance-node-tests', `${process.pid}-${digest}`);
    process.env.YANCE_DATA_DIR = isolated;
    return isolated;
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Yance');
  }
  return path.join(os.homedir(), '.yance');
}

const DATA_ROOT = resolveDataRoot();
const STORE_ROOT = path.join(DATA_ROOT, 'store');
const PATHS = Object.freeze({
  root: DATA_ROOT,
  db: STORE_ROOT,
  sqlite: path.join(STORE_ROOT, 'yance-r32.db'),
  legacyJson: path.join(DATA_ROOT, 'legacy-json'),
  media: path.join(DATA_ROOT, 'media'),
  whatsappAuth: path.join(DATA_ROOT, 'whatsapp-auth'),
  baileysAuthLegacy: path.join(DATA_ROOT, 'baileys-auth'),
  backups: path.join(DATA_ROOT, 'backups'),
  portableBackups: path.join(DATA_ROOT, 'portable-backups'),
  logs: path.join(DATA_ROOT, 'logs'),
  tmp: path.join(DATA_ROOT, 'tmp'),
  cache: path.join(DATA_ROOT, 'cache'),
  models: path.join(DATA_ROOT, 'models'),
  secure: path.join(DATA_ROOT, 'secure'),
  aiAssets: path.join(DATA_ROOT, 'ai-assets'),
  notificationSounds: path.join(DATA_ROOT, 'notification-sounds')
});

const DIRECTORY_PATHS = Object.freeze([
  PATHS.root,
  PATHS.db,
  PATHS.legacyJson,
  PATHS.media,
  PATHS.whatsappAuth,
  PATHS.backups,
  PATHS.portableBackups,
  PATHS.logs,
  PATHS.tmp,
  PATHS.cache,
  PATHS.models,
  PATHS.secure,
  PATHS.aiAssets,
  PATHS.notificationSounds
]);

function ensureDirectories() {
  DIRECTORY_PATHS.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
}

function resolvePort() {
  const configured = process.env.YANCE_PORT;
  if (configured == null || configured === '') return PRODUCT.port;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    const error = new Error(`Invalid YANCE_PORT: ${configured}`);
    error.code = 'YANCE_PORT_INVALID';
    throw error;
  }
  return port;
}

const CONFIG = Object.freeze({
  product: PRODUCT,
  host: process.env.YANCE_HOST || '127.0.0.1',
  port: resolvePort(),
  ollamaHosts: Array.from(new Set([
    process.env.OLLAMA_HOST,
    'http://127.0.0.1:11434',
    'http://localhost:11434'
  ].filter(Boolean).map(value => String(value).replace(/\/$/, '').replace(/\/(?:v1|api)$/i, '')))),
  modelTimeoutMs: Math.max(180000, Number(process.env.YANCE_MODEL_TIMEOUT_MS || 180000)),
  mediaMaxBytes: Math.max(1024 * 1024, Number(process.env.YANCE_MEDIA_MAX_BYTES || 64 * 1024 * 1024)),
  notificationPrivacy: process.env.YANCE_NOTIFICATION_PRIVACY || 'preview',
  paths: PATHS
});

module.exports = { CONFIG, PATHS, ensureDirectories, resolveDataRoot, resolvePort };
