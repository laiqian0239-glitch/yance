# R2 Direct-Chat Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the two focused R2 command/IPC/Element wiring RED tests GREEN without visual changes or route-authority regression.

**Architecture:** Keep provisioning behind the existing closed account command boundary. Element may request exact direct-chat provisioning only when canonical mautrix route resolution is unresolved, then re-resolve and open the exact joined Matrix room.

**Tech Stack:** Node.js backend/Electron IPC, TypeScript Element module, node:test.

**Spec:** `docs/YANCE_V21_NEW_CHAT_HANDOFF_2026-09-22_ZH.md` and `docs/YANCE_V21_CLOSURE_LEDGER_2026-09-22_ZH.md`

## Global Constraints
- No visual changes; Element timeline/composer remain authority.
- No reset/clean, no SQLite fabrication, no chat-history rewrites.
- Human acceptance remains the final gate.

### Task 1: Closed command boundary
- Test: existing `tests/wp0/v21-mautrix-direct-chat-command-wiring-local.test.js` first assertion stays RED before implementation.
- Modify `backend/core/accountContext.js` only as required to expose `account.provisioning.directChat.ensure` via existing manager authority.
- Verify focused test progresses past the first RED without changing its assertion.

### Task 2: Element unresolved-route retry
- Test: existing second assertion stays RED before implementation.
- Modify `integration/element-module/src/index.tsx` to call existing `runPlatformAccountCommand` with `provisioning-direct-chat-ensure`, open/join returned room, then re-resolve canonical route.
- Verify focused 2/2 GREEN, then typecheck/build and fresh regression evidence.
