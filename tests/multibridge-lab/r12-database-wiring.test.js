'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'multibridge-lab', 'fixtures', 'r12-wire-bridge-config-expression.txt');
const IMPLEMENTATION = path.join(ROOT, 'tools', 'multibridge-lab', 'r12-database-wiring.ps1');
const TARGETS = ['instagram-dm', 'google-messages', 'signal'];
const NON_TARGETS = ['facebook-personal', 'line', 'telegram', 'whatsapp'];

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWindowsPowerShell(command) {
  return spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
}

test('historical R12 wiring fixture proves database fields were never mutated', () => {
  assert.ok(fs.existsSync(FIXTURE), `missing historical R12 fixture: ${FIXTURE}`);
  const fixture = fs.readFileSync(FIXTURE, 'utf8');
  assert.match(fixture, /EXACT_YQ_EXPRESSION_BEGIN/);
  assert.match(fixture, /\.homeserver\.address=strenv\(YANCE_HOMESERVER_ADDRESS\)/);
  assert.match(fixture, /\.appservice\.address=strenv\(YANCE_APPSERVICE_ADDRESS\)/);
  assert.match(fixture, /\.bridge\.permissions\[strenv\(YANCE_ADMIN_PERMISSION_KEY\)\]=strenv\(YANCE_ADMIN_PERMISSION\)/);
  const exact = fixture.split('EXACT_YQ_EXPRESSION_BEGIN')[1].split('EXACT_YQ_EXPRESSION_END')[0];
  assert.doesNotMatch(exact, /\.database\.type/);
  assert.doesNotMatch(exact, /\.database\.uri/);
});

test('recovered R12 database wiring implementation exists and remains a thin upstream-native field repair', () => {
  assert.ok(fs.existsSync(IMPLEMENTATION), `missing recovered R12 database wiring implementation: ${IMPLEMENTATION}`);
  const script = fs.readFileSync(IMPLEMENTATION, 'utf8');
  assert.match(script, /function\s+Get-LabR12DatabaseWiring\b/);
  assert.match(script, /sqlite3-fk-wal/);
  assert.match(script, /\.database\.type=strenv\(YANCE_DATABASE_TYPE\)/);
  assert.match(script, /\.database\.uri=strenv\(YANCE_DATABASE_URI\)/);
  assert.doesNotMatch(script, /postgres:\/\/user:password@host\/database\?sslmode=disable/);
  for (const service of TARGETS) assert.match(script, new RegExp(`['\"]${service}['\"]`));
});

test('recovered R12 database wiring targets exactly the three proven database failures', { skip: process.platform !== 'win32' }, () => {
  const command = [
    `. ${psQuote(IMPLEMENTATION)}`,
    `$targets = @(${TARGETS.map(psQuote).join(',')})`,
    `$nonTargets = @(${NON_TARGETS.map(psQuote).join(',')})`,
    'foreach ($service in $targets) {',
    '  $wiring = Get-LabR12DatabaseWiring -Service $service',
    "  if ($null -eq $wiring) { throw ('missing wiring for ' + $service) }",
    "  Write-Output ($service + '|' + $wiring.Type + '|' + $wiring.Uri + '|' + $wiring.YqExpression)",
    '}',
    'foreach ($service in $nonTargets) {',
    '  $wiring = Get-LabR12DatabaseWiring -Service $service',
    "  if ($null -ne $wiring) { throw ('unexpected database rewrite for ' + $service) }",
    '}'
  ].join('\r\n');
  const run = runWindowsPowerShell(command);
  const combined = `${run.stdout || ''}\n${run.stderr || ''}`;
  assert.equal(run.status, 0, `R12 database wiring contract failed:\n${combined}`);
  for (const service of TARGETS) {
    const escaped = service.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(combined, new RegExp(`${escaped}\\|sqlite3-fk-wal\\|file:/data/${escaped}\\.db\\?_txlock=immediate\\|`));
  }
  assert.match(combined, /\.database\.type=strenv\(YANCE_DATABASE_TYPE\)\|\.database\.uri=strenv\(YANCE_DATABASE_URI\)/);
  assert.doesNotMatch(combined, /postgres:\/\//);
});
