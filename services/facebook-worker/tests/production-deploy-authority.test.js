import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalConfigPath = path.join(workerDir, 'wrangler.jsonc');
const requiredSecretsPath = path.join(workerDir, 'required-secrets.json');
const legacyDeployConfigPath = path.join(workerDir, 'wrangler.deploy.local.jsonc');
const EXPECTED_PRODUCTION_D1_ID = '9394aab2-8a7d-40fa-88b5-90455a7a0bbd';
const EXPECTED_REQUIRED_SECRETS = Object.freeze([
  'META_APP_ID',
  'META_APP_SECRET',
  'META_VERIFY_TOKEN',
  'TOKEN_ENCRYPTION_KEY',
  'DESKTOP_AUTH_MASTER_KEY'
]);

function readCanonicalConfig() {
  return JSON.parse(fs.readFileSync(canonicalConfigPath, 'utf8'));
}

test('Facebook Public has one canonical deployable Wrangler authority with the sealed production D1 binding', () => {
  const config = readCanonicalConfig();
  const db = config.d1_databases?.find((item) => item.binding === 'DB');
  assert.equal(db?.database_name, 'yance-facebook-gateway');
  assert.equal(db?.database_id, EXPECTED_PRODUCTION_D1_ID);
  assert.equal(config.vars?.OAUTH_STATE_TTL_SECONDS, '600');
  assert.equal(fs.existsSync(legacyDeployConfigPath), false, 'legacy divergent wrangler.deploy.local.jsonc must be retired');
});

test('canonical production deployment has a non-secret required-secret manifest without inventing Wrangler config fields', () => {
  const config = readCanonicalConfig();
  assert.equal(config.secrets, undefined, 'required secret policy must stay outside the official Wrangler configuration schema');
  assert.equal(fs.existsSync(requiredSecretsPath), true, 'required-secrets.json must declare Worker-owned secret names');
  const manifest = JSON.parse(fs.readFileSync(requiredSecretsPath, 'utf8'));
  assert.deepEqual(manifest.required, EXPECTED_REQUIRED_SECRETS);
});
