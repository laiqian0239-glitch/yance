'use strict';

const { canonicalSha256 } = require('./jcs');
const { REASON_CODES } = require('./reasonCodes');

function fail(reasonCode, details) { return { pass: false, reasonCode, details }; }

function verifyCommandFacts(receipt, commandSet) {
  const expectedIds = new Set(commandSet.commands.map((command) => command.commandId));
  const actualIds = new Set(receipt.execution.commands.map((command) => command.commandId));
  for (const commandId of expectedIds) if (!actualIds.has(commandId)) return fail(REASON_CODES.EVIDENCE_COMMAND_MISSING, { commandId });
  for (const commandId of actualIds) if (!expectedIds.has(commandId)) return fail(REASON_CODES.EVIDENCE_COMMAND_UNEXPECTED, { commandId });

  const executions = new Map(receipt.execution.commands.map((entry) => [entry.commandId, entry]));
  const results = new Map(receipt.results.map((entry) => [entry.commandId, entry]));
  for (const command of commandSet.commands) {
    const execution = executions.get(command.commandId);
    const result = results.get(command.commandId);
    if (!execution || !result) return fail(REASON_CODES.EVIDENCE_COMMAND_MISSING, { commandId: command.commandId });
    const argvDigest = canonicalSha256({ executable: command.executable, argv: command.argv });
    if (execution.argvDigest !== argvDigest) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH, { commandId: command.commandId, field: 'argvDigest' });
    const passed = execution.exitCode === command.expectedExitCode;
    if (result.passed !== passed) return fail(REASON_CODES.EVIDENCE_COMMAND_RESULT_MISMATCH, { commandId: command.commandId, field: 'passed' });
    if (!passed) return fail(REASON_CODES.EVIDENCE_COMMAND_FAILED, { commandId: command.commandId, exitCode: execution.exitCode, expectedExitCode: command.expectedExitCode });
  }
  return { pass: true };
}

module.exports = { verifyCommandFacts };
