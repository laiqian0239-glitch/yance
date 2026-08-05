#!/usr/bin/env python3
"""Cross-platform browser launch and UTF-8 transport authority for real UAT probes."""
from __future__ import annotations

import json
import sys

CHROMIUM_ARGS = ("--no-sandbox", "--disable-gpu")


def launch_chromium(browser_type):
    """Launch Playwright's installed managed Chromium with shared probe options."""
    return browser_type.launch(headless=True, args=list(CHROMIUM_ARGS))


def write_json_stdout(payload, *, stdout_buffer=None):
    """Emit one Unicode JSON record as UTF-8 bytes, independent of host locale."""
    target = stdout_buffer if stdout_buffer is not None else sys.stdout.buffer
    record = json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n"
    written = target.write(record)
    if written is not None and written != len(record):
        raise IOError(f"short JSON stdout write: {written}/{len(record)} bytes")
    target.flush()
