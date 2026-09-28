'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const SKILLS = [
  {
    name: 'yance-release-controller',
    admitScript: 'admit:yance-release-controller',
    proveScript: 'prove:yance-release-controller',
  },
  {
    name: 'yance-mature-authority-audit',
    admitScript: 'admit:yance-mature-authority',
    proveScript: 'prove:yance-mature-authority',
  },
  {
    name: 'yance-windows-visual-closure',
    admitScript: 'admit:yance-windows-visual',
    proveScript: 'prove:yance-windows-visual',
  },
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(relativePath, args = []) {
  return spawnSync(process.execPath, [path.join(ROOT, relativePath), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('all three repository skills expose complete executable packages', () => {
  for (const skill of SKILLS) {
    const root = path.join('skills', skill.name);
    for (const required of ['SKILL.md', 'admission.js', 'proof.js', 'evidence-schema.json']) {
      const absolute = path.join(ROOT, root, required);
      assert.equal(fs.statSync(absolute).isFile(), true, `${root}/${required} must be a file`);
      assert.ok(fs.statSync(absolute).size > 100, `${root}/${required} must not be a placeholder`);
    }

    const tests = fs.readdirSync(path.join(ROOT, root, 'tests')).filter((file) => file.endsWith('.test.js'));
    assert.ok(tests.length > 0, `${root}/tests must contain executable behavior tests`);

    const skillText = read(`${root}/SKILL.md`);
    assert.match(skillText, new RegExp(`^name: ${skill.name}$`, 'mu'));
    assert.match(skillText, /^description: .+$/mu);
    assert.match(skillText, /admission\.js/u);
    assert.match(skillText, /proof\.js/u);
    assert.match(skillText, /evidence-schema\.json/u);

    const schema = JSON.parse(read(`${root}/evidence-schema.json`));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');

    for (const executable of ['admission.js', 'proof.js']) {
      const help = run(`${root}/${executable}`, ['--help']);
      assert.equal(help.status, 0, `${root}/${executable} --help failed: ${help.stderr}`);
      assert.match(help.stdout, /Usage:/u);

      const missingEvidence = run(`${root}/${executable}`);
      assert.notEqual(missingEvidence.status, 0, `${root}/${executable} must fail closed without evidence`);
    }
  }
});

test('package scripts route to the exact repository-owned skill entrypoints', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const skill of SKILLS) {
    assert.equal(
      pkg.scripts[skill.admitScript],
      `node skills/${skill.name}/admission.js`,
      `${skill.admitScript} must not route through an alternate helper`,
    );
    assert.equal(
      pkg.scripts[skill.proveScript],
      `node skills/${skill.name}/proof.js`,
      `${skill.proveScript} must not route through an alternate helper`,
    );
  }
  assert.match(pkg.scripts['test:yance-skills'], /v21-yance-repository-skills\.test\.js/u);
  for (const skill of SKILLS) {
    assert.match(pkg.scripts['test:yance-skills'], new RegExp(`skills/${skill.name}/tests/\\*\\.test\\.js`, 'u'));
  }
});

test('AGENTS routes recovery, production mutation, and Windows visual proof without gate substitution', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /Fresh chat \/ context recovery\s*\r?\n-> skills\/yance-release-controller\//u);
  assert.match(agents, /Any production mutation\s*\r?\n-> skills\/yance-mature-authority-audit\//u);
  assert.match(agents, /Any real UI \/ Windows Product acceptance\s*\r?\n-> skills\/yance-windows-visual-closure\//u);
  assert.match(agents, /A DOM node, mounted class, source test, successful build, or synthetic\/browser-only image is never sufficient Windows visual proof/u);
  assert.match(agents, /A GREEN admission never expands allowed paths and never grants commit, push, PR, CI, merge, RC, UAT, or release permission/u);
});
