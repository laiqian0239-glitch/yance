#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const zlib = require("node:zlib");
const { validateAdmission, isSha256 } = require("./admission.js");

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_PIXELS = 50_000_000;
const MAX_DIFFERENT_PIXEL_RATIO = 0.25;
const MAX_MEAN_ABSOLUTE_DELTA = 0.12;
const MAX_PIXEL_DELTA_THRESHOLD = 32;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveEvidencePath(manifestPath, referencedPath) {
  if (typeof referencedPath !== "string" || referencedPath.trim() === "") throw new Error("Referenced path is empty.");
  return path.isAbsolute(referencedPath)
    ? path.normalize(referencedPath)
    : path.resolve(path.dirname(manifestPath), referencedPath);
}

function readBoundFile(manifestPath, referencedPath, expectedHash, label) {
  const resolvedPath = resolveEvidencePath(manifestPath, referencedPath);
  let buffer;
  try {
    buffer = fs.readFileSync(resolvedPath);
  } catch (error) {
    throw new Error(`${label} cannot be read at ${resolvedPath}: ${error.message}`);
  }
  const actualHash = sha256(buffer);
  if (!isSha256(expectedHash) || actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}.`);
  }
  return { path: resolvedPath, buffer, sha256: actualHash };
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodePng(buffer, label = "PNG") {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG file.`);
  }
  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const compressedParts = [];
  let sawEnd = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (crcOffset + 4 > buffer.length) throw new Error(`${label} has a truncated chunk.`);
    const typeBytes = buffer.subarray(typeOffset, dataOffset);
    const type = typeBytes.toString("ascii");
    const data = buffer.subarray(dataOffset, crcOffset);
    const expectedCrc = buffer.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([typeBytes, data]));
    if (actualCrc !== expectedCrc) throw new Error(`${label} has an invalid ${type} CRC.`);
    if (type === "IHDR") {
      if (header || length !== 13) throw new Error(`${label} has an invalid IHDR.`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "PLTE") {
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      compressedParts.push(Buffer.from(data));
    } else if (type === "IEND") {
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
  }
  if (!header || compressedParts.length === 0 || !sawEnd) throw new Error(`${label} is missing IHDR, IDAT, or IEND.`);
  if (offset !== buffer.length) throw new Error(`${label} contains bytes after IEND.`);
  if (header.width === 0 || header.height === 0 || header.width * header.height > MAX_PNG_PIXELS) {
    throw new Error(`${label} dimensions are invalid or exceed the proof limit.`);
  }
  if (header.bitDepth !== 8 || !new Set([0, 2, 3, 4, 6]).has(header.colorType)) {
    throw new Error(`${label} must use a supported 8-bit grayscale, RGB, indexed, gray-alpha, or RGBA format.`);
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    throw new Error(`${label} must use standard non-interlaced PNG encoding.`);
  }
  if (header.colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error(`${label} indexed image is missing a valid palette.`);
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const rowBytes = header.width * channels;
  const expectedInflatedLength = header.height * (rowBytes + 1);
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(compressedParts), { maxOutputLength: expectedInflatedLength + 1 });
  } catch (error) {
    throw new Error(`${label} pixel data cannot be inflated: ${error.message}`);
  }
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(`${label} pixel payload length does not match its dimensions.`);
  }
  const unfiltered = Buffer.alloc(rowBytes * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const sourceRow = y * (rowBytes + 1);
    const filter = inflated[sourceRow];
    if (filter > 4) throw new Error(`${label} uses an invalid PNG row filter.`);
    const destinationRow = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceRow + 1 + x];
      const left = x >= channels ? unfiltered[destinationRow + x - channels] : 0;
      const above = y > 0 ? unfiltered[destinationRow - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? unfiltered[destinationRow - rowBytes + x - channels] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + above;
      else if (filter === 3) value = raw + Math.floor((left + above) / 2);
      else value = raw + paeth(left, above, upperLeft);
      unfiltered[destinationRow + x] = value & 0xff;
    }
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const source = pixel * channels;
    const destination = pixel * 4;
    if (header.colorType === 0) {
      rgba[destination] = unfiltered[source];
      rgba[destination + 1] = unfiltered[source];
      rgba[destination + 2] = unfiltered[source];
      rgba[destination + 3] = 255;
    } else if (header.colorType === 2) {
      rgba[destination] = unfiltered[source];
      rgba[destination + 1] = unfiltered[source + 1];
      rgba[destination + 2] = unfiltered[source + 2];
      rgba[destination + 3] = 255;
    } else if (header.colorType === 3) {
      const paletteIndex = unfiltered[source];
      const paletteOffset = paletteIndex * 3;
      if (paletteOffset + 2 >= palette.length) throw new Error(`${label} references a missing palette entry.`);
      rgba[destination] = palette[paletteOffset];
      rgba[destination + 1] = palette[paletteOffset + 1];
      rgba[destination + 2] = palette[paletteOffset + 2];
      rgba[destination + 3] = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255;
    } else if (header.colorType === 4) {
      rgba[destination] = unfiltered[source];
      rgba[destination + 1] = unfiltered[source];
      rgba[destination + 2] = unfiltered[source];
      rgba[destination + 3] = unfiltered[source + 1];
    } else {
      rgba[destination] = unfiltered[source];
      rgba[destination + 1] = unfiltered[source + 1];
      rgba[destination + 2] = unfiltered[source + 2];
      rgba[destination + 3] = unfiltered[source + 3];
    }
  }
  return { width: header.width, height: header.height, pixels: rgba };
}

