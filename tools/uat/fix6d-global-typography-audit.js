'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AUTHORITY = 'frontend/r32-global-reading.css';
const REQUIRED_TOKENS = Object.freeze([
  '--type-page-title',
  '--type-section-title',
  '--type-card-title',
  '--type-body',
  '--type-body-strong',
  '--type-caption',
  '--type-meta',
  '--type-control',
  '--type-badge',
  '--type-data-value'
]);
const REQUIRED_TOKEN_SET = new Set(REQUIRED_TOKENS);
const LEGACY_TYPOGRAPHY_TOKEN = /--ws-(?:page-title|page-copy|section-title|section|card-title|body|small|meta|number|button|title)\b/giu;
const FONT_SIZE_KEYWORD = /^(?:inherit|initial|unset|revert)$/iu;
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SCAN_ROOTS = Object.freeze([
  'frontend',
  'integration/element-module/src'
]);

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function walk(dir) {
  const output = [];
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'assets') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute));
    else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

function record(violations, type, relativePath, line, value) {
  violations.push(Object.freeze({ type, file: relativePath, line, value: String(value || '').trim() }));
}

function isAllowedFontSize(value) {
  if (FONT_SIZE_KEYWORD.test(value)) return true;
  const match = value.match(/^var\((--type-[a-z0-9-]+)\)$/iu);
  return Boolean(match && REQUIRED_TOKEN_SET.has(match[1].toLowerCase()));
}

function semanticShorthandToken(value) {
  const match = value.match(/(?:^|\s|\/)var\((--type-[a-z0-9-]+)\)(?:\s*\/|\s|$)/iu);
  return match?.[1]?.toLowerCase() || '';
}

function scanFile(root, absolutePath, violations, definitions, readingSelectors) {
  const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
  const text = fs.readFileSync(absolutePath, 'utf8');

  for (const match of text.matchAll(/font-size\s*:\s*([^;}{]+)/giu)) {
    const value = match[1].trim();
    if (/!important/iu.test(value)) record(violations, 'font-size-important', relativePath, lineAt(text, match.index), value);
    const normalized = value.replace(/\s*!important\s*$/iu, '').trim();
    if (!isAllowedFontSize(normalized)) record(violations, 'non-semantic-font-size', relativePath, lineAt(text, match.index), value);
  }

  for (const match of text.matchAll(/(?:^|[;{])\s*font\s*:\s*([^;}{]+)/gimu)) {
    const value = match[1].trim();
    const shorthandToken = semanticShorthandToken(value);
    const semanticShorthand = /^inherit$/iu.test(value) || Boolean(shorthandToken && REQUIRED_TOKEN_SET.has(shorthandToken));
    if (!semanticShorthand && (shorthandToken || /(?:\d*\.)?\d+(?:px|rem|em|pt)\b/iu.test(value))) {
      record(violations, 'non-semantic-font-shorthand', relativePath, lineAt(text, match.index), value);
    }
  }

  if (relativePath.endsWith('.html')) {
    for (const match of text.matchAll(/style\s*=\s*(["'])[^"']*font-size\s*:[^"']*\1/giu)) {
      record(violations, 'inline-font-size', relativePath, lineAt(text, match.index), match[0]);
    }
  }

  const dynamicPatterns = [
    /\.style\.fontSize\s*=/giu,
    /style\.setProperty\(\s*(["'])font-size\1/giu,
    /style\.setProperty\(\s*(["'])(?:--type-|--ws-(?:page-title|page-copy|section-title|section|card-title|body|small|meta|number|button|title))[^"']*\1/giu
  ];
  for (const pattern of dynamicPatterns) {
    for (const match of text.matchAll(pattern)) record(violations, 'dynamic-font-size', relativePath, lineAt(text, match.index), match[0]);
  }

  for (const match of text.matchAll(LEGACY_TYPOGRAPHY_TOKEN)) {
    record(violations, 'legacy-typography-token', relativePath, lineAt(text, match.index), match[0]);
  }

  for (const match of text.matchAll(/(?:-webkit-)?line-clamp\s*:/giu)) {
    record(violations, 'text-line-clamp', relativePath, lineAt(text, match.index), match[0]);
  }

  for (const match of text.matchAll(/--(?!type-)[a-z0-9-]*(?:font|text)[a-z0-9-]*size[a-z0-9-]*\s*:/giu)) {
    record(violations, 'typography-alias-token', relativePath, lineAt(text, match.index), match[0]);
  }

  for (const match of text.matchAll(/([^{}]*html\s*\[\s*data-reading\s*=\s*(["'])(standard|comfortable|large)\2\s*\][^{}]*)\{/giu)) {
    const selector = match[1].replace(/\s+/gu, ' ').trim();
    readingSelectors.push(Object.freeze({ file: relativePath, line: lineAt(text, match.index), mode: match[3], selector }));
    if (relativePath !== AUTHORITY) record(violations, 'reading-selector-outside-authority', relativePath, lineAt(text, match.index), selector);
  }

  for (const match of text.matchAll(/(--type-[a-z0-9-]+)\s*:/giu)) {
    const token = match[1].toLowerCase();
    if (!definitions.has(token)) definitions.set(token, []);
    definitions.get(token).push(Object.freeze({ file: relativePath, line: lineAt(text, match.index) }));
    if (relativePath !== AUTHORITY) record(violations, 'semantic-token-defined-outside-authority', relativePath, lineAt(text, match.index), token);
  }
}

function auditTypography(rootPath) {
  const root = path.resolve(rootPath);
  const violations = [];
  const definitions = new Map();
  const readingSelectors = [];
  const files = SCAN_ROOTS
    .flatMap(relative => walk(path.join(root, relative)))
    .sort();
  for (const file of files) scanFile(root, file, violations, definitions, readingSelectors);

  for (const token of REQUIRED_TOKENS) {
    const rows = definitions.get(token) || [];
    if (rows.length !== 3 || rows.some(row => row.file !== AUTHORITY)) {
      record(violations, 'semantic-token-definition-count', AUTHORITY, 1, `${token}: expected=3 actual=${rows.length}`);
    }
  }
  for (const token of definitions.keys()) {
    if (!REQUIRED_TOKENS.includes(token)) record(violations, 'unknown-semantic-token-definition', AUTHORITY, 1, token);
  }
  for (const mode of ['standard', 'comfortable', 'large']) {
    const rows = readingSelectors.filter(row => row.mode === mode);
    if (rows.length !== 1 || rows[0]?.file !== AUTHORITY) {
      record(violations, 'reading-selector-count', AUTHORITY, 1, `${mode}: expected=1 actual=${rows.length}`);
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.type.localeCompare(b.type));
  const counts = Object.create(null);
  for (const violation of violations) counts[violation.type] = (counts[violation.type] || 0) + 1;
  return Object.freeze({
    schemaVersion: 1,
    authority: AUTHORITY,
    scanRoots: SCAN_ROOTS,
    requiredTokens: REQUIRED_TOKENS,
    filesScanned: files.length,
    pass: violations.length === 0,
    counts,
    readingSelectors,
    violations
  });
}

if (require.main === module) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../..');
  const result = auditTypography(root);
  process.stdout.write(`${JSON.stringify(result, null, process.argv.includes('--pretty') ? 2 : 0)}\n`);
  process.exitCode = result.pass ? 0 : 1;
}

module.exports = { AUTHORITY, REQUIRED_TOKENS, SCAN_ROOTS, auditTypography };
