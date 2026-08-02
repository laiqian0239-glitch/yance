#!/usr/bin/env node
'use strict';

const gate = require('../../backend/services/architectureShadowGate');
const authorities = String(process.env.YANCE_FIX6M_SHADOW_AUTHORITIES || 'communication,contact-relationship,ai-learning').split(',').map(value => value.trim()).filter(Boolean);
const result = gate.evaluate({ authorities, minSamples: Number(process.env.YANCE_FIX6M_SHADOW_MIN_SAMPLES || 100), windowSize: Number(process.env.YANCE_FIX6M_SHADOW_WINDOW_SIZE || 1000) });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.pass ? 0 : 1;
