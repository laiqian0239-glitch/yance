'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PLACEHOLDERS = Object.freeze({
  '__EXPECTED_COMMIT__': 'expectedCommit',
  '__EXPECTED_TREE__': 'expectedTree',
  '__BRANCH__': 'branch',
  '__BUNDLE_SHA256__': 'bundleSha256',
  '__SHORT_COMMIT__': 'shortCommit'
});

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${key || '<end>'}`);
    result[key.slice(2)] = value;
  }
  for (const required of ['template', 'binding', 'output']) {
    if (!result[required]) throw new Error(`missing required option --${required}`);
  }
  return result;
}

function assertHex(value, length, field) {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`${field} must be lowercase ${length}-character hex`);
  }
}

function validateBinding(binding) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error('binding must be an object');
  assertHex(binding.expectedCommit, 40, 'expectedCommit');
  assertHex(binding.expectedTree, 40, 'expectedTree');
  assertHex(binding.bundleSha256, 64, 'bundleSha256');
  if (typeof binding.branch !== 'string' || !binding.branch || /[\0\r\n]/.test(binding.branch)) throw new Error('branch is invalid');
  const shortCommit = binding.expectedCommit.slice(0, 7);
  return { ...binding, shortCommit };
}

function renderTemplate(template, rawBinding) {
  const binding = validateBinding(rawBinding);
  let rendered = String(template);
  for (const [placeholder, field] of Object.entries(PLACEHOLDERS)) {
    rendered = rendered.split(placeholder).join(binding[field]);
  }
  const unresolved = rendered.match(/__[A-Z0-9_]+__/g);
  if (unresolved) throw new Error(`unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  return rendered.replace(/^\uFEFF/, '');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const templatePath = path.resolve(args.template);
  const bindingPath = path.resolve(args.binding);
  const outputPath = path.resolve(args.output);
  const template = fs.readFileSync(templatePath, 'utf8');
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  const rendered = renderTemplate(template, binding);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `\uFEFF${rendered}`, 'utf8');
  process.stdout.write(`${outputPath}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, validateBinding, renderTemplate };
