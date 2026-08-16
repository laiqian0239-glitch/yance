'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PRODUCTION_ROOTS = ['backend','electron','shared','assets'];
function rel(file) { return path.relative(ROOT, file).split(path.sep).join('/'); }
function walk(root, options = {}) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (error) { if (options.errors) options.errors.push({ path: current, error: error.message }); continue; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full); else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function tempRoot(prefix = 'yance-wp6-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, { cwd: options.cwd || ROOT, encoding: 'utf8', timeout: options.timeout || 180000, env: { ...process.env, ...(options.env || {}) } });
  return { status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.message || '' };
}
function git(args, cwd = ROOT) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function utcNow() { return new Date().toISOString(); }
module.exports = { ROOT, PRODUCTION_ROOTS, git, readJson, rel, runNode, sha256File, stable, tempRoot, utcNow, walk, writeJson };
