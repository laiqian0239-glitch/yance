#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const FORBIDDEN_TYPES = [
  ['secure', 'credential', 'hydrate'].join(':'),
  ['secure', 'credential', 'set'].join(':'),
  ['secure', 'credential', 'delete'].join(':'),
  ['secure', 'credential', 'persist'].join(':'),
  ['secure', 'credential', 'remove'].join(':')
];
const ROOTS = ['electron', 'backend'];

function productionFiles(root) {
  const files = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  };
  for (const relativeRoot of ROOTS) walk(path.join(root, relativeRoot));
  return files.sort();
}

function lineNumber(source, index) { return source.slice(0, index).split('\n').length; }

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function inspectBootFailureSources({ entrySource, channelSource }) {
  const violations = [];
  const entryFailureBlock = functionSlice(
    entrySource,
    'bootDesktopHostedBackend().catch(error => {',
    'module.exports = { bootDesktopHostedBackend }'
  );
  const builder = functionSlice(
    channelSource,
    'function buildBootFailureLifecycleMessage',
    'function sanitizeParentLifecycleMessage'
  );
  const requireRule = (condition, reasonCode, detail) => {
    if (!condition) violations.push({ reasonCode, detail });
  };

  requireRule(
    entryFailureBlock.includes('buildBootFailureLifecycleMessage(error, { pid: process.pid })'),
    'BOOT_FAILURE_BUILDER_BYPASSED',
    'desktopHostedEntry must construct startup-failed IPC only through the audited builder'
  );
  requireRule(
    !/\bmessage\s*:\s*(?:error|cause)(?:\?\.|\.)message\b/.test(entryFailureBlock),
    'BOOT_FAILURE_RAW_MESSAGE_EXPOSED',
    'desktopHostedEntry must not project Error.message into IPC or stderr payloads'
  );
  requireRule(
    !/\bstack\s*:\s*(?:error|cause)(?:\?\.|\.)stack\b/.test(entryFailureBlock),
    'BOOT_FAILURE_RAW_STACK_EXPOSED',
    'desktopHostedEntry must not project a raw stack into IPC or stderr payloads'
  );
  requireRule(
    !/\.\.\.\s*(?:error|cause)\b/.test(entryFailureBlock),
    'BOOT_FAILURE_ERROR_SPREAD',
    'desktopHostedEntry must not spread an Error object into the payload'
  );

  requireRule(builder.length > 0, 'BOOT_FAILURE_BUILDER_MISSING', 'audited boot-failure builder is missing');
  requireRule(
    builder.includes("type: 'backend:startup-failed'")
      && builder.includes('reasonCode,')
      && builder.includes('code: reasonCode')
      && builder.includes("phase: 'early-boot'")
      && builder.includes('message: BOOT_FAILURE_REASON_MESSAGES[reasonCode]')
      && builder.includes('stackHash: bootFailureStackHash(error)')
      && builder.includes('pid'),
    'BOOT_FAILURE_SCHEMA_NOT_FIXED',
    'boot-failure builder must emit only the fixed audited schema'
  );
  requireRule(
    !/\.\.\.\s*(?:error|cause|options|payload)\b/.test(builder),
    'BOOT_FAILURE_DYNAMIC_SPREAD',
    'boot-failure builder must not use object spread from dynamic inputs'
  );
  requireRule(
    !/\bmessage\s*:\s*(?:error|cause)(?:\?\.|\.)message\b/.test(builder),
    'BOOT_FAILURE_RAW_MESSAGE_EXPOSED',
    'boot-failure builder must use fixed safe diagnostic text'
  );
  requireRule(
    !/\bstack\s*:/.test(builder),
    'BOOT_FAILURE_RAW_STACK_EXPOSED',
    'boot-failure builder may emit only stackHash, never stack'
  );
  requireRule(
    !/\b(?:rawError|secret|token|credential|sessionKey|database|entries)\s*:/.test(builder),
    'BOOT_FAILURE_SENSITIVE_FIELD_ADDED',
    'boot-failure builder contains a forbidden sensitive or dynamic field'
  );
  return violations;
}

