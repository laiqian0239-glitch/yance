'use strict';

const BERLIN = Object.freeze({
  city: 'Berlin',
  timeZone: 'Europe/Berlin',
  latitude: 52.52,
  longitude: 13.405,
});
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function conditionLabelZhForCode(value) {
  const code = Number(value);
  if (code === 0) return '晴';
  if ([1, 2].includes(code)) return '晴间多云';
  if (code === 3) return '多云';
  if ([45, 48].includes(code)) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95 && code <= 99) return '雷暴';
  return '天气';
}

function unavailableProjection(nowMs, stale = false) {
  return Object.freeze({
    available: false,
    city: BERLIN.city,
    timeZone: BERLIN.timeZone,
    observedAt: '',
    fetchedAt: new Date(nowMs).toISOString(),
    stale,
    temperatureC: null,
    weatherCode: null,
    conditionLabelZh: '',
    isDay: null,
    source: 'open-meteo',
  });
}

function createBerlinWeatherService(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const clock = typeof options.clock === 'function' ? options.clock : () => Date.now();
  const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  let cache = null;

  async function getCurrent() {
    const nowMs = Number(clock());
    const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (cache && safeNowMs - cache.fetchedAtMs < ttlMs) return cache.projection;
    if (typeof fetchImpl !== 'function') return unavailableProjection(safeNowMs, Boolean(cache));

    try {
      const query = new URLSearchParams({
        latitude: String(BERLIN.latitude),
        longitude: String(BERLIN.longitude),
        current: 'temperature_2m,weather_code,is_day',
        timezone: BERLIN.timeZone,
        temperature_unit: 'celsius',
      });
      const response = await fetchImpl(`https://api.open-meteo.com/v1/forecast?${query.toString()}`);
      if (!response?.ok) throw new Error(`OPEN_METEO_HTTP_${Number(response?.status || 0)}`);
      const payload = await response.json();
      const current = payload && typeof payload.current === 'object' ? payload.current : null;
      const temperatureC = Number(current?.temperature_2m);
      const weatherCode = Number(current?.weather_code);
      const isDayValue = Number(current?.is_day);
      if (!current || !Number.isFinite(temperatureC) || !Number.isFinite(weatherCode) || ![0, 1].includes(isDayValue)) {
        throw new Error('OPEN_METEO_CURRENT_INVALID');
      }
      const projection = Object.freeze({
        available: true,
        city: BERLIN.city,
        timeZone: BERLIN.timeZone,
        observedAt: String(current.time || ''),
        fetchedAt: new Date(safeNowMs).toISOString(),
        stale: false,
        temperatureC,
        weatherCode,
        conditionLabelZh: conditionLabelZhForCode(weatherCode),
        isDay: isDayValue === 1,
        source: 'open-meteo',
      });
      cache = { fetchedAtMs: safeNowMs, projection };
      return projection;
    } catch (_) {
      return unavailableProjection(safeNowMs, Boolean(cache));
    }
  }

  return Object.freeze({ getCurrent });
}

const singleton = createBerlinWeatherService();
module.exports = {
  BERLIN,
  DEFAULT_TTL_MS,
  conditionLabelZhForCode,
  createBerlinWeatherService,
  getCurrent: (input) => singleton.getCurrent(input),
};
