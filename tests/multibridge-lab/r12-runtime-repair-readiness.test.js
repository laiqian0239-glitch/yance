'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const LOGIN_AUTHORITY = path.join(ROOT, 'tests', 'multibridge-lab', 'fixtures', 'runtime-login-flow-authorities.json');
const IMPLEMENTATION = path.join(ROOT, 'tools', 'multibridge-lab', 'r12-runtime-repair-readiness.ps1');
const WRAPPER = path.join(ROOT, 'tools', 'multibridge-lab', 'RUN_R12_RUNTIME_REPAIR_READINESS.cmd');
const README = path.join(ROOT, 'tools', 'multibridge-lab', 'R12_RUNTIME_REPAIR_READINESS_README.txt');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'multibridge-lab-native-process.yml');
const TARGETS = ['facebook-personal', 'instagram-dm', 'google-messages', 'signal', 'line'];

test('exact-five upstream login-flow authorities are frozen before the human-auth boundary', () => {
  const authority = JSON.parse(fs.readFileSync(LOGIN_AUTHORITY, 'utf8'));
  assert.equal(authority.schemaVersion, 1);
  assert.deepEqual(authority.authorities.map(item => item.service), TARGETS);
  assert.deepEqual(authority.authorities.map(item => item.blob), [
    '1ddef424aefef63affed39509886d81ec47ea4d5',
    'be0e8bd071fdcf3a1345f8067bea7302bbe25ef7',
    '1c2c2ad8582f75ac017fc9bcfbfe77c131505199',
    '0446d23eb96cfb00056c070de60e216e3af25bdb',
    'cae3a391ad546be2a7ebce0ac146da0a5bcaecbc'
  ]);
  for (const item of authority.authorities) assert.equal(item.flowEvidence, 'GetLoginFlows');
});

