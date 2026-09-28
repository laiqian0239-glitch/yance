"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const zlib = require("node:zlib");

const { validateAdmission } = require("../admission.js");
const { crc32, validateProof } = require("../proof.js");

const SKILL_ROOT = path.resolve(__dirname, "..");
const NOW = "2026-09-21T00:00:00.000Z";
const HEAD = "a".repeat(40);

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function rgbaPng(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha = 255] = pixel(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      raw[offset + 3] = alpha;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function defaultPixel(x, y) {
  if (x >= 10 && x < 42 && y >= 10 && y < 42) {
    return [(x * 19 + y * 3) % 256, (y * 23 + x * 5) % 256, (x * y * 7) % 256, 255];
  }
  return [24, 19, 42, 255];
}

function writeBuffer(directory, name, buffer) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, buffer);
  return { path: name, sha256: hash(buffer), absolutePath: filePath };
}

function writeJson(directory, name, value) {
  return writeBuffer(directory, name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

function visibleProbe(tagName) {
  return {
    tagName,
    computedStyle: { display: "flex", visibility: "visible", contentVisibility: "visible", opacity: "1" },
    rect: { x: 20, y: 520, width: 240, height: 42 },
    withinViewport: true,
    occluded: false,
  };
}

function createPe() {
  const buffer = Buffer.alloc(512);
  buffer.write("MZ", 0, "ascii");
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write("PE\0\0", 0x80, "binary");
  return buffer;
}

function createScreenshot(directory, id, width, height, pixel = () => [24, 19, 42, 255]) {
  const png = rgbaPng(width, height, pixel);
  const actual = writeBuffer(directory, `${id}.png`, png);
  const baseline = writeBuffer(directory, `${id}.baseline.png`, png);
  const diff = writeJson(directory, `${id}.diff.json`, {
    schemaVersion: 1,
    kind: "yance-design-baseline-diff",
    engine: "yance-pixel-diff",
    actualSha256: actual.sha256,
    baselineSha256: baseline.sha256,
    metrics: { differentPixels: 0, totalPixels: width * height, differentPixelRatio: 0, meanAbsoluteDelta: 0 },
    thresholds: { pixelDeltaThreshold: 16, maxDifferentPixelRatio: 0.1, maxMeanAbsoluteDelta: 0.05 },
    passed: true,
  });
  return {
    id,
    path: actual.path,
    sha256: actual.sha256,
    width,
    height,
    capturedAt: NOW,
    captureSource: "electron-window",
    designBaseline: { path: baseline.path, sha256: baseline.sha256, authorityId: "design-v1" },
    diffReport: { path: diff.path, sha256: diff.sha256 },
  };
}

function surfaceReport(directory, name, surface, checks, artifactSha256) {
  return writeJson(directory, `${name}.surface.json`, {
    schemaVersion: 1,
    kind: "yance-windows-surface-proof",
    surface,
    exactHead: HEAD,
    status: "passed",
    capturedAt: NOW,
    ...(artifactSha256 ? { artifactSha256 } : {}),
    checks,
  });
}

function bindReviewAndRuntimeReceipts(directory, evidence) {
  const baselineReceipt = writeJson(directory, "baseline.review.json", {
    schemaVersion: 1,
    kind: "yance-design-baseline-review",
    baselineSetId: evidence.baselineAuthority.id,
    approvedBy: evidence.baselineAuthority.approvedBy,
    approvedAt: evidence.baselineAuthority.approvedAt,
    immutable: true,
    custody: { method: "sha256-review-receipt" },
    baselines: evidence.screenshots.map((screenshot) => ({ screenshotId: screenshot.id, sha256: screenshot.designBaseline.sha256 })),
  });
  evidence.baselineAuthority.reviewReceipt = { path: baselineReceipt.path, sha256: baselineReceipt.sha256 };

  for (const screenshot of evidence.screenshots) {
    const receipt = writeJson(directory, `${screenshot.id}.capture.json`, {
      schemaVersion: 1,
      kind: "yance-electron-capture-receipt",
      screenshotId: screenshot.id,
      screenshotSha256: screenshot.sha256,
      exactHead: evidence.exactHead,
      capturedAt: screenshot.capturedAt,
      captureSource: screenshot.captureSource,
      electronTarget: {
        protocol: "CDP",
        type: "page",
        targetId: `target-${screenshot.id}`,
        url: "http://127.0.0.1:53796/#/room/test",
      },
      window: {
        title: "Yance",
        pid: evidence.runtime.liveProcess.pid,
        liveExecutablePath: evidence.runtime.liveProcess.executablePath,
        liveExecutableSha256: evidence.runtime.liveProcess.executableSha256,
      },
    });
    screenshot.captureReceipt = { path: receipt.path, sha256: receipt.sha256 };
  }

  for (const probe of evidence.avatarProbes) {
    const screenshot = evidence.screenshots.find((entry) => entry.id === probe.screenshotId);
    const observation = probe.visualObservation;
    const receipt = writeJson(directory, `${probe.id}.avatar-review.json`, {
      schemaVersion: 1,
      kind: "yance-avatar-photo-review",
      exactHead: evidence.exactHead,
      screenshotId: probe.screenshotId,
      screenshotSha256: screenshot.sha256,
      avatarId: probe.id,
      cropSha256: probe.cropSha256,
      classification: observation.classification,
      method: observation.method,
      observedAt: observation.observedAt,
      reviewer: observation.reviewer,
      ...(observation.confidence === undefined ? {} : { confidence: observation.confidence }),
    });
    observation.reviewReceipt = { path: receipt.path, sha256: receipt.sha256 };
  }

  const conversationScreenshot = evidence.screenshots.find((entry) => entry.id === evidence.surfaceProofs.conversation.screenshotId);
  const runtimeProbe = writeJson(directory, "conversation.runtime-probe.json", {
    schemaVersion: 1,
    kind: "yance-conversation-runtime-probe",
    probeSource: "electron-cdp-runtime",
    exactHead: evidence.exactHead,
    screenshotId: conversationScreenshot.id,
    screenshotSha256: conversationScreenshot.sha256,
    capturedAt: conversationScreenshot.capturedAt,
    runtime: {
      pid: evidence.runtime.liveProcess.pid,
      executablePath: evidence.runtime.liveProcess.executablePath,
      executableSha256: evidence.runtime.liveProcess.executableSha256,
    },
    conversation: evidence.surfaceProofs.conversation,
    composer: evidence.surfaceProofs.composer,
  });
  evidence.surfaceProofs.probeReceipt = { path: runtimeProbe.path, sha256: runtimeProbe.sha256 };
}

function makeLocalFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yance-visual-skill-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const screenshots = [
    createScreenshot(directory, "wide-100", 1440, 600),
    createScreenshot(directory, "default-125", 1100, 600, defaultPixel),
    createScreenshot(directory, "compact-150", 800, 600),
  ];
  const defaultScreenshot = screenshots[1];
  const crop = writeBuffer(directory, "avatar-contact-1.png", rgbaPng(32, 32, (x, y) => defaultPixel(x + 10, y + 10)));
  const trayReport = surfaceReport(directory, "tray", "tray", {
    iconVisible: true,
    yanceIconMatched: true,
    genericElectronIconVisible: false,
    screenshotSha256: defaultScreenshot.sha256,
  });
  const browserReport = surfaceReport(directory, "browser-window", "browser-window", {
    title: "Yance",
    windowIconMatched: true,
    draggableRegionVerified: true,
    captionSafeAreaVerified: true,
    captionBackgroundContinuous: true,
    screenshotSha256: defaultScreenshot.sha256,
  });
  const runtimeHash = "b".repeat(64);
  const evidence = {
    schemaVersion: 1,
    closureKind: "yance-windows-visual-closure",
    exactHead: HEAD,
    capturedAt: NOW,
    stage: "local-ui-acceptance",
    captureMode: "frozen-acceptance-electron",
    baselineAuthority: { id: "design-v1", source: "owner-approved-design", approvedBy: "product-owner", approvedAt: NOW, immutable: true },
    evidencePolicy: {
      realScreenshotsRequired: true,
      baselineDiffRequired: true,
      domOnlyEvidenceAccepted: false,
      classOnlyEvidenceAccepted: false,
      unitTestOnlyEvidenceAccepted: false,
    },
    runtime: {
      osPlatform: "win32",
      isElectron: true,
      isPackaged: false,
      productName: "Yance",
      executablePath: "C:\\YanceAcceptance\\Yance.exe",
      executableSha256: runtimeHash,
      exactHeadBinding: HEAD,
      elementSessionReady: true,
      productShellReady: true,
      liveProcess: { pid: 100, executablePath: "C:\\YanceAcceptance\\Yance.exe", executableSha256: runtimeHash },
    },
    authority: {
      timelineOwner: "Element/Matrix",
      composerOwner: "Element",
      sendOwner: "Element/Matrix",
      nativeIntegrationOwner: "Electron/Windows",
      yanceRole: "product-projection",
      shadowAuthorityFindings: [],
    },
    screenshots,
    responsiveProfiles: [
      { id: "wide", role: "wide", width: 1440, height: 600, scalePercent: 100, capturePixelRatio: 1, screenshotId: "wide-100" },
      { id: "default", role: "default", width: 1100, height: 600, scalePercent: 125, capturePixelRatio: 1, screenshotId: "default-125" },
      { id: "compact", role: "compact", width: 800, height: 600, scalePercent: 150, capturePixelRatio: 1, screenshotId: "compact-150" },
    ],
    expectedAvatarIds: ["contact-1"],
    avatarProbes: [
      {
        id: "contact-1",
        platform: "facebook",
        expectedKind: "photo",
        screenshotId: "default-125",
        cropPath: crop.path,
        cropSha256: crop.sha256,
        screenshotPixelRect: { x: 10, y: 10, width: 32, height: 32 },
        renderedElement: {
          ...visibleProbe("IMG"),
          complete: true,
          naturalWidth: 128,
          naturalHeight: 128,
          currentSrc: "mxc://example/contact-1",
          rect: { x: 10, y: 10, width: 32, height: 32 },
        },
        visualObservation: { classification: "photo-visible", method: "human-reviewed-screenshot", reviewer: "product-owner", observedAt: NOW },
      },
    ],
    surfaceProofs: {
      conversation: {
        screenshotId: "default-125",
        yancePrimaryChromeVisible: true,
        realMessagesVisible: true,
        rawSecurityWarningVisible: false,
        rawRoomIntroVisible: false,
        rawMembershipEventsVisible: false,
        genericElementPrimaryNavigationVisible: false,
        cssDomMaskingUsed: false,
        horizontalOverflow: false,
      },
      composer: {
        owner: "Element",
        screenshotId: "default-125",
        inputProbe: visibleProbe("DIV"),
        sendControlProbe: visibleProbe("BUTTON"),
        clipped: false,
        occluded: false,
      },
    },
    windowsArtifacts: [
      { kind: "tray", materialized: true, status: "passed", evidencePath: trayReport.path, evidenceSha256: trayReport.sha256, screenshotId: "default-125" },
      { kind: "browser-window", materialized: true, status: "passed", evidencePath: browserReport.path, evidenceSha256: browserReport.sha256, screenshotId: "default-125" },
    ],
    deferredWindowsSurfaces: ["packaged-executable", "installer", "desktop-shortcut", "start-menu-shortcut", "apps-features"].map((kind) => ({
      kind,
      requiredStage: "packaged-windows-uat",
      replacementEvidenceAccepted: false,
      reason: `${kind} does not exist until the admitted Windows package is materialized.`,
    })),
  };
  bindReviewAndRuntimeReceipts(directory, evidence);
  const manifest = writeJson(directory, "evidence.json", evidence);
  return { directory, evidence, manifestPath: manifest.absolutePath };
}

function makePackagedFixture(t) {
  const fixture = makeLocalFixture(t);
  const { directory, evidence } = fixture;
  evidence.stage = "packaged-windows-uat";
  evidence.captureMode = "packaged-windows-product";
  evidence.runtime.isPackaged = true;
  evidence.deferredWindowsSurfaces = [];

  const executable = writeBuffer(directory, "Yance.exe", createPe());
  const installer = writeBuffer(directory, "Yance-Setup.exe", createPe());
  const desktop = writeBuffer(directory, "Yance-Desktop.lnk", Buffer.alloc(64, 7));
  const startMenu = writeBuffer(directory, "Yance-Start.lnk", Buffer.alloc(64, 8));
  evidence.runtime.executablePath = executable.absolutePath;
  evidence.runtime.executableSha256 = executable.sha256;
  evidence.runtime.liveProcess.executablePath = executable.absolutePath;
  evidence.runtime.liveProcess.executableSha256 = executable.sha256;

  const packagedReport = surfaceReport(directory, "packaged", "packaged-executable", {
    peParsed: true,
    peIconPresent: true,
    peIconHash: "1".repeat(64),
    productName: "Yance",
    fileDescription: "Yance",
  }, executable.sha256);
  const installerReport = surfaceReport(directory, "installer", "installer", {
    peParsed: true,
    installerIconPresent: true,
    installerIconHash: "2".repeat(64),
    productName: "Yance",
  }, installer.sha256);
  const desktopReport = surfaceReport(directory, "desktop", "desktop-shortcut", {
    shortcutResolved: true,
    iconVisible: true,
    targetPath: executable.absolutePath,
    iconLocation: executable.absolutePath,
    targetSha256: executable.sha256,
  }, desktop.sha256);
  const startReport = surfaceReport(directory, "start", "start-menu-shortcut", {
    shortcutResolved: true,
    iconVisible: true,
    targetPath: executable.absolutePath,
    iconLocation: executable.absolutePath,
    targetSha256: executable.sha256,
  }, startMenu.sha256);
  const appsReport = surfaceReport(directory, "apps", "apps-features", {
    registryEntryPresent: true,
    displayName: "Yance",
    displayIconVisible: true,
    displayIconTargetSha256: executable.sha256,
  });

  evidence.windowsArtifacts.unshift(
    { kind: "packaged-executable", materialized: true, status: "passed", artifactPath: executable.path, artifactSha256: executable.sha256, evidencePath: packagedReport.path, evidenceSha256: packagedReport.sha256 },
    { kind: "installer", materialized: true, status: "passed", artifactPath: installer.path, artifactSha256: installer.sha256, evidencePath: installerReport.path, evidenceSha256: installerReport.sha256 },
    { kind: "desktop-shortcut", materialized: true, status: "passed", artifactPath: desktop.path, artifactSha256: desktop.sha256, evidencePath: desktopReport.path, evidenceSha256: desktopReport.sha256 },
    { kind: "start-menu-shortcut", materialized: true, status: "passed", artifactPath: startMenu.path, artifactSha256: startMenu.sha256, evidencePath: startReport.path, evidenceSha256: startReport.sha256 },
    { kind: "apps-features", materialized: true, status: "passed", evidencePath: appsReport.path, evidenceSha256: appsReport.sha256 },
  );
  bindReviewAndRuntimeReceipts(directory, evidence);
  const manifest = writeJson(directory, "packaged-evidence.json", evidence);
  return { ...fixture, manifestPath: manifest.absolutePath };
}

test("valid local Electron evidence passes without prematurely requiring packaged-only artifacts", (t) => {
  const fixture = makeLocalFixture(t);
  const admission = validateAdmission(fixture.evidence);
  assert.equal(admission.ok, true, JSON.stringify(admission.errors, null, 2));
  const proof = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(proof.ok, true, JSON.stringify(proof.errors, null, 2));
  assert.equal(proof.summary.avatarCropsBoundToScreenshots, 1);
  assert.equal(proof.summary.deferredWindowsSurfaceCount, 5);
});

test("packaged Windows evidence proves every materialized native surface", (t) => {
  const fixture = makePackagedFixture(t);
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.summary.windowsSurfaceCount, 7);
  assert.equal(result.summary.deferredWindowsSurfaceCount, 0);
});

