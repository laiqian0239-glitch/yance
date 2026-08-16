'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');
const brandRoot = path.join(root, 'assets', 'branding', 'yance');
const sourceRoot = path.join(brandRoot, 'source');
const productRoot = path.join(brandRoot, 'product');
const wordmarkRoot = path.join(brandRoot, 'wordmarks');
const generated = path.join(brandRoot, 'generated');
const productSvg = path.join(productRoot, 'yance-mark-flat.svg');
const microSvg = path.join(productRoot, 'yance-mark-micro.svg');
const sizes = [16, 20, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 20, 24, 32, 48, 64, 128, 256];
const wordmarkConversions = [
  ['yance-wordmark-zh-editable.svg', 'yance-wordmark-zh.svg'],
  ['yance-wordmark-en-editable.svg', 'yance-wordmark-en.svg'],
  ['yance-lockup-horizontal-editable.svg', 'yance-lockup-horizontal.svg'],
  ['yance-lockup-stacked-editable.svg', 'yance-lockup-stacked.svg']
];

function command(name, args) {
  try { return execFileSync(name, args, { stdio: 'inherit' }); }
  catch (error) { throw new Error(`${name} failed: ${error.message}`); }
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function copy(file, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}
function relative(file) { return path.relative(root, file).replaceAll('\\', '/'); }

function convertWordmarks() {
  fs.mkdirSync(wordmarkRoot, { recursive: true });
  for (const [sourceName, outputName] of wordmarkConversions) {
    const source = path.join(sourceRoot, sourceName);
    const output = path.join(wordmarkRoot, outputName);
    command('inkscape', [source, '--export-text-to-path', '--export-plain-svg', `--export-filename=${output}`]);
  }
}

function generateRasterAssets() {
  fs.rmSync(generated, { recursive: true, force: true });
  fs.mkdirSync(generated, { recursive: true });
  const pngs = [];
  for (const size of sizes) {
    const source = size <= 24 ? microSvg : productSvg;
    const output = path.join(generated, `yance-app-icon-${size}.png`);
    command('inkscape', [source, '--export-type=png', `--export-filename=${output}`, `--export-width=${size}`, `--export-height=${size}`, '--export-background-opacity=0']);
    pngs.push(output);
  }
  const ico = path.join(generated, 'Yance.ico');
  command('magick', [...icoSizes.map(size => path.join(generated, `yance-app-icon-${size}.png`)), ico]);
  return { pngs, ico };
}

function publishCanonicalAliases({ pngs, ico }) {
  const aliases = new Map([
    [path.join(sourceRoot, 'yance-mark-master.svg'), path.join(brandRoot, 'yance-mark.svg')],
    [path.join(productRoot, 'yance-mark-flat.svg'), path.join(brandRoot, 'yance-mark-flat.svg')],
    [path.join(productRoot, 'yance-mark-mono-dark.svg'), path.join(brandRoot, 'yance-mark-mono-dark.svg')],
    [path.join(productRoot, 'yance-mark-mono-light.svg'), path.join(brandRoot, 'yance-mark-mono-light.svg')],
    [path.join(wordmarkRoot, 'yance-wordmark-zh.svg'), path.join(brandRoot, 'yance-wordmark-zh.svg')],
    [path.join(wordmarkRoot, 'yance-wordmark-en.svg'), path.join(brandRoot, 'yance-wordmark-en.svg')],
    [path.join(wordmarkRoot, 'yance-lockup-horizontal.svg'), path.join(brandRoot, 'yance-lockup-horizontal.svg')],
    [path.join(wordmarkRoot, 'yance-lockup-stacked.svg'), path.join(brandRoot, 'yance-lockup-stacked.svg')],
    [ico, path.join(brandRoot, 'Yance.ico')]
  ]);
  for (const file of pngs) aliases.set(file, path.join(brandRoot, path.basename(file)));
  for (const [source, destination] of aliases) copy(source, destination);
}

function writeManifest({ pngs, ico }) {
  const tracked = [
    path.join(sourceRoot, 'yance-mark-master.svg'),
    ...wordmarkConversions.map(([source]) => path.join(sourceRoot, source)),
    ...['yance-mark-flat.svg', 'yance-mark-micro.svg', 'yance-mark-mono-dark.svg', 'yance-mark-mono-light.svg'].map(file => path.join(productRoot, file)),
    path.join(brandRoot, 'presentation', 'yance-mark-display.svg'),
    ...wordmarkConversions.map(([, output]) => path.join(wordmarkRoot, output)),
    ...pngs,
    ico
  ];
  const manifest = {
    schemaVersion: 2,
    brand: 'Yance',
    chineseBrand: '言策',
    brandingVersion: 2,
    source: relative(productSvg),
    microSource: relative(microSvg),
    sizes,
    icoSizes,
    generatedAtPolicy: 'deterministic-from-tracked-svg-sources',
    files: tracked.map(file => ({
      path: relative(file),
      bytes: fs.statSync(file).size,
      sha256: sha256(file)
    }))
  };
  fs.writeFileSync(path.join(brandRoot, 'brand-assets-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function main() {
  convertWordmarks();
  const generatedAssets = generateRasterAssets();
  publishCanonicalAliases(generatedAssets);
  writeManifest(generatedAssets);
  console.log(`Generated ${generatedAssets.pngs.length} PNG files, ${wordmarkConversions.length} path-based wordmarks, and ${relative(generatedAssets.ico)}`);
}

if (require.main === module) main();
module.exports = { main, sizes, icoSizes, wordmarkConversions };