function compareImages(actual, baseline, pixelDeltaThreshold) {
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    throw new Error("Actual screenshot and design baseline dimensions differ.");
  }
  let differentPixels = 0;
  let totalAbsoluteDelta = 0;
  const totalPixels = actual.width * actual.height;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4;
    let maxDelta = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(actual.pixels[offset + channel] - baseline.pixels[offset + channel]);
      totalAbsoluteDelta += delta;
      if (delta > maxDelta) maxDelta = delta;
    }
    if (maxDelta > pixelDeltaThreshold) differentPixels += 1;
  }
  return {
    differentPixels,
    totalPixels,
    differentPixelRatio: differentPixels / totalPixels,
    meanAbsoluteDelta: totalAbsoluteDelta / (totalPixels * 4 * 255),
  };
}

function nearlyEqual(left, right, tolerance = 1e-8) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function visibleProbeErrors(probe, pointer, options = {}) {
  const errors = [];
  if (!probe || typeof probe !== "object") return [{ code: "VISIBLE_PROBE_REQUIRED", path: pointer, message: "Rendered-element probe is missing." }];
  if (options.requireImage) {
    if (probe.tagName !== "IMG") errors.push({ code: "AVATAR_NOT_IMG", path: `${pointer}.tagName`, message: "Avatar must be a rendered IMG." });
    if (probe.complete !== true) errors.push({ code: "AVATAR_IMG_INCOMPLETE", path: `${pointer}.complete`, message: "img.complete must be true." });
    if (!(Number.isFinite(probe.naturalWidth) && probe.naturalWidth > 0)) errors.push({ code: "AVATAR_NATURAL_WIDTH_ZERO", path: `${pointer}.naturalWidth`, message: "naturalWidth must be greater than zero." });
    if (!(Number.isFinite(probe.naturalHeight) && probe.naturalHeight > 0)) errors.push({ code: "AVATAR_NATURAL_HEIGHT_ZERO", path: `${pointer}.naturalHeight`, message: "naturalHeight must be greater than zero." });
    if (typeof probe.currentSrc !== "string" || probe.currentSrc.trim() === "") errors.push({ code: "AVATAR_CURRENT_SRC_EMPTY", path: `${pointer}.currentSrc`, message: "The loaded image source is required." });
  }
  const style = probe.computedStyle || {};
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || !(Number.parseFloat(style.opacity) > 0)) {
    errors.push({ code: "ELEMENT_COMPUTED_HIDDEN", path: `${pointer}.computedStyle`, message: "Computed display, visibility, content-visibility, and opacity must be visible." });
  }
  const rect = probe.rect || {};
  if (!(Number.isFinite(rect.width) && rect.width > 0 && Number.isFinite(rect.height) && rect.height > 0 && Number.isFinite(rect.x) && Number.isFinite(rect.y))) {
    errors.push({ code: "ELEMENT_RECT_EMPTY", path: `${pointer}.rect`, message: "The rendered element needs a positive on-screen rect." });
  }
  if (probe.withinViewport !== true || probe.occluded !== false) {
    errors.push({ code: "ELEMENT_NOT_VISUALLY_AVAILABLE", path: pointer, message: "The element must be within the viewport and not occluded." });
  }
  return errors;
}