test("an IMG node or mounted class without loaded and visible image facts is admission RED", (t) => {
  const fixture = makeLocalFixture(t);
  fixture.evidence.avatarProbes[0].renderedElement = { tagName: "IMG" };
  const result = validateAdmission(fixture.evidence);
  assert.equal(result.ok, false);
  const codes = new Set(result.errors.map((entry) => entry.code));
  assert.equal(codes.has("AVATAR_IMG_INCOMPLETE"), true);
  assert.equal(codes.has("AVATAR_NATURAL_DIMENSIONS_ZERO"), true);
  assert.equal(codes.has("AVATAR_COMPUTED_HIDDEN"), true);
  assert.equal(codes.has("AVATAR_RECT_EMPTY"), true);
  assert.equal(codes.has("AVATAR_NOT_VISUALLY_AVAILABLE"), true);
});

test("ordinary-test-only policy cannot be promoted to visual evidence", (t) => {
  const fixture = makeLocalFixture(t);
  fixture.evidence.evidencePolicy.unitTestOnlyEvidenceAccepted = true;
  const result = validateAdmission(fixture.evidence);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "EVIDENCE_POLICY_WEAKENED"), true);
});

test("a production screenshot without a runtime capture receipt is admission RED", (t) => {
  const fixture = makeLocalFixture(t);
  delete fixture.evidence.screenshots[0].captureReceipt;
  const result = validateAdmission(fixture.evidence);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "SCREENSHOT_CAPTURE_RECEIPT_REQUIRED"), true);
});

