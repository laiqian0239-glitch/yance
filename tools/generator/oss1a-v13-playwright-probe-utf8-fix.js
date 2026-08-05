'use strict';

const fs = require('node:fs');

const TEST_PATH = 'tests/uat/fix6dPlaywrightBrowserRuntime.test.js';
const AUTHORITY_PATH = 'tools/uat/playwright_browser_runtime.py';
const PROBE_PATHS = Object.freeze([
  'tools/uat/fix6d_computed_style_probe.py',
  'tools/uat/fix6d_global_typography_matrix_probe.py'
]);
const IMPLEMENTATION_PATHS = Object.freeze([AUTHORITY_PATH, ...PROBE_PATHS].sort());
const FINAL_PATHS = Object.freeze([TEST_PATH, ...IMPLEMENTATION_PATHS].sort());

function replaceExact(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`${label}: source block is ambiguous`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function updateFile(filePath, transform) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${filePath}: transformation produced no change`);
  fs.writeFileSync(filePath, after, 'utf8');
}

function updateProbeRuntimeAuthority() {
  updateFile(AUTHORITY_PATH, source => {
    source = replaceExact(
      source,
      '"""Cross-platform Playwright browser launch authority for real UAT probes."""\nfrom __future__ import annotations\n\n',
      '"""Cross-platform browser launch and UTF-8 transport authority for real UAT probes."""\nfrom __future__ import annotations\n\nimport json\nimport sys\n\n',
      'probe runtime: broaden authority and import transport dependencies'
    );
    source = replaceExact(
      source,
      `def launch_chromium(browser_type):\n    """Launch Playwright's installed managed Chromium with shared probe options."""\n    return browser_type.launch(headless=True, args=list(CHROMIUM_ARGS))\n`,
      `def launch_chromium(browser_type):\n    """Launch Playwright's installed managed Chromium with shared probe options."""\n    return browser_type.launch(headless=True, args=list(CHROMIUM_ARGS))\n\n\ndef write_json_stdout(payload, *, stdout_buffer=None):\n    """Emit one Unicode JSON record as UTF-8 bytes, independent of host locale."""\n    target = stdout_buffer if stdout_buffer is not None else sys.stdout.buffer\n    record = json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\\n"\n    written = target.write(record)\n    if written is not None and written != len(record):\n        raise IOError(f"short JSON stdout write: {written}/{len(record)} bytes")\n    target.flush()\n`,
      'probe runtime: add UTF-8 JSON transport authority'
    );
    return source;
  });
}

function updateComputedStyleProbe() {
  updateFile(PROBE_PATHS[0], source => {
    source = replaceExact(
      source,
      'from playwright_browser_runtime import launch_chromium\n',
      'from playwright_browser_runtime import launch_chromium, write_json_stdout\n',
      'computed-style probe: import shared UTF-8 transport authority'
    );
    source = replaceExact(
      source,
      '    print(json.dumps(payload, ensure_ascii=False))\n',
      '    write_json_stdout(payload)\n',
      'computed-style probe: delegate JSON stdout transport'
    );
    return source;
  });
}

function updateTypographyMatrixProbe() {
  updateFile(PROBE_PATHS[1], source => {
    source = replaceExact(
      source,
      'from playwright_browser_runtime import launch_chromium\n',
      'from playwright_browser_runtime import launch_chromium, write_json_stdout\n',
      'typography matrix probe: import shared UTF-8 transport authority'
    );
    source = replaceExact(
      source,
      '    print(json.dumps(output, ensure_ascii=False))\n',
      '    write_json_stdout(output)\n',
      'typography matrix probe: delegate JSON stdout transport'
    );
    return source;
  });
}

function assertTransportAuthority() {
  const authority = fs.readFileSync(AUTHORITY_PATH, 'utf8');
  if (!authority.includes('def write_json_stdout(payload, *, stdout_buffer=None):')) {
    throw new Error(`${AUTHORITY_PATH}: UTF-8 JSON transport authority missing`);
  }
  if (!authority.includes('.encode("utf-8")')) {
    throw new Error(`${AUTHORITY_PATH}: JSON transport is not explicitly UTF-8`);
  }
  for (const filePath of PROBE_PATHS) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('print(json.dumps(')) {
      throw new Error(`${filePath}: locale-dependent JSON text stdout remains`);
    }
    if (!source.includes('write_json_stdout')) {
      throw new Error(`${filePath}: shared UTF-8 JSON transport delegation missing`);
    }
  }
}

function main() {
  updateProbeRuntimeAuthority();
  updateComputedStyleProbe();
  updateTypographyMatrixProbe();
  assertTransportAuthority();
}

if (require.main === module) main();

module.exports = {
  TEST_PATH,
  AUTHORITY_PATH,
  PROBE_PATHS,
  IMPLEMENTATION_PATHS,
  FINAL_PATHS,
  replaceExact,
  main
};
