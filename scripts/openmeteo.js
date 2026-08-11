function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchJsonWithRetry(url, { attempts = 3, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      }
      const json = await res.json();
      if (json.error) {
        throw new Error(`Open-Meteo error: ${json.reason || JSON.stringify(json)}`);
      }
      return json;
    } catch (err) {
      lastError = err;
      console.warn(`  attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt < attempts) {
        await sleep(baseDelayMs * attempt * attempt);
      }
    }
  }
  throw lastError;
}

// times/values are parallel arrays of hourly ISO timestamps (already in the
// requested local timezone) and numbers-or-null; returns {date: maxValue}
// skipping hours with no reading.
function aggregateHourlyMaxByDate(times, values) {
  const result = {};
  for (let i = 0; i < times.length; i++) {
    const date = times[i].slice(0, 10);
    const value = values[i];
    if (value === null || value === undefined) continue;
    if (!(date in result) || value > result[date]) {
      result[date] = value;
    }
  }
  return result;
}

const WEATHER_RANGES = {
  high_c: [-20, 55],
  low_c: [-20, 55],
  wind_speed_max_kmh: [0, 250],
  wind_gusts_max_kmh: [0, 300],
  precipitation_mm: [0, 300],
  humidity_mean_pct: [0, 100],
  uv_index_max: [0, 16],
};

function isValidNumber(value, [min, max]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

// Returns an array of human-readable problems; empty array means valid.
function validateWeatherRecord(record) {
  const errors = [];
  for (const [field, range] of Object.entries(WEATHER_RANGES)) {
    if (!isValidNumber(record[field], range)) {
      errors.push(`${field}=${JSON.stringify(record[field])} outside expected range [${range[0]}, ${range[1]}]`);
    }
  }
  if (isValidNumber(record.low_c, WEATHER_RANGES.low_c) && isValidNumber(record.high_c, WEATHER_RANGES.high_c) && record.low_c > record.high_c) {
    errors.push(`low_c (${record.low_c}) > high_c (${record.high_c})`);
  }
  return errors;
}

module.exports = {
  sleep,
  formatDate,
  fetchJsonWithRetry,
  aggregateHourlyMaxByDate,
  validateWeatherRecord,
};