function extractRegion(image, rect) {
  if (
    !Number.isInteger(rect.x) || !Number.isInteger(rect.y) || !Number.isInteger(rect.width) || !Number.isInteger(rect.height) ||
    rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > image.width || rect.y + rect.height > image.height
  ) {
    throw new Error("Crop rectangle is outside the screenshot.");
  }
  const pixels = Buffer.alloc(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceStart = ((rect.y + row) * image.width + rect.x) * 4;
    const destinationStart = row * rect.width * 4;
    image.pixels.copy(pixels, destinationStart, sourceStart, sourceStart + rect.width * 4);
  }
  return { width: rect.width, height: rect.height, pixels };
}

function samePixels(left, right) {
  return left.width === right.width && left.height === right.height && left.pixels.equals(right.pixels);
}

function cropDiversity(image) {
  const colors = new Set();
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  const count = image.width * image.height;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4;
    const red = image.pixels[offset];
    const green = image.pixels[offset + 1];
    const blue = image.pixels[offset + 2];
    const alpha = image.pixels[offset + 3];
    if (colors.size < 257) colors.add(`${red},${green},${blue},${alpha}`);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    luminanceSum += luminance;
    luminanceSquaredSum += luminance * luminance;
  }
  const mean = luminanceSum / count;
  return { uniqueColors: colors.size, luminanceVariance: luminanceSquaredSum / count - mean * mean };
}

function inspectPe(buffer, label) {
  if (buffer.length < 256 || buffer.toString("ascii", 0, 2) !== "MZ") throw new Error(`${label} is not an MZ executable.`);
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 4 > buffer.length || buffer.toString("binary", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`${label} does not contain a valid PE signature.`);
  }
}

function readJsonBoundFile(manifestPath, referencedPath, expectedHash, label) {
  const file = readBoundFile(manifestPath, referencedPath, expectedHash, label);
  try {
    return { ...file, json: JSON.parse(file.buffer.toString("utf8")) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function sameWindowsPath(left, right) {
  return typeof left === "string" && typeof right === "string" && left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
}

function validateBaselineReviewReceipt(receipt, evidence) {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "yance-design-baseline-review" ||
    receipt.baselineSetId !== evidence.baselineAuthority.id ||
    receipt.approvedBy !== evidence.baselineAuthority.approvedBy ||
    receipt.approvedAt !== evidence.baselineAuthority.approvedAt ||
    receipt.immutable !== true ||
    !receipt.custody ||
    receipt.custody.method !== "sha256-review-receipt"
  ) {
    throw new Error("Baseline review receipt is not bound to the declared approval authority.");
  }
  const receiptBaselines = Array.isArray(receipt.baselines) ? receipt.baselines : [];
  if (receiptBaselines.length !== evidence.screenshots.length) throw new Error("Baseline review receipt does not enumerate every screenshot baseline exactly once.");
  const byScreenshot = new Map();
  for (const entry of receiptBaselines) {
    if (!entry || byScreenshot.has(entry.screenshotId)) throw new Error("Baseline review receipt has a missing or duplicate screenshot binding.");
    byScreenshot.set(entry.screenshotId, entry.sha256);
  }
  for (const screenshot of evidence.screenshots) {
    if (byScreenshot.get(screenshot.id) !== screenshot.designBaseline.sha256) throw new Error(`Baseline review receipt does not bind ${screenshot.id} to its baseline hash.`);
  }
}

function validateCaptureReceipt(receipt, screenshot, evidence) {
  const runtime = evidence.runtime;
  const process = runtime.liveProcess || {};
  const target = receipt.electronTarget || {};
  const window = receipt.window || {};
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "yance-electron-capture-receipt" ||
    receipt.screenshotId !== screenshot.id ||
    receipt.screenshotSha256 !== screenshot.sha256 ||
    receipt.exactHead !== evidence.exactHead ||
    receipt.capturedAt !== screenshot.capturedAt ||
    receipt.captureSource !== screenshot.captureSource
  ) {
    throw new Error("Capture receipt is not bound to this screenshot, exact head, timestamp, and capture source.");
  }
  if (target.protocol !== "CDP" || target.type !== "page" || !String(target.targetId || "").trim() || !String(target.url || "").trim()) {
    throw new Error("Capture receipt is missing the concrete Electron/CDP page target.");
  }
  if (
    window.title !== "Yance" ||
    window.pid !== process.pid ||
    !sameWindowsPath(window.liveExecutablePath, process.executablePath) ||
    window.liveExecutableSha256 !== process.executableSha256 ||
    !sameWindowsPath(window.liveExecutablePath, runtime.executablePath) ||
    window.liveExecutableSha256 !== runtime.executableSha256
  ) {
    throw new Error("Capture receipt window/process identity does not match the admitted live Yance executable.");
  }
}

function validateConversationProbeReceipt(receipt, evidence, screenshotById) {
  const surfaces = evidence.surfaceProofs;
  const screenshot = screenshotById.get(surfaces.conversation.screenshotId);
  const runtime = receipt.runtime || {};
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "yance-conversation-runtime-probe" ||
    receipt.probeSource !== "electron-cdp-runtime" ||
    receipt.exactHead !== evidence.exactHead ||
    !screenshot ||
    receipt.screenshotId !== screenshot.id ||
    receipt.screenshotSha256 !== screenshot.sha256 ||
    receipt.capturedAt !== screenshot.capturedAt
  ) {
    throw new Error("Conversation probe receipt is not bound to the accepted screenshot and exact head.");
  }
  if (
    runtime.pid !== evidence.runtime.liveProcess.pid ||
    !sameWindowsPath(runtime.executablePath, evidence.runtime.liveProcess.executablePath) ||
    runtime.executableSha256 !== evidence.runtime.liveProcess.executableSha256
  ) {
    throw new Error("Conversation probe receipt runtime does not match the admitted live process.");
  }
  if (!isDeepStrictEqual(receipt.conversation, surfaces.conversation) || !isDeepStrictEqual(receipt.composer, surfaces.composer)) {
    throw new Error("Conversation or Composer manifest assertions differ from the hashed runtime probe receipt.");
  }
}

