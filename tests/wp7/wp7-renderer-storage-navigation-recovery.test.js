'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runRendererStorageProbeNavigation,
  createRendererStorageProbeSession
} = require('../../electron/wp7RendererStorageProbeNavigation');
const {
  WP7_RENDERER_STORAGE_PROBE_PATH,
  WP7_RENDERER_STORAGE_PROBE_MARKER,
  rendererStorageProbeResponse
} = require('../../shared/wp7/rendererStorageProbeDocument');

function fakeView(load, execute, destroyed) {
  let isDestroyed = false;
  return {
    async loadURL(url) { return load(url); },
    webContents: {
      isDestroyed() { return isDestroyed; },
      async executeJavaScript(script, userGesture) { return execute(script, userGesture); }
    },
    isDestroyed() { return isDestroyed; },
    destroy() { isDestroyed = true; destroyed.push(true); }
  };
}

test('safe-mode renderer storage navigation retries transient ERR_FAILED with a fresh trusted view', async () => {
  let created = 0;
  let readinessChecks = 0;
  const destroyed = [];
  const sleeps = [];
  const result = await runRendererStorageProbeNavigation({
    url: `http://127.0.0.1:27632${WP7_RENDERER_STORAGE_PROBE_PATH}`,
    script: "localStorage.setItem('x','1'); 'stored'",
    attempts: 3,
    delayMs: 25,
    waitForReady: async () => { readinessChecks += 1; return { ready: true }; },
    createView: () => {
      created += 1;
      const current = created;
      return fakeView(
        async () => {
          if (current === 1) throw Object.assign(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1:27632'"), { code: 'ERR_FAILED' });
        },
        async (_script, userGesture) => { assert.equal(userGesture, true); return 'stored'; },
        destroyed
      );
    },
    sleep: async (ms) => { sleeps.push(ms); }
  });
  assert.equal(result, 'stored');
  assert.equal(created, 2);
  assert.equal(readinessChecks, 2);
  assert.equal(destroyed.length, 2);
  assert.deepEqual(sleeps, [25]);
});

test('safe-mode renderer storage navigation rejects permanent failure with stable evidence details', async () => {
  const destroyed = [];
  await assert.rejects(
    runRendererStorageProbeNavigation({
      url: `http://127.0.0.1:27632${WP7_RENDERER_STORAGE_PROBE_PATH}`,
      script: "localStorage.removeItem('x'); 'removed'",
      waitForReady: async () => ({ ready: true }),
      createView: () => fakeView(
        async () => { throw Object.assign(new Error('ERR_ACCESS_DENIED'), { code: 'ERR_ACCESS_DENIED' }); },
        async () => 'not-reached',
        destroyed
      ),
      sleep: async () => {}
    }),
    (error) => {
      assert.equal(error.reasonCode, 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_FAILED');
      assert.equal(error.details.failures.length, 1);
      assert.deepEqual(error.details.failures[0], { attempt: 1, phase: 'navigation', code: 'ERR_ACCESS_DENIED', message: 'ERR_ACCESS_DENIED' });
      return true;
    }
  );
  assert.equal(destroyed.length, 1);
});

test('safe-mode matrix reuses one verified renderer across backend restart cycles', async () => {
  let created = 0;
  let readinessChecks = 0;
  const destroyed = [];
  const scripts = [];
  const session = createRendererStorageProbeSession({
    url: `http://127.0.0.1:27632${WP7_RENDERER_STORAGE_PROBE_PATH}`,
    waitForReady: async () => { readinessChecks += 1; return { ready: true }; },
    createView: () => {
      created += 1;
      return fakeView(async () => {}, async (script) => { scripts.push(script); return `receipt-${scripts.length}`; }, destroyed);
    },
    sleep: async () => {}
  });
  assert.equal(await session.execute("localStorage.setItem('x','1')"), 'receipt-1');
  assert.equal(await session.execute("localStorage.removeItem('x')"), 'receipt-2');
  assert.equal(await session.execute("localStorage.setItem('x','1')"), 'receipt-3');
  assert.equal(created, 1, 'later matrix scenarios must not require another local navigation');
  assert.equal(readinessChecks, 1, 'trusted readiness is required when acquiring the retained renderer');
  assert.equal(session.snapshot().retained, true);
  session.dispose();
  assert.equal(session.snapshot().retained, false);
  assert.equal(destroyed.length, 1);
});

test('a failed retained renderer is destroyed and reacquired through the trusted readiness boundary', async () => {
  let created = 0;
  let readinessChecks = 0;
  const destroyed = [];
  const session = createRendererStorageProbeSession({
    url: `http://127.0.0.1:27632${WP7_RENDERER_STORAGE_PROBE_PATH}`,
    waitForReady: async () => { readinessChecks += 1; return { ready: true }; },
    createView: () => {
      created += 1;
      let executions = 0;
      const current = created;
      return fakeView(async () => {}, async () => {
        executions += 1;
        if (current === 1 && executions === 2) throw new Error('renderer process lost');
        return `view-${current}`;
      }, destroyed);
    },
    sleep: async () => {}
  });
  assert.equal(await session.execute("localStorage.setItem('x','1')"), 'view-1');
  assert.equal(await session.execute("localStorage.removeItem('x')"), 'view-2');
  assert.equal(created, 2);
  assert.equal(readinessChecks, 2);
  assert.equal(destroyed.length, 1);
  session.dispose();
  assert.equal(destroyed.length, 2);
});

test('renderer storage probe document is exact, inert and unavailable outside formal safe-mode execution', () => {
  const denied = rendererStorageProbeResponse({
    WP7_PROBE_ID: 'first-start',
    WP7_PROBE_EXECUTION_CLASS: 'PRE_REVIEW_PACKAGED_INTEGRATION'
  });
  assert.equal(denied.statusCode, 404);

  for (const executionClass of ['PRE_REVIEW_PACKAGED_INTEGRATION', 'FINAL_WINDOWS']) {
    const allowed = rendererStorageProbeResponse({
      WP7_PROBE_ID: 'safe-mode-negative',
      WP7_PROBE_EXECUTION_CLASS: executionClass
    });
    assert.equal(allowed.statusCode, 200);
    assert.match(allowed.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.match(allowed.headers['Content-Security-Policy'], /connect-src 'none'/);
    assert.match(allowed.body, new RegExp(`data-wp7-renderer-storage-probe="${WP7_RENDERER_STORAGE_PROBE_MARKER}"`));
    assert.doesNotMatch(allowed.body, /<script\b/i);
    assert.doesNotMatch(allowed.body, /\b(?:src|href)\s*=/i);
  }
});

test('renderer storage navigation rejects a page without the exact inert-document marker', async () => {
  const destroyed = [];
  await assert.rejects(
    runRendererStorageProbeNavigation({
      url: `http://127.0.0.1:27632${WP7_RENDERER_STORAGE_PROBE_PATH}`,
      script: "localStorage.setItem('x','1'); 'stored'",
      waitForReady: async () => ({ ready: true }),
      createView: () => fakeView(async () => {}, async () => 'not-reached', destroyed),
      verifyView: async () => false,
      sleep: async () => {}
    }),
    (error) => {
      assert.equal(error.reasonCode, 'WP7_SAFE_MODE_RENDERER_STORAGE_NAVIGATION_FAILED');
      assert.equal(error.details.failures[0].phase, 'document-verification');
      assert.equal(error.details.failures[0].code, 'WP7_RENDERER_STORAGE_PROBE_DOCUMENT_INVALID');
      return true;
    }
  );
  assert.equal(destroyed.length, 1);
});
