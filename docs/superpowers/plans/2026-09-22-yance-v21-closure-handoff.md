# Yance v21 Closure Checkpoint & Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the current live worktree in a non-promoting remote checkpoint, publish an auditable closure ledger, and hand the next chat an exact resume point.

**Architecture:** Keep the existing isolated worktree and frozen runtime intact. Create a checkpoint branch from the current detached HEAD, commit tracked implementation changes plus selected source/tests/docs only, exclude generated/runtime/temp artifacts, and push the branch without merging. GitHub issue #1051 receives a non-Controller checkpoint that points to the branch and ledger.

**Tech Stack:** Git, GitHub, Node test runner, Electron/Element module, Matrix/Mautrix, SQLite.

**Spec:** `docs/YANCE_V21_CLOSURE_LEDGER_2026-09-22_ZH.md`

## Global Constraints

- Human acceptance remains the final acceptance standard.
- No reset/clean, no history deletion, no database shortcut mutation.
- No merge / RC / UAT promotion from this checkpoint.
- Exclude `.tmp*`, `.runtime`, `__pycache__`, `.local-corepack-shims` and local generated evidence from the checkpoint commit.
- Never commit real Chatwoot, Matrix, OpenRouter or platform credentials.

## Review Focus

- Accidentally committing runtime databases/secrets.
- Losing untracked source/tests that contain current fixes.
- Misreporting known RED tests as GREEN.
- Pushing to a shared release/main branch instead of an isolated checkpoint branch.
- Next chat redoing diagnosis instead of resuming at R2 wiring.
### Task 1: Seal the ledger and new-chat handoff

**Files:**
- Create: `docs/YANCE_V21_CLOSURE_LEDGER_2026-09-22_ZH.md`
- Create: `docs/YANCE_V21_NEW_CHAT_HANDOFF_2026-09-22_ZH.md`

- [x] Record 17 product/runtime problems and 5 engineering risks.
- [x] Record closure states: RED / CODE-GREEN / DATA-GREEN / HUMAN-ACCEPTED / CLOSED.
- [x] Record R2 as the first resume point.

### Task 2: Create the isolated remote checkpoint

**Files:** current worktree tracked changes plus selected untracked source/tests/docs/config/assets/skills.

- [x] Detect existing linked worktree; do not create a second one.
- [x] Create branch `checkpoint/yance-v21-closure-20260922` from detached HEAD.
- [x] Stage all tracked changes.
- [x] Stage selected untracked implementation/test/doc files.
- [x] Confirm generated/runtime/temp paths are not staged.
- [x] Scan staged diff for credential-shaped values.

### Task 3: Capture fresh verification state

- [x] Run direct-chat/routing focused tests and record exact pass/fail count.
- [x] Run RoomView remount regression.
- [x] Run Product final admission and record exact pass/fail count.
- [x] Verify Telegram/WhatsApp account-state evidence from SQLite without modifying data.
### Task 4: Commit, push, and register handoff

- [x] Commit the checkpoint with an explicit WIP/handoff message.
- [x] Push only `checkpoint/yance-v21-closure-20260922` to `origin`.
- [x] Add a non-Controller checkpoint comment to GitHub issue #1051 with branch, commit, fresh RED/GREEN counts, ledger path and human-acceptance rule.
- [x] Verify remote branch/commit exists.

## Completion contract

This plan is complete only when:
1. the checkpoint branch exists remotely;
2. the ledger and new-chat handoff are readable from that branch;
3. the known RED tests are preserved and reported, not hidden;
4. no runtime/temp/generated artifacts or real secrets are part of the commit;
5. the next-chat first command can resume from R2 without reconstructing context.
