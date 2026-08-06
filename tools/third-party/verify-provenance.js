#!/usr/bin/env node
'use strict';

const { verifyRepository } = require('./provenance');

const json = process.argv.includes('--json');
const report = verifyRepository(process.cwd());

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (report.ok) {
  process.stdout.write(`OSS provenance verified: ${report.projects.length} project(s).\n`);
} else {
  process.stderr.write('OSS provenance verification failed.\n');
  for (const item of report.errors) {
    process.stderr.write(`- ${item.code}${item.path ? `: ${item.path}` : ''}\n`);
  }
}

if (!report.ok) process.exitCode = 1;
