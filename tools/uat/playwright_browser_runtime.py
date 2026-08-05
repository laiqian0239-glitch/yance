#!/usr/bin/env python3
"""Cross-platform Playwright browser launch authority for real UAT probes."""
from __future__ import annotations

CHROMIUM_ARGS = ("--no-sandbox", "--disable-gpu")


def launch_chromium(browser_type):
    """Launch Playwright's installed managed Chromium with shared probe options."""
    return browser_type.launch(headless=True, args=list(CHROMIUM_ARGS))
