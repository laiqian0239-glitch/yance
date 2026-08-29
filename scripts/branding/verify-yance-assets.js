'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BRAND_ROOT = path.join(ROOT, 'assets', 'branding', 'yance');
const GENERATED = path.join(BRAND_ROOT, 'generated');
const REQUIRED_SIZES = [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024];
const REQUIRED_ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256];
const REQUIRED_COLORS = ['#2A0F4A', '#FFFFFF'];

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}
function required(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail('BRAND_ASSET_MISSING', `Required brand asset is missing: ${path.relative(ROOT, file)}`);
  return file;
}
function pngDimensions(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail('BRAND_PNG_INVALID', `Invalid PNG: ${path.relative(ROOT, file)}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function icoDimensions(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) fail('BRAND_ICO_INVALID', `Invalid ICO header: ${path.relative(ROOT, file)}`);
  const count = bytes.readUInt16LE(4);
  if (bytes.length < 6 + count * 16) fail('BRAND_ICO_INVALID', `Truncated ICO directory: ${path.relative(ROOT, file)}`);
  const dimensions = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    dimensions.push({ width, height, bitCount: bytes.readUInt16LE(offset + 6), bytesInResource: bytes.readUInt32LE(offset + 8) });
  }
  return dimensions;
}
function assertSame(source, copy, reason) {
  required(source); required(copy);
  if (sha256(source) !== sha256(copy)) fail('BRAND_ASSET_COPY_DRIFT', reason, { source: path.relative(ROOT, source), copy: path.relative(ROOT, copy) });
}
function verifySvg(file, { noText = false, noExternalImage = true } = {}) {
  const text = fs.readFileSync(required(file), 'utf8');
  if (!/<svg\b/i.test(text) || !/viewBox=/i.test(text)) fail('BRAND_SVG_INVALID', `SVG lacks root/viewBox: ${path.relative(ROOT, file)}`);
  if (noText && /<text\b/i.test(text)) fail('BRAND_WORDMARK_NOT_OUTLINED', `Production wordmark still contains editable text: ${path.relative(ROOT, file)}`);
  if (noExternalImage && /<image\b/i.test(text)) fail('BRAND_SVG_EXTERNAL_RASTER', `SVG contains an image dependency: ${path.relative(ROOT, file)}`);
  if (/data:font|\.woff2?|\.ttf|\.otf/i.test(text)) fail('BRAND_FONT_EMBEDDED', `SVG embeds or references a font file: ${path.relative(ROOT, file)}`);
  return text;
}
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function verifyYanceAssets() {
  const tokens = JSON.parse(fs.readFileSync(required(path.join(BRAND_ROOT, 'branding-tokens.json')), 'utf8'));
  const tokenColors = Object.values(tokens.palette || tokens.colors || {}).map(value => String(value).toUpperCase());
  for (const color of REQUIRED_COLORS) if (!tokenColors.includes(color)) fail('BRAND_COLOR_TOKEN_MISSING', `Missing formal brand color ${color}`);

  verifySvg(path.join(BRAND_ROOT, 'source', 'yance-mark-master.svg'));
  for (const name of ['yance-mark-flat.svg', 'yance-mark-micro.svg', 'yance-mark-mono-dark.svg', 'yance-mark-mono-light.svg']) verifySvg(path.join(BRAND_ROOT, 'product', name));
  verifySvg(path.join(BRAND_ROOT, 'presentation', 'yance-mark-display.svg'));
  for (const name of ['yance-wordmark-zh.svg', 'yance-wordmark-en.svg', 'yance-lockup-horizontal.svg', 'yance-lockup-stacked.svg']) verifySvg(path.join(BRAND_ROOT, 'wordmarks', name), { noText: true });

  const pngEvidence = [];
  for (const size of REQUIRED_SIZES) {
    const generated = required(path.join(GENERATED, `yance-app-icon-${size}.png`));
    const dimensions = pngDimensions(generated);
    if (dimensions.width !== size || dimensions.height !== size) fail('BRAND_PNG_SIZE_MISMATCH', `PNG size mismatch for ${size}`, dimensions);
    assertSame(generated, path.join(BRAND_ROOT, `yance-app-icon-${size}.png`), `Canonical PNG alias drifted at ${size}px`);
    pngEvidence.push({ size, bytes: fs.statSync(generated).size, sha256: sha256(generated) });
  }

  const ico = required(path.join(GENERATED, 'Yance.ico'));
  const icoEntries = icoDimensions(ico);
  const dimensions = new Set(icoEntries.filter(row => row.width === row.height).map(row => row.width));
  for (const size of REQUIRED_ICO_SIZES) if (!dimensions.has(size)) fail('BRAND_ICO_SIZE_MISSING', `Yance.ico is missing ${size}x${size}`, { entries: icoEntries });
  assertSame(ico, path.join(BRAND_ROOT, 'Yance.ico'), 'Canonical Yance.ico alias drifted');

  for (const file of walk(BRAND_ROOT)) {
    if (/\.(?:ttf|otf|woff2?|eot)$/i.test(file)) fail('BRAND_FONT_FILE_FORBIDDEN', `Font files must not be bundled: ${path.relative(ROOT, file)}`);
  }

  const manifest = JSON.parse(fs.readFileSync(required(path.join(BRAND_ROOT, 'brand-assets-manifest.json')), 'utf8'));
  if (manifest.brand !== 'Yance' || manifest.chineseBrand !== '言策' || manifest.brandingVersion !== 2) fail('BRAND_MANIFEST_IDENTITY_INVALID', 'Brand manifest identity mismatch');
  for (const entry of manifest.files || []) {
    const file = required(path.join(ROOT, entry.path));
    if (fs.statSync(file).size !== entry.bytes || sha256(file) !== entry.sha256) fail('BRAND_MANIFEST_HASH_MISMATCH', `Brand manifest mismatch: ${entry.path}`);
  }

  return {
    status: 'PASS',
    brand: 'Yance',
    chineseBrand: '言策',
    brandingVersion: 2,
    pngs: pngEvidence,
    icoEntries,
    manifestFileCount: manifest.files.length,
    bundledFontFiles: 0
  };
}

function main() {
  const result = verifyYanceAssets();
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  if (output) {
    const destination = path.resolve(output);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', reasonCode: error.code || 'BRAND_ASSET_VERIFY_FAILED', message: error.message, details: error.details || {} }, null, 2));
    process.exitCode = 1;
  }
}
module.exports = { verifyYanceAssets, pngDimensions, icoDimensions, REQUIRED_SIZES, REQUIRED_ICO_SIZES };
