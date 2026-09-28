#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_RESPONSIVE_ROLES = Object.freeze(["wide", "default", "compact"]);
const REQUIRED_SCALE_PERCENTS = Object.freeze([100, 125, 150]);
const REQUIRED_WINDOWS_SURFACES = Object.freeze([
  "packaged-executable",
  "installer",
  "desktop-shortcut",
  "start-menu-shortcut",
  "apps-features",
  "tray",
  "browser-window",
]);
const REQUIRED_LOCAL_WINDOWS_SURFACES = Object.freeze(["tray", "browser-window"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const HEAD_PATTERN = /^[a-f0-9]{40}$/i;

function issue(errors, code, pointer, message) {
  errors.push({ code, path: pointer, message });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isIsoDate(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function lowerWindowsPath(value) {
  return typeof value === "string" ? value.replaceAll("/", "\\").toLowerCase() : "";
}

function uniqueStrings(values) {
  return new Set(Array.isArray(values) ? values.filter(isNonEmptyString) : []);
}

function validateAdmission(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    issue(errors, "EVIDENCE_OBJECT_REQUIRED", "$", "Evidence must be a JSON object.");
    return { ok: false, errors, summary: {} };
  }

  if (evidence.schemaVersion !== 1) {
    issue(errors, "SCHEMA_VERSION_UNSUPPORTED", "$.schemaVersion", "schemaVersion must be 1.");
  }
  if (evidence.closureKind !== "yance-windows-visual-closure") {
    issue(errors, "CLOSURE_KIND_INVALID", "$.closureKind", "closureKind must identify this visual closure skill.");
  }
  if (!HEAD_PATTERN.test(String(evidence.exactHead || ""))) {
    issue(errors, "EXACT_HEAD_REQUIRED", "$.exactHead", "An exact 40-character Git head is required.");
  }
  if (!isIsoDate(evidence.capturedAt)) {
    issue(errors, "CAPTURE_TIME_REQUIRED", "$.capturedAt", "capturedAt must be an ISO timestamp.");
  }

  const validStages = new Set(["local-ui-acceptance", "packaged-windows-uat"]);
  if (!validStages.has(evidence.stage)) {
    issue(errors, "STAGE_INVALID", "$.stage", "stage must be local-ui-acceptance or packaged-windows-uat.");
  }
  const validCaptureModes = new Set(["frozen-acceptance-electron", "packaged-windows-product"]);
  if (!validCaptureModes.has(evidence.captureMode)) {
    issue(errors, "CAPTURE_MODE_INVALID", "$.captureMode", "Evidence must come from Electron, not a browser surrogate.");
  }
  if (evidence.stage === "packaged-windows-uat" && evidence.captureMode !== "packaged-windows-product") {
    issue(errors, "PACKAGED_CAPTURE_REQUIRED", "$.captureMode", "Packaged Windows UAT requires the packaged product capture mode.");
  }

  const baseline = evidence.baselineAuthority || {};
  if (!isNonEmptyString(baseline.id)) {
    issue(errors, "BASELINE_ID_REQUIRED", "$.baselineAuthority.id", "An immutable baseline-set identifier is required.");
  }
  if (baseline.source !== "owner-approved-design") {
    issue(errors, "BASELINE_AUTHORITY_INVALID", "$.baselineAuthority.source", "The design baseline must be owner approved.");
  }
  if (!isNonEmptyString(baseline.approvedBy) || !isIsoDate(baseline.approvedAt) || baseline.immutable !== true) {
    issue(errors, "BASELINE_APPROVAL_REQUIRED", "$.baselineAuthority", "Baseline approver, timestamp, and immutable=true are required.");
  }
  if (!baseline.reviewReceipt || !isNonEmptyString(baseline.reviewReceipt.path) || !isSha256(baseline.reviewReceipt.sha256)) {
    issue(errors, "BASELINE_REVIEW_RECEIPT_REQUIRED", "$.baselineAuthority.reviewReceipt", "A hashed baseline approval receipt is required.");
  }

  const policy = evidence.evidencePolicy || {};
  const requiredPolicy = {
    realScreenshotsRequired: true,
    baselineDiffRequired: true,
    domOnlyEvidenceAccepted: false,
    classOnlyEvidenceAccepted: false,
    unitTestOnlyEvidenceAccepted: false,
  };
  for (const [key, expected] of Object.entries(requiredPolicy)) {
    if (policy[key] !== expected) {
      issue(errors, "EVIDENCE_POLICY_WEAKENED", `$.evidencePolicy.${key}`, `${key} must be ${expected}.`);
    }
  }

  const runtime = evidence.runtime || {};
  if (runtime.osPlatform !== "win32" || runtime.isElectron !== true || runtime.productName !== "Yance") {
    issue(errors, "WINDOWS_ELECTRON_RUNTIME_REQUIRED", "$.runtime", "Proof must bind to the Yance Electron product on Windows.");
  }
  if (!isNonEmptyString(runtime.executablePath) || !isSha256(runtime.executableSha256)) {
    issue(errors, "EXECUTABLE_IDENTITY_REQUIRED", "$.runtime", "The live executable path and SHA-256 are required.");
  }
  if (runtime.exactHeadBinding !== evidence.exactHead) {
    issue(errors, "RUNTIME_HEAD_BINDING_MISMATCH", "$.runtime.exactHeadBinding", "Runtime bytes must bind to the exact head.");
  }
  if (runtime.elementSessionReady !== true || runtime.productShellReady !== true) {
    issue(errors, "PRODUCT_SESSION_NOT_READY", "$.runtime", "Element session and Yance Product shell must both be ready.");
  }
  if (evidence.stage === "packaged-windows-uat" && runtime.isPackaged !== true) {
    issue(errors, "PACKAGED_RUNTIME_REQUIRED", "$.runtime.isPackaged", "Final Windows UAT cannot use an unpackaged runtime.");
  }
  const liveProcess = runtime.liveProcess || {};
  if (
    lowerWindowsPath(liveProcess.executablePath) !== lowerWindowsPath(runtime.executablePath) ||
    liveProcess.executableSha256 !== runtime.executableSha256
  ) {
    issue(errors, "LIVE_PROCESS_IDENTITY_MISMATCH", "$.runtime.liveProcess", "The observed live process must be the admitted executable bytes.");
  }

  const authority = evidence.authority || {};
  const authorityExpected = {
    timelineOwner: "Element/Matrix",
    composerOwner: "Element",
    sendOwner: "Element/Matrix",
    nativeIntegrationOwner: "Electron/Windows",
    yanceRole: "product-projection",
  };
  for (const [key, expected] of Object.entries(authorityExpected)) {
    if (authority[key] !== expected) {
      issue(errors, "MATURE_OWNER_MISMATCH", `$.authority.${key}`, `${key} must remain ${expected}.`);
    }
  }
  if (!Array.isArray(authority.shadowAuthorityFindings) || authority.shadowAuthorityFindings.length !== 0) {
    issue(errors, "SHADOW_AUTHORITY_PRESENT", "$.authority.shadowAuthorityFindings", "Visual closure is blocked by any shadow authority finding.");
  }

  const screenshots = Array.isArray(evidence.screenshots) ? evidence.screenshots : [];
  if (screenshots.length < 3) {
    issue(errors, "SCREENSHOT_MATRIX_INCOMPLETE", "$.screenshots", "At least three real Electron screenshots are required.");
  }
  const screenshotIds = uniqueStrings(screenshots.map((entry) => entry && entry.id));
  if (screenshotIds.size !== screenshots.length) {
    issue(errors, "SCREENSHOT_ID_DUPLICATE", "$.screenshots", "Screenshot IDs must be non-empty and unique.");
  }
  screenshots.forEach((entry, index) => {
    const pointer = `$.screenshots[${index}]`;
    if (!entry || typeof entry !== "object") {
      issue(errors, "SCREENSHOT_INVALID", pointer, "Screenshot evidence must be an object.");
      return;
    }
    if (!isNonEmptyString(entry.path) || !isSha256(entry.sha256) || !isIsoDate(entry.capturedAt)) {
      issue(errors, "SCREENSHOT_CUSTODY_INCOMPLETE", pointer, "Screenshot path, hash, and capture time are required.");
    }
    if (!Number.isInteger(entry.width) || entry.width < 320 || !Number.isInteger(entry.height) || entry.height < 240) {
      issue(errors, "SCREENSHOT_DIMENSIONS_INVALID", pointer, "Screenshot dimensions must describe a usable product window.");
    }
    if (!new Set(["electron-window", "windows-screen-capture"]).has(entry.captureSource)) {
      issue(errors, "SCREENSHOT_SOURCE_INVALID", `${pointer}.captureSource`, "A real Electron/window capture source is required.");
    }
    if (!entry.captureReceipt || !isNonEmptyString(entry.captureReceipt.path) || !isSha256(entry.captureReceipt.sha256)) {
      issue(errors, "SCREENSHOT_CAPTURE_RECEIPT_REQUIRED", `${pointer}.captureReceipt`, "Every production screenshot requires a hashed Electron runtime capture receipt.");
    }
    const design = entry.designBaseline || {};
    if (!isNonEmptyString(design.path) || !isSha256(design.sha256) || design.authorityId !== baseline.id) {
      issue(errors, "DESIGN_BASELINE_BINDING_INCOMPLETE", `${pointer}.designBaseline`, "Each screenshot must bind to an approved baseline file and hash.");
    }
    const diff = entry.diffReport || {};
    if (!isNonEmptyString(diff.path) || !isSha256(diff.sha256)) {
      issue(errors, "DESIGN_DIFF_REPORT_REQUIRED", `${pointer}.diffReport`, "Each screenshot needs a hashed design-diff report.");
    }
  });

  const profiles = Array.isArray(evidence.responsiveProfiles) ? evidence.responsiveProfiles : [];
  const roles = uniqueStrings(profiles.map((profile) => profile && profile.role));
  const scales = new Set(profiles.map((profile) => profile && profile.scalePercent).filter(Number.isFinite));
  const profileScreenshotIds = uniqueStrings(profiles.map((profile) => profile && profile.screenshotId));
  for (const role of REQUIRED_RESPONSIVE_ROLES) {
    if (!roles.has(role)) {
      issue(errors, "RESPONSIVE_ROLE_MISSING", "$.responsiveProfiles", `Missing ${role} responsive proof.`);
    }
  }
  for (const scale of REQUIRED_SCALE_PERCENTS) {
    if (!scales.has(scale)) {
      issue(errors, "DISPLAY_SCALE_MISSING", "$.responsiveProfiles", `Missing ${scale}% display-scale proof.`);
    }
  }
  if (profileScreenshotIds.size !== profiles.length) {
    issue(errors, "RESPONSIVE_SCREENSHOT_REUSED", "$.responsiveProfiles", "Each responsive/display-scale profile requires its own capture.");
  }
  profiles.forEach((profile, index) => {
    const pointer = `$.responsiveProfiles[${index}]`;
    if (!profile || typeof profile !== "object" || !screenshotIds.has(profile.screenshotId)) {
      issue(errors, "RESPONSIVE_SCREENSHOT_MISSING", pointer, "Each responsive profile must reference a real screenshot.");
      return;
    }
    const bounds = {
      wide: [1440, Number.POSITIVE_INFINITY],
      default: [1100, 1439],
      compact: [800, 1099],
    }[profile.role];
    if (!bounds || !Number.isInteger(profile.width) || profile.width < bounds[0] || profile.width > bounds[1]) {
      issue(errors, "RESPONSIVE_WIDTH_INVALID", `${pointer}.width`, `Width is invalid for the ${profile.role || "unknown"} profile.`);
    }
    if (!Number.isInteger(profile.height) || profile.height < 600) {
      issue(errors, "RESPONSIVE_HEIGHT_INVALID", `${pointer}.height`, "Responsive proof requires a window at least 600 CSS pixels high.");
    }
    if (!REQUIRED_SCALE_PERCENTS.includes(profile.scalePercent)) {
      issue(errors, "DISPLAY_SCALE_INVALID", `${pointer}.scalePercent`, "Display scale must be 100, 125, or 150.");
    }
    if (!Number.isFinite(profile.capturePixelRatio) || profile.capturePixelRatio <= 0 || profile.capturePixelRatio > 4) {
      issue(errors, "CAPTURE_PIXEL_RATIO_INVALID", `${pointer}.capturePixelRatio`, "Capture pixel ratio must be a positive finite value no greater than 4.");
    }
  });

  const expectedAvatarIds = Array.isArray(evidence.expectedAvatarIds) ? evidence.expectedAvatarIds : [];
  const expectedAvatarSet = uniqueStrings(expectedAvatarIds);
  const avatarProbes = Array.isArray(evidence.avatarProbes) ? evidence.avatarProbes : [];
  const probeIds = uniqueStrings(avatarProbes.map((probe) => probe && probe.id));
  if (expectedAvatarIds.length === 0 || expectedAvatarSet.size !== expectedAvatarIds.length) {
    issue(errors, "EXPECTED_AVATARS_REQUIRED", "$.expectedAvatarIds", "Declare every expected contact-photo identity exactly once.");
  }
  if (probeIds.size !== avatarProbes.length || probeIds.size !== expectedAvatarSet.size) {
    issue(errors, "AVATAR_PROBE_COVERAGE_MISMATCH", "$.avatarProbes", "Every expected avatar needs exactly one probe.");
  }
  for (const id of expectedAvatarSet) {
    if (!probeIds.has(id)) {
      issue(errors, "AVATAR_PROBE_MISSING", "$.avatarProbes", `Missing avatar probe for ${id}.`);
    }
  }
  avatarProbes.forEach((probe, index) => {
    const pointer = `$.avatarProbes[${index}]`;
    if (!probe || typeof probe !== "object" || !screenshotIds.has(probe.screenshotId)) {
      issue(errors, "AVATAR_SCREENSHOT_REQUIRED", pointer, "Each avatar probe must reference a real screenshot.");
      return;
    }
    if (probe.expectedKind !== "photo" || !isNonEmptyString(probe.platform)) {
      issue(errors, "AVATAR_EXPECTATION_INVALID", pointer, "Avatar probes must expect a platform contact photo.");
    }
    if (!isNonEmptyString(probe.cropPath) || !isSha256(probe.cropSha256)) {
      issue(errors, "AVATAR_SCREENSHOT_CROP_REQUIRED", pointer, "A hashed crop taken from the real screenshot is required.");
    }
    if (!probe.screenshotPixelRect || !Number.isInteger(probe.screenshotPixelRect.x) || !Number.isInteger(probe.screenshotPixelRect.y) || !Number.isInteger(probe.screenshotPixelRect.width) || !Number.isInteger(probe.screenshotPixelRect.height)) {
      issue(errors, "AVATAR_SCREENSHOT_RECT_REQUIRED", `${pointer}.screenshotPixelRect`, "The avatar crop rectangle in screenshot pixels is required.");
    }
    const rendered = probe.renderedElement || {};
    if (rendered.tagName !== "IMG") {
      issue(errors, "AVATAR_IMG_PROBE_REQUIRED", `${pointer}.renderedElement`, "The real rendered IMG probe is required; node presence alone is insufficient.");
    }
    if (rendered.complete !== true) {
      issue(errors, "AVATAR_IMG_INCOMPLETE", `${pointer}.renderedElement.complete`, "img.complete must be true.");
    }
    if (!(Number.isFinite(rendered.naturalWidth) && rendered.naturalWidth > 0) || !(Number.isFinite(rendered.naturalHeight) && rendered.naturalHeight > 0)) {
      issue(errors, "AVATAR_NATURAL_DIMENSIONS_ZERO", `${pointer}.renderedElement`, "naturalWidth and naturalHeight must both be greater than zero.");
    }
    if (!isNonEmptyString(rendered.currentSrc)) {
      issue(errors, "AVATAR_CURRENT_SRC_EMPTY", `${pointer}.renderedElement.currentSrc`, "The loaded image currentSrc is required.");
    }
    const computed = rendered.computedStyle || {};
    if (computed.display === "none" || computed.visibility === "hidden" || computed.visibility === "collapse" || computed.contentVisibility === "hidden" || !(Number.parseFloat(computed.opacity) > 0)) {
      issue(errors, "AVATAR_COMPUTED_HIDDEN", `${pointer}.renderedElement.computedStyle`, "Computed display, visibility, content-visibility, and opacity must all be visible.");
    }
    const rect = rendered.rect || {};
    if (!(Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0)) {
      issue(errors, "AVATAR_RECT_EMPTY", `${pointer}.renderedElement.rect`, "The IMG must have a positive rendered rectangle.");
    }
    if (rendered.withinViewport !== true || rendered.occluded !== false) {
      issue(errors, "AVATAR_NOT_VISUALLY_AVAILABLE", `${pointer}.renderedElement`, "The IMG must be within the viewport and not occluded.");
    }
    const observation = probe.visualObservation || {};
    if (observation.classification !== "photo-visible" || !new Set(["human-reviewed-screenshot", "computer-vision"]).has(observation.method) || !isIsoDate(observation.observedAt)) {
      issue(errors, "AVATAR_VISUAL_OBSERVATION_REQUIRED", `${pointer}.visualObservation`, "A dated review of the actual screenshot crop must confirm a visible photo.");
    }
    if (!observation.reviewReceipt || !isNonEmptyString(observation.reviewReceipt.path) || !isSha256(observation.reviewReceipt.sha256)) {
      issue(errors, "AVATAR_REVIEW_RECEIPT_REQUIRED", `${pointer}.visualObservation.reviewReceipt`, "Photo classification requires a hashed review receipt bound to the screenshot and crop.");
    }
  });

  const surfaces = evidence.surfaceProofs || {};
  if (!surfaces.probeReceipt || !isNonEmptyString(surfaces.probeReceipt.path) || !isSha256(surfaces.probeReceipt.sha256)) {
    issue(errors, "CONVERSATION_RUNTIME_PROBE_RECEIPT_REQUIRED", "$.surfaceProofs.probeReceipt", "Conversation and Composer assertions require a hashed DOM/runtime probe receipt.");
  }
  const conversation = surfaces.conversation || {};
  if (!screenshotIds.has(conversation.screenshotId)) {
    issue(errors, "CONVERSATION_SCREENSHOT_REQUIRED", "$.surfaceProofs.conversation", "Conversation proof must reference a real screenshot.");
  }
  const conversationExpected = {
    yancePrimaryChromeVisible: true,
    realMessagesVisible: true,
    rawSecurityWarningVisible: false,
    rawRoomIntroVisible: false,
    rawMembershipEventsVisible: false,
    genericElementPrimaryNavigationVisible: false,
    cssDomMaskingUsed: false,
    horizontalOverflow: false,
  };
  for (const [key, expected] of Object.entries(conversationExpected)) {
    if (conversation[key] !== expected) {
      issue(errors, "CONVERSATION_PRODUCT_SURFACE_RED", `$.surfaceProofs.conversation.${key}`, `${key} must be ${expected}.`);
    }
  }

  const composer = surfaces.composer || {};
  if (composer.owner !== "Element" || !screenshotIds.has(composer.screenshotId)) {
    issue(errors, "COMPOSER_OWNER_OR_SCREENSHOT_INVALID", "$.surfaceProofs.composer", "Composer must remain Element-owned and reference a real screenshot.");
  }
  if (!composer.inputProbe || !composer.sendControlProbe || composer.clipped !== false || composer.occluded !== false) {
    issue(errors, "COMPOSER_PROOF_INCOMPLETE", "$.surfaceProofs.composer", "Composer input, send control, clipping, and occlusion proof are required.");
  }

  const artifacts = Array.isArray(evidence.windowsArtifacts) ? evidence.windowsArtifacts : [];
  const artifactKinds = uniqueStrings(artifacts.map((entry) => entry && entry.kind));
  const deferred = Array.isArray(evidence.deferredWindowsSurfaces) ? evidence.deferredWindowsSurfaces : [];
  const deferredKinds = uniqueStrings(deferred.map((entry) => entry && entry.kind));
  const requiredNow = evidence.stage === "packaged-windows-uat" ? REQUIRED_WINDOWS_SURFACES : REQUIRED_LOCAL_WINDOWS_SURFACES;
  for (const kind of requiredNow) {
    if (!artifactKinds.has(kind)) {
      issue(errors, "WINDOWS_SURFACE_MISSING", "$.windowsArtifacts", `Missing ${kind} materialized proof.`);
    }
  }
  if (evidence.stage === "packaged-windows-uat" && deferred.length > 0) {
    issue(errors, "PACKAGED_SURFACE_DEFERRAL_FORBIDDEN", "$.deferredWindowsSurfaces", "Packaged Windows UAT cannot defer any required Windows surface.");
  }
  if (evidence.stage === "local-ui-acceptance") {
    for (const kind of REQUIRED_WINDOWS_SURFACES) {
      if (!artifactKinds.has(kind) && !deferredKinds.has(kind)) {
        issue(errors, "WINDOWS_SURFACE_APPLICABILITY_UNDECLARED", "$.deferredWindowsSurfaces", `${kind} must be proved now or explicitly deferred to packaged Windows UAT.`);
      }
    }
    deferred.forEach((entry, index) => {
      if (
        !entry ||
        !REQUIRED_WINDOWS_SURFACES.includes(entry.kind) ||
        REQUIRED_LOCAL_WINDOWS_SURFACES.includes(entry.kind) ||
        entry.requiredStage !== "packaged-windows-uat" ||
        entry.replacementEvidenceAccepted !== false ||
        !isNonEmptyString(entry.reason)
      ) {
        issue(errors, "WINDOWS_SURFACE_DEFERRAL_INVALID", `$.deferredWindowsSurfaces[${index}]`, "Deferral must target packaged-windows-uat, reject replacement evidence, and explain why the surface is not materialized locally.");
      }
    });
  }
  if (deferredKinds.size !== deferred.length || [...deferredKinds].some((kind) => artifactKinds.has(kind))) {
    issue(errors, "WINDOWS_SURFACE_APPLICABILITY_CONFLICT", "$.deferredWindowsSurfaces", "Deferred surfaces must be unique and cannot also claim materialized proof.");
  }
  if (artifactKinds.size !== artifacts.length) {
    issue(errors, "WINDOWS_SURFACE_DUPLICATE", "$.windowsArtifacts", "Each Windows surface must appear exactly once.");
  }
  artifacts.forEach((entry, index) => {
    const pointer = `$.windowsArtifacts[${index}]`;
    if (!entry || typeof entry !== "object") {
      issue(errors, "WINDOWS_SURFACE_INVALID", pointer, "Windows surface evidence must be an object.");
      return;
    }
    if (entry.materialized !== true || entry.status !== "passed") {
      issue(errors, "WINDOWS_SURFACE_NOT_MATERIALIZED", pointer, "Source intent is insufficient; the actual Windows surface must pass.");
    }
    if (!isNonEmptyString(entry.evidencePath) || !isSha256(entry.evidenceSha256)) {
      issue(errors, "WINDOWS_SURFACE_CUSTODY_INCOMPLETE", pointer, "A hashed native/screenshot evidence record is required.");
    }
    if (new Set(["packaged-executable", "installer", "desktop-shortcut", "start-menu-shortcut"]).has(entry.kind)) {
      if (!isNonEmptyString(entry.artifactPath) || !isSha256(entry.artifactSha256)) {
        issue(errors, "WINDOWS_ARTIFACT_IDENTITY_REQUIRED", pointer, `${entry.kind} requires the materialized file path and hash.`);
      }
    }
    if (new Set(["tray", "browser-window"]).has(entry.kind) && !screenshotIds.has(entry.screenshotId)) {
      issue(errors, "WINDOWS_SURFACE_SCREENSHOT_REQUIRED", pointer, `${entry.kind} must reference a real screenshot.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      exactHead: evidence.exactHead || null,
      stage: evidence.stage || null,
      screenshotCount: screenshots.length,
      responsiveProfileCount: profiles.length,
      avatarProbeCount: avatarProbes.length,
      windowsSurfaceCount: artifacts.length,
      deferredWindowsSurfaceCount: deferred.length,
    },
  };
}

function usage() {
  return [
    "Usage: node skills/yance-windows-visual-closure/admission.js --evidence <evidence.json> [--json]",
    "",
    "Fail-closed preflight for real Yance Electron/Windows visual-closure evidence.",
    "It requires hashed runtime/review receipts and rejects DOM-only, class-only, unit-test-only,",
    "browser-surrogate, incomplete responsive, avatar, Composer, Tray, PE/installer/shortcut,",
    "Apps & Features, and BrowserWindow evidence.",
  ].join("\n");
}

function parseArgs(argv) {
  const result = { json: false, help: false, evidencePath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") result.help = true;
    else if (value === "--json") result.json = true;
    else if (value === "--evidence") result.evidencePath = argv[++index] || null;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

function runCli(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.evidencePath) {
    process.stderr.write(`--evidence is required.\n${usage()}\n`);
    return 2;
  }
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidencePath), "utf8"));
  } catch (error) {
    const result = { ok: false, errors: [{ code: "EVIDENCE_READ_FAILED", path: "$", message: error.message }] };
    process.stderr.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `WINDOWS_VISUAL_ADMISSION_RED\nEVIDENCE_READ_FAILED: ${error.message}\n`);
    return 1;
  }
  const result = validateAdmission(evidence);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`WINDOWS_VISUAL_ADMISSION_GREEN\n${JSON.stringify(result.summary)}\n`);
  } else {
    process.stderr.write(`WINDOWS_VISUAL_ADMISSION_RED\n${result.errors.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join("\n")}\n`);
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  REQUIRED_RESPONSIVE_ROLES,
  REQUIRED_SCALE_PERCENTS,
  REQUIRED_WINDOWS_SURFACES,
  REQUIRED_LOCAL_WINDOWS_SURFACES,
  isSha256,
  validateAdmission,
  runCli,
};
