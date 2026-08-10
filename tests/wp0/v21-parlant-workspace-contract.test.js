'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const PRODUCT_SENTINEL = 'integration/element-module/src/product-experience/ProductExperienceShell.tsx';
const CHANNELS = [
  'desktop:parlant-get-relationship-goal',
  'desktop:parlant-upsert-relationship-goal',
  'desktop:parlant-delete-relationship-goal',
  'desktop:parlant-set-relationship-goal-paused'
];
const readText = rel => {
  const filePath = path.join(ROOT, ...rel.split('/'));
  assert.equal(fs.existsSync(filePath), true, `missing Parlant workspace contract file: ${rel}`);
  return fs.readFileSync(filePath, 'utf8');
};
const readJson = rel => JSON.parse(readText(rel));
const hasProductExperienceLayout = () => fs.existsSync(path.join(ROOT, ...PRODUCT_SENTINEL.split('/')));

function sourceRegion(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('renderer Goal operations stay on guarded desktop IPC and never gain runtime authority', () => {
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const manifest = readJson('electron/m2/ipcManifest.json');
  const manifestChannels = new Set(manifest.handlers.map(row => row.channel));
  assert.match(main, /require\(['"]\.\/parlantRelationshipRuntime['"]\)/u);
  for (const channel of CHANNELS) {
    assert.ok(
      main.includes(`ipcGuardHandle('${channel}'`) || main.includes(`ipcGuardHandle("${channel}"`),
      `${channel}: main must register through ipcGuardHandle`
    );
    assert.equal(manifestChannels.has(channel), true, `${channel}: ipcManifest.json must declare channel`);
  }
  for (const api of ['getParlantRelationshipGoal','upsertParlantRelationshipGoal','deleteParlantRelationshipGoal','setParlantRelationshipGoalPaused']) assert.ok(preload.includes(api));
  assert.doesNotMatch(preload, /startParlant|stopParlant|restartParlant|killParlant|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
});

test('Parlant Goal IPC schemas are contact-scoped, closed and credential-free', () => {
  const manifest = readJson('electron/m2/ipcManifest.json');
  const by = new Map(manifest.handlers.map(row => [row.channel, row]));
  for (const channel of CHANNELS) {
    const contract = by.get(channel);
    assert.ok(contract, `missing IPC contract: ${channel}`);
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
    assert.deepEqual(Object.keys(by.get(channel).outputSchema.properties || {}).sort(), [...allowed].sort(), `${channel} must keep the bounded Goal projection`);
  }
  assert.deepEqual(
    Object.keys(by.get('desktop:parlant-delete-relationship-goal').outputSchema.properties || {}).sort(),
    ['deleted'],
    'delete Goal projection must stay limited to the deletion result'
  );
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
  const inbound = sourceRegion(main, 'async function processParlantInboundEvent', '\nfunction scheduleParlantInboundEvent');
  assert.doesNotMatch(inbound, /(?:sendMessage|sendText|sendMedia|channel\s*\.\s*send)[\s\S]{0,40}\(/u, 'Parlant inbound handling must never call a channel send primitive');
});

test('inbound Parlant handling uses one resolved text value for both Parlant and the backend', () => {
  const main = readText('electron/main.js');
  const inbound = sourceRegion(main, 'async function processParlantInboundEvent', '\nfunction scheduleParlantInboundEvent');
  assert.match(inbound, /const inboundText\s*=\s*String\(message\.text\s*\|\|\s*message\.transcript\s*\|\|\s*message\.translation\s*\|\|\s*['"]['"]\)\.trim\(\)/u);
  assert.equal((inbound.match(/text:\s*inboundText/gu) || []).length, 2, 'Parlant ingest and backend candidate commit must receive the same resolved inbound text');
});

test('missing Parlant provider credentials fail closed without renderer event spam', () => {
  const main = readText('electron/main.js');
  const inbound = sourceRegion(main, 'async function processParlantInboundEvent', '\nfunction scheduleParlantInboundEvent');
  assert.match(inbound, /DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING/u);
  assert.match(inbound, /reasonCode\s*!==\s*['"]DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING['"]/u, 'ambient inbound traffic must not emit degraded renderer events when the optional Goal runtime has no provider credential');
});

test('relationship desktop event subscription never steals selection from an unsaved Goal draft', () => {
  if (hasProductExperienceLayout()) {
    const assistant = readText('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
    const projection = readText('integration/element-module/src/product-experience/experienceProjection.ts');
    const session = readText('integration/element-module/src/product-experience/experienceSession.ts');
    assert.match(session, /selectedRelationshipId/u, 'Product session must keep explicit selected-relationship authority');
    assert.match(assistant, /dirtyDraftRef\s*=\s*useRef\(false\)/u, 'Product assistant must track unsaved Goal draft state');
    assert.match(assistant, /syncDraft\s*&&\s*!dirtyDraftRef\.current/u, 'background projection refresh must not overwrite a dirty Goal draft');
    assert.match(assistant, /contactId\s*===\s*relationshipId/u, 'relationship desktop events must refresh only the currently open relationship assistant');
    assert.match(assistant, /load\(false\)/u, 'background relationship events must refresh without resynchronizing the draft');
    assert.doesNotMatch(assistant + projection, /selectRelationship\(/u, 'background Goal/desktop events must not auto-select another relationship');
  } else {
    const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
    assert.doesNotMatch(workspace, /event\?\.type\s*===\s*["']message:inserted["'][\s\S]{0,160}setSelectedContactId/u, 'inbound messages must not auto-select another relationship while the user is editing');
    assert.match(workspace, /selectedContactRef\s*=\s*React\.useRef/u, 'stable desktop subscription must read the latest selected relationship through a ref');
    assert.match(workspace, /selectedContactRef\.current\s*=\s*selectedContactId/u);
    assert.match(workspace, /contactId\s*===\s*selectedContactRef\.current/u);
  }
});

test('existing Yance Workspace provides stable Goal controls without browser goal persistence', () => {
  if (hasProductExperienceLayout()) {
    const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
    const assistant = readText('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
    const projection = readText('integration/element-module/src/product-experience/experienceProjection.ts');
    const session = readText('integration/element-module/src/product-experience/experienceSession.ts');
    assert.match(workspace, /ProductExperienceShell/u);
    for (const marker of ['getParlantRelationshipGoal','upsertParlantRelationshipGoal','deleteParlantRelationshipGoal','setParlantRelationshipGoalPaused']) {
      assert.equal(projection.includes(marker), true, `Product projection must retain stable Goal identifier: ${marker}`);
    }
    for (const marker of ['updateRelationshipGoal','deleteRelationshipGoal','setRelationshipGoalPaused']) {
      assert.equal(assistant.includes(marker), true, `Product assistant must retain Goal control: ${marker}`);
    }
    assert.match(projection, /storeSnapshot\(\{ domains: \["customers"\] \}\)/u);
    assert.match(session, /selectRelationship/u);
    const productGoalAuthority = assistant + projection + session;
    assert.doesNotMatch(productGoalAuthority, /from\s+['"](?:node:|parlant)|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
    assert.doesNotMatch(productGoalAuthority, /localStorage\.setItem\(/u, 'Product Goal state must not gain browser persistence');
  } else {
    const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
    for (const marker of ['data-yance-workspace','getParlantRelationshipGoal','upsertParlantRelationshipGoal','deleteParlantRelationshipGoal','setParlantRelationshipGoalPaused']) {
      assert.equal(workspace.includes(marker), true, `workspace must retain stable Goal identifier: ${marker}`);
    }
    assert.match(workspace, /storeSnapshot\(\{\s*domains:\s*\["customers"\]\s*\}\)/u);
    assert.doesNotMatch(workspace, /from\s+['"](?:node:|parlant)|child_process|\bspawn\b|OPENROUTER_API_KEY/iu);
    const writes = workspace.match(/localStorage\.setItem\([^\n]+/gu) || [];
    assert.equal(writes.some(line => /goal|parlant|journey|contactId/iu.test(line)), false);
  }
});

test('dedicated Parlant workflow runs whenever an asserted contract dependency changes', () => {
  const workflow = readText('.github/workflows/v21-parlant-p0-windows.yml');
  for (const requiredPath of [
    'electron/main.js',
    'electron/preload.js',
    'electron/m2/ipcManifest.json',
    'integration/element-module/src/YanceWorkspace.tsx',
    'tools/wp7/lib.js',
    'tools/wp7/packaged-product-trust.js',
    'tools/wp7/create-pre-review-trusted-product.js',
    'THIRD_PARTY_NOTICES.md',
    'package.json'
  ]) {
    assert.equal(workflow.includes(`'${requiredPath}'`) || workflow.includes(`"${requiredPath}"`), true, `Parlant workflow path filter must include ${requiredPath}`);
  }
});
