// One-time (per city) historical backfill.
// Usage: node scripts/backfill.js <city-id>
//
// Note: Open-Meteo's historical archive API does not compute UV index for
// past dates (it returns null for every date tested) — uv_index_max in the
// weather file will be null for most of the backfilled history and only
// starts filling in from whatever the forecast API's rolling window covers
// (roughly the last ~2-3 months), growing by one day with each daily update.
// PM10/air quality similarly only has real data for the last few years
// (varies by location), not the full 5-year window — the AQI file simply
// starts wherever Open-Meteo's data actually begins.

const fs = require('fs');
const path = require('path');
const cities = require('./cities.config');
const { fetchJsonWithRetry, formatDate, aggregateHourlyMaxByDate } = require('./openmeteo');

const WEATHER_DAILY_PARAMS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'precipitation_sum',
  'relative_humidity_2m_mean',
  'uv_index_max',
].join(',');

const DATA_DIR = path.join(__dirname, '..', 'data', 'cities');

async function backfillCity(city) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // through yesterday (today is incomplete)
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);

  const startStr = formatDate(start);
  const endStr = formatDate(end);

  console.log(`[${city.id}] fetching 5-year weather history (${startStr}..${endStr})`);
  const weatherUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&start_date=${startStr}&end_date=${endStr}&daily=${WEATHER_DAILY_PARAMS}` +
    `&timezone=${encodeURIComponent(city.timezone)}`;
  const weatherData = await fetchJsonWithRetry(weatherUrl);

  const weatherRecords = weatherData.daily.time.map((date, i) => ({
    date,
    high_c: weatherData.daily.temperature_2m_max[i],
    low_c: weatherData.daily.temperature_2m_min[i],
    wind_speed_max_kmh: weatherData.daily.wind_speed_10m_max[i],
    wind_gusts_max_kmh: weatherData.daily.wind_gusts_10m_max[i],
    precipitation_mm: weatherData.daily.precipitation_sum[i],
    humidity_mean_pct: weatherData.daily.relative_humidity_2m_mean[i],
    uv_index_max: weatherData.daily.uv_index_max[i],
  }));

  // The archive API never computes UV index for past dates (confirmed null
  // across every date tested). Seed whatever recent UV history the forecast
  // API's rolling window actually has, same "accept what's available"
  // treatment as the AQI data below, so the UV chart isn't empty at launch.
  console.log(`[${city.id}] fetching recent UV history via forecast API (past_days=92)`);
  const uvUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&past_days=92&forecast_days=0&daily=uv_index_max&timezone=${encodeURIComponent(city.timezone)}`;
  const uvData = await fetchJsonWithRetry(uvUrl);
  const uvByDate = {};
  uvData.daily.time.forEach((date, i) => {
    if (uvData.daily.uv_index_max[i] !== null) uvByDate[date] = uvData.daily.uv_index_max[i];
  });
  let uvSeeded = 0;
  for (const record of weatherRecords) {
    if (record.date in uvByDate) {
      record.uv_index_max = uvByDate[record.date];
      uvSeeded += 1;
    }
  }
  console.log(`[${city.id}] seeded ${uvSeeded} UV records from the forecast API's recent window`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, `${city.id}.json`),
    JSON.stringify(weatherRecords, null, 2) + '\n'
  );
  console.log(`[${city.id}] wrote ${weatherRecords.length} weather records`);

  console.log(`[${city.id}] fetching air quality history (${startStr}..${endStr})`);
  const aqiUrl =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&start_date=${startStr}&end_date=${endStr}&hourly=pm10&timezone=${encodeURIComponent(city.timezone)}`;
  const aqiData = await fetchJsonWithRetry(aqiUrl);
  const dailyMax = aggregateHourlyMaxByDate(aqiData.hourly.time, aqiData.hourly.pm10);
  const aqiRecords = Object.keys(dailyMax)
    .sort()
    .map((date) => ({ date, pm10: dailyMax[date] }));

  fs.writeFileSync(
    path.join(DATA_DIR, `${city.id}-aqi.json`),
    JSON.stringify(aqiRecords, null, 2) + '\n'
  );
  console.log(
    `[${city.id}] wrote ${aqiRecords.length} AQI records` +
      (aqiRecords.length ? ` (${aqiRecords[0].date}..${aqiRecords[aqiRecords.length - 1].date})` : '')
  );
}

async function main() {
  const cityId = process.argv[2];
  if (!cityId) {
    console.error('Usage: node scripts/backfill.js <city-id>');
    console.error(`Configured cities: ${cities.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  const city = cities.find((c) => c.id === cityId);
  if (!city) {
    console.error(`Unknown city id "${cityId}". Configured cities: ${cities.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  await backfillCity(city);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