function inspectServerStartupFailureSources({ serverSource, channelSource }) {
  const violations = [];
  const failureBlock = functionSlice(
    serverSource,
    'function announceStartupFailure',
    'function boundServerPort'
  );
  const builder = functionSlice(
    channelSource,
    'function buildServerStartupFailureLifecycleMessage',
    'function sanitizeParentLifecycleMessage'
  );
  const requireRule = (condition, reasonCode, detail) => {
    if (!condition) violations.push({ reasonCode, detail });
  };

  requireRule(
    failureBlock.includes('buildServerStartupFailureLifecycleMessage(error, {')
      && failureBlock.includes('pid: process.pid')
      && failureBlock.includes('reasonCode: code'),
    'SERVER_STARTUP_FAILURE_BUILDER_BYPASSED',
    'backend/server.js must construct startup-failed IPC only through the audited server-startup builder'
  );
  requireRule(
    failureBlock.includes('sendParentLifecycleMessage(payload);'),
    'SERVER_STARTUP_FAILURE_CHANNEL_BYPASSED',
    'backend/server.js must send startup-failed IPC only through the audited parent lifecycle channel'
  );
  requireRule(
    !failureBlock.includes('sendParentMessage(') && !failureBlock.includes('readinessPayload('),
    'SERVER_STARTUP_FAILURE_GENERIC_IPC_USED',
    'backend/server.js startup-failed path must not reuse the generic ready-message IPC helper or readiness payload'
  );
  requireRule(
    !/\bmessage\s*:\s*(?:error|cause)(?:\?\.|\.)message\b/.test(failureBlock),
    'SERVER_STARTUP_FAILURE_RAW_MESSAGE_EXPOSED',
    'backend/server.js must not project Error.message into IPC, stderr, readiness, or durable boot diagnostics'
  );
  requireRule(
    !/\bstack\s*:\s*(?:error|cause)(?:\?\.|\.)stack\b/.test(failureBlock),
    'SERVER_STARTUP_FAILURE_RAW_STACK_EXPOSED',
    'backend/server.js must not project a raw stack into startup-failed diagnostics'
  );
  requireRule(
    !/\.\.\.\s*(?:error|cause|failure|payload)\b/.test(failureBlock),
    'SERVER_STARTUP_FAILURE_DYNAMIC_SPREAD',
    'backend/server.js startup-failed path must not spread dynamic diagnostic objects'
  );
  requireRule(
    !failureBlock.includes('startupNonce')
      && !failureBlock.includes('credentialMetadata')
      && !failureBlock.includes('readinessPayload('),
    'SERVER_STARTUP_FAILURE_CONTEXT_EXPOSED',
    'backend/server.js startup-failed IPC must not include startup nonce, credential metadata, or readiness context'
  );
  requireRule(
    !/announceStartupFailure\(error,\s*(?:error|cause)(?:\?\.|\.)/.test(serverSource),
    'SERVER_STARTUP_FAILURE_DYNAMIC_REASON',
    'backend/server.js must pass a fixed fallback reason code to the audited builder'
  );
  requireRule(
    !serverSource.includes("sendParentMessage({ type: 'backend:startup-failed'")
      && !serverSource.includes('YANCE_R32_STORE_STARTUP_FAILED'),
    'SERVER_STARTUP_FAILURE_LEGACY_PATH_PRESENT',
    'legacy raw startup-failed IPC or stderr paths must be removed'
  );

  requireRule(builder.length > 0, 'SERVER_STARTUP_FAILURE_BUILDER_MISSING', 'audited server-startup failure builder is missing');
  requireRule(
    builder.includes("type: 'backend:startup-failed'")
      && builder.includes('reasonCode,')
      && builder.includes('code: reasonCode')
      && builder.includes("phase: 'server-startup'")
      && builder.includes('message: SERVER_STARTUP_FAILURE_REASON_MESSAGES[reasonCode]')
      && builder.includes('stackHash: bootFailureStackHash(error)')
      && builder.includes('pid'),
    'SERVER_STARTUP_FAILURE_SCHEMA_NOT_FIXED',
    'server-startup failure builder must emit only the fixed audited schema'
  );
  requireRule(
    !/\.\.\.\s*(?:error|cause|options|payload)\b/.test(builder),
    'SERVER_STARTUP_FAILURE_BUILDER_DYNAMIC_SPREAD',
    'server-startup failure builder must not spread dynamic inputs'
  );
  requireRule(
    !/\bmessage\s*:\s*(?:error|cause)(?:\?\.|\.)message\b/.test(builder),
    'SERVER_STARTUP_FAILURE_RAW_MESSAGE_EXPOSED',
    'server-startup failure builder must use fixed safe diagnostic text'
  );
  requireRule(
    !/\bstack\s*:/.test(builder),
    'SERVER_STARTUP_FAILURE_RAW_STACK_EXPOSED',
    'server-startup failure builder may emit only stackHash, never stack'
  );
  requireRule(
    !/\b(?:rawError|secret|token|credential|sessionKey|database|entries|startupNonce)\s*:/.test(builder),
    'SERVER_STARTUP_FAILURE_SENSITIVE_FIELD_ADDED',
    'server-startup failure builder contains a forbidden sensitive or contextual field'
  );
  return violations;
}

function scanSecretTransports(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const forbidden = [];
  const genericSendSites = [];
  for (const file of productionFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    for (const type of FORBIDDEN_TYPES) {
      const tokens = type.split(':');
      const pattern = new RegExp(tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-zA-Z0-9]{0,48}'), 'gi');
      for (const match of source.matchAll(pattern)) {
        forbidden.push({ file: relative, line: lineNumber(source, match.index), messageType: type, matchedSource: match[0] });
      }
    }
    const sendPattern = /\b(process|child)\.send\s*\(/g;
    for (const match of source.matchAll(sendPattern)) {
      const start = Math.max(0, match.index - 180);
      const end = Math.min(source.length, match.index + 360);
      const context = source.slice(start, end).replace(/\s+/g, ' ').trim();
      const allowed = relative === 'electron/main.js' && context.includes("type: 'desktop:lifecycle'")
        || relative === 'backend/bootstrap/parentLifecycleChannel.js' && context.includes('function sendViaProcess')
        || relative === 'backend/server.js' && (context.includes("type: 'backend:ready'") || context.includes('function sendParentMessage'));
      genericSendSites.push({ file: relative, line: lineNumber(source, match.index), callee: `${match[1]}.send`, allowed, context });
    }
  }
  const entryPath = path.join(root, 'backend', 'desktopHostedEntry.js');
  const channelPath = path.join(root, 'backend', 'bootstrap', 'parentLifecycleChannel.js');
  const bootFailureBuilderViolations = inspectBootFailureSources({
    entrySource: fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '',
    channelSource: fs.existsSync(channelPath) ? fs.readFileSync(channelPath, 'utf8') : ''
  });
  const serverPath = path.join(root, 'backend', 'server.js');
  const serverStartupFailureBuilderViolations = inspectServerStartupFailureSources({
    serverSource: fs.existsSync(serverPath) ? fs.readFileSync(serverPath, 'utf8') : '',
    channelSource: fs.existsSync(channelPath) ? fs.readFileSync(channelPath, 'utf8') : ''
  });
  const unapprovedGenericSendSites = genericSendSites.filter(row => !row.allowed);
  const result = {
    status: forbidden.length === 0
      && unapprovedGenericSendSites.length === 0
      && bootFailureBuilderViolations.length === 0
      && serverStartupFailureBuilderViolations.length === 0
      ? 'PASS'
      : 'FAIL',
    approvedSecretTransports: [
      { id: 'STARTUP_SNAPSHOT_FD5', transport: 'DEDICATED_INHERITED_PIPE_FD5', direction: 'Electron-to-backend', oneTime: true },
      { id: 'RUNTIME_CUSTODY_FD6', transport: 'DEDICATED_INHERITED_PIPE_FD6', direction: 'Bidirectional request-ack', oneTime: false }
    ],
    dedicatedCredentialPipeCount: 2,
    genericNodeIpcSecretTransportCount: forbidden.length,
    forbiddenMessageTypes: FORBIDDEN_TYPES,
    forbiddenOccurrences: forbidden,
    genericSendSites,
    unapprovedGenericSendSites,
    bootFailureBuilderViolations,
    serverStartupFailureBuilderViolations
  };
  return result;
}

if (require.main === module) {
  const result = scanSecretTransports();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'PASS') process.exit(1);
}

module.exports = {
  FORBIDDEN_TYPES,
  inspectBootFailureSources,
  inspectServerStartupFailureSources,
  scanSecretTransports
};
