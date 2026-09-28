'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function successResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

test('Berlin weather projects current Open-Meteo payload and WMO label', async () => {
  const { createBerlinWeatherService } = require('../services/berlinWeatherService');
  let calls = 0;
  const service = createBerlinWeatherService({
    clock: () => Date.parse('2026-09-27T13:40:00.000Z'),
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /latitude=52\.52/u);
      assert.match(String(url), /longitude=13\.405/u);
      assert.match(String(url), /timezone=Europe%2FBerlin/u);
      return successResponse({ current: { time: '2026-09-27T15:40', temperature_2m: 23.4, weather_code: 1, is_day: 1 } });
    },
  });
  const weather = await service.getCurrent();
  assert.equal(calls, 1);
  assert.equal(weather.available, true);
  assert.equal(weather.city, 'Berlin');
  assert.equal(weather.timeZone, 'Europe/Berlin');
  assert.equal(weather.temperatureC, 23.4);
  assert.equal(weather.conditionLabelZh, '晴间多云');
  assert.equal(weather.isDay, true);
  assert.equal(weather.source, 'open-meteo');
});
test('Berlin weather reuses only a fresh ten-minute cache', async () => {
  const { createBerlinWeatherService } = require('../services/berlinWeatherService');
  let now = Date.parse('2026-09-27T13:40:00.000Z');
  let calls = 0;
  const service = createBerlinWeatherService({
    clock: () => now,
    fetchImpl: async () => {
      calls += 1;
      return successResponse({ current: { time: '2026-09-27T15:40', temperature_2m: 20 + calls, weather_code: 0, is_day: 1 } });
    },
  });
  assert.equal((await service.getCurrent()).temperatureC, 21);
  now += 9 * 60 * 1000;
  assert.equal((await service.getCurrent()).temperatureC, 21);
  assert.equal(calls, 1);
  now += 2 * 60 * 1000;
  assert.equal((await service.getCurrent()).temperatureC, 22);
  assert.equal(calls, 2);
});

test('expired cache plus network failure returns unavailable without stale temperature', async () => {
  const { createBerlinWeatherService } = require('../services/berlinWeatherService');
  let now = Date.parse('2026-09-27T13:40:00.000Z');
  let fail = false;
  const service = createBerlinWeatherService({
    clock: () => now,
    fetchImpl: async () => {
      if (fail) throw new Error('offline');
      return successResponse({ current: { time: '2026-09-27T15:40', temperature_2m: 18, weather_code: 61, is_day: 1 } });
    },
  });
  assert.equal((await service.getCurrent()).available, true);
  now += 11 * 60 * 1000;
  fail = true;
  const weather = await service.getCurrent();
  assert.equal(weather.available, false);
  assert.equal(weather.stale, true);
  assert.equal(weather.temperatureC, null);
  assert.equal(weather.conditionLabelZh, '');
});

test('malformed or non-ok responses are unavailable', async () => {
  const { createBerlinWeatherService } = require('../services/berlinWeatherService');
  const malformed = createBerlinWeatherService({
    fetchImpl: async () => successResponse({ current: { temperature_2m: 'nope' } }),
  });
  assert.equal((await malformed.getCurrent()).available, false);

  const rejected = createBerlinWeatherService({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal((await rejected.getCurrent()).available, false);
});
