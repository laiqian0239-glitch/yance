'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('mautrix-meta provisioning secret is materialized through mature bridge config, not a fake _FILE config field', () => {
  const compose = read('services/matrix/docker-compose.yml');
  const registrationStart = compose.indexOf('  mautrix-meta-registration:');
  const registrationEnd = compose.indexOf('\n  mautrix-whatsapp-registration:', registrationStart);
  const registration = compose.slice(registrationStart, registrationEnd);
  const runtimeStart = compose.indexOf('  mautrix-meta:', registrationEnd);
  const runtimeEnd = compose.indexOf('\nvolumes:', runtimeStart);
  const runtime = compose.slice(runtimeStart, runtimeEnd);

  assert.match(registration, /\.provisioning\.shared_secret\s*=\s*load_str\("\/run\/secrets\/yance_mautrix_meta_provisioning_secret"\)/u);
  assert.doesNotMatch(registration, /YANCE_MAUTRIX_META_PROVISIONING__SHARED_SECRET_FILE/u);
  assert.doesNotMatch(runtime, /YANCE_MAUTRIX_META_PROVISIONING__SHARED_SECRET_FILE/u);
});

test('committed mautrix-meta template remains fail-closed until Docker secret materialization', () => {
  const config = read('config/matrix/mautrix-meta/config.yaml');
  assert.match(config, /provisioning:\s*\n(?:[^\n]*\n){0,6}\s*shared_secret:\s*disable\b/u);
  assert.match(config, /allow_matrix_auth:\s*false\b/u);
});
