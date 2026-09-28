---
name: yance-windows-visual-closure
description: Prove Yance real Electron and packaged Windows visual closure against an owner-approved design, including responsive captures, loaded contact photos, the Element-owned Composer, Tray, BrowserWindow, PE/installer icons, shortcuts, and Apps & Features. Use for any claim that the real Yance Windows UI or materialized product appearance is accepted; do not use DOM presence, CSS class mounting, browser surrogates, or ordinary test success as visual proof.
---

# Yance Windows Visual Closure

Use this skill only as a fail-closed validator. It does not own Electron lifecycle, Element/Matrix state, packaging, installation, or release promotion.

## Required authority

Before touching the acceptance runtime, read the repository root `AGENTS.md` and the current Controller authorization. Honor the frozen-runtime admission, build admission, and safe-reload entrypoints named there. Do not restart, rebuild, reinstall, re-login, change ports/profile/data, or directly reload the renderer unless the current authority explicitly permits it.

Element/Matrix retains timeline, room, session, crypto, Composer, send, retry, and recovery ownership. Electron/Windows retains native integration. Yance may supply Product identity, chrome, navigation, and the thinnest projection. A visual workaround must not become a second state/lifecycle owner. Do not hide an owned error with CSS or DOM removal and call it closure; correct the source presentation through the mature owner's narrow seam.

## Evidence contract

Create one JSON evidence manifest conforming to [evidence-schema.json](evidence-schema.json). Keep every referenced path and SHA-256 bound to the exact capture bytes.

The manifest must include:

- the exact Git head, live executable path/hash, Electron/Windows identity, ready Element session, and ready Yance Product shell;
- an immutable, owner-approved design baseline set;
- separate real Electron captures for `wide`, `default`, and `compact`, collectively covering Windows display scales 100%, 125%, and 150%; every PNG needs a hashed runtime capture receipt containing the screenshot hash, exact head, capture time/source, concrete Electron/CDP page target, window title, PID, and live executable path/hash;
- a pixel diff report per capture. `proof.js` decodes both PNGs and recomputes the metrics; a claimed `passed: true` is not trusted;
- every expected contact photo as a rendered `IMG` probe plus a crop copied from the real screenshot and a hashed photo-review receipt;
- the visible Element-owned Composer input and send control, bound with all Product conversation observations to one hashed Electron DOM/runtime probe receipt;
- Product conversation observations, including absence of raw security warning, room intro, membership events, generic Element primary navigation, clipping, overflow, and CSS/DOM masking. The receipt must bind them to the exact head, screenshot ID/hash, capture time, PID, and executable identity;
- Windows materialized-surface reports appropriate to the stage.

At `local-ui-acceptance`, Tray and BrowserWindow are required now. PE executable, installer, desktop shortcut, Start Menu shortcut, and Apps & Features may be deferred only to `packaged-windows-uat`, one by one, with `replacementEvidenceAccepted: false`; source intent, DOM state, or a local browser screenshot cannot replace them. At `packaged-windows-uat`, all seven surfaces are mandatory and no deferral is allowed.

## Avatar proof is not node presence

For every expected avatar, collect all of these values from the real rendered element:

```text
tagName === "IMG"
complete === true
naturalWidth > 0
naturalHeight > 0
currentSrc is non-empty
computed display is not none
computed visibility is not hidden/collapse
computed contentVisibility is not hidden
computed opacity > 0
rect.width > 0 and rect.height > 0
withinViewport === true
occluded === false
```

Save the exact screenshot crop and its pixel rectangle. `proof.js` decodes the full screenshot and crop, then requires the pixels to match exactly. It also rejects visually flat placeholder evidence and requires a dated human or computer-vision observation that the crop is a visible photo. A DOM `<img>`, mounted class, mocked fixture, loaded URL string, focused test, or ordinary GREEN suite is insufficient.

## Receipt custody boundary

Production evidence must reference these JSON receipts by both path and SHA-256:

- `yance-electron-capture-receipt`, one per screenshot;
- `yance-conversation-runtime-probe`, for conversation and Composer DOM/runtime facts;
- `yance-design-baseline-review`, enumerating every approved baseline hash;
- `yance-avatar-photo-review`, one per reviewed avatar crop;
- `yance-windows-surface-proof`, one per applicable Windows native surface.

The proof gate reads every receipt and cross-checks its identities; it never accepts a receipt field copied only into the manifest. Synthetic PNGs and hand-authored capture receipts are permitted only inside this skill's isolated tests. They are forbidden as Product evidence.

A receipt SHA-256 proves byte custody and detects mutation after the hash was recorded. By itself it does **not** authenticate who approved the design/review, prove wall-clock time, or prove that the recorder was independent. Bind the receipt hash to the current authoritative Controller/owner record, or verify it through an external trusted signature/transparency system when independent identity or timestamp proof is required. This skill validates hash and cross-document consistency; it does not claim cryptographic identity verification.

## Run the gates

From the repository root:

```powershell
node skills/yance-windows-visual-closure/admission.js --evidence <evidence.json>
node skills/yance-windows-visual-closure/proof.js --evidence <evidence.json>
```

Use `--json` for machine-readable output and `--help` for the supported interface. Do not weaken thresholds, omit an expected avatar, reuse one screenshot for multiple responsive profiles, replace an approved baseline with the current capture, or mark a non-materialized Windows surface as passed.

`WINDOWS_VISUAL_ADMISSION_GREEN` means only that the evidence set is admissible. `WINDOWS_VISUAL_CLOSURE_GREEN` means the referenced local evidence passed this validator. Neither result grants commit, CI, RC, UAT, merge, or release authority.

## Stop conditions

Any missing receipt/file, receipt hash or runtime binding mismatch, unsupported or corrupt PNG, fabricated diff metric, hidden/incomplete image, zero natural dimensions, empty/offscreen/occluded rectangle, unmatched screenshot crop, missing scale/profile, mature-owner mismatch, shadow authority finding, wrong live executable, or absent stage-required Windows surface is RED. Preserve the evidence and return to the same causal batch; do not substitute a weaker proof or retry promotion.
