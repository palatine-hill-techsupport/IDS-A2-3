import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

const PACKAGE_ID = "victorian-property-sales-report-median-house-by-suburb";
const API_URL = `https://discover.data.vic.gov.au/api/3/action/package_show?id=${PACKAGE_ID}`;
const SOURCE_URL = `https://discover.data.vic.gov.au/dataset/${PACKAGE_ID}`;
const OUT_DIR = path.resolve("public", "data");
const QUARTERS_DIR = path.join(OUT_DIR, "quarters");
const LOCAL_WORKBOOK_DIRS = [process.cwd(), path.resolve("assets", "source")];

const args = new Set(process.argv.slice(2));
// CLASS_MODE is the assignment-safe default: row data is limited to exactly
// suburb, median_price, and annual_change_pct. Use --full or CLASS_MODE=false
// later when you want the richer dataset as god intended.
const classMode = !args.has("--full") && process.env.CLASS_MODE !== "false";
const includeHistorical = args.has("--historical") || process.env.DOWNLOAD_HISTORICAL === "true";

function normaliseHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[%$]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyHeader(value, fallback) {
  const slug = normaliseHeader(value).replace(/\s+/g, "_");
  return slug || fallback;
}

function toTitleCase(value) {
  return String(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value)
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .replace(/\(([^)]+)\)/g, "-$1")
    .trim();

  if (!text || text === "-" || text.toLowerCase() === "na") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function isActiveXlsResource(resource) {
  const format = String(resource.format ?? "").toUpperCase();
  const url = String(resource.url ?? "").toLowerCase();
  return resource.state === "active" && (format.includes("XLS") || url.endsWith(".xls") || url.endsWith(".xlsx"));
}

function sortByPeriodEndDesc(resources) {
  return [...resources].sort((a, b) => String(b.period_end ?? "").localeCompare(String(a.period_end ?? "")));
}

function rowText(row) {
  return row.map((cell) => String(cell ?? "")).join(" ");
}

function combinedHeader(rows, rowIndex, colIndex) {
  const parts = [];
  for (const offset of [-1, 0, 1, 2, 3]) {
    const value = rows[rowIndex + offset]?.[colIndex];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      parts.push(String(value).trim());
    }
  }
  return parts.join(" ");
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const normalised = normaliseHeader(rowText(rows[i]));
    if (/\b(suburb|locality)\b/.test(normalised)) {
      return i;
    }
  }
  return -1;
}

function countYearMentions(text) {
  return (String(text).match(/\b20\d{2}\b/g) ?? []).length;
}

function hasSameQuarterDifferentYears(text) {
  const normalised = normaliseHeader(text);
  const years = [...normalised.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length < 2 || Math.abs(years.at(-1) - years[0]) !== 1) return false;

  const monthGroups = [
    ["jan", "mar"],
    ["apr", "jun"],
    ["jul", "sep"],
    ["oct", "dec"]
  ];
  return monthGroups.some((group) => group.every((month) => normalised.includes(month)));
}

function findColumnMap(rows, headerRowIndex) {
  const headerRow = rows[headerRowIndex] ?? [];
  const headerTexts = headerRow.map((_, colIndex) => combinedHeader(rows, headerRowIndex, colIndex));
  const normalisedHeaders = headerTexts.map(normaliseHeader);

  const suburbColumn = normalisedHeaders.findIndex((header) => /\b(suburb|locality)\b/.test(header));
  if (suburbColumn === -1) {
    throw new Error("Could not find a suburb/locality column.");
  }

  const salesColumns = normalisedHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /\b(no|number)\b.*\bsales\b|\bsales\b/.test(header))
    .map(({ index }) => index);

  const changeColumns = normalisedHeaders
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => /\b(change|annual|yearly|12 month|12 months)\b/.test(header))
    .map(({ index }) => index);

  const firstNonPriceColumn = Math.min(...[...salesColumns, ...changeColumns].filter((index) => index > suburbColumn), headerRow.length);
  const medianPriceColumn = headerRow
    .map((_, index) => index)
    .filter((index) => index > suburbColumn && index < firstNonPriceColumn)
    .map((index) => ({
      index,
      numericCount: rows
        .slice(headerRowIndex + 1, headerRowIndex + 80)
        .filter((row) => parseNumber(row[index]) !== null).length
    }))
    .filter(({ numericCount }) => numericCount > 0)
    .sort((a, b) => b.index - a.index || b.numericCount - a.numericCount)[0]?.index;

  if (medianPriceColumn === undefined) {
    throw new Error("Could not find a likely median price column.");
  }

  const annualChangeColumn =
    changeColumns.find((index) => /\b(annual|yearly|12 month|12 months|12month)\b/.test(normalisedHeaders[index])) ??
    changeColumns.find((index) => hasSameQuarterDifferentYears(headerTexts[index])) ??
    changeColumns
      .map((index) => ({ index, years: countYearMentions(headerTexts[index]) }))
      .sort((a, b) => b.years - a.years)[0]?.index;

  if (annualChangeColumn === undefined) {
    throw new Error("Could not find a likely annual change percentage column.");
  }

  const quarterlyChangeColumn = changeColumns.find((index) => index !== annualChangeColumn) ?? null;
  const quarterlySalesColumn = salesColumns[0] ?? null;
  const ytdSalesColumn = salesColumns[1] ?? null;

  return {
    suburbColumn,
    medianPriceColumn,
    annualChangeColumn,
    quarterlyChangeColumn,
    quarterlySalesColumn,
    ytdSalesColumn,
    headerTexts
  };
}

