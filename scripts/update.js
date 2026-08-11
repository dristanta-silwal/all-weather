// Daily update, run by .github/workflows/update-data.yml.
// For each configured city: fetches the last few days (buffer in case a run
// was missed), appends any new complete days, trims to a 5-year rolling
// window. Weather data is validated and treated as required — a bad/missing
// value fails the whole run (surfaced via a GitHub issue by the workflow).
// AQI is best-effort/secondary: a failure there is logged and skipped rather
// than failing the run, since its availability is inherently less reliable.

const fs = require('fs');
const path = require('path');
const cities = require('./cities.config');
const { fetchJsonWithRetry, formatDate, aggregateHourlyMaxByDate, validateWeatherRecord } = require('./openmeteo');

const WEATHER_DAILY_PARAMS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'precipitation_sum',
  'relative_humidity_2m_mean',
  'uv_index_max',
].join(',');

const PAST_DAYS = 3; // buffer so a missed scheduled run still catches up
const RETENTION_YEARS = 5;
const DATA_DIR = path.join(__dirname, '..', 'data', 'cities');

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function trimToRetention(records) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  const cutoffStr = formatDate(cutoff);
  return records.filter((r) => r.date >= cutoffStr);
}

function writeSorted(filePath, records) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(filePath, JSON.stringify(trimToRetention(sorted), null, 2) + '\n');
}

async function updateCity(city) {
  const weatherPath = path.join(DATA_DIR, `${city.id}.json`);
  const aqiPath = path.join(DATA_DIR, `${city.id}-aqi.json`);

  const weatherRecords = loadJson(weatherPath);
  const aqiRecords = loadJson(aqiPath);
  const existingWeatherDates = new Set(weatherRecords.map((r) => r.date));
  const existingAqiDates = new Set(aqiRecords.map((r) => r.date));
  const today = formatDate(new Date());

  console.log(`[${city.id}] fetching recent weather (past_days=${PAST_DAYS})`);
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}` +
    `&past_days=${PAST_DAYS}&forecast_days=1&daily=${WEATHER_DAILY_PARAMS}` +
    `&timezone=${encodeURIComponent(city.timezone)}`;
  const weatherData = await fetchJsonWithRetry(weatherUrl);

  let weatherChanged = false;
  for (let i = 0; i < weatherData.daily.time.length; i++) {
    const date = weatherData.daily.time[i];
    if (date >= today) continue; // only complete past days
    if (existingWeatherDates.has(date)) continue;

    const record = {
      date,
      high_c: weatherData.daily.temperature_2m_max[i],
      low_c: weatherData.daily.temperature_2m_min[i],
      wind_speed_max_kmh: weatherData.daily.wind_speed_10m_max[i],
      wind_gusts_max_kmh: weatherData.daily.wind_gusts_10m_max[i],
      precipitation_mm: weatherData.daily.precipitation_sum[i],
      humidity_mean_pct: weatherData.daily.relative_humidity_2m_mean[i],
      uv_index_max: weatherData.daily.uv_index_max[i],
    };

    const errors = validateWeatherRecord(record);
    if (errors.length > 0) {
      // Treated the same as a fetch failure: fail the run so it's retried
      // (next scheduled run, or manually) rather than commit bad data.
      throw new Error(`[${city.id}] invalid weather record for ${date}: ${errors.join('; ')}`);
    }

    weatherRecords.push(record);
    existingWeatherDates.add(date);
    weatherChanged = true;
    console.log(`[${city.id}] + weather record for ${date}`);
  }

  console.log(`[${city.id}] fetching recent air quality (past_days=${PAST_DAYS})`);
  let aqiChanged = false;
  try {
    const aqiUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.latitude}&longitude=${city.longitude}` +
      `&past_days=${PAST_DAYS}&forecast_days=1&hourly=pm10&timezone=${encodeURIComponent(city.timezone)}`;
    const aqiData = await fetchJsonWithRetry(aqiUrl);
    const dailyMax = aggregateHourlyMaxByDate(aqiData.hourly.time, aqiData.hourly.pm10);
    for (const [date, pm10] of Object.entries(dailyMax)) {
      if (date >= today) continue;
      if (existingAqiDates.has(date)) continue;
      if (typeof pm10 !== 'number' || pm10 < 0 || pm10 > 1000) continue;
      aqiRecords.push({ date, pm10 });
      existingAqiDates.add(date);
      aqiChanged = true;
      console.log(`[${city.id}] + AQI record for ${date}`);
    }
  } catch (err) {
    console.warn(`[${city.id}] AQI fetch failed, skipping AQI for this run: ${err.message}`);
  }

  if (weatherChanged) writeSorted(weatherPath, weatherRecords);
  if (aqiChanged) writeSorted(aqiPath, aqiRecords);

  return weatherChanged || aqiChanged;
}

async function main() {
  let anyChanged = false;
  for (const city of cities) {
    const changed = await updateCity(city);
    anyChanged = anyChanged || changed;
  }
  console.log(anyChanged ? 'Data updated.' : 'No new data (already up to date).');
}

main().catch((err) => {
  console.error('Update failed:', err.message);
  process.exit(1);
});
