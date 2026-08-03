# WP-B Implementation Plan — Amendment 1

- Status: `NORMATIVE`
- Applies to: `docs/superpowers/plans/2026-08-03-yance-acv2-wp-b-implementation.md`
- Reason: implementation-plan self-review found one XState v5 snapshot-construction error and two inventory/import-closure gaps.

This amendment is part of the implementation plan. Where it conflicts with the base plan, this document controls.

## 1. Correct XState v5 Adapter implementation

Replace the `createLifecycleAdapter` example in Task 3 with:

```js
'use strict';
const { createMachine, getInitialSnapshot, getNextSnapshot } = require('xstate');

function flatStateValue(snapshot) {
  if (typeof snapshot.value !== 'string') {
    const error = new Error('WP-B lifecycle must remain a flat state machine');
    error.code = 'WP_B_LIFECYCLE_STATE_SHAPE_INVALID';
    throw error;
  }
  return snapshot.value;
}

function createLifecycleAdapter(config) {
  const machine = createMachine(config);
  return Object.freeze({
    initialState() {
      return flatStateValue(getInitialSnapshot(machine));
    },
    transition(state, eventType) {
      const current = machine.resolveState({ value: String(state), context: {} });
      const next = getNextSnapshot(machine, current, { type: String(eventType) });
      return flatStateValue(next);
    }
  });
}

module.exports = { createLifecycleAdapter };
```

The public Yance module must reject nested/parallel state values. WP-B uses XState only to validate a flat durable lifecycle; database state remains the authority.

## 2. Add automatic operation call-site discovery to Task 1

Add these files to Task 1:

- Create: `tools/architecture-closure-v2/discover-wp-b-operation-call-sites.js`
- Create: `backend/tests/architectureClosureV2/wpB/operationInventoryDiscovery.test.js`

The discovery tool must scan these roots:

```js
const DISCOVERY_ROOTS = Object.freeze([
  'backend',
  'electron',
  'services',
  'tools'
]);
```

It must classify at least these source patterns:

```js
const PATTERNS = Object.freeze([
  ['CHILD_PROCESS_EXTERNAL_EXECUTION', /\b(?:fork|spawn|execFile)\s*\(/u],
  ['NETWORK_CLIENT_CALL', /\b(?:fetch|axios\.|request\(|https?\.(?:get|request))\b/u],
  ['PLATFORM_OR_PROVIDER_CALL', /\b(?:sendMessage|sendMedia|invokeProvider|executeModel|restoreSession|fetchHistory|downloadMedia|uploadMedia)\s*\(/u],
  ['RETRY_OR_TIMER', /\b(?:setTimeout|setInterval|retry|backoff|nextAttemptAt)\b/u],
  ['RECOVERY_ENTRYPOINT', /\b(?:recover|resume|restore|reconcile|repair)\w*\s*\(/u]
]);
```

The test must fail whenever a discovered path is absent from `wp-b-operation-inventory.json`:

```js
test('every discovered WP-B call site has an inventory row', () => {
  const report = discoverCallSites(REPO_ROOT);
  assert.equal(report.unregistered.length, 0, JSON.stringify(report.unregistered, null, 2));
});
```

Generated rows are proposals only. Each row must still be reviewed and assigned an operation kind, owner, idempotency strategy, receipt capability, reconciliation policy and removal condition before Task 1 closes.

## 3. Enforce one production XState import boundary

Extend `verify-wp-b-open-source-adoption.js` and `openSourceAdoptionGate.test.js` with a source scan that requires:

```text
production files containing require('xstate') or import ... from 'xstate': exactly 1
allowed path: backend/services/xstateLifecycleAdapter.js
```

The verifier must emit:

```json
{
  "xstateProductionImportCount": 1,
  "xstateProductionImportPaths": [
    "backend/services/xstateLifecycleAdapter.js"
  ]
}
```

Zero imports after Task 3 means the original module was not actually introduced. More than one import means the Yance Adapter boundary was bypassed. Both conditions fail closed.

## 4. Upstream tests and platform tests remain distinct gates

- XState upstream `pnpm test:core` runs against exact tag `xstate@5.32.5` in an isolated Ubuntu job and records the tag commit SHA and normalized output hash.
- Yance Adapter, lifecycle, Schema, CAS, outbox and fault tests run on both Ubuntu and Windows.
- Passing Yance tests cannot replace upstream tests.
- Passing upstream tests cannot replace Yance RED, Adapter or platform/fault tests.

## 5. Open-source final authorization timing

The registry may record Steps 1–8 during Milestone 1 and Step 9 after the Ubuntu/Windows/fault matrix. Step 10 is completed only after NOTICE/SBOM/provenance artifacts are bound to the final reviewed Head. Step 11 is completed only by the final independent review.

Until all eleven steps are complete:

```text
openSourceAdoptionGate=PENDING
xstateProductionUseAuthorized=false
wpBClosureAllowed=false
```

The code may exist on the Draft WP-B branch after Step 6, but it cannot be promoted, merged or described as approved production adoption before Step 11.
