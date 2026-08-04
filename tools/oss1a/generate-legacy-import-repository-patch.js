'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const repositoryPath = path.resolve(process.argv[2] || 'backend/repositories/whatsappAuthStateRepository.js');
const outputPath = path.resolve(process.argv[3] || '/tmp/whatsappAuthStateRepository.generated.js');
const methodPath = path.resolve(__dirname, 'legacy-import-repository-method.txt');
const before = `  importLegacySnapshot() {\n    throw repositoryError(\n      'WHATSAPP_AUTH_LEGACY_IMPORT_NOT_AUTHORIZED',\n      'Legacy import requires the separately tested two-phase importer authority'\n    );\n  }`;
const replacement = fs.readFileSync(methodPath, 'utf8').trimEnd();
const source = fs.readFileSync(repositoryPath, 'utf8');
const first = source.indexOf(before);
if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
  throw new Error('expected exactly one legacy import placeholder');
}
const generated = source.slice(0, first) + replacement + source.slice(first + before.length);
fs.writeFileSync(outputPath, generated, 'utf8');
const syntax = childProcess.spawnSync(process.execPath, ['--check', outputPath], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'generated repository syntax failed');
process.stdout.write(`${outputPath}\n`);
