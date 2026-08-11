'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-pinned-db-image-validation.yml');

function matrixBlock(source, service, nextService) {
  const start = source.indexOf(`- service: ${service}`);
  assert.notEqual(start, -1, `missing pinned DB matrix service ${service}`);
  const end = nextService ? source.indexOf(`- service: ${nextService}`, start + 1) : source.indexOf('    steps:', start + 1);
  assert.notEqual(end, -1, `could not bound matrix block for ${service}`);
  return source.slice(start, end);
}

test('pinned DB image validation covers exactly the five R12 database repair targets with exact upstream identities', () => {
  assert.ok(fs.existsSync(WORKFLOW), `missing pinned DB workflow: ${WORKFLOW}`);
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const services = ['facebook-personal', 'instagram-dm', 'google-messages', 'signal', 'line'];
  for (const service of services) assert.match(source, new RegExp(`- service: ${service}\\b`));
  assert.doesNotMatch(source, /- service: (?:telegram|whatsapp)\b/);

  const facebook = matrixBlock(source, 'facebook-personal', 'instagram-dm');
  assert.match(facebook, /repository: mautrix\/meta/);
  assert.match(facebook, /commit: a0db68a56bb5715d67faa331f647e771d62b05a2/);
  assert.match(facebook, /dockerfile: Dockerfile\b/);
  assert.match(facebook, /binary: \/usr\/bin\/mautrix-meta\b/);

  const line = matrixBlock(source, 'line');
  assert.match(line, /repository: beeper\/line/);
  assert.match(line, /commit: 0fc10ea165b54db6ffd7c085d42cc42b0ce46414/);
  assert.match(line, /dockerfile: Dockerfile\b/);
  assert.match(line, /binary: \/usr\/bin\/matrix-line\b/);
});

test('pinned DB image validation requires the exact binary to remain running with exit code zero', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  assert.doesNotMatch(source, /DB_VALIDATION_GREEN_LATER_NONCONFIG_EXIT/);
  assert.match(source, /if \[ "\$state" != running \] \|\| \[ "\$exit_code" != 0 \]; then/);
  assert.match(source, /write_report PROCESS_NOT_RUNNING/);
  assert.match(source, /exit 35/);
  assert.match(source, /PINNED_IMAGE_DB_STARTUP_GREEN/);
});
