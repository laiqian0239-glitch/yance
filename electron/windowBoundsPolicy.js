'use strict';

const DEFAULT_WIDTH = 1186;
const DEFAULT_HEIGHT = 758;
const MIN_WIDTH = 980;
const MIN_HEIGHT = 680;

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveInitialWindowBounds(settings = {}, workArea = {}) {
  const areaX = finiteNumber(workArea.x) ?? 0;
  const areaY = finiteNumber(workArea.y) ?? 0;
  const areaWidth = Math.max(1, finiteNumber(workArea.width) ?? DEFAULT_WIDTH);
  const areaHeight = Math.max(1, finiteNumber(workArea.height) ?? DEFAULT_HEIGHT);
  const persistedX = finiteNumber(settings.windowX);
  const persistedY = finiteNumber(settings.windowY);
  const hasPersistedPosition = persistedX !== null && persistedY !== null;

  let width;
  let height;
  if (hasPersistedPosition) {
    width = clamp(finiteNumber(settings.windowWidth) ?? DEFAULT_WIDTH, Math.min(MIN_WIDTH, areaWidth), areaWidth);
    height = clamp(finiteNumber(settings.windowHeight) ?? DEFAULT_HEIGHT, Math.min(MIN_HEIGHT, areaHeight), areaHeight);
  } else {
    const widthCap = Math.floor(areaWidth * 0.72);
    const heightCap = Math.floor(areaHeight * 0.82);
    width = Math.min(DEFAULT_WIDTH, widthCap);
    height = Math.min(DEFAULT_HEIGHT, heightCap);
    if (areaWidth >= MIN_WIDTH) width = Math.max(MIN_WIDTH, width);
    if (areaHeight >= MIN_HEIGHT) height = Math.max(MIN_HEIGHT, height);
    width = Math.min(width, areaWidth);
    height = Math.min(height, areaHeight);
  }

  const maxX = areaX + Math.max(0, areaWidth - width);
  const maxY = areaY + Math.max(0, areaHeight - height);
  const x = hasPersistedPosition
    ? clamp(persistedX, areaX, maxX)
    : areaX + Math.round((areaWidth - width) / 2);
  const y = hasPersistedPosition
    ? clamp(persistedY, areaY, maxY)
    : areaY + Math.round((areaHeight - height) / 2);

  return {
    x,
    y,
    width,
    height,
    maximized: settings.windowMaximized === true,
  };
}

function captureNormalWindowBounds(windowLike) {
  if (!windowLike || windowLike.isMinimized() || windowLike.isMaximized()) return null;
  const bounds = windowLike.getBounds();
  return {
    windowX: Math.trunc(bounds.x),
    windowY: Math.trunc(bounds.y),
    windowWidth: Math.max(MIN_WIDTH, Math.trunc(bounds.width)),
    windowHeight: Math.max(MIN_HEIGHT, Math.trunc(bounds.height)),
    windowMaximized: false,
  };
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  resolveInitialWindowBounds,
  captureNormalWindowBounds,
};
