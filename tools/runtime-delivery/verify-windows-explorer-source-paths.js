'use strict';

const path = require('node:path');
const { sourcePayloadRecords } = require('./source-uat-delivery');
const { assertWindowsExplorerSafe } = require('./windows-explorer-path-authority');

function value(argv, name) {
  const prefix = `--${name}=`;
  return argv.find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

function main() {
  const argv = process.argv.slice(2);
  const root = path.resolve(value(argv, 'root') || process.cwd());
  const archiveRootName = value(argv, 'archive-root') || 'YANCE_FIX6I_SOURCE';
  const archiveFileBase = value(argv, 'archive-file-base') || archiveRootName;
  const records = sourcePayloadRecords(root);
  const result = assertWindowsExplorerSafe({
    archiveRootName,
    archiveFileBase,
    entries: records.map(row => row.path),
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode: error.reasonCode || error.code || 'WINDOWS_EXPLORER_PATH_BUDGET_FAILED',
    message: error.message,
    details: error.details || {},
  }, null, 2)}\n`);
  process.exitCode = 1;
}
