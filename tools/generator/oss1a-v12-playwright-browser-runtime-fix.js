'use strict';

const fs = require('node:fs');

const AUTHORITY_PATH = 'tools/uat/playwright_browser_runtime.py';
const PROBE_PATHS = Object.freeze([
  'tools/uat/fix6d_computed_style_probe.py',
  'tools/uat/fix6d_global_typography_matrix_probe.py'
]);
const IMPLEMENTATION_PATHS = Object.freeze([AUTHORITY_PATH, ...PROBE_PATHS].sort());

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

function writeBrowserRuntimeAuthority() {
  fs.writeFileSync(AUTHORITY_PATH, `#!/usr/bin/env python3
"""Cross-platform Playwright browser launch authority for real UAT probes."""
from __future__ import annotations

CHROMIUM_ARGS = ("--no-sandbox", "--disable-gpu")


def launch_chromium(browser_type):
    """Launch Playwright's installed managed Chromium with shared probe options."""
    return browser_type.launch(headless=True, args=list(CHROMIUM_ARGS))
`, 'utf8');
}

function updateComputedStyleProbe() {
  updateFile(PROBE_PATHS[0], source => {
    source = replaceExact(
      source,
      'from playwright.sync_api import sync_playwright\n',
      'from playwright.sync_api import sync_playwright\nfrom playwright_browser_runtime import launch_chromium\n',
      'computed-style probe: import browser runtime authority'
    );
    source = replaceExact(
      source,
      "        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-gpu'])",
      '        browser = launch_chromium(p.chromium)',
      'computed-style probe: delegate browser launch'
    );
    return source;
  });
}

function updateTypographyMatrixProbe() {
  updateFile(PROBE_PATHS[1], source => {
    source = replaceExact(
      source,
      'from playwright.sync_api import sync_playwright\n',
      'from playwright.sync_api import sync_playwright\nfrom playwright_browser_runtime import launch_chromium\n',
      'typography matrix probe: import browser runtime authority'
    );
    source = replaceExact(
      source,
      '        browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox", "--disable-gpu"])',
      '        browser = launch_chromium(p.chromium)',
      'typography matrix probe: delegate browser launch'
    );
    return source;
  });
}

function assertPortableSources() {
  for (const filePath of IMPLEMENTATION_PATHS) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (source.includes('/usr/bin/chromium')) throw new Error(`${filePath}: Linux-only Chromium path remains`);
    if (source.includes('executable_path')) throw new Error(`${filePath}: executable selection remains outside Playwright authority`);
  }
}

function main() {
  writeBrowserRuntimeAuthority();
  updateComputedStyleProbe();
  updateTypographyMatrixProbe();
  assertPortableSources();
}

if (require.main === module) main();

module.exports = {
  AUTHORITY_PATH,
  PROBE_PATHS,
  IMPLEMENTATION_PATHS,
  replaceExact,
  main
};