function isSummarySuburb(value) {
  const normalised = normaliseHeader(value);
  if (!normalised) return true;
  if (/^(total|grand total|all suburbs)$/.test(normalised)) return true;
  if (/\b(metropolitan|country victoria|regional victoria|victoria total|subtotal)\b/.test(normalised)) return true;
  return false;
}

function cleanRowsFromSheet(rows, resource, sheetName) {
  const headerRowIndex = findHeaderRow(rows);
  if (headerRowIndex === -1) {
    throw new Error(`No suburb header found in sheet "${sheetName}".`);
  }

  const columns = findColumnMap(rows, headerRowIndex);
  const cleaned = [];

  for (const row of rows.slice(headerRowIndex + 1)) {
    const rawSuburb = row[columns.suburbColumn];
    const suburb = toTitleCase(String(rawSuburb ?? "").trim());
    const medianPrice = parseNumber(row[columns.medianPriceColumn]);
    const annualChangePct = parseNumber(row[columns.annualChangeColumn]);

    if (isSummarySuburb(suburb) || medianPrice === null) continue;

    const fullRow = {
      suburb,
      median_price: Math.round(medianPrice),
      annual_change_pct: annualChangePct,
      latest_period_label: columns.headerTexts[columns.medianPriceColumn] ?? null,
      annual_change_label: columns.headerTexts[columns.annualChangeColumn] ?? null,
      period_start: resource.period_start ?? null,
      period_end: resource.period_end ?? null,
      resource_name: resource.name ?? null
    };

    if (columns.quarterlyChangeColumn !== null) {
      fullRow.quarterly_change_pct = parseNumber(row[columns.quarterlyChangeColumn]);
      fullRow.quarterly_change_label = columns.headerTexts[columns.quarterlyChangeColumn] ?? null;
    }

    if (columns.quarterlySalesColumn !== null) {
      fullRow.quarterly_sales = parseNumber(row[columns.quarterlySalesColumn]);
    }

    if (columns.ytdSalesColumn !== null) {
      fullRow.ytd_sales = parseNumber(row[columns.ytdSalesColumn]);
    }

    columns.headerTexts.forEach((header, index) => {
      if (index === columns.suburbColumn || row[index] === undefined || row[index] === "") return;
      const key = slugifyHeader(header, `column_${index + 1}`);
      if (!(key in fullRow)) fullRow[key] = parseNumber(row[index]) ?? row[index];
    });

    cleaned.push(fullRow);
  }

  return {
    rows: cleaned,
    headerRowIndex,
    columns: {
      suburb: columns.headerTexts[columns.suburbColumn],
      median_price: columns.headerTexts[columns.medianPriceColumn],
      annual_change_pct: columns.headerTexts[columns.annualChangeColumn]
    }
  };
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { "user-agent": "IDS201 static data pipeline/1.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadWorkbook(resource) {
  const localAttempts = await localWorkbookPaths(resource);
  const attempts = [resource.url, ...(await archivedWorkbookUrls(resource.url))];
  const errors = [];

  for (const localPath of localAttempts) {
    try {
      console.log(`Using local workbook override: ${path.relative(process.cwd(), localPath)}`);
      const workbook = await readWorkbookFromFile(localPath);
      return { workbook, resolvedUrl: `local:${path.relative(process.cwd(), localPath)}` };
    } catch (error) {
      errors.push(`${localPath}: ${error.message}`);
    }
  }

  for (const url of attempts) {
    try {
      const workbook = await downloadWorkbookFromUrl(url);
      return { workbook, resolvedUrl: url };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function localWorkbookPaths(resource) {
  const names = new Set();
  const urlFileName = fileNameFromUrl(resource.url);
  if (urlFileName) names.add(urlFileName);

  const year = String(resource.period_end ?? "").slice(0, 4);
  const quarter = quarterNumberFromPeriodEnd(resource.period_end);
  if (year && quarter) {
    names.add(`median-house-q${quarter}-${year}.xls`);
    names.add(`median-house-q${quarter}-${year}.xlsx`);
  }

  const resourceSlug = normaliseHeader(resource.name ?? "").replace(/\s+/g, "-");
  if (resourceSlug) {
    names.add(`${resourceSlug}.xls`);
    names.add(`${resourceSlug}.xlsx`);
  }

  const candidates = [];
  for (const dir of LOCAL_WORKBOOK_DIRS) {
    for (const name of names) candidates.push(path.resolve(dir, name));
  }

  const found = [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      found.push(candidate);
    } catch {
      // Local workbook overrides are optional.
    }
  }
  return found;
}

function fileNameFromUrl(url) {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    return null;
  }
}

function quarterNumberFromPeriodEnd(periodEnd) {
  const month = Number(String(periodEnd ?? "").slice(5, 7));
  if (!month) return null;
  return Math.ceil(month / 3);
}

async function archivedWorkbookUrls(url) {
  try {
    const cdxUrl = `https://web.archive.org/cdx?url=${encodeURIComponent(url)}&output=json&filter=statuscode:200&filter=mimetype:application/vnd.ms-excel&collapse=digest`;
    const response = await fetchWithTimeout(cdxUrl, {
      headers: { "user-agent": "IDS201 static data pipeline/1.0" }
    });
    if (!response.ok) return [];

    const captures = await response.json();
    const rows = captures.slice(1);
    return rows
      .map((row) => ({
        timestamp: row[1],
        original: row[2]
      }))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 2)
      .map(({ timestamp, original }) => `https://web.archive.org/web/${timestamp}id_/${original}`);
  } catch {
    return [];
  }
}

async function downloadWorkbookFromUrl(url) {
  const response = await fetchWithTimeout(url, {
    headers: { "user-agent": "IDS201 static data pipeline/1.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (/text\/html/i.test(contentType) && buffer.toString("utf8", 0, 200).includes("<html")) {
    throw new Error(`Resource returned HTML instead of an XLS workbook (${contentType}).`);
  }

  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

async function readWorkbookFromFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

async function parseResource(resource) {
  const { workbook, resolvedUrl } = await downloadWorkbook(resource);
  const sheetResults = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      blankrows: false
    });
    return {
      sheetName,
      parsedRowCount: rows.length,
      ...cleanRowsFromSheet(rows, resource, sheetName)
    };
  });

  const bestSheet = sheetResults.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!bestSheet || bestSheet.rows.length === 0) {
    throw new Error("Workbook parsed, but no usable suburb rows survived cleaning.");
  }

  return {
    ...bestSheet,
    resolvedUrl
  };
}

