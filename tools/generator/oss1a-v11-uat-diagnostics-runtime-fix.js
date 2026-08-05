'use strict';

const fs = require('node:fs');

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`${label}: source block is ambiguous`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function updateFile(filePath, transform) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${filePath}: transformation produced no change`);
  fs.writeFileSync(filePath, after, 'utf8');
}

fs.mkdirSync('requirements', { recursive: true });
fs.writeFileSync('requirements/uat-playwright.txt', 'playwright==1.61.0\n', 'utf8');

fs.mkdirSync('tests/uat/helpers', { recursive: true });
fs.writeFileSync('tests/uat/helpers/authoritySqliteTestHost.js', `'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireAuthorityWriteHost } = require('../../../backend/services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../../../backend/lib/sqliteConnectionBroker');

function restoreEnvironment(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function installAuthoritySqliteTestHost(name) {
  const normalizedName = String(name || 'uat').replace(/[^a-z0-9-]+/giu, '-').toLowerCase();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), \`yance-\${normalizedName}-\`));
  const dbPath = path.join(dataRoot, 'store', 'yance-r32.db');
  const previousEnvironment = {
    YANCE_DATA_DIR: process.env.YANCE_DATA_DIR,
    YANCE_PRIMARY_SQLITE_PATH: process.env.YANCE_PRIMARY_SQLITE_PATH,
    YANCE_TEST_ONLY_SQLITE_BROKER_RESET: process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET
  };
  process.env.YANCE_DATA_DIR = dataRoot;
  process.env.YANCE_PRIMARY_SQLITE_PATH = dbPath;
  process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';

  let host = null;
  let broker = null;
  try {
    resetSqliteConnectionBrokerForTests();
    host = acquireAuthorityWriteHost({
      dbPath,
      instanceId: \`uat-diagnostics:\${normalizedName}:\${process.pid}\`
    });
    broker = createSqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: host.capability
    });
    const store = broker.open();
    let closed = false;
    return Object.freeze({
      dataRoot,
      dbPath,
      store,
      broker,
      close() {
        if (closed) return false;
        closed = true;
        try { broker.checkpointAndClose(); } finally {
          try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
          restoreEnvironment(previousEnvironment);
          fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        }
        return true;
      }
    });
  } catch (error) {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
    restoreEnvironment(previousEnvironment);
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    throw error;
  }
}

module.exports = { installAuthoritySqliteTestHost };
`, 'utf8');

function installHostBeforeProjectImports(filePath, name, firstProjectImport) {
  updateFile(filePath, source => {
    source = replaceExact(
      source,
      `const path = require('node:path');\n\n${firstProjectImport}`,
      `const path = require('node:path');\n\nconst { installAuthoritySqliteTestHost } = require('./helpers/authoritySqliteTestHost');\nconst authoritySqliteTestHost = installAuthoritySqliteTestHost('${name}');\n\n${firstProjectImport}`,
      `${filePath}: install authority SQLite host before project imports`
    );
    const marker = "const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');\n";
    source = replaceExact(
      source,
      marker,
      `${marker}\ntest.after(() => authoritySqliteTestHost.close());\n`,
      `${filePath}: close authority SQLite host`
    );
    return source;
  });
}

installHostBeforeProjectImports(
  'tests/uat/f25WindowsUatRepairBatch20AiUxReadability.test.js',
  'f25-ai-ux-readability',
  "const smoke = require('../../backend/services/openRouterOnboardingSmokeService');"
);
installHostBeforeProjectImports(
  'tests/uat/fix6dRuntimeAuthorityIndependentAudit.test.js',
  'fix6d-runtime-authority-independent-audit',
  "const credentialReceipt = require('../../frontend/js/r32-credential-mutation-receipt');"
);
installHostBeforeProjectImports(
  'tests/uat/fix6dRuntimeAuthorityRepair.test.js',
  'fix6d-runtime-authority-repair',
  "const credentialReceipt = require('../../frontend/js/r32-credential-mutation-receipt');"
);

updateFile('tests/uat/modelRegistryFactSeparation.test.js', source => {
  source = replaceExact(
    source,
    `const fs = require('node:fs');\nconst os = require('node:os');\nconst path = require('node:path');\n\nconst dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-model-fact-separation-'));\nprocess.env.YANCE_DATA_DIR = dataRoot;\n\nconst { closeR32Store } = require('../../backend/lib/r32StoreSingleton');\nconst registry = require('../../backend/services/modelRegistry');\n`,
    `const { installAuthoritySqliteTestHost } = require('./helpers/authoritySqliteTestHost');\nconst authoritySqliteTestHost = installAuthoritySqliteTestHost('model-registry-fact-separation');\n\nconst registry = require('../../backend/services/modelRegistry');\n`,
    'model registry test: replace direct temporary store with broker host'
  );
  source = replaceExact(
    source,
    `test.after(() => {\n  closeR32Store();\n  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });\n});\n`,
    `test.after(() => authoritySqliteTestHost.close());\n`,
    'model registry test: close broker host'
  );
  return source;
});

updateFile('.github/workflows/oss1a-whatsapp-lifecycle.yml', source => {
  source = replaceExact(
    source,
    `    branches:\n      - governance/oss-1a-canonical-projection-checkpoint-authorization\n`,
    `    branches:\n      - governance/oss-1a-uat-diagnostics-runtime-authorization\n`,
    'workflow: current governance base'
  );
  source = replaceExact(
    source,
    `    timeout-minutes: 30\n`,
    `    timeout-minutes: 45\n`,
    'workflow: diagnostics timeout budget'
  );
  source = replaceExact(
    source,
    `      - name: Run UAT diagnostics contracts\n        run: npm run test:uat-diagnostics\n`,
    `      - name: Install pinned Python UAT browser runtime\n        shell: bash\n        run: |\n          set -euo pipefail\n          python3 --version\n          python3 -m pip install --disable-pip-version-check --requirement requirements/uat-playwright.txt\n          python3 -m playwright install --with-deps chromium\n      - name: Run UAT diagnostics contracts\n        run: npm run test:uat-diagnostics\n`,
    'workflow: install real Chromium diagnostics runtime'
  );
  if (source.includes('continue-on-error')) throw new Error('workflow must not use continue-on-error');
  return source;
});

for (const filePath of [
  '.github/workflows/oss1a-whatsapp-lifecycle.yml',
  'requirements/uat-playwright.txt',
  'tests/uat/f25WindowsUatRepairBatch20AiUxReadability.test.js',
  'tests/uat/fix6dRuntimeAuthorityIndependentAudit.test.js',
  'tests/uat/fix6dRuntimeAuthorityRepair.test.js',
  'tests/uat/helpers/authoritySqliteTestHost.js',
  'tests/uat/modelRegistryFactSeparation.test.js'
]) {
  if (!fs.existsSync(filePath)) throw new Error(`candidate path missing: ${filePath}`);
}
