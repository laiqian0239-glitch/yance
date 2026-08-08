'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHANNELS = [
  'desktop:letta-get-state',
  'desktop:letta-list-agents',
  'desktop:letta-list-conversations'
];

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Letta workspace file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('all Letta renderer access stays on the existing guarded desktop IPC boundary', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = readJson('electron/m2/ipcManifest.json');
  const manifestChannels = new Set(manifest.handlers.map(handler => handler.channel));

  assert.equal(main.includes("require('./lettaAgentRuntime')") || main.includes('require("./lettaAgentRuntime")'), true, 'main process must load the Letta runtime adapter');
  for (const channel of CHANNELS) {
    assert.equal(main.includes(`ipcGuardHandle('${channel}'`) || main.includes(`ipcGuardHandle("${channel}"`), true, `main process must guard ${channel}`);
    assert.equal(manifestChannels.has(channel), true, `IPC manifest must declare ${channel}`);
  }
  assert.equal(preload.includes("getLettaState: () => ipcRenderer.invoke('desktop:letta-get-state')"), true);
  assert.equal(preload.includes("listLettaAgents: () => ipcRenderer.invoke('desktop:letta-list-agents')"), true);
  assert.equal(preload.includes("listLettaConversations: input => ipcRenderer.invoke('desktop:letta-list-conversations'"), true);
  assert.doesNotMatch(preload, /child_process|\bspawn\b|@letta-ai/u);
});

test('Letta lifecycle stays main-process-owned and is not exposed as renderer process control', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const runtime = readText('electron/lettaAgentRuntime.js');
  assert.match(main, /createLettaAgentRuntime/u);
  assert.match(main, /ensureLettaAgentRuntime\(\)\.start\(\)/u, 'Electron main must explicitly start the Letta runtime it owns');
  assert.match(main, /lettaAgentRuntime\.stop\(\)/u, 'Electron main must stop the Letta runtime it owns');
  assert.doesNotMatch(preload, /startLetta|stopLetta|restartLetta|killLetta/u);
  assert.doesNotMatch(main, /process\.kill\([^\n]*(?:letta|LETTA)/u, 'Electron main must not address the Letta child through an arbitrary PID');
  assert.doesNotMatch(main, /(?:lettaAgentRuntime|letta)[^\n]*\.kill\(/iu, 'Electron main must delegate Letta shutdown to the runtime adapter');
  assert.match(runtime, /ownedChild\.kill\('SIGTERM'\)/u, 'the runtime adapter may signal only its owned Letta child');
  assert.doesNotMatch(runtime, /process\.kill\(/u, 'the runtime adapter must not signal arbitrary PIDs');
});

test('application runtime authority never aliases the Letta PID into backendPid', () => {
  const main = readText('electron/main.js');
  const start = main.indexOf('function applicationRuntimeAuthoritySnapshot()');
  const end = main.indexOf('function currentApiSessionToken', start);
  assert.notEqual(start, -1, 'applicationRuntimeAuthoritySnapshot must exist');
  assert.notEqual(end, -1, 'authority snapshot section must be bounded');
  const section = main.slice(start, end);
  assert.doesNotMatch(section, /backendPid:\s*Number\(backend\.backendPid\s*\|\|\s*letta\.pid/u, 'backendPid must never fall back to the Letta child PID');
  assert.match(section, /backendPid:\s*Number\(backend\.backendPid\s*\|\|\s*0\)/u, 'backendPid must remain bound only to the Yance backend child');
});

test('the existing Element Yance Workspace is the only Letta product surface', () => {
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(workspace, /data-yance-workspace/u);
  assert.match(workspace, /Letta/u);
  assert.match(workspace, /getLettaState/u);
  assert.match(workspace, /listLettaAgents/u);
  assert.match(workspace, /listLettaConversations/u);
  assert.doesNotMatch(workspace, /from\s+['"](?:node:|@letta-ai)/u);
  assert.doesNotMatch(workspace, /\bspawn\b|child_process|LETTA_LOCAL_BACKEND_DIR/u);
  assert.doesNotMatch(workspace, /LettaPage|LettaShell|SecondAi|SecondAI/u);
  assert.doesNotMatch(workspace, /createAgent|deleteAgent|sendMessage|\.send\(/u);
});

test('Letta IPC contracts remain readonly projections without arbitrary path or process authority', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const byChannel = new Map(manifest.handlers.map(handler => [handler.channel, handler]));
  for (const channel of CHANNELS) {
    const contract = byChannel.get(channel);
    assert.ok(contract, `missing manifest contract for ${channel}`);
    assert.equal(contract.direction, 'renderer-to-main');
    assert.equal(contract.ipcType, 'invoke');
    assert.equal(contract.sensitiveFields.length, 0);
    assert.equal(contract.inputSchema?.additionalProperties, false, `${channel} must declare a closed input schema`);
  }

  const conversations = byChannel.get('desktop:letta-list-conversations');
  const properties = Object.keys(conversations.inputSchema?.properties || {}).sort();
  assert.deepEqual(properties, ['agentId', 'limit']);
  assert.equal(Object.prototype.hasOwnProperty.call(conversations.inputSchema?.properties || {}, 'path'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(conversations.inputSchema?.properties || {}, 'command'), false);
});
