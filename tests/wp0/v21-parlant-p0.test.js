'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PARLANT_TAG = 'v3.3.2';
const PARLANT_VERSION = '3.3.2';
const PARLANT_COMMIT = '61bba3b2b3fffd677d345e393e8c942dbd400297';
const PARLANT_UV_LOCK_BLOB = 'aa2f7de8e858f19296df58efec56d72c8d3f50a5';
const UV_VERSION = '0.12.3';
const UV_COMMIT = '507230998c9541d67814b57463ac00e454ff6991';
const PYTHON_BUILD_STANDALONE_RELEASE = '20260807';
const PYTHON_BUILD_STANDALONE_COMMIT = '00c8a06113f11220667c3bcf5fab1672ff9e78ef';
const CPYTHON_VERSION = '3.12.13';

const repositoryPath = relativePath => path.join(ROOT, ...relativePath.split('/'));
function readText(relativePath) {
  const filePath = repositoryPath(relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing V2.1 Parlant P0 file: ${relativePath}`);
  return fs.readFileSync(filePath, 'utf8');
}
const readJson = relativePath => JSON.parse(readText(relativePath));

test('V2.1 Parlant P0 pins exact mature OSS authorities without adding Node dependencies', () => {
  const lock = readJson('config/upstreams/v21-parlant-p0.json');
  assert.equal(lock.schemaVersion, 1);
  assert.equal(lock.upstreams.parlant.version, PARLANT_TAG);
  assert.equal(lock.upstreams.parlant.commit, PARLANT_COMMIT);
  assert.equal(lock.upstreams.parlant.license, 'Apache-2.0');
  assert.equal(lock.upstreams.parlant.uvLockGitBlob, PARLANT_UV_LOCK_BLOB);
  assert.equal(lock.upstreams.uv.version, UV_VERSION);
  assert.equal(lock.upstreams.uv.commit, UV_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.release, PYTHON_BUILD_STANDALONE_RELEASE);
  assert.equal(lock.upstreams.pythonBuildStandalone.commit, PYTHON_BUILD_STANDALONE_COMMIT);
  assert.equal(lock.upstreams.pythonBuildStandalone.cpythonVersion, CPYTHON_VERSION);
  const pkg = readJson('package.json');
  assert.equal(Object.keys(pkg.dependencies || {}).some(name => /parlant|python|uv/iu.test(name)), false);
});

test('redistribution obligations are explicit and carry full license texts', () => {
  const notices = readText('THIRD_PARTY_NOTICES.md');
  for (const required of ['Parlant', 'uv', 'python-build-standalone', 'CPython']) assert.match(notices, new RegExp(required, 'u'));
  const licenses = [
    ['third_party/licenses/parlant-Apache-2.0.txt', /Apache License/u],
    ['third_party/licenses/uv-Apache-2.0.txt', /Apache License/u],
    ['third_party/licenses/uv-MIT.txt', /MIT License|Permission is hereby granted/u],
    ['third_party/licenses/python-build-standalone-MPL-2.0.txt', /Mozilla Public License/u],
    ['third_party/licenses/cpython-PSF-2.0.txt', /PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2|Python Software Foundation License/u]
  ];
  for (const [relativePath, marker] of licenses) {
    const text = readText(relativePath);
    assert.match(text, marker);
    assert.ok(text.length > 500, `${relativePath} must contain upstream license text`);
  }
});

test('Electron adapter is Parlant-specific, loopback-only, telemetry-off and main-owned', () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtime = require(runtimePath);
  assert.equal(runtime.PARLANT_VERSION, PARLANT_VERSION);
  assert.equal(runtime.PARLANT_COMMIT, PARLANT_COMMIT);
  assert.equal(runtime.assertLoopbackEndpoint('http://127.0.0.1:8800'), 'http://127.0.0.1:8800');
  assert.equal(runtime.assertLoopbackEndpoint('http://localhost:8800'), 'http://localhost:8800');
  for (const denied of ['http://0.0.0.0:8800', 'http://192.168.1.20:8800', 'https://127.0.0.1:8800']) {
    assert.throws(() => runtime.assertLoopbackEndpoint(denied), /loopback|Parlant|endpoint/iu);
  }
  const dataRoot = path.join(os.tmpdir(), 'yance-parlant-contract-root');
  const env = runtime.buildParlantEnvironment({
    baseEnv: { ELECTRON_RUN_AS_NODE: '1', PARLANT_DATA_COLLECTION: 'true', OPENROUTER_API_KEY: 'ambient-denied', KEEP_ME: 'yes' },
    dataRoot,
    openRouterApiKey: 'explicit-main-owned-key'
  });
  assert.equal(env.KEEP_ME, undefined, 'child environment must be allowlisted rather than inherit arbitrary ambient values');
  assert.equal(env.PARLANT_DATA_COLLECTION, 'false');
  assert.equal(env.OPENROUTER_API_KEY, 'explicit-main-owned-key');
  assert.equal(Object.hasOwn(env, 'ELECTRON_RUN_AS_NODE'), false);
  assert.equal(env.YANCE_PARLANT_DATA_ROOT, path.resolve(dataRoot));
  assert.equal(env.PARLANT_HOME, path.resolve(dataRoot));
});

test('relationship identifiers are deterministic isolation keys, not a Yance Journey store', () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const runtime = require(runtimePath);
  const a = runtime.relationshipKey('contact-A');
  assert.equal(a, runtime.relationshipKey('contact-A'));
  assert.notEqual(a, runtime.relationshipKey('contact-B'));
  assert.match(a, /^[a-f0-9]{64}$/u);
  const source = readText('electron/parlantRelationshipRuntime.js');
  assert.doesNotMatch(source, /journeyGraph|goalGraph|transitionGraph|better-sqlite3|leveldb|indexeddb/iu);
});

test('Python bridge uses Parlant full persistent Application/Store authority, not transient SDK Server', () => {
  const server = readText('runtime/parlant/yance_parlant_server.py');
  assert.match(server, /from parlant\.bin\.server import StartupParameters, start_parlant/u);
  assert.match(server, /from parlant\.core\.application import Application/u);
  assert.match(server, /JourneyStore/u);
  assert.match(server, /SessionStore/u);
  assert.match(server, /JourneyEvaluator/u);
  assert.match(server, /JourneyPayload/u);
  assert.match(server, /start_parlant\(params\)/u);
  assert.match(server, /RUNTIME\.app\.journeys\.create/u);
  assert.match(server, /RUNTIME\.journey_store\.create_node/u);
  assert.match(server, /RUNTIME\.journey_store\.create_edge/u);
  assert.match(server, /JourneyStore\.END_NODE_ID/u);
  assert.match(server, /state\.journey_paths/u, 'progress must project Parlant-native journey_paths');
  assert.match(server, /["']manual["']/u);
  assert.match(server, /["']auto["']/u);
  assert.doesNotMatch(server, /\bp\.Server\b|import parlant\.sdk as p|class\s+(?:Journey|GoalGraph|TransitionGraph)|networkx|state_machine/iu);
});

test('customer ingestion uses native Parlant SessionModule and candidate path never owns channel sending', () => {
  const server = readText('runtime/parlant/yance_parlant_server.py');
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const main = readText('electron/main.js');
  assert.match(server, /create_customer_message\(/u);
  assert.match(server, /trigger_processing=current\.mode != ["']manual["']/u);
  assert.match(server, /source=EventSource\.CUSTOMER/u);
  assert.match(server, /source=EventSource\.AI_AGENT/u);
  for (const name of ['readRelationshipGoal','upsertRelationshipGoal','deleteRelationshipGoal','setRelationshipGoalPaused','ingestCustomerMessage','requestReplyCandidate']) assert.ok(runtime.includes(name));
  assert.doesNotMatch(`${runtime}\n${server}`, /sendMessage|sendText|sendMedia|channel\.send|whatsapp|telegram|facebook/iu);
  assert.match(main, /\/api\/r32\/store\/replies\/generate/u);
  assert.match(main, /manualText:\s*candidateText/u);
  assert.match(main, /source:\s*['"]parlant-journey['"]/u);
});

test('relationship ingress sequencer serializes one contact without globally blocking other relationships', async () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const { createRelationshipTaskSequencer } = require(runtimePath);
  assert.equal(typeof createRelationshipTaskSequencer, 'function');
  const sequencer = createRelationshipTaskSequencer();
  const order = [];
  let releaseA;
  const gateA = new Promise(resolve => { releaseA = resolve; });
  const a1 = sequencer.run('contact-A', async () => { order.push('a1:start'); await gateA; order.push('a1:end'); return 'a1'; });
  const a2 = sequencer.run('contact-A', async () => { order.push('a2:start'); return 'a2'; });
  const b1 = sequencer.run('contact-B', async () => { order.push('b1:start'); return 'b1'; });
  await b1;
  assert.deepEqual(order, ['a1:start', 'b1:start'], 'different relationships must stay parallel while contact-A is busy');
  releaseA();
  assert.deepEqual(await Promise.all([a1, a2]), ['a1', 'a2']);
  assert.deepEqual(order, ['a1:start', 'b1:start', 'a1:end', 'a2:start']);
  await assert.rejects(sequencer.run('contact-A', async () => { throw new Error('expected failure'); }), /expected failure/u);
  assert.equal(await sequencer.run('contact-A', async () => 'after-failure'), 'after-failure', 'a failed task must not poison the relationship queue');
});

test('Parlant candidate correlation is bound to the native processing trace and same-contact ingress is sequenced', () => {
  const server = readText('runtime/parlant/yance_parlant_server.py');
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const main = readText('electron/main.js');
  assert.match(server, /["']traceId["']\s*:\s*str\(event\.trace_id\)/u, 'ingest must return the native Parlant event trace');
  assert.match(server, /with\s+RUNTIME\.container\[Tracer\]\.span\(\s*["']yance\.relationship\.ingest["']/u, 'ingest must create the native Parlant processing span before dispatching the background engine task');
  assert.match(server, /processing_trace_id\s*:\s*str\s*=\s*Query\(/u, 'candidate route must require an exact processing trace');
  assert.match(server, /trace_id=processing_trace_id/u, 'candidate lookup must filter by the exact native trace');
  assert.doesNotMatch(server, /trace_id=None/u, 'candidate lookup must never accept an uncorrelated AI event');
  assert.match(runtime, /processing_trace_id=\$\{encodeURIComponent\(processingTraceId\)\}/u, 'Electron adapter must transport the trace as a query value');
  assert.match(main, /processingTraceId:\s*String\(ingested\?\.traceId\s*\|\|\s*['"]['"]\)/u, 'main must bind candidate capture to the ingest trace');
  assert.match(main, /parlantInboundSequencer\.run\(contactId/u, 'same-contact inbound work must go through the relationship sequencer');
  assert.doesNotMatch(main, /Promise\.resolve\(processParlantInboundEvent\(event\)\)/u, 'event socket must not launch same-contact Parlant work concurrently');
});

test('provider/runtime failures fail closed and renderer never receives plaintext OpenRouter credentials', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const main = readText('electron/main.js');
  const preload = readText('electron/preload.js');
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');
  assert.match(runtime, /DESKTOP_PARLANT_RUNTIME_NOT_READY|DESKTOP_PARLANT_RUNTIME_MISSING/u);
  assert.match(main, /DESKTOP_PARLANT_OPENROUTER_CREDENTIAL_MISSING/u);
  assert.match(main, /model:openrouter:default/u);
  assert.match(main, /vault\?\.get/u);
  assert.doesNotMatch(preload, /OPENROUTER_API_KEY|openRouterApiKey|apiKey/iu);
  assert.doesNotMatch(workspace, /OPENROUTER_API_KEY|openRouterApiKey|apiKey/iu);
  assert.doesNotMatch(main, /process\.env\.OPENROUTER_API_KEY/u, 'main must use Yance credential authority, not ambient provider keys');
  assert.match(runtime, /payload\?\.detail/u, 'FastAPI reasonCode detail must survive the main-process adapter');
});

test('application startup never resolves Python dependencies online', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const server = readText('runtime/parlant/yance_parlant_server.py');
  for (const source of [runtime, server]) assert.doesNotMatch(source, /\b(?:pip|uv)\s+(?:install|sync)|subprocess[^\n]*(?:pip|uv)|git\s+clone|curl\s+http|Invoke-WebRequest/iu);
  assert.match(runtime, /parlant-runtime/u);
});

test('Parlant child spawn failures stay inside the supervised runtime boundary', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  assert.match(runtime, /nextChild\.once\?\.\(\s*['"]error['"]/u, 'spawned Parlant child must have an explicit error listener before readiness');
  assert.match(runtime, /DESKTOP_PARLANT_CHILD_SPAWN_FAILED/u, 'spawn errors must map to a stable fail-closed reason code');
});

test('Parlant loopback transport authenticates the exact Yance-owned child and rejects local impostors', () => {
  const runtime = readText('electron/parlantRelationshipRuntime.js');
  const server = readText('runtime/parlant/yance_parlant_server.py');
  const preload = readText('electron/preload.js');
  const workspace = readText('integration/element-module/src/YanceWorkspace.tsx');

  assert.match(runtime, /YANCE_PARLANT_LOOPBACK_TOKEN/u, 'main-owned child environment must carry an ephemeral loopback credential');
  assert.match(runtime, /x-yance-parlant-token/iu, 'every Electron-to-Parlant request must authenticate with the loopback credential');
  assert.match(runtime, /\/yance\/healthz/u, 'readiness must use the Yance-owned health endpoint rather than generic Parlant health');
  assert.match(runtime, /instanceProof/u, 'readiness must validate an instance-specific proof rather than accept any HTTP 200');
  assert.match(runtime, /PARLANT_ENV\s*:\s*['"]production['"]/u, 'Parlant must run with upstream production authorization as defense in depth');

  assert.match(server, /YANCE_PARLANT_LOOPBACK_TOKEN/u, 'bridge must require the same ephemeral loopback credential');
  assert.match(server, /hmac\.compare_digest/u, 'loopback credential comparison must be constant-time');
  assert.match(server, /@api\.middleware\(\s*["']http["']\s*\)/u, 'authentication must cover the complete Parlant HTTP surface, not only custom routes');
  assert.match(server, /x-yance-parlant-token/iu, 'bridge middleware must reject requests without the Yance loopback credential');
  assert.match(server, /\/yance\/healthz/u, 'bridge must expose an authenticated Yance-owned health proof');

  assert.doesNotMatch(preload, /YANCE_PARLANT_LOOPBACK_TOKEN|x-yance-parlant-token/iu, 'loopback credential must never enter renderer IPC');
  assert.doesNotMatch(workspace, /YANCE_PARLANT_LOOPBACK_TOKEN|x-yance-parlant-token/iu, 'loopback credential must never enter Workspace state');
});

const jsFunctionBody = (source, name) => {
  const start = source.indexOf(`async function ${name}(`);
  if (start === -1) return '';
  let parenDepth = 0;
  let openBrace = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { openBrace = source.indexOf('{', i); break; }
    }
  }
  if (openBrace === -1) return '';
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1); }
  }
  return '';
};

test('Daily Chat Goal is an additive per-localDate Journey, not a date-scoped Relationship Goal', () => {
  const server = readText('runtime/parlant/yance_parlant_server.py');
  const runtime = readText('electron/parlantRelationshipRuntime.js');

  // Persistent Relationship Goal authority stays relationship-stable: no date dimension.
  assert.match(server, /def identifiers\(key: str\)\s*->\s*dict\[str, str\]/u);
  assert.match(server, /["']journey["']\s*:\s*f["']yance-goal-\{short\}["']/u);
  assert.doesNotMatch(server, /yance-goal-\{short\}-\{local_date\}|date_suffix/u);

  // Additive Daily Goal identity reuses canonical agent/customer and derives Journey
  // identity from relationship + localDate.
  assert.match(server, /def daily_goal_identifiers\(key: str, local_date: str\)/u);
  assert.match(server, /["']agent["']\s*:\s*canonical\[["']agent["']\]/u);
  assert.match(server, /["']customer["']\s*:\s*canonical\[["']customer["']\]/u);
  assert.match(server, /yance-daily-chat-goal-\{short\}-\{local_date\}/u);
  assert.match(server, /yance-daily-steer-\{short\}-\{local_date\}/u);

  // Native Parlant labels, strict YYYY-MM-DD validation.
  assert.match(server, /DAILY_GOAL_LABEL\s*=\s*["']yance-daily-chat-goal["']/u);
  assert.match(server, /DAILY_LOCAL_DATE_LABEL_PREFIX\s*=\s*["']yance-local-date["']/u);
  assert.match(server, /f"\{DAILY_LOCAL_DATE_LABEL_PREFIX\}:\{local_date\}"/u);
  assert.match(server, /YANCE_PARLANT_DAILY_LOCAL_DATE_INVALID/u);
  assert.match(server, /re\.compile\(r["']\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$["']\)/u);

  // Independent API seam: daily-chat-goals is a separate route family, and the
  // persistent relationship-goals routes must not accept a localDate dimension.
  assert.match(server, /\/yance\/daily-chat-goals\/\{route_key\}/u);
  assert.match(server, /async def get_daily_chat_goal/u);
  assert.match(server, /async def put_daily_chat_goal/u);
  assert.match(server, /async def delete_daily_chat_goal/u);
  assert.doesNotMatch(server, /async def get_relationship_goal\([^)]*localDate/u);
  assert.doesNotMatch(server, /async def delete_relationship_goal\([^)]*localDate/u);
  assert.doesNotMatch(server, /async def put_relationship_goal\([^)]*localDate/u);

  // Electron runtime is additive: persistent methods never transport localDate,
  // daily methods are a separate narrow seam that hits /yance/daily-chat-goals/.
  for (const name of ['readRelationshipGoal', 'upsertRelationshipGoal', 'deleteRelationshipGoal', 'setRelationshipGoalPaused', 'ingestCustomerMessage', 'requestReplyCandidate']) {
    const body = jsFunctionBody(runtime, name);
    assert.ok(body.length > 0, `${name} must remain present`);
    assert.doesNotMatch(body, /localDate/u, `${name} must not transport localDate`);
  }
  for (const name of ['readDailyChatGoal', 'upsertDailyChatGoal', 'deleteDailyChatGoal']) {
    const body = jsFunctionBody(runtime, name);
    assert.ok(body.length > 0, `${name} must exist`);
    assert.match(body, /localDate/u, `${name} must transport localDate`);
  }
  assert.match(runtime, /\/yance\/daily-chat-goals\/\$\{relationshipKey\(contactId\)\}/u);
  assert.match(runtime, /DESKTOP_PARLANT_DAILY_LOCAL_DATE_INVALID/u);
});

test('Daily Goal identity derives deterministically from relationship + localDate: rollover, idempotent, non-regression, delete isolation', () => {
  const runtimePath = repositoryPath('electron/parlantRelationshipRuntime.js');
  delete require.cache[require.resolve(runtimePath)];
  const { relationshipKey } = require(runtimePath);

  const key = relationshipKey('contact-A');
  const short = key.slice(0, 40);
  const dayA = '2026-09-05';
  const dayB = '2026-09-06';

  const persistentJourney = `yance-goal-${short}`;
  const persistentSteering = `yance-steer-${short}`;
  const dailyJourneyA = `yance-daily-chat-goal-${short}-${dayA}`;
  const dailyJourneyB = `yance-daily-chat-goal-${short}-${dayB}`;

  // rollover: date A -> date B opens a distinct daily journey.
  assert.notEqual(dailyJourneyA, dailyJourneyB);

  // idempotent: same relationship + same localDate resolves the same journey id.
  assert.equal(dailyJourneyA, `yance-daily-chat-goal-${relationshipKey('contact-A').slice(0, 40)}-${dayA}`);

  // non-regression + delete isolation: the daily journey id space is disjoint from
  // the persistent yance-goal-* Relationship Goal authority, so a date rollover or a
  // delete of day B can never touch the persistent relationship goal graph.
  assert.notEqual(dailyJourneyA, persistentJourney);
  assert.notEqual(dailyJourneyB, persistentJourney);
  assert.ok(dailyJourneyA.startsWith('yance-daily-chat-goal-'));
  assert.ok(persistentJourney.startsWith('yance-goal-'));
  assert.ok(!persistentJourney.startsWith('yance-daily-chat-goal-'));
  assert.ok(!persistentSteering.startsWith('yance-daily-'));

  // identity must carry both relationship scope (short) and localDate.
  assert.ok(dailyJourneyA.includes(short), 'daily journey must embed relationship scope');
  assert.ok(dailyJourneyA.endsWith(`-${dayA}`), 'daily journey must embed localDate');

  // The Python source is the authority: assert it uses the exact same derivations.
  const server = readText('runtime/parlant/yance_parlant_server.py');
  assert.match(server, /["']journey["']\s*:\s*f["']yance-goal-\{short\}["']/u, 'persistent journey id must be relationship-stable');
  assert.match(server, /["']journey["']\s*:\s*f["']yance-daily-chat-goal-\{short\}-\{local_date\}["']/u, 'daily journey id must derive from relationship + localDate');
});