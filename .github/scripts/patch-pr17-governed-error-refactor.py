#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parent / 'refactor-pr17-governed-errors.py'
source = path.read_text(encoding='utf-8')
before = """        2,
        \"require explicit host identity for owned and first-claim CAS\",
"""
after = """        3,
        \"require explicit host identity for every owned transition and first-claim CAS\",
"""
if source.count(before) != 1:
    raise RuntimeError('governed error refactor count patch target is not unique')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
print('PR17_GOVERNED_ERROR_REFACTOR_PATCHED')
