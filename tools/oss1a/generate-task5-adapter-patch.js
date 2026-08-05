'use strict';

const fs = require('node:fs');
const childProcess = require('node:child_process');

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error('expected input and output paths');
let source = fs.readFileSync(inputPath, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected one exact match`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  [
    '    row.sessionFence = createSessionGenerationFence(',
    '      () => this.accounts.get(accountId) === row && this.generations.get(accountId) === row.generation,',
    '      { prefix: `whatsapp:${databaseAccountId}` }',
    '    );'
  ].join('\n'),
  [
    '    row.sessionFence = createSessionGenerationFence(',
    '      () => this.accounts.get(accountId) === row && this.generations.get(accountId) === row.generation,',
    '      {',
    '        prefix: `whatsapp:${databaseAccountId}`,',
    '        generation: row.generation,',
    '        epoch: Number.isInteger(options.authEpoch) ? options.authEpoch : 0,',
    "        socketToken: typeof options.socketToken === 'string' ? options.socketToken : ''",
    '      }',
    '    );'
  ].join('\n'),
  'session fence authority details'
);

replaceOnce(
  [
    "    onSocket('creds.update', async update => {",
    '      await saveCreds(update);',
    "      socketGuard.assertCurrent({ accountId: databaseAccountId, eventName: 'creds.update' });",
    '      this.invalidateCredentialState(reference);',
    '    });'
  ].join('\n'),
  [
    "    onSocket('creds.update', async update => {",
    '      const writeResult = await socketGuard.runWrite(',
    "        { accountId: databaseAccountId, eventName: 'creds.update' },",
    '        () => saveCreds(update)',
    '      );',
    '      if (!writeResult.ok) return writeResult;',
    '      this.invalidateCredentialState(reference);',
    '      return writeResult;',
    '    });'
  ].join('\n'),
  'creds update write fence'
);

fs.writeFileSync(outputPath, source, 'utf8');
const syntax = childProcess.spawnSync(process.execPath, ['--check', outputPath], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout || 'generated adapter syntax failed');