test("post-capture receipt tampering is detected by its recorded hash", (t) => {
  const fixture = makeLocalFixture(t);
  const receipt = fixture.evidence.screenshots[0].captureReceipt;
  fs.appendFileSync(path.join(fixture.directory, receipt.path), " ", "utf8");
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "SCREENSHOT_CAPTURE_RECEIPT_RED" && /SHA-256 mismatch/.test(entry.message)), true);
});

test("a freshly rehashed capture receipt still fails when its process identity differs", (t) => {
  const fixture = makeLocalFixture(t);
  const screenshot = fixture.evidence.screenshots[0];
  const receiptPath = path.join(fixture.directory, screenshot.captureReceipt.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.window.pid += 1;
  const rewritten = writeJson(fixture.directory, screenshot.captureReceipt.path, receipt);
  screenshot.captureReceipt.sha256 = rewritten.sha256;
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "SCREENSHOT_CAPTURE_RECEIPT_RED" && /process identity/.test(entry.message)), true);
});

test("conversation safety and Composer claims must match the hashed runtime probe receipt", (t) => {
  const fixture = makeLocalFixture(t);
  const ref = fixture.evidence.surfaceProofs.probeReceipt;
  const receiptPath = path.join(fixture.directory, ref.path);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.conversation.rawSecurityWarningVisible = true;
  const rewritten = writeJson(fixture.directory, ref.path, receipt);
  ref.sha256 = rewritten.sha256;
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "CONVERSATION_RUNTIME_PROBE_RECEIPT_RED" && /differ/.test(entry.message)), true);
});

