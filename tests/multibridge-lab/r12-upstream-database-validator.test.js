'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const AUTHORITY_FILE = path.join(ROOT, 'tests', 'multibridge-lab', 'fixtures', 'upstream-database-validator-authorities.json');
const IMPLEMENTATION = path.join(ROOT, 'tools', 'multibridge-lab', 'r12-database-wiring.ps1');

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

test('frozen upstream database validator authorities have the exact three-service identity', () => {
  const authority = JSON.parse(fs.readFileSync(AUTHORITY_FILE, 'utf8'));
  assert.equal(authority.schemaVersion, 1);
  assert.equal(authority.placeholderUri, 'postgres://user:password@host/database?sslmode=disable');
  assert.equal(authority.fatalError, 'database.uri not configured');
  assert.equal(authority.supportedSqliteType, 'sqlite3-fk-wal');
  assert.equal(authority.recommendedSqliteUriPattern, 'file:<path>?_txlock=immediate');
  assert.deepEqual(authority.authorities.map(item => item.service), ['instagram-dm', 'google-messages', 'signal']);
  assert.deepEqual(authority.authorities.map(item => item.bridgev2Commit), [
    '56938b8a508d37c2501629d9b35538e849f4a63b',
    '5743d9b6f27e2de4966f50e13a658308cdcdbbcb',
    'f7cfa8766d2bcf45f944fc76ea856bcc36317ad9'
  ]);
  assert.deepEqual(authority.authorities.map(item => item.validatorBlob), [
    '667d48e5e4647d58802ec87b67f7b294e00cd5a8',
    'f83032370ba81302451157dd96f7c8f2cdd2f15c',
    'e1321e6421b387b2b8651861f51559d10eca2f1b'
  ]);
});

test('R12 generated database values clear every frozen upstream database.uri fatal predicate', { skip: process.platform !== 'win32' }, () => {
  const authority = JSON.parse(fs.readFileSync(AUTHORITY_FILE, 'utf8'));
  const services = authority.authorities.map(item => item.service);
  const command = [
    `. ${psQuote(IMPLEMENTATION)}`,
    `$services = @(${services.map(psQuote).join(',')})`,
    'foreach ($service in $services) {',
    '  $wiring = Get-LabR12DatabaseWiring -Service $service',
    "  if ($null -eq $wiring) { throw ('missing wiring for ' + $service) }",
    '  [pscustomobject]@{ Service = $service; Type = $wiring.Type; Uri = $wiring.Uri; YqExpression = $wiring.YqExpression } | ConvertTo-Json -Compress',
    '}'
  ].join('\r\n');
  const run = runWindowsPowerShell(command);
  assert.equal(run.status, 0, `failed to evaluate recovered R12 wiring:\n${run.stdout}\n${run.stderr}`);
  const rows = run.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.equal(rows.length, authority.authorities.length);
  for (const source of authority.authorities) {
    const row = rows.find(item => item.Service === source.service);
    assert.ok(row, `missing generated wiring for ${source.service}`);
    assert.equal(row.Type, authority.supportedSqliteType);
    assert.notEqual(row.Uri, authority.placeholderUri, `${source.service} still matches exact fatal placeholder`);
    assert.equal(row.Uri, `file:/data/${source.service}.db?_txlock=immediate`);
    assert.match(row.Uri, /^file:\/data\/[a-z0-9-]+\.db\?_txlock=immediate$/);
    assert.equal(row.YqExpression, '.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)');
  }
});
