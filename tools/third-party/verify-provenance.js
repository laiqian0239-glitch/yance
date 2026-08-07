#!/usr/bin/env node
'use strict';

const { verifyRepository } = require('./provenance');
const json = process.argv.includes('--json');
const report = verifyRepository(process.cwd());
if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else if (report.ok) process.stdout.write(`OSS provenance verified: ${report.projects.length} project(s).\n`);
else for (const error of report.errors) process.stderr.write(`[${error.code}] ${error.path}: ${error.message}\n`);
process.exitCode = report.ok ? 0 : 1;
