'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SOURCE_PATH = require.resolve('../../../services/durableExecutionAuthority');

function source() {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

test('durable execution rows carry content hash, state version, claim and host fencing facts', () => {
  const text = source();
  for (const marker of [
    'command_content_sha256', 'content_hash_version', 'state_version', 'claim_id',
    'lease_expires_at', 'heartbeat_sequence', 'host_generation', 'fencing_token'
  ]) assert.match(text, new RegExp(marker, 'u'), `missing ${marker}`);
});

test('authoritative transition SQL predicates every stale-writer fact in one UPDATE', () => {
  const text = source();
  const update = text.match(/UPDATE\s+durable_executions[\s\S]*?WHERE[\s\S]*?`/iu)?.[0] || '';
  assert.match(update, /execution_id\s*=\s*\?/iu);
  assert.match(update, /state_version\s*=\s*\?/iu);
  assert.match(update, /generation\s*=\s*\?/iu);
  assert.match(update, /owner_id\s*=\s*\?/iu);
  assert.match(update, /claim_id\s*=\s*\?/iu);
  assert.match(update, /host_generation\s*=\s*\?/iu);
  assert.match(update, /fencing_token\s*=\s*\?/iu);
  assert.match(update, /authority_write_host_lease/iu);
});

test('unconditional execution update is forbidden', () => {
  const text = source();
  assert.doesNotMatch(
    text,
    /UPDATE\s+durable_executions[\s\S]*?WHERE\s+execution_id\s*=\s*\?\s*`/iu
  );
});

test('CAS rejection is based on affected row count', () => {
  const text = source();
  assert.match(text, /changes[^\n]*!==?\s*1/iu);
  assert.match(text, /WP_B_EXECUTION_CAS_REJECTED/u);
});

test('same idempotency key with different canonical content hash fails closed', () => {
  const text = source();
  assert.match(text, /WP_B_EXECUTION_IDEMPOTENCY_CONFLICT/u);
  assert.match(text, /canonicalHash|commandContentSha256|command_content_sha256/u);
});
