'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE_PATH = path.join(ROOT, 'backend', 'services', 'personalAccessService.js');
const SERVER_PATH = path.join(ROOT, 'backend', 'server.js');

function loadServiceWithExistingProjectionGuard() {
  const source = fs.readFileSync(SERVICE_PATH, 'utf8');
  const instance = new Module(SERVICE_PATH, module);
  instance.filename = SERVICE_PATH;
  instance.paths = Module._nodeModulePaths(path.dirname(SERVICE_PATH));
  instance.require = request => {
    if (request === '../core/securityGuardSingleton') {
      return {
        getSecurityGuard() {
          const error = new Error('Existing R32 credential projection is not an import-time construction capability');
          error.code = 'EXISTING_R32_IMPORT_TIME_SECURITY_GUARD_ACQUISITION';
          throw error;
        }
      };
    }
    return Module.createRequire(SERVICE_PATH)(request);
  };
  instance._compile(source, SERVICE_PATH);
  return instance.exports;
}

test('existing-R32 packaged server import does not acquire SecurityGuard while constructing personal access routes', () => {
  const { createPersonalAccessService } = loadServiceWithExistingProjectionGuard();
  assert.doesNotThrow(
    () => createPersonalAccessService(),
    'backend/server.js synchronous import must not acquire existing-data SecurityGuard/credential authority merely to construct the personal-access service'
  );
});

test('personal access resolves credential authority only at request capability use', () => {
  const source = fs.readFileSync(SERVICE_PATH, 'utf8');
  assert.doesNotMatch(source, /constructor\(options = \{\}\) \{[\s\S]*?options\.credentialStore \|\| getSecurityGuard\(\)\.credentials/u);
  assert.match(source, /credentialStoreProvider|resolveCredentialStore/u);
});

test('server registration preserves the lazy credential authority seam', () => {
  const server = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.match(server, /createPersonalAccessService\(\{[\s\S]*?credentialStoreProvider/u);
  assert.doesNotMatch(server, /const personalAccessService = createPersonalAccessService\(\);/u);
});

