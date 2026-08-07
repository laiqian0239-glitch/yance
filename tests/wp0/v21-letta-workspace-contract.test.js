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
  assert.match(main, /createLettaAgentRuntime/u);
  assert.match(main, /\.start\(\)/u);
  assert.match(main, /\.stop\(\)/u);
  assert.doesNotMatch(preload, /startLetta|stopLetta|restartLetta|killLetta/u);
  assert.doesNotMatch(main, /kill\([^\n]*pid|process\.kill\([^\n]*letta/iu);
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
    assert.notEqual(contract.inputSchema?.additionalProperties, true);
  }

  const conversations = byChannel.get('desktop:letta-list-conversations');
  const properties = Object.keys(conversations.inputSchema?.properties || {}).sort();
  assert.deepEqual(properties, ['agentId', 'limit']);
  assert.equal(Object.prototype.hasOwnProperty.call(conversations.inputSchema?.properties || {}, 'path'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(conversations.inputSchema?.properties || {}, 'command'), false);
});
