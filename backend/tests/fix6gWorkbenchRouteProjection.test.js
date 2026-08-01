'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-ai-workbench-runtime.js'), 'utf8');
const routeDraftAuthority = require('../../frontend/js/r32-route-draft-authority');

test('workbench reads requested route intent separately from resolved authority output', () => {
  assert.match(source, /requested=r\.requested&&typeof r\.requested==='object'/u);
  assert.match(source, /requestedPrimary=requested\.primary&&typeof requested\.primary==='object'/u);
  assert.match(source, /resolved=r\.resolved&&typeof r\.resolved==='object'/u);
  assert.match(source, /resolvedFallback=resolved\.fallback&&typeof resolved\.fallback==='object'/u);
  assert.match(source, /resolutionState/u);
  assert.match(source, /reasonCodes/u);
});

test('single-task route test projects current automatic resolution without saving the complete route table first', () => {
  const draft = routeDraftAuthority.project({
    id: 'quick_reply',
    main: 'auto',
    backup: 'auto',
    actualMain: 'openrouter/primary',
    actualBackup: 'openrouter/fallback',
    requestedEnabled: true,
    allowConditional: true,
    limit: 220,
    timeoutMs: 180000
  }, [], { purpose: 'test' });

  assert.equal(draft.requested.primary.mode, 'auto');
  assert.equal(draft.requested.primary.modelId, '');
  assert.equal(draft.primary, 'openrouter/primary');
  assert.equal(draft.fallback, 'openrouter/fallback');
  assert.equal(draft.allowConditional, true);
  assert.equal(draft.resolved.primary.modelId, 'openrouter/primary');
  assert.match(source, /routes\/\$\{encodeURIComponent\(r\.id\)\}\/test/u);
  assert.match(source, /routeDraft:routeDraftPayload\(r,'test'\)/u);
  assert.doesNotMatch(
    source,
    /await requestJson\('\/api\/r32\/models\/routes',\{method:'POST',body:JSON\.stringify\(\{routes:routesPayload\(\)\}\)\}\);const payload=await requestJson\(`\/api\/r32\/models\/routes\/\$\{encodeURIComponent\(r\.id\)\}\/test`/u
  );
});

test('automatic fallback resolution failures are explicit and provider-independent', () => {
  assert.match(source, /NO_QUALIFIED_INDEPENDENT_FALLBACK/u);
  assert.match(source, /自动备用尚未解析/u);
  assert.match(source, /不同供应商故障域/u);
});

test('model center renders lifecycle pools instead of one flat reply model grid', () => {
  assert.match(source, /state\.modelPools/u);
  assert.match(source, /冠军模型/u);
  assert.match(source, /正式资格模型/u);
  assert.match(source, /回复挑战者/u);
  assert.match(source, /后台工作模型/u);
  assert.match(source, /多模态模型/u);
  assert.match(source, /模型库存/u);
  assert.match(source, /Batch-only/u);
});