test("a rehashed baseline receipt cannot change the recorded owner approval", (t) => {
  const fixture = makeLocalFixture(t);
  const ref = fixture.evidence.baselineAuthority.reviewReceipt;
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.directory, ref.path), "utf8"));
  receipt.approvedBy = "unbound-reviewer";
  const rewritten = writeJson(fixture.directory, ref.path, receipt);
  ref.sha256 = rewritten.sha256;
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "BASELINE_REVIEW_RECEIPT_RED" && /approval authority/.test(entry.message)), true);
});

test("a rehashed avatar review receipt cannot switch the reviewed crop", (t) => {
  const fixture = makeLocalFixture(t);
  const ref = fixture.evidence.avatarProbes[0].visualObservation.reviewReceipt;
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.directory, ref.path), "utf8"));
  receipt.cropSha256 = "f".repeat(64);
  const rewritten = writeJson(fixture.directory, ref.path, receipt);
  ref.sha256 = rewritten.sha256;
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "AVATAR_SCREENSHOT_PROOF_RED" && /review receipt/.test(entry.message)), true);
});

test("a separately generated avatar image cannot impersonate a crop from the Electron screenshot", (t) => {
  const fixture = makeLocalFixture(t);
  const fakeCrop = writeBuffer(fixture.directory, "unbound-avatar.png", rgbaPng(32, 32, (x, y) => [(x * 31) % 256, (y * 29) % 256, 240, 255]));
  fixture.evidence.avatarProbes[0].cropPath = fakeCrop.path;
  fixture.evidence.avatarProbes[0].cropSha256 = fakeCrop.sha256;
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "AVATAR_SCREENSHOT_PROOF_RED" && /not the declared region/.test(entry.message)), true);
});