function toCsv(rows) {
  const headers = ["suburb", "median_price", "annual_change_pct"];
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function writeOutputs({ dataset, resources, selectedResource, parseResult, metadata, fullRows, quarters, failures = [] }) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(QUARTERS_DIR, { recursive: true });

  const classRows = dataset.map(({ suburb, median_price, annual_change_pct }) => ({
    suburb,
    median_price,
    annual_change_pct
  }));

  const metadataOut = {
    source_title: metadata.title,
    source_url: SOURCE_URL,
    ckan_api_url: API_URL,
    resource_name: selectedResource.name,
    resource_url: selectedResource.url,
    resolved_resource_url: parseResult.resolvedUrl,
    period_start: selectedResource.period_start ?? null,
    period_end: selectedResource.period_end ?? null,
    fetched_at: new Date().toISOString(),
    class_mode: classMode,
    include_historical: includeHistorical,
    active_xls_resource_count: resources.length,
    selected_resource_was_latest: resources[0]?.id === selectedResource.id,
    fallback_failures: failures,
    parsed_sheet: parseResult.sheetName,
    parsed_row_count: parseResult.parsedRowCount,
    cleaned_row_count: dataset.length,
    detected_columns: parseResult.columns,
    published_latest_resource: resources[0]
      ? {
          resource_name: resources[0].name,
          period_start: resources[0].period_start ?? null,
          period_end: resources[0].period_end ?? null,
          resource_url: resources[0].url
        }
      : null
  };

  await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.class.json"), `${JSON.stringify(classRows, null, 2)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.class.csv"), `${toCsv(classRows)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "metadata.json"), `${JSON.stringify(metadataOut, null, 2)}\n`);

  const quartersOut = {
    source_title: metadata.title,
    source_url: SOURCE_URL,
    ckan_api_url: API_URL,
    fetched_at: metadataOut.fetched_at,
    published_latest_resource: metadataOut.published_latest_resource,
    default_period_end: selectedResource.period_end ?? null,
    quarters
  };

  await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.quarters.json"), `${JSON.stringify(quartersOut, null, 2)}\n`);

  for (const quarter of quarters.filter((quarter) => quarter.available)) {
    const quarterRows = quarter.rows.map(({ suburb, median_price, annual_change_pct }) => ({
      suburb,
      median_price,
      annual_change_pct
    }));
    await fs.writeFile(path.join(QUARTERS_DIR, `${quarter.period_end}.class.json`), `${JSON.stringify(quarterRows, null, 2)}\n`);
  }

  if (!classMode || fullRows.length > 0) {
    await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.full.json"), `${JSON.stringify(fullRows, null, 2)}\n`);
  }

  console.log(`Wrote ${classRows.length} class rows to ${path.relative(process.cwd(), OUT_DIR)}.`);
}

async function main() {
  console.log(`Fetching CKAN metadata: ${API_URL}`);
  const packageResponse = await fetchJson(API_URL);
  const metadata = packageResponse.result;
  const resources = sortByPeriodEndDesc((metadata.resources ?? []).filter(isActiveXlsResource));

  console.log(`Found ${resources.length} active XLS resources.`);
  resources.forEach((resource, index) => {
    console.log(`${index + 1}. ${resource.period_end ?? "unknown period"} - ${resource.name}`);
  });

  const resourcesToParse = includeHistorical ? resources : resources.slice();
  const successful = [];
  const failures = [];
  const quarterRecords = [];

  for (const resource of resourcesToParse) {
    try {
      console.log(`Downloading and parsing: ${resource.name} (${resource.period_end})`);
      const parseResult = await parseResource(resource);
      console.log(`Parsed ${parseResult.parsedRowCount} sheet rows; ${parseResult.rows.length} rows survived cleaning.`);
      successful.push({ resource, parseResult });
      quarterRecords.push({
        resource_name: resource.name,
        resource_url: resource.url,
        resolved_resource_url: parseResult.resolvedUrl,
        period_start: resource.period_start ?? null,
        period_end: resource.period_end ?? null,
        available: true,
        row_count: parseResult.rows.length,
        rows: parseResult.rows.map(({ suburb, median_price, annual_change_pct }) => ({
          suburb,
          median_price,
          annual_change_pct
        }))
      });
      if (!includeHistorical) break;
    } catch (error) {
      console.warn(`Could not use ${resource.name} (${resource.period_end}): ${error.message}`);
      failures.push({ resource_name: resource.name, period_end: resource.period_end, error: error.message });
      quarterRecords.push({
        resource_name: resource.name,
        resource_url: resource.url,
        period_start: resource.period_start ?? null,
        period_end: resource.period_end ?? null,
        available: false,
        row_count: 0,
        error: error.message,
        rows: []
      });
    }
  }

  if (successful.length === 0) {
    throw new Error("No active XLS resources could be downloaded, parsed, and cleaned.");
  }

  const selected = successful[0];
  if (failures.length > 0) {
    console.warn(`Fallback selected ${selected.resource.name} (${selected.resource.period_end}) after ${failures.length} newer resource failure(s).`);
  }

  const fullRows = includeHistorical
    ? successful.flatMap(({ parseResult }) => parseResult.rows)
    : selected.parseResult.rows;

  const dataset = classMode ? selected.parseResult.rows : fullRows;
  await writeOutputs({
    dataset,
    fullRows,
    resources,
    selectedResource: selected.resource,
    parseResult: selected.parseResult,
    metadata,
    quarters: quarterRecords,
    failures
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
