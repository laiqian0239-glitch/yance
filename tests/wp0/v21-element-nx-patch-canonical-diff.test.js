'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PATCH = path.join(ROOT, 'upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch');

function readPatch() {
  assert.equal(fs.existsSync(PATCH), true, 'missing authorized Element Nx CRLF patch');
  return fs.readFileSync(PATCH, 'utf8');
}

function lockSection(patch) {
  const marker = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml';
  const start = patch.indexOf(marker);
  assert.ok(start >= 0, '0003 must contain pnpm-lock.yaml diff');
  return patch.slice(start);
}

function hunkCoordinates(section) {
  return [...section.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu)]
    .map(match => ({
      oldStart: Number(match[1]),
      oldCount: Number(match[2] ?? 1),
      newStart: Number(match[3]),
      newCount: Number(match[4] ?? 1)
    }));
}

test('dense Nx-tools replay is one canonical unified=3 hunk from exact pinned source', () => {
  const section = lockSection(readPatch());
  const dense = hunkCoordinates(section)
    .filter(hunk => hunk.oldStart >= 16370 && hunk.oldStart <= 16425);

  assert.deepEqual(
    dense,
    [{ oldStart: 16375, oldCount: 49, newStart: 16395, newCount: 49 }],
    'standard Git unified=3 context coalesces old 16378..16420 Nx-tools mutations into one exact-source 16375..16423 hunk'
  );
});

test('canonical Nx-tools hunk keeps the frozen mutation set and pinned old identity', () => {
  const patch = readPatch();
  const section = lockSection(patch);
  assert.match(
    section,
    /^index 7e1974c8c30a7f92bdd89bf3562fbb74979e1dbc\.\.[a-f0-9]{40} 100644$/mu,
    'pnpm-lock patch must stay bound to exact pinned Element old blob'
  );

  const denseStart = section.indexOf('@@ -16375,49 +16395,49 @@');
  assert.ok(denseStart >= 0, 'canonical dense Nx-tools hunk must exist');
  const nextHunk = section.indexOf('\n@@ ', denseStart + 1);
  const dense = section.slice(denseStart, nextHunk === -1 ? section.length : nextHunk);

  for (const required of [
    "'@nx-tools/ci-context@7.3.0(@nx/devkit@22.6.5(nx@23.1.1))(tslib@2.8.1)'",
    "'@nx-tools/container-metadata@7.3.0(@nx/devkit@22.6.5(nx@23.1.1))(tslib@2.8.1)'",
    "'@nx-tools/core@7.3.0(@nx/devkit@22.6.5(nx@23.1.1))(tslib@2.8.1)'",
    "'@nx-tools/nx-container@7.3.0(@nx/devkit@22.6.5(nx@23.1.1))",
    'nx: 23.1.1'
  ]) assert.match(dense, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

  assert.doesNotMatch(dense, /matrix-js-sdk|COREPACK_ENABLE|autocrlf|ignore-whitespace|recount/iu);
});

test('remaining Nx runtime replay tail uses exact-source canonical unified=3 hunks', () => {
  const section = lockSection(readPatch());
  const tail = hunkCoordinates(section).filter(hunk => hunk.oldStart >= 23870);

  assert.deepEqual(
    tail,
    [
      { oldStart: 23875, oldCount: 8, newStart: 23907, newCount: 10 },
      { oldStart: 23909, oldCount: 11, newStart: 23943, newCount: 12 },
      { oldStart: 23929, oldCount: 7, newStart: 23964, newCount: 7 },
      { oldStart: 23938, oldCount: 6, newStart: 23973, newCount: 7 },
      { oldStart: 23961, oldCount: 16, newStart: 23997, newCount: 16 },
      { oldStart: 24014, oldCount: 6, newStart: 24050, newCount: 13 },
      { oldStart: 25522, oldCount: 6, newStart: 25565, newCount: 8 }
    ],
    'standard Git unified=3 context must describe every remaining Nx runtime tail mutation against pinned Element a2a996ae source'
  );
});