test('final Windows runtime repair/readiness package is thin, exact-five, Compose-native and fail-closed', () => {
  assert.ok(fs.existsSync(IMPLEMENTATION), `missing runtime repair/readiness implementation: ${IMPLEMENTATION}`);
  assert.ok(fs.existsSync(WRAPPER), `missing user-visible runtime wrapper: ${WRAPPER}`);
  assert.ok(fs.existsSync(README), `missing user runtime README: ${README}`);

  const script = fs.readFileSync(IMPLEMENTATION, 'utf8');
  const wrapper = fs.readFileSync(WRAPPER, 'utf8');
  const readme = fs.readFileSync(README, 'utf8');
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  assert.match(script, /r12-database-wiring\.ps1/);
  assert.match(script, /Get-LabR12DatabaseWiring/);
  assert.match(script, /runtime[\\/]docker-compose\.lab\.yml/);
  for (const service of TARGETS) assert.match(script, new RegExp(`['\"]${service}['\"]`));

  assert.match(script, /del\(\.database\.type,\s*\.database\.uri\)/);
  assert.match(script, /NON_DATABASE_CONFIG_HASH_GREEN/);
  assert.match(script, /\.database\.type=strenv\(YANCE_DATABASE_TYPE\)/);
  assert.match(script, /\.database\.uri=strenv\(YANCE_DATABASE_URI\)/);
  assert.match(script, /\[IO\.File\]::Replace\(/);
  assert.doesNotMatch(script, /\.homeserver\.address\s*=/);
  assert.doesNotMatch(script, /\.appservice\.address\s*=/);
  assert.doesNotMatch(script, /\.bridge\.permissions\[/);
  assert.doesNotMatch(script, /registration\.yaml.*(?:Set-Content|Copy-Item|Move-Item|Remove-Item)/i);

  assert.match(script, /compose[\s\S]*config[\s\S]*--services/);
  assert.match(script, /COMPOSE_AUTHORITY_GREEN/);
  assert.doesNotMatch(script, /docker\s+network\s+create/i);
  assert.doesNotMatch(script, /(?:hosts|etc\/hosts).*Add-Content/i);
  assert.doesNotMatch(script, /R13/i);

  assert.match(script, /UPSTREAM_CONFIG_VALIDATION_GREEN/);
  assert.match(script, /RestartCount/);
  assert.match(script, /RestartCount\s+-ne\s+0/);
  assert.match(script, /SUSTAINED_RUNTIME_GREEN/);
  assert.match(script, /Start-Sleep\s+-Seconds\s+15/);

  assert.match(script, /exec[\s\S]*-T[\s\S]*synapse[\s\S]*python/);
  assert.match(script, /socket\.create_connection/);
  assert.match(script, /exec[\s\S]*-T[\s\S]*curl/);
  assert.match(script, /_matrix\/client\/versions/);
  assert.match(script, /SYNAPSE_TO_BRIDGES_GREEN/);
  assert.match(script, /BRIDGES_TO_SYNAPSE_GREEN/);

  assert.match(script, /runtime-login-flow-authorities\.json/);
  assert.match(script, /LOGIN_FLOW_AUTHORITY_GREEN/);
  assert.match(script, /LAB_RUNTIME_READY/);
  assert.match(script, /HUMAN_AUTH_REQUIRED/);
  assert.match(script, /REAL_RED/);
  assert.match(script, /GREEN/);
  assert.doesNotMatch(script, /CreateLogin|SubmitCookies|PerformProvisioning|enter_creds/i);

  assert.doesNotMatch(script, /compose[\s\S]*logs/i);
  assert.doesNotMatch(script, /upload-artifact/i);
  assert.doesNotMatch(script, /Get-Content[^\n]*(?:registration\.yaml|lab-password|lab-account)/i);

  assert.match(wrapper, /powershell(?:\.exe)?/i);
  assert.match(wrapper, /pause/i);
  assert.match(wrapper, /exit\s+\/b\s+%/i);

  assert.doesNotMatch(wrapper, /-ExecutionPolicy\s+(?:Bypass|Unrestricted)/i);
  assert.doesNotMatch(wrapper, /Set-ExecutionPolicy/i);
  assert.doesNotMatch(wrapper, /Get-FileHash/);
  assert.match(wrapper, /\[Security\.Cryptography\.SHA256\]::Create\(\)/);
  assert.match(wrapper, /\[IO\.File\]::OpenRead/);
  assert.match(wrapper, /ComputeHash/);
  assert.match(wrapper, /PACKAGE_INTEGRITY_GREEN/);
  assert.match(wrapper, /Unblock-File/);
  assert.match(wrapper, /PACKAGE_MOTW_RELEASE_GREEN/);
  for (const hash of [
    '552f9cd47c8138ff6d2ee7b9394b23581dedfe9fb86859ee92a9d151f6c68e5c',
    '47c9a239414ed7f11cdcaaad6c9f3efd47a9f41a1bd59a84824d948e6bbca7d3',
    'fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d',
    '29e1b882feadb8abe87ca89906a898601ee4e1c369532b0faf9f20999d238c6f'
  ]) assert.match(wrapper, new RegExp(hash));
  const integrityIndex = wrapper.indexOf('PACKAGE_INTEGRITY_GREEN');
  const unblockIndex = wrapper.indexOf('Unblock-File');
  const invokeIndex = wrapper.lastIndexOf('-File "%~dp0r12-runtime-repair-readiness.ps1"');
  assert.ok(integrityIndex >= 0 && unblockIndex > integrityIndex && invokeIndex > unblockIndex,
    'wrapper must verify sealed bytes before unblocking and invoking the runtime script');
  assert.doesNotMatch(wrapper, /Get-ChildItem[^\r\n]*Unblock-File/i);

  assert.match(readme, /C:\\Users\\1\\Downloads\\yance-multibridge-lab/);
  assert.match(readme, /HUMAN_AUTH_REQUIRED/);
  assert.match(readme, /do not upload/i);

  assert.match(workflow, /yance-multibridge-r12-runtime-repair-readiness/);
  assert.match(workflow, /r12-runtime-repair-readiness\.ps1/);
  assert.match(workflow, /RUN_R12_RUNTIME_REPAIR_READINESS\.cmd/);
  assert.match(workflow, /R12_RUNTIME_REPAIR_READINESS_README\.txt/);
  assert.match(workflow, /powershell\.exe\s+-NoLogo\s+-NoProfile\s+-NonInteractive/);
  assert.match(workflow, /WINDOWS_POWERSHELL_5_1_PARSE_GREEN/);

  assert.match(workflow, /Zone\.Identifier/);
  assert.match(workflow, /PSExecutionPolicyPreference/);
  assert.match(workflow, /MOTW_BOOTSTRAP_GREEN/);
  assert.match(workflow, /FINAL STATUS: REAL_RED/);
  assert.match(workflow, /PSSecurityException/);
});
