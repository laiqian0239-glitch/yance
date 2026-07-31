'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('recovery state refresh shares in-flight requests and suppresses focus bursts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-safe-mode-runtime.js'), 'utf8');
  const refreshSource = extract(source, 'async function refresh', '\nfunction scheduleRefresh');
  let calls = 0;
  const context = {
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    refreshPromise: null,
    lastRefreshAt: 0,
    render() {},
    window: {
      YanceCore: {
        recovery: {
          async state() {
            calls += 1;
            await new Promise(resolve => setTimeout(resolve, 20));
            return { safeMode: { active: false } };
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(refreshSource, context);
  await Promise.all([
    vm.runInContext('refresh()', context),
    vm.runInContext('refresh()', context),
    vm.runInContext('refresh()', context)
  ]);
  assert.equal(calls, 1);
  await vm.runInContext('refresh()', context);
  assert.equal(calls, 1);
  await vm.runInContext('refresh({force:true})', context);
  assert.equal(calls, 2);
});

test('focus and network handlers use the coalesced scheduler', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-safe-mode-runtime.js'), 'utf8');
  assert.match(source, /addEventListener\('focus', \(\) => scheduleRefresh\(\)\)/);
  assert.match(source, /browserOnline\) scheduleRefresh\(\{ force: true \}\)/);
  assert.doesNotMatch(source, /addEventListener\('focus', refresh\)/);
});
