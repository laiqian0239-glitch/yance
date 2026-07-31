'use strict';

/**
 * M10 Developer Toolkit CLI.
 *
 * Subcommands:
 *   contract   Validate the contract surface (M6 layout, M2 IPC denylist, M8 native governance).
 *   doctor     Health diagnostics: M9 headless verification gate + M8 native governance.
 *   verify     Run the M9 headless verification suite (alias to the orchestrator).
 *   scaffold   Print resolved local launch layout (M6 contract) for the current tree.
 *
 * Exit code: 0 when healthy / all contracts valid, 1 otherwise.
 */

const { validateContracts, formatContracts, diagnose, loadReleaseLayout } = require('./devToolkit');

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const args = Object.fromEntries(rest.map(a => a.split('=')).map(([k, v]) => [k, v]));

  switch (sub) {
    case 'contract': {
      const result = validateContracts({});
      console.log(formatContracts(result));
      process.exit(result.allValid ? 0 : 1);
    }
    case 'doctor': {
      const requireRealMachine = args['require-real-machine'] === 'true';
      const health = diagnose({ requireRealMachine });
      console.log('# Doctor');
      console.log(`- verification gate: ${health.verificationGate.passed ? 'PASS' : 'FAIL'}`);
      console.log(`- native governance: ${health.nativeGovernance.valid ? 'PASS' : 'FAIL'} (${health.nativeGovernance.recommendation})`);
      console.log(`- healthy: ${health.healthy ? 'YES' : 'NO'}`);
      process.exit(health.healthy ? 0 : 1);
    }
    case 'verify': {
      const orch = require('../wp9/verifyOrchestrator');
      const run = orch.runAll({ tiers: ['headless'], requireRealMachine: args['require-real-machine'] === 'true' });
      console.log(orch.formatReport(run));
      process.exit(run.gate.passed ? 0 : 1);
    }
    case 'scaffold': {
      const rl = loadReleaseLayout();
      const mode = args.mode || 'dev';
      const resourcesPath = args['resources-path'] || process.cwd();
      const resolved = rl.resolveLayoutPaths(mode, { resourcesPath });
      console.log(`# Resolved ${mode} launch layout`);
      for (const [k, v] of Object.entries(resolved)) console.log(`- ${k}: ${v}`);
      process.exit(0);
    }
    default:
      console.log('Usage: node tools/wp10/dev.js <contract|doctor|verify|scaffold> [--mode=dev|production] [--require-real-machine=true]');
      process.exit(2);
  }
}

main();
