'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('../../backend/services/privacy');

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const SENSITIVE_KEY = /(?:^|_)(?:api.?key|authorization|cookie|credential|secret|password|passphrase|token|qr|challenge|prompt|response|request.?body|body|content|conversation|chat|attachment|media|transcript|user.?text|input|output)(?:$|_)/iu;
const STARTUP_DIAGNOSTIC_HINT = /(?:startup|backend|boot|migration|sqlite|database|server|ready|fatal|error|exception|uncaught|unhandled|native.?binary|dependency|integrity|electron|safe.?mode|schema|port|lock|timeout|child.?process)/iu;

function isStartupDiagnosticRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const level = String(value.level || value.severity || '').toLowerCase();
  const searchable = [
    value.event, value.code, value.reasonCode, value.type, value.phase,
    value.message, value.error, value.failure?.code, value.failure?.message
  ].filter(item => item !== undefined && item !== null).join(' ');
  return ['error', 'fatal'].includes(level) || STARTUP_DIAGNOSTIC_HINT.test(searchable);
}

function sanitizeValue(value, key = '') {
  if (SENSITIVE_KEY.test(String(key || ''))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) out[childKey] = sanitizeValue(childValue, childKey);
    return out;
  }
  if (typeof value === 'string') return redact(value, 12000, { redactPaths: true });
  return value;
}

function readBoundedUtf8(file) {
  const size = fs.statSync(file).size;
  if (size <= MAX_INPUT_BYTES) return { text: fs.readFileSync(file, 'utf8'), truncated: false };
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_INPUT_BYTES);
    fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    return { text: buffer.toString('utf8'), truncated: true };
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeDiagnosticFile(inputFile, outputFile) {
  const input = path.resolve(inputFile);
  const output = path.resolve(outputFile);
  if (input === output) throw new Error('diagnostic source and destination must be different files');
  if (!fs.existsSync(input) || !fs.statSync(input).isFile()) throw new Error(`diagnostic source file is missing: ${input}`);

  const { text, truncated } = readBoundedUtf8(input);
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  let parseFailureCount = 0;
  let droppedNonDiagnosticCount = 0;
  let documentMode = 'filtered-lines';
  const sanitized = [];
  if (truncated) sanitized.push(JSON.stringify({ documentType: 'YANCE_UI_UAT_DIAGNOSTIC_TRUNCATION', retainedTailBytes: MAX_INPUT_BYTES }));

  if (!truncated && path.extname(input).toLowerCase() === '.json') {
    try {
      sanitized.push(JSON.stringify(sanitizeValue(JSON.parse(text))));
      documentMode = 'whole-json';
    } catch (_) {
      parseFailureCount += 1;
    }
  }

  if (documentMode !== 'whole-json') {
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (!isStartupDiagnosticRecord(parsed)) {
          droppedNonDiagnosticCount += 1;
          continue;
        }
        sanitized.push(JSON.stringify(sanitizeValue(parsed)));
      } catch (_) {
        parseFailureCount += 1;
        if (!STARTUP_DIAGNOSTIC_HINT.test(line)) {
          droppedNonDiagnosticCount += 1;
          continue;
        }
        sanitized.push(redact(line, 12000, { redactPaths: true }));
      }
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${sanitized.join('\n')}\n`, 'utf8');
  return {
    inputFile: input,
    outputFile: output,
    lineCount: lines.filter(line => line.trim()).length,
    parseFailureCount,
    droppedNonDiagnosticCount,
    documentMode,
    truncated,
    outputBytes: fs.statSync(output).size
  };
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--input=')) options.input = arg.slice('--input='.length);
    else if (arg.startsWith('--output=')) options.output = arg.slice('--output='.length);
    else throw new Error(`unsupported argument: ${arg}`);
  }
  if (!options.input || !options.output) throw new Error('--input and --output are required');
  return options;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ status: 'PASS', ...sanitizeDiagnosticFile(options.input, options.output) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_INPUT_BYTES,
  SENSITIVE_KEY,
  STARTUP_DIAGNOSTIC_HINT,
  isStartupDiagnosticRecord,
  sanitizeDiagnosticFile,
  sanitizeValue
};
