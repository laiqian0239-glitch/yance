'use strict';

const { CURRENT_STAGE, verifyWp0Gate } = require('./lib');

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const targetStage = argValue('--target-stage', CURRENT_STAGE);
const result = verifyWp0Gate({ targetStage });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== 'PASS') process.exitCode = 1;
