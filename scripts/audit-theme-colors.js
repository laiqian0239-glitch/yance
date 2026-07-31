#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const colorPattern = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
const extensions = new Set(['.css', '.js', '.html']);
const paletteSources = new Set([
  'frontend/r32-theme-motion.css',
  'frontend/r32-theme-motion.js',
  'frontend/r32-theme-authority.css'
]);
const legacyDebt = Object.freeze({
  'frontend/index.html': 0
});
const maintainedRuntimeFiles = Object.freeze([
  'frontend/js/r32-ui-runtime.js',
  'frontend/r32-system-center.js',
  'frontend/js/r32-insights-runtime.js',
  'frontend/js/r32-ai-workbench-runtime.js',
  'frontend/js/sqliteConversationRuntime.js',
  'frontend/js/r32-safe-mode-runtime.js',
  'frontend/r32-account-center.js',
  'frontend/r32-phase1-governance.css'
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function countColors(file) {
  const text = fs.readFileSync(file, 'utf8');
  return (text.match(colorPattern) || []).length;
}

const all = walk(frontend)
  .filter(file => extensions.has(path.extname(file).toLowerCase()))
  .map(file => ({
    file: path.relative(root, file).replaceAll(path.sep, '/'),
    count: countColors(file)
  }))
  .filter(row => row.count > 0)
  .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

const failures = [];
for (const relative of maintainedRuntimeFiles) {
  const absolute = path.join(root, relative);
  const count = countColors(absolute);
  if (count > 0) failures.push(`${relative}: ${count} fixed color literal(s)`);
}
for (const [relative, baseline] of Object.entries(legacyDebt)) {
  const count = countColors(path.join(root, relative));
  if (count > baseline) failures.push(`${relative}: fixed-color debt increased ${baseline} -> ${count}`);
}
for (const row of all) {
  if (paletteSources.has(row.file) || Object.hasOwn(legacyDebt, row.file) || maintainedRuntimeFiles.includes(row.file)) continue;
  failures.push(`${row.file}: unclassified fixed-color source (${row.count})`);
}

const report = {
  schemaVersion: 1,
  policy: {
    semanticContract: 'frontend/r32-theme-semantic-contract.css',
    paletteSources: [...paletteSources],
    maintainedRuntimeFiles: [...maintainedRuntimeFiles],
    legacyDebt
  },
  fixedColorSources: all,
  failures
};

const output = path.join(root, 'governance', 'theme-color-debt-report.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (failures.length) {
  console.error('Theme color audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Theme color audit PASS. Legacy inline structural color debt: ${legacyDebt['frontend/index.html']}; maintained runtime fixed colors: 0.`);