function validateAvatarReviewReceipt(receipt, probe, evidence, screenshotById) {
  const screenshot = screenshotById.get(probe.screenshotId);
  const observation = probe.visualObservation;
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "yance-avatar-photo-review" ||
    receipt.exactHead !== evidence.exactHead ||
    !screenshot ||
    receipt.screenshotId !== screenshot.id ||
    receipt.screenshotSha256 !== screenshot.sha256 ||
    receipt.avatarId !== probe.id ||
    receipt.cropSha256 !== probe.cropSha256 ||
    receipt.classification !== observation.classification ||
    receipt.method !== observation.method ||
    receipt.observedAt !== observation.observedAt ||
    receipt.reviewer !== observation.reviewer ||
    receipt.confidence !== observation.confidence
  ) {
    throw new Error("Avatar review receipt is not bound to the exact head, screenshot, crop, and declared review.");
  }
}

function validateWindowsSurfaceReport(report, entry, evidence, screenshotById) {
  const failures = [];
  const push = (code, message) => failures.push({ code, path: `$.windowsArtifacts[${entry.kind}]`, message });
  if (report.schemaVersion !== 1 || report.kind !== "yance-windows-surface-proof" || report.surface !== entry.kind || report.exactHead !== evidence.exactHead || report.status !== "passed") {
    push("WINDOWS_REPORT_BINDING_INVALID", "Native surface report is not bound to this surface, head, and passing status.");
    return failures;
  }
  const checks = report.checks || {};
  if (entry.artifactSha256 && report.artifactSha256 !== entry.artifactSha256) push("WINDOWS_REPORT_ARTIFACT_MISMATCH", "Native report is not bound to the materialized artifact hash.");
  if (entry.kind === "packaged-executable") {
    if (entry.artifactSha256 !== evidence.runtime.executableSha256) push("LIVE_EXECUTABLE_NOT_PACKAGED_ARTIFACT", "The packaged executable must be the admitted live executable bytes.");
    if (checks.peParsed !== true || checks.peIconPresent !== true || !isSha256(checks.peIconHash) || checks.productName !== "Yance" || checks.fileDescription !== "Yance") push("PACKAGED_EXECUTABLE_VISUAL_IDENTITY_RED", "PE icon and Yance version identity are required.");
  } else if (entry.kind === "installer") {
    if (checks.peParsed !== true || checks.installerIconPresent !== true || !isSha256(checks.installerIconHash) || checks.productName !== "Yance") push("INSTALLER_VISUAL_IDENTITY_RED", "Installer PE icon and product identity are required.");
  } else if (entry.kind === "desktop-shortcut" || entry.kind === "start-menu-shortcut") {
    if (checks.shortcutResolved !== true || checks.iconVisible !== true || !checks.targetPath || !checks.iconLocation || checks.targetSha256 !== evidence.runtime.executableSha256) push("SHORTCUT_VISUAL_IDENTITY_RED", "Shortcut must resolve to the admitted executable and show the Yance icon.");
  } else if (entry.kind === "apps-features") {
    if (checks.registryEntryPresent !== true || checks.displayName !== "Yance" || checks.displayIconVisible !== true || checks.displayIconTargetSha256 !== evidence.runtime.executableSha256) push("APPS_FEATURES_VISUAL_IDENTITY_RED", "Apps & Features must show Yance and bind DisplayIcon to the admitted executable.");
  } else if (entry.kind === "tray") {
    const screenshot = screenshotById.get(entry.screenshotId);
    if (checks.iconVisible !== true || checks.yanceIconMatched !== true || checks.genericElectronIconVisible !== false || !screenshot || checks.screenshotSha256 !== screenshot.sha256) push("TRAY_VISUAL_IDENTITY_RED", "Tray evidence must show the Yance icon in the bound screenshot and no generic Electron icon.");
  } else if (entry.kind === "browser-window") {
    const screenshot = screenshotById.get(entry.screenshotId);
    if (checks.title !== "Yance" || checks.windowIconMatched !== true || checks.draggableRegionVerified !== true || checks.captionSafeAreaVerified !== true || checks.captionBackgroundContinuous !== true || !screenshot || checks.screenshotSha256 !== screenshot.sha256) push("BROWSER_WINDOW_VISUAL_IDENTITY_RED", "BrowserWindow title, icon, drag region, caption safe area, and caption background must pass in the bound screenshot.");
  }
  return failures;
}

