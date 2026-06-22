import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

const PACKAGE_ID = "victorian-property-sales-report-median-house-by-suburb";
const API_URL = `https://discover.data.vic.gov.au/api/3/action/package_show?id=${PACKAGE_ID}`;
const SOURCE_URL = `https://discover.data.vic.gov.au/dataset/${PACKAGE_ID}`;
const OUT_DIR = path.resolve("public", "data");

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
  for (const offset of [-1, 0, 1]) {
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
    .at(-1);

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
  const response = await fetch(url, {
    headers: { "user-agent": "IDS201 static data pipeline/1.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

async function downloadWorkbook(resource) {
  const response = await fetch(resource.url, {
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

async function parseResource(resource) {
  const workbook = await downloadWorkbook(resource);
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

  return bestSheet;
}

function toCsv(rows) {
  const headers = ["suburb", "median_price", "annual_change_pct"];
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

async function writeOutputs({ dataset, resources, selectedResource, parseResult, metadata, fullRows, failures = [] }) {
  await fs.mkdir(OUT_DIR, { recursive: true });

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
    detected_columns: parseResult.columns
  };

  await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.class.json"), `${JSON.stringify(classRows, null, 2)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "property-median-house-suburb.class.csv"), `${toCsv(classRows)}\n`);
  await fs.writeFile(path.join(OUT_DIR, "metadata.json"), `${JSON.stringify(metadataOut, null, 2)}\n`);

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

  for (const resource of resourcesToParse) {
    try {
      console.log(`Downloading and parsing: ${resource.name} (${resource.period_end})`);
      const parseResult = await parseResource(resource);
      console.log(`Parsed ${parseResult.parsedRowCount} sheet rows; ${parseResult.rows.length} rows survived cleaning.`);
      successful.push({ resource, parseResult });
      if (!includeHistorical) break;
    } catch (error) {
      console.warn(`Could not use ${resource.name} (${resource.period_end}): ${error.message}`);
      failures.push({ resource_name: resource.name, period_end: resource.period_end, error: error.message });
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
    failures
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
