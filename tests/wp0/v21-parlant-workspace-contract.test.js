'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const CHANNELS = [
  'desktop:parlant-get-relationship-goal',
  'desktop:parlant-upsert-relationship-goal',
  'desktop:parlant-delete-relationship-goal',
  'desktop:parlant-set-relationship-goal-paused'
];

function repositoryPath(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Parlant Workspace file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test('renderer Goal operations stay on exact guarded desktop IPC and never gain runtime/process authority', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = readJson('electron/m2/ipcManifest.json');
  const manifestChannels = new Set(manifest.handlers.map(handler => handler.channel));

  assert.equal(main.includes("require('./parlantRelationshipRuntime')") || main.includes('require("./parlantRelationshipRuntime")'), true, 'Electron main must own the Parlant adapter');
  for (const channel of CHANNELS) {
    assert.equal(main.includes(`ipcGuardHandle('${channel}'`) || main.includes(`ipcGuardHandle("${channel}"`), true, `main process must guard ${channel}`);
    assert.equal(manifestChannels.has(channel), true, `IPC manifest must declare ${channel}`);
  }

  assert.match(preload, /getParlantRelationshipGoal:\s*input\s*=>\s*ipcRenderer\.invoke\(['"]desktop:parlant-get-relationship-goal['"]/u);
  assert.match(preload, /upsertParlantRelationshipGoal:\s*input\s*=>\s*ipcRenderer\.invoke\(['"]desktop:parlant-upsert-relationship-goal['"]/u);
  assert.match(preload, /deleteParlantRelationshipGoal:\s*input\s*=>\s*ipcRenderer\.invoke\(['"]desktop:parlant-delete-relationship-goal['"]/u);
  assert.match(preload, /setParlantRelationshipGoalPaused:\s*input\s*=>\s*ipcRenderer\.invoke\(['"]desktop:parlant-set-relationship-goal-paused['"]/u);
  assert.doesNotMatch(preload, /startParlant|stopParlant|restartParlant|killParlant|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
});

test('Parlant Goal IPC schemas are contact-scoped, closed and credential-free', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const byChannel = new Map(manifest.handlers.map(handler => [handler.channel, handler]));

  for (const channel of CHANNELS) {
    const contract = byChannel.get(channel);
    assert.ok(contract, `missing manifest contract for ${channel}`);
    assert.equal(contract.direction, 'renderer-to-main');
    assert.equal(contract.ipcType, 'invoke');
    assert.equal(contract.inputSchema?.additionalProperties, false);
    assert.equal(contract.outputSchema?.additionalProperties, false);
    assert.equal(contract.sensitiveFields.length, 0, `${channel} must not expose provider credentials`);
    assert.equal(Object.prototype.hasOwnProperty.call(contract.inputSchema?.properties || {}, 'contactId'), true, `${channel} must bind operations to the existing Yance contact authority`);
    for (const forbidden of ['apiKey', 'openRouterApiKey', 'endpoint', 'command', 'path', 'pid']) {
      assert.equal(Object.prototype.hasOwnProperty.call(contract.inputSchema?.properties || {}, forbidden), false, `${channel} must not expose ${forbidden}`);
    }
  }

  const upsert = byChannel.get('desktop:parlant-upsert-relationship-goal');
  assert.equal(Object.prototype.hasOwnProperty.call(upsert.inputSchema.properties, 'goal'), true);
  const pause = byChannel.get('desktop:parlant-set-relationship-goal-paused');
  assert.equal(pause.inputSchema.properties.paused?.type, 'boolean');
});

test('renderer projection exposes only bounded goal/progress state, never raw Parlant session/Journey internals', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const byChannel = new Map(manifest.handlers.map(handler => [handler.channel, handler]));
  const projectionChannels = [
    'desktop:parlant-get-relationship-goal',
    'desktop:parlant-upsert-relationship-goal',
    'desktop:parlant-set-relationship-goal-paused'
  ];
  const allowed = ['contactId', 'goal', 'paused', 'progress', 'reasonCode', 'status'];

  for (const channel of projectionChannels) {
    const keys = Object.keys(byChannel.get(channel).outputSchema?.properties || {}).sort();
    assert.deepEqual(keys, allowed, `${channel} must expose only the bounded Goal projection`);
  }

  const manifestText = JSON.stringify(manifest);
  assert.doesNotMatch(manifestText, /OPENROUTER_API_KEY|api[_-]?key|journey_paths|session_events|agent_states|prompt|token/iu);
});

test('incoming customer events, reply candidates and channel sending stay internal to main rather than renderer IPC', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = readJson('electron/m2/ipcManifest.json');
  const manifestText = JSON.stringify(manifest);

  assert.doesNotMatch(preload, /ingestParlant|Parlant.*Candidate|sendParlant|parlant.*send/iu);
  assert.doesNotMatch(manifestText, /desktop:parlant-(?:ingest|candidate|send)/iu);
  assert.match(main, /ingestCustomerMessage/u, 'real customer messages must enter Parlant from the main-owned integration chain');
  assert.match(main, /requestReplyCandidate/u, 'goal-aware reply candidates must enter the main-owned reply decision chain');
  assert.doesNotMatch(main, /parlant[^\n]*(?:sendMessage|sendText|sendMedia|channel\.send)/iu, 'Parlant integration must not own channel sending');
});

test('existing Element Yance Workspace remains the only product surface and provides usable Goal controls', () => {
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(workspace, /data-yance-workspace/u);
  assert.match(workspace, /Parlant/u);
  assert.match(workspace, /getParlantRelationshipGoal/u);
  assert.match(workspace, /upsertParlantRelationshipGoal/u);
  assert.match(workspace, /deleteParlantRelationshipGoal/u);
  assert.match(workspace, /setParlantRelationshipGoalPaused/u);
  assert.match(workspace, /contactId/iu);
  assert.match(workspace, /Conversation goal|Relationship goal|Goal/u);
  assert.match(workspace, /Pause/u);
  assert.match(workspace, /Resume/u);
  assert.match(workspace, /Delete/u);
  assert.match(workspace, /progress/iu);
  assert.match(workspace, /degraded|unavailable|reasonCode/iu, 'runtime/provider failures must be visible rather than silently bypassed');
  assert.doesNotMatch(workspace, /from\s+['"](?:node:|parlant)|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
  assert.doesNotMatch(workspace, /ParlantPage|ParlantShell|SecondAi|SecondAI/u);
});

test('Goal state is never persisted in browser storage as a second authority', () => {
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  const storageWrites = workspace.match(/localStorage\.setItem\([^\n]+/gu) || [];
  assert.equal(storageWrites.some(line => /goal|parlant|journey|contactId/iu.test(line)), false, 'Parlant-owned goal state must never be mirrored into localStorage');
});
