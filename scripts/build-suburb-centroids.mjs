import fs from "node:fs/promises";
import path from "node:path";

const POSTCODE_PAGE_URL = "https://www.matthewproctor.com/australian_postcodes";
const CLASS_DATA_PATH = path.resolve("public", "data", "property-median-house-suburb.class.json");
const OUT_PATH = path.resolve("public", "data", "suburb-centroids.json");

function normaliseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index]?.trim() ?? ""]))
  );
}

async function findCsvUrl() {
  const response = await fetch(POSTCODE_PAGE_URL);
  if (!response.ok) throw new Error(`Could not load postcode page: HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/href="([^"]+australian_postcodes\.csv[^"]*)"/i);
  if (!match) throw new Error("Could not find the Australian postcodes CSV link.");
  return new URL(match[1], POSTCODE_PAGE_URL).href;
}

function pickCoordinate(row) {
  const lat = Number(row["Lat_precise"] || row["lat"]);
  const lon = Number(row["Long_precise"] || row["long"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null;
  return { lat, lon };
}

async function main() {
  const suburbs = JSON.parse(await fs.readFile(CLASS_DATA_PATH, "utf8"));
  const wanted = new Map();
  for (const row of suburbs) {
    const keys = [
      normaliseName(row.suburb),
      normaliseName(row.suburb.replace(/\s*\([^)]*\)/g, ""))
    ].filter(Boolean);

    for (const key of keys) {
      if (!wanted.has(key)) wanted.set(key, row.suburb);
    }
  }
  const csvUrl = await findCsvUrl();

  console.log(`Fetching suburb centroid source: ${csvUrl}`);
  const csvResponse = await fetch(csvUrl);
  if (!csvResponse.ok) throw new Error(`Could not download postcode CSV: HTTP ${csvResponse.status}`);

  const records = parseCsv(await csvResponse.text());
  const candidates = new Map();

  for (const row of records) {
    if (row.state !== "VIC") continue;
    const key = normaliseName(row.locality);
    if (!wanted.has(key)) continue;
    const coordinate = pickCoordinate(row);
    if (!coordinate) continue;

    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push({
      suburb: wanted.get(key),
      lat: coordinate.lat,
      lon: coordinate.lon
    });
  }

  const centroids = [...candidates.entries()]
    .map(([key, matches]) => ({
      suburb: wanted.get(key),
      lat: Number((matches.reduce((sum, row) => sum + row.lat, 0) / matches.length).toFixed(6)),
      lon: Number((matches.reduce((sum, row) => sum + row.lon, 0) / matches.length).toFixed(6))
    }))
    .sort((a, b) => a.suburb.localeCompare(b.suburb));

  const matchedSuburbs = new Set(centroids.map((row) => row.suburb));
  const missing = suburbs
    .filter((row) => !matchedSuburbs.has(row.suburb))
    .map((row) => row.suburb)
    .sort((a, b) => a.localeCompare(b));

  await fs.writeFile(
    OUT_PATH,
    `${JSON.stringify(
      {
        source: "Matthew Proctor Australian Postcodes database",
        source_url: POSTCODE_PAGE_URL,
        generated_at: new Date().toISOString(),
        matched_suburb_count: centroids.length,
        missing_suburb_count: missing.length,
        missing_suburbs: missing,
        centroids
      },
      null,
      2
    )}\n`
  );

  console.log(`Matched ${centroids.length} suburb centroids; ${missing.length} suburbs missing coordinates.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
