'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const wp1 = require('../../tools/wp1/lib');
const { readJson, sha256File } = require('../../tools/wp7/lib');
const { temp } = require('./helpers');
const { isFinalExecution, finalContext } = require('./final-phase-helpers');

test('final-payload-recomputed.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    const release = readJson(context.finalReleaseEvidencePath);
    assert.equal(sha256File(context.payloadFilesPath), release.payloadFilesSha256);
    const records = wp1.generatePayloadRecords(context.payloadRoot);
    assert.equal(wp1.applicationPayloadSha256(records), release.applicationPayloadSha256);
    return;
  }
  const dir = temp('wp7-payload-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  const a = wp1.applicationPayloadSha256(wp1.generatePayloadRecords(dir));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'b');
  const b = wp1.applicationPayloadSha256(wp1.generatePayloadRecords(dir));
  assert.notEqual(a, b);
});
