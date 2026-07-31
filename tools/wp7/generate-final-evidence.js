#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Wp7Error, readJson } = require('./lib');
const { generateFinalEvidenceSet } = require('./final-evidence');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

try {
  const inputPath = path.resolve(arg('--input') || '');
  const outputRoot = path.resolve(arg('--output') || '');
  if (!fs.existsSync(inputPath) || !arg('--output')) throw new Error('usage: generate-final-evidence.js --input <final-evidence-input.json> --output <directory>');
  const input = readJson(inputPath);
  if (input.observations !== undefined || input.testResults !== undefined || input.platform !== undefined || input.fixtureMode !== undefined) {
    throw new Wp7Error('WP7_FINAL_WINDOWS_EVIDENCE_PROVENANCE_BYPASS', 'final evidence input may contain paths only, not caller claims');
  }
  const base = path.dirname(inputPath);
  const result = generateFinalEvidenceSet({
    outputRoot,
    contextPath: path.resolve(base, input.contextPath || ''),
    finalPackagingResultsPath: path.resolve(base, input.finalPackagingResultsPath || ''),
    finalWindowsResultsPath: path.resolve(base, input.finalWindowsResultsPath || '')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || 'WP7_FINAL_EVIDENCE_GENERATION_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exit(1);
}
