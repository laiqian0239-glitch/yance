'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PRODUCT_SENTINEL = 'integration/element-module/src/product-experience/ProductExperienceShell.tsx';
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

function hasProductExperienceLayout() {
  return fs.existsSync(repositoryPath(PRODUCT_SENTINEL));
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
  const stopStart = runtime.indexOf('async function stop()');
  const stopEnd = runtime.indexOf('async function start()', stopStart);
  assert.match(main, /createLettaAgentRuntime/u);
  assert.match(main, /ensureLettaAgentRuntime\(\)\.start\(\)/u, 'Electron main must explicitly start the Letta runtime it owns');
  assert.match(main, /lettaAgentRuntime\.stop\(\)/u, 'Electron main must stop the Letta runtime it owns');
  assert.doesNotMatch(preload, /startLetta|stopLetta|restartLetta|killLetta/u);
  assert.doesNotMatch(main, /process\.kill\([^\n]*(?:letta|LETTA)/u, 'Electron main must not address the Letta child through an arbitrary PID');
  assert.doesNotMatch(main, /(?:lettaAgentRuntime|letta)[^\n]*\.kill\(/iu, 'Electron main must delegate Letta shutdown to the runtime adapter');
  assert.notEqual(stopStart, -1, 'runtime stop() must exist');
  assert.notEqual(stopEnd, -1, 'runtime stop() section must be bounded');
  assert.match(runtime.slice(stopStart, stopEnd), /ownedChild\.kill\('SIGTERM'\)/u, 'normal stop() must signal only its owned Letta child with SIGTERM');
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
  if (hasProductExperienceLayout()) {
    const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
    const assistant = readText('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
    const projection = readText('integration/element-module/src/product-experience/experienceProjection.ts');
    assert.match(workspace, /ProductExperienceShell/u);
    assert.match(assistant, /Letta/u);
    assert.match(projection, /getLettaState/u);
    assert.match(projection, /listLettaAgents/u);
    assert.match(projection, /listLettaConversations/u);
    const productAuthority = workspace + assistant + projection;
    assert.doesNotMatch(productAuthority, /from\s+['"](?:node:|@letta-ai)/u);
    assert.doesNotMatch(productAuthority, /\bspawn\b|child_process|LETTA_LOCAL_BACKEND_DIR/u);
    assert.doesNotMatch(productAuthority, /LettaPage|LettaShell|SecondAi|SecondAI/u);
    assert.doesNotMatch(productAuthority, /createAgent|deleteAgent|sendMessage|\.send\(/u);
  } else {
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
  }
});

test('Letta Workspace refreshes readonly projections after runtime state changes and labels bounded counts honestly', () => {
  if (hasProductExperienceLayout()) {
    const assistant = readText('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
    const projection = readText('integration/element-module/src/product-experience/experienceProjection.ts');
    assert.match(assistant, /window\.setTimeout/u, 'Product assistant must refresh Letta state after mount without reintroducing an interval loop');
    assert.match(assistant, /window\.clearTimeout/u, 'Product assistant must dispose the cancellable refresh timer');
    assert.doesNotMatch(assistant, /setInterval\(/u, 'Product reduced-motion contract forbids reintroducing the retired setInterval refresh');
    assert.match(assistant, /load\(false\)/u, 'background refreshes must preserve an unsaved Goal draft');
    assert.match(assistant, /setProjection\(null\)/u, 'Product assistant must clear stale projection when Letta becomes unavailable');
    assert.match(projection, /let agentCount = 0/u);
    assert.match(projection, /let recentConversationCount = 0/u);
    assert.match(projection, /const firstId = text\(normalized\[0\]\?\.id\)/u, 'bounded conversation count must remain first-agent scoped');
    assert.match(projection, /listLettaConversations\(\{ agentId: firstId, limit: 20 \}\)/u, 'bounded conversation projection must preserve the 20-item cap');
    assert.match(assistant, /Recent context/u, 'bounded recent-conversation projection must stay visible');
  } else {
    const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
    assert.match(workspace, /setInterval\(/u, 'Workspace must refresh Letta state after mount so post-ready exits are observable');
    assert.match(workspace, /clearInterval\(/u, 'Workspace must dispose the Letta refresh interval');
    assert.match(workspace, /setLettaAgents\(\[\]\)/u, 'Workspace must clear stale agent projection when Letta is not ready');
    assert.match(workspace, /setLettaConversations\(\[\]\)/u, 'Workspace must clear stale conversation projection when Letta is not ready');
    assert.match(workspace, /Recent conversations \(first agent\)/u, 'bounded conversation count must identify its first-agent scope');
    assert.match(workspace, /20\+/u, 'bounded conversation count must disclose the 20-item cap');
  }
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

test('Letta IPC manifest validation summary and source locations stay traceable', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const rendererToMain = manifest.handlers.filter(handler => handler.direction === 'renderer-to-main');
  assert.equal(manifest.validationSummary?.rendererToMainHandlerCount, rendererToMain.length, 'declared renderer-to-main count must equal actual handlers');
  const byChannel = new Map(manifest.handlers.map(handler => [handler.channel, handler]));
  for (const channel of CHANNELS) {
    const contract = byChannel.get(channel);
    assert.ok(Number.isInteger(contract?.handler?.line) && contract.handler.line > 0, `${channel} handler source line must be traceable`);
    assert.ok(Number.isInteger(contract?.rendererExposure?.line) && contract.rendererExposure.line > 0, `${channel} renderer exposure source line must be traceable`);
  }
});