function validateProof(evidence, manifestPath) {
  const admission = validateAdmission(evidence);
  const errors = [...admission.errors];
  if (!admission.ok) return { ok: false, errors, summary: admission.summary };
  const add = (code, pointer, message) => errors.push({ code, path: pointer, message });
  const screenshotById = new Map(evidence.screenshots.map((entry) => [entry.id, entry]));
  const decodedScreenshots = new Map();

  try {
    const baselineReceipt = readJsonBoundFile(
      manifestPath,
      evidence.baselineAuthority.reviewReceipt.path,
      evidence.baselineAuthority.reviewReceipt.sha256,
      "Baseline approval receipt",
    );
    validateBaselineReviewReceipt(baselineReceipt.json, evidence);
  } catch (error) {
    add("BASELINE_REVIEW_RECEIPT_RED", "$.baselineAuthority.reviewReceipt", error.message);
  }

  evidence.screenshots.forEach((entry, index) => {
    const pointer = `$.screenshots[${index}]`;
    try {
      const captureReceipt = readJsonBoundFile(manifestPath, entry.captureReceipt.path, entry.captureReceipt.sha256, `Capture receipt ${entry.id}`);
      validateCaptureReceipt(captureReceipt.json, entry, evidence);
    } catch (error) {
      add("SCREENSHOT_CAPTURE_RECEIPT_RED", `${pointer}.captureReceipt`, error.message);
    }
    try {
      const actualFile = readBoundFile(manifestPath, entry.path, entry.sha256, `Screenshot ${entry.id}`);
      const baselineFile = readBoundFile(manifestPath, entry.designBaseline.path, entry.designBaseline.sha256, `Design baseline ${entry.id}`);
      const reportFile = readJsonBoundFile(manifestPath, entry.diffReport.path, entry.diffReport.sha256, `Design diff ${entry.id}`);
      const actual = decodePng(actualFile.buffer, `Screenshot ${entry.id}`);
      const baseline = decodePng(baselineFile.buffer, `Design baseline ${entry.id}`);
      if (actual.width !== entry.width || actual.height !== entry.height) throw new Error("Declared screenshot dimensions do not match PNG dimensions.");
      const report = reportFile.json;
      if (report.schemaVersion !== 1 || report.kind !== "yance-design-baseline-diff" || report.actualSha256 !== entry.sha256 || report.baselineSha256 !== entry.designBaseline.sha256) {
        throw new Error("Diff report is not bound to the screenshot and approved baseline hashes.");
      }
      if (!new Set(["pixelmatch", "odiff", "imagemagick", "opencv", "resemblejs", "yance-pixel-diff"]).has(report.engine)) {
        throw new Error("Diff report must name an admitted pixel comparison engine.");
      }
      const thresholds = report.thresholds || {};
      if (!(Number.isFinite(thresholds.pixelDeltaThreshold) && thresholds.pixelDeltaThreshold >= 0 && thresholds.pixelDeltaThreshold <= MAX_PIXEL_DELTA_THRESHOLD)) throw new Error("Per-pixel delta threshold is absent or too permissive.");
      if (!(Number.isFinite(thresholds.maxDifferentPixelRatio) && thresholds.maxDifferentPixelRatio >= 0 && thresholds.maxDifferentPixelRatio <= MAX_DIFFERENT_PIXEL_RATIO)) throw new Error("Different-pixel ratio threshold is absent or too permissive.");
      if (!(Number.isFinite(thresholds.maxMeanAbsoluteDelta) && thresholds.maxMeanAbsoluteDelta >= 0 && thresholds.maxMeanAbsoluteDelta <= MAX_MEAN_ABSOLUTE_DELTA)) throw new Error("Mean-delta threshold is absent or too permissive.");
      const metrics = compareImages(actual, baseline, thresholds.pixelDeltaThreshold);
      const reported = report.metrics || {};
      if (reported.differentPixels !== metrics.differentPixels || reported.totalPixels !== metrics.totalPixels || !nearlyEqual(reported.differentPixelRatio, metrics.differentPixelRatio) || !nearlyEqual(reported.meanAbsoluteDelta, metrics.meanAbsoluteDelta)) throw new Error("Diff report metrics do not match recomputed pixels.");
      if (report.passed !== true || metrics.differentPixelRatio > thresholds.maxDifferentPixelRatio || metrics.meanAbsoluteDelta > thresholds.maxMeanAbsoluteDelta) throw new Error("Screenshot exceeds the approved design-difference thresholds.");
      decodedScreenshots.set(entry.id, actual);
    } catch (error) {
      add("SCREENSHOT_OR_BASELINE_PROOF_RED", pointer, error.message);
    }
  });

  evidence.responsiveProfiles.forEach((profile, index) => {
    const screenshot = screenshotById.get(profile.screenshotId);
    const expectedWidth = Math.round(profile.width * profile.capturePixelRatio);
    const expectedHeight = Math.round(profile.height * profile.capturePixelRatio);
    if (!screenshot || screenshot.width !== expectedWidth || screenshot.height !== expectedHeight) {
      add("RESPONSIVE_CAPTURE_DIMENSION_MISMATCH", `$.responsiveProfiles[${index}]`, "Screenshot pixels must match CSS viewport dimensions times capturePixelRatio.");
    }
  });

  evidence.avatarProbes.forEach((probe, index) => {
    const pointer = `$.avatarProbes[${index}]`;
    errors.push(...visibleProbeErrors(probe.renderedElement, `${pointer}.renderedElement`, { requireImage: true }));
    try {
      const screenshot = decodedScreenshots.get(probe.screenshotId);
      if (!screenshot) throw new Error("Referenced screenshot did not pass decoding and design comparison.");
      const cropFile = readBoundFile(manifestPath, probe.cropPath, probe.cropSha256, `Avatar crop ${probe.id}`);
      const crop = decodePng(cropFile.buffer, `Avatar crop ${probe.id}`);
      const extracted = extractRegion(screenshot, probe.screenshotPixelRect);
      if (!samePixels(crop, extracted)) throw new Error("Avatar crop pixels are not the declared region of the real screenshot.");
      const diversity = cropDiversity(crop);
      if (diversity.uniqueColors < 16 || diversity.luminanceVariance < 40) throw new Error("Screenshot crop is visually flat and cannot substantiate a contact photo.");
      const observation = probe.visualObservation;
      if (observation.method === "computer-vision" && !(Number.isFinite(observation.confidence) && observation.confidence >= 0.9)) throw new Error("Computer-vision photo classification confidence must be at least 0.9.");
      if (observation.method === "human-reviewed-screenshot" && !String(observation.reviewer || "").trim()) throw new Error("Human screenshot review requires an identified reviewer.");
      const reviewReceipt = readJsonBoundFile(manifestPath, observation.reviewReceipt.path, observation.reviewReceipt.sha256, `Avatar review ${probe.id}`);
      validateAvatarReviewReceipt(reviewReceipt.json, probe, evidence, screenshotById);
    } catch (error) {
      add("AVATAR_SCREENSHOT_PROOF_RED", pointer, error.message);
    }
  });

  const composer = evidence.surfaceProofs.composer;
  errors.push(...visibleProbeErrors(composer.inputProbe, "$.surfaceProofs.composer.inputProbe"));
  errors.push(...visibleProbeErrors(composer.sendControlProbe, "$.surfaceProofs.composer.sendControlProbe"));
  try {
    const probeReceipt = readJsonBoundFile(
      manifestPath,
      evidence.surfaceProofs.probeReceipt.path,
      evidence.surfaceProofs.probeReceipt.sha256,
      "Conversation runtime probe receipt",
    );
    validateConversationProbeReceipt(probeReceipt.json, evidence, screenshotById);
  } catch (error) {
    add("CONVERSATION_RUNTIME_PROBE_RECEIPT_RED", "$.surfaceProofs.probeReceipt", error.message);
  }

  evidence.windowsArtifacts.forEach((entry, index) => {
    const pointer = `$.windowsArtifacts[${index}]`;
    try {
      if (entry.artifactPath) {
        const artifact = readBoundFile(manifestPath, entry.artifactPath, entry.artifactSha256, `${entry.kind} artifact`);
        if (entry.kind === "packaged-executable" || entry.kind === "installer") inspectPe(artifact.buffer, entry.kind);
        if ((entry.kind === "desktop-shortcut" || entry.kind === "start-menu-shortcut") && (path.extname(artifact.path).toLowerCase() !== ".lnk" || artifact.buffer.length < 16)) throw new Error(`${entry.kind} is not a materialized .lnk file.`);
      }
      const reportFile = readJsonBoundFile(manifestPath, entry.evidencePath, entry.evidenceSha256, `${entry.kind} evidence`);
      errors.push(...validateWindowsSurfaceReport(reportFile.json, entry, evidence, screenshotById));
    } catch (error) {
      add("WINDOWS_MATERIALIZED_PROOF_RED", pointer, error.message);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      ...admission.summary,
      screenshotPixelsRecomputed: decodedScreenshots.size,
      captureReceiptsVerified: evidence.screenshots.length - errors.filter((entry) => entry.code === "SCREENSHOT_CAPTURE_RECEIPT_RED").length,
      avatarCropsBoundToScreenshots: evidence.avatarProbes.length - errors.filter((entry) => entry.code === "AVATAR_SCREENSHOT_PROOF_RED").length,
      designThresholdCeilings: {
        maxDifferentPixelRatio: MAX_DIFFERENT_PIXEL_RATIO,
        maxMeanAbsoluteDelta: MAX_MEAN_ABSOLUTE_DELTA,
        maxPixelDeltaThreshold: MAX_PIXEL_DELTA_THRESHOLD,
      },
    },
  };
}

function usage() {
  return [
    "Usage: node skills/yance-windows-visual-closure/proof.js --evidence <evidence.json> [--json]",
    "",
    "Verifies capture/review/runtime receipt custody, recomputes PNG design diffs, binds every",
    "avatar crop to the real Electron screenshot, checks complete/natural dimensions/computed",
    "visibility/rect, and verifies Composer plus materialized Windows PE, installer, shortcuts,",
    "Apps & Features, Tray, and BrowserWindow evidence. Missing evidence fails closed.",
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
  const manifestPath = path.resolve(args.evidencePath);
  let evidence;
  try {
    evidence = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const result = { ok: false, errors: [{ code: "EVIDENCE_READ_FAILED", path: "$", message: error.message }] };
    process.stderr.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `WINDOWS_VISUAL_CLOSURE_RED\nEVIDENCE_READ_FAILED: ${error.message}\n`);
    return 1;
  }
  const result = validateProof(evidence, manifestPath);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.ok) {
    process.stdout.write(`WINDOWS_VISUAL_CLOSURE_GREEN\n${JSON.stringify(result.summary)}\n`);
  } else {
    process.stderr.write(`WINDOWS_VISUAL_CLOSURE_RED\n${result.errors.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join("\n")}\n`);
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = runCli();

module.exports = {
  MAX_DIFFERENT_PIXEL_RATIO,
  MAX_MEAN_ABSOLUTE_DELTA,
  MAX_PIXEL_DELTA_THRESHOLD,
  crc32,
  decodePng,
  compareImages,
  validateProof,
  runCli,
};