test("proof recomputes pixels and rejects a fabricated passing design-diff report", (t) => {
  const fixture = makeLocalFixture(t);
  const screenshot = fixture.evidence.screenshots[0];
  const changed = writeBuffer(fixture.directory, "wide-changed.png", rgbaPng(1440, 600, () => [240, 240, 240, 255]));
  screenshot.path = changed.path;
  screenshot.sha256 = changed.sha256;
  const fakeReport = writeJson(fixture.directory, "wide-fake.diff.json", {
    schemaVersion: 1,
    kind: "yance-design-baseline-diff",
    engine: "yance-pixel-diff",
    actualSha256: changed.sha256,
    baselineSha256: screenshot.designBaseline.sha256,
    metrics: { differentPixels: 0, totalPixels: 1440 * 600, differentPixelRatio: 0, meanAbsoluteDelta: 0 },
    thresholds: { pixelDeltaThreshold: 16, maxDifferentPixelRatio: 0.1, maxMeanAbsoluteDelta: 0.05 },
    passed: true,
  });
  screenshot.diffReport = { path: fakeReport.path, sha256: fakeReport.sha256 };
  const result = validateProof(fixture.evidence, fixture.manifestPath);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "SCREENSHOT_OR_BASELINE_PROOF_RED" && /metrics do not match/.test(entry.message)), true);
});

test("packaged stage cannot defer installer or shortcut proof", (t) => {
  const fixture = makeLocalFixture(t);
  fixture.evidence.stage = "packaged-windows-uat";
  fixture.evidence.captureMode = "packaged-windows-product";
  fixture.evidence.runtime.isPackaged = true;
  const result = validateAdmission(fixture.evidence);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((entry) => entry.code === "PACKAGED_SURFACE_DEFERRAL_FORBIDDEN"), true);
  assert.equal(result.errors.some((entry) => entry.code === "WINDOWS_SURFACE_MISSING"), true);
});

test("both executable entrypoints expose help without needing evidence", () => {
  for (const script of ["admission.js", "proof.js"]) {
    const result = spawnSync(process.execPath, [path.join(SKILL_ROOT, script), "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--evidence/);
  }
});
