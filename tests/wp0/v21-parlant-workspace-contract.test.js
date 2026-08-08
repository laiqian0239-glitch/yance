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
const readText = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const readJson = rel => JSON.parse(readText(rel));

test('renderer Goal operations stay on guarded desktop IPC and never gain runtime authority', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = readJson('electron/m2/ipcManifest.json');
  const manifestChannels = new Set(manifest.handlers.map(row => row.channel));
  assert.match(main, /require\(['"]\.\/parlantRelationshipRuntime['"]\)/u);
  for (const channel of CHANNELS) {
    assert.ok(main.includes(`ipcGuardHandle('${channel}'`) || main.includes(`ipcGuardHandle(\"${channel}\"`));
    assert.equal(manifestChannels.has(channel), true);
  }
  for (const api of ['getParlantRelationshipGoal','upsertParlantRelationshipGoal','deleteParlantRelationshipGoal','setParlantRelationshipGoalPaused']) assert.ok(preload.includes(api));
  assert.doesNotMatch(preload, /startParlant|stopParlant|restartParlant|killParlant|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
});

test('Parlant Goal IPC schemas are contact-scoped, closed and credential-free', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const by = new Map(manifest.handlers.map(row => [row.channel, row]));
  for (const channel of CHANNELS) {
    const contract = by.get(channel);
    assert.ok(contract);
    assert.equal(contract.inputSchema.additionalProperties, false);
    assert.equal(contract.outputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(contract.inputSchema.properties || {}, 'contactId'), true);
    assert.equal((contract.sensitiveFields || []).length, 0);
    for (const forbidden of ['apiKey','openRouterApiKey','endpoint','command','path','pid']) assert.equal(Object.hasOwn(contract.inputSchema.properties || {}, forbidden), false);
  }
});

test('renderer projection is bounded and omits raw Parlant internals', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const by = new Map(manifest.handlers.map(row => [row.channel, row]));
  const allowed = ['available','exists','goalText','paused','progress','reasonCode'];
  for (const channel of ['desktop:parlant-get-relationship-goal','desktop:parlant-upsert-relationship-goal','desktop:parlant-set-relationship-goal-paused']) {
    assert.deepEqual(Object.keys(by.get(channel).outputSchema.properties || {}).sort(), [...allowed].sort());
  }
  const parlantContracts = manifest.handlers.filter(row => CHANNELS.includes(row.channel));
  assert.doesNotMatch(JSON.stringify(parlantContracts), /OPENROUTER_API_KEY|api[_-]?key|journey_paths|session_events|agent_states|prompt|token/iu);
});

test('incoming events and candidate generation stay internal to main and Yance retains send authority', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = JSON.stringify(readJson('electron/m2/ipcManifest.json'));
  assert.doesNotMatch(preload, /ingestParlant|Parlant.*Candidate|sendParlant|parlant.*send/iu);
  assert.doesNotMatch(manifest, /desktop:parlant-(?:ingest|candidate|send)/iu);
  assert.match(main, /event\.type === ['"]message:inserted['"]/u);
  assert.match(main, /direction === ['"]inbound['"]/u);
  assert.match(main, /ingestCustomerMessage/u);
  assert.match(main, /requestReplyCandidate/u);
  assert.match(main, /manualText:\s*candidateText/u);
  assert.doesNotMatch(main, /parlant[^\n]*(?:sendMessage|sendText|sendMedia|channel\.send)/iu);
});

test('existing Yance Workspace provides Goal controls without browser goal persistence', () => {
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  for (const marker of ['data-yance-workspace','Relationship Goal','getParlantRelationshipGoal','upsertParlantRelationshipGoal','deleteParlantRelationshipGoal','setParlantRelationshipGoalPaused','Pause','Resume','Delete','Progress','Yance approval and channel pipeline']) assert.match(workspace, new RegExp(marker, 'u'));
  assert.match(workspace, /storeSnapshot\(\{\s*domains:\s*\["customers"\]\s*\}\)/u);
  assert.doesNotMatch(workspace, /from\s+['"](?:node:|parlant)|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
  const writes = workspace.match(/localStorage\.setItem\([^\n]+/gu) || [];
  assert.equal(writes.some(line => /goal|parlant|journey|contactId/iu.test(line)), false);
});
