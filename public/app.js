const dataUrl = new URL("./data/property-median-house-suburb.class.json", import.meta.url);
const metadataUrl = new URL("./data/metadata.json", import.meta.url);
const centroidsUrl = new URL("./data/suburb-centroids.json", import.meta.url);

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
});

const compactCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  notation: "compact",
  maximumFractionDigits: 1
});

const percent = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0
});

const elements = {
  totalSuburbs: document.querySelector("#total-suburbs"),
  medianPrice: document.querySelector("#median-price"),
  highestPrice: document.querySelector("#highest-price"),
  strongestGrowth: document.querySelector("#strongest-growth"),
  highestList: document.querySelector("#highest-list"),
  lowestList: document.querySelector("#lowest-list"),
  growthList: document.querySelector("#growth-list"),
  declineList: document.querySelector("#decline-list"),
  priceChart: document.querySelector("#price-chart"),
  changeChart: document.querySelector("#change-chart"),
  distributionChart: document.querySelector("#distribution-chart"),
  suburbTable: document.querySelector("#suburb-table"),
  tableCount: document.querySelector("#table-count"),
  searchInput: document.querySelector("#search-input"),
  dataPeriod: document.querySelector("#data-period"),
  resourceName: document.querySelector("#resource-name"),
  map: document.querySelector("#suburb-map"),
  mapCount: document.querySelector("#map-count"),
  mapLegend: document.querySelector("#map-legend"),
  changeModeButtons: document.querySelectorAll("[data-change-mode]"),
  mapModeButtons: document.querySelectorAll("[data-map-mode]")
};

let mapState = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normaliseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(value) {
  return Number.isFinite(value) ? currency.format(value) : "n/a";
}

function formatPriceShort(value) {
  return Number.isFinite(value) ? compactCurrency.format(value).replace("M", "m") : "n/a";
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${percent.format(value)}%`;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function topBy(rows, field, direction = "desc", count = 5) {
  const multiplier = direction === "desc" ? -1 : 1;
  return [...rows]
    .filter((row) => Number.isFinite(row[field]))
    .sort((a, b) => (a[field] - b[field]) * multiplier)
    .slice(0, count);
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function changeClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

function setActiveButton(buttons, activeValue, dataKey) {
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset[dataKey] === activeValue);
  });
}

function renderRankList(target, rows, field, formatter) {
  target.innerHTML = rows
    .map(
      (row) => `
        <li>
          <strong>${escapeHtml(row.suburb)}</strong>
          <span>${escapeHtml(formatter(row[field]))}</span>
        </li>
      `
    )
    .join("");
}

function renderBarRows(target, rows, options) {
  const max = options.max ?? Math.max(...rows.map((row) => Math.abs(options.value(row))));
  const safeMax = max > 0 ? max : 1;

  target.innerHTML = rows
    .map((row) => {
      const value = options.value(row);
      const width = clamp(Math.abs(value) / safeMax) * 100;
      const fillClass = options.fillClass ? options.fillClass(row, value) : "";
      const label = options.label(row);
      const formattedValue = options.format(value, row);

      return `
        <div class="bar-row">
          <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="bar-track" aria-label="${escapeHtml(`${label}: ${formattedValue}`)}">
            <span class="bar-fill ${escapeHtml(fillClass)}" style="width: ${Math.max(3, width)}%"></span>
          </span>
          <span class="bar-value">${escapeHtml(formattedValue)}</span>
        </div>
      `;
    })
    .join("");
}

function renderPriceChart(rows) {
  const topRows = topBy(rows, "median_price", "desc", 10);
  renderBarRows(elements.priceChart, topRows, {
    value: (row) => row.median_price,
    label: (row) => row.suburb,
    format: (value) => formatPriceShort(value),
    max: topRows[0]?.median_price ?? 1
  });
}

function renderChangeChart(rows, mode = "growth") {
  const direction = mode === "growth" ? "desc" : "asc";
  const chartRows = topBy(rows, "annual_change_pct", direction, 10);
  const maxAbs = Math.max(...chartRows.map((row) => Math.abs(row.annual_change_pct)), 1);

  renderBarRows(elements.changeChart, chartRows, {
    value: (row) => row.annual_change_pct,
    label: (row) => row.suburb,
    format: (value) => formatChange(value),
    max: maxAbs,
    fillClass: (_row, value) => (value >= 0 ? "positive-fill" : "negative-fill")
  });

  setActiveButton(elements.changeModeButtons, mode, "changeMode");
}

function priceBands(rows) {
  const bands = [
    { label: "Under $500k", min: 0, max: 500000 },
    { label: "$500k-$750k", min: 500000, max: 750000 },
    { label: "$750k-$1m", min: 750000, max: 1000000 },
    { label: "$1m-$1.25m", min: 1000000, max: 1250000 },
    { label: "$1.25m-$1.5m", min: 1250000, max: 1500000 },
    { label: "$1.5m-$2m", min: 1500000, max: 2000000 },
    { label: "$2m+", min: 2000000, max: Infinity }
  ];

  return bands.map((band) => ({
    ...band,
    count: rows.filter((row) => row.median_price >= band.min && row.median_price < band.max).length
  }));
}

function renderDistribution(rows) {
  const bands = priceBands(rows);
  const maxCount = Math.max(...bands.map((band) => band.count), 1);

  renderBarRows(elements.distributionChart, bands, {
    value: (band) => band.count,
    label: (band) => band.label,
    format: (count) => `${count} suburbs`,
    max: maxCount,
    fillClass: () => "distribution-fill"
  });
}

function renderTable(rows) {
  elements.tableCount.textContent = `${rows.length} suburb${rows.length === 1 ? "" : "s"} shown`;
  elements.suburbTable.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.suburb)}</td>
          <td>${formatPrice(row.median_price)}</td>
          <td class="${changeClass(row.annual_change_pct)}">${formatChange(row.annual_change_pct)}</td>
        </tr>
      `
    )
    .join("");
}

function interpolateHex(start, end, amount) {
  const parse = (hex) => hex.match(/\w\w/g).map((part) => Number.parseInt(part, 16));
  const [r1, g1, b1] = parse(start);
  const [r2, g2, b2] = parse(end);
  const toHex = (number) => Math.round(number).toString(16).padStart(2, "0");
  return `#${toHex(r1 + (r2 - r1) * amount)}${toHex(g1 + (g2 - g1) * amount)}${toHex(b1 + (b2 - b1) * amount)}`;
}

function priceColour(value, min, max) {
  const ratio = clamp((value - min) / (max - min || 1));
  return interpolateHex("9ccdbb", "2e4658", ratio);
}

function changeColour(value, min, max) {
  if (value < 0) {
    return interpolateHex("e7bdc4", "a64a61", clamp(value / (min || -1)));
  }
  return interpolateHex("c8a46a", "34745f", clamp(value / (max || 1)));
}

function popupHtml(row) {
  return `
    <strong class="popup-title">${escapeHtml(row.suburb)}</strong>
    <span class="popup-row"><span>Median price</span><strong>${formatPrice(row.median_price)}</strong></span>
    <span class="popup-row"><span>Annual change</span><strong class="${changeClass(row.annual_change_pct)}">${formatChange(row.annual_change_pct)}</strong></span>
  `;
}

function renderMapMarkers(mode = "price") {
  if (!mapState) return;

  const { L, layer, mappedRows, priceExtent, changeExtent } = mapState;
  layer.clearLayers();

  for (const row of mappedRows) {
    const value = mode === "price" ? row.median_price : row.annual_change_pct;
    const ratio =
      mode === "price"
        ? clamp((row.median_price - priceExtent.min) / (priceExtent.max - priceExtent.min || 1))
        : clamp(Math.abs(row.annual_change_pct) / Math.max(Math.abs(changeExtent.min), Math.abs(changeExtent.max), 1));
    const colour =
      mode === "price"
        ? priceColour(row.median_price, priceExtent.min, priceExtent.max)
        : changeColour(row.annual_change_pct, changeExtent.min, changeExtent.max);

    L.circleMarker([row.lat, row.lon], {
      radius: 5 + ratio * 9,
      color: "#ffffff",
      weight: 1,
      fillColor: colour,
      fillOpacity: 0.78
    })
      .bindPopup(popupHtml(row))
      .addTo(layer);
  }

  elements.mapLegend.innerHTML =
    mode === "price"
      ? `
        <span><span class="legend-swatch" style="background:#9ccdbb"></span>Lower median price</span>
        <span><span class="legend-swatch" style="background:#2e4658"></span>Higher median price</span>
      `
      : `
        <span><span class="legend-swatch" style="background:#a64a61"></span>Decline</span>
        <span><span class="legend-swatch" style="background:#c8a46a"></span>Flat / modest change</span>
        <span><span class="legend-swatch" style="background:#34745f"></span>Growth</span>
      `;

  setActiveButton(elements.mapModeButtons, mode, "mapMode");
}

function initialiseMap(rows, centroidData) {
  const L = window.L;
  if (!L) {
    elements.map.textContent = "Map library could not load.";
    return;
  }

  const centroidBySuburb = new Map(
    centroidData.centroids.map((row) => [normaliseName(row.suburb), row])
  );
  const mappedRows = rows
    .map((row) => ({ ...row, ...centroidBySuburb.get(normaliseName(row.suburb)) }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));

  elements.mapCount.textContent = `${mappedRows.length} of ${rows.length} suburbs plotted with static centroid coordinates.`;

  const map = L.map(elements.map, {
    scrollWheelZoom: false,
    preferCanvas: true
  }).setView([-37.8136, 144.9631], 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const bounds = L.latLngBounds(mappedRows.map((row) => [row.lat, row.lon]));
  const prices = mappedRows.map((row) => row.median_price);
  const changes = mappedRows.map((row) => row.annual_change_pct);

  mapState = {
    L,
    map,
    layer,
    mappedRows,
    priceExtent: { min: Math.min(...prices), max: Math.max(...prices) },
    changeExtent: { min: Math.min(...changes), max: Math.max(...changes) }
  };

  renderMapMarkers("price");
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.08));

  setTimeout(() => map.invalidateSize(), 150);
}

function renderSummary(rows) {
  const highestPrices = topBy(rows, "median_price", "desc", 5);
  const lowestPrices = topBy(rows, "median_price", "asc", 5);
  const growth = topBy(rows, "annual_change_pct", "desc", 5);
  const decline = topBy(rows, "annual_change_pct", "asc", 5);
  const medianMedianPrice = median(rows.map((row) => row.median_price));

  elements.totalSuburbs.textContent = rows.length.toLocaleString("en-AU");
  elements.medianPrice.textContent = formatPrice(medianMedianPrice);
  elements.highestPrice.textContent = `${highestPrices[0]?.suburb ?? "n/a"} ${formatPrice(highestPrices[0]?.median_price)}`;
  elements.strongestGrowth.textContent = `${growth[0]?.suburb ?? "n/a"} ${formatChange(growth[0]?.annual_change_pct)}`;

  renderRankList(elements.highestList, highestPrices, "median_price", formatPrice);
  renderRankList(elements.lowestList, lowestPrices, "median_price", formatPrice);
  renderRankList(elements.growthList, growth, "annual_change_pct", formatChange);
  renderRankList(elements.declineList, decline, "annual_change_pct", formatChange);
}

function renderMetadata(metadata) {
  elements.dataPeriod.textContent = metadata.period_end
    ? new Date(`${metadata.period_end}T00:00:00`).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric"
      })
    : "Unknown";
  elements.resourceName.textContent = metadata.resource_name ?? "Unknown resource";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`);
  return response.json();
}

function sanitiseRows(rows) {
  return rows
    .map((row) => ({
      suburb: String(row.suburb ?? "").trim(),
      median_price: Number(row.median_price),
      annual_change_pct: Number(row.annual_change_pct)
    }))
    .filter((row) => row.suburb && Number.isFinite(row.median_price) && Number.isFinite(row.annual_change_pct));
}

async function loadDashboard() {
  const [rawRows, metadata, centroidData] = await Promise.all([
    fetchJson(dataUrl),
    fetchJson(metadataUrl),
    fetchJson(centroidsUrl)
  ]);
  const rows = sanitiseRows(rawRows);
  const alphabeticRows = [...rows].sort((a, b) => a.suburb.localeCompare(b.suburb));

  renderMetadata(metadata);
  renderSummary(rows);
  renderPriceChart(rows);
  renderChangeChart(rows, "growth");
  renderDistribution(rows);
  renderTable(alphabeticRows);
  initialiseMap(rows, centroidData);

  elements.searchInput.addEventListener("input", () => {
    const query = elements.searchInput.value.trim().toLowerCase();
    const filtered = query ? rows.filter((row) => row.suburb.toLowerCase().includes(query)) : rows;
    renderTable([...filtered].sort((a, b) => a.suburb.localeCompare(b.suburb)));
  });

  elements.changeModeButtons.forEach((button) => {
    button.addEventListener("click", () => renderChangeChart(rows, button.dataset.changeMode));
  });

  elements.mapModeButtons.forEach((button) => {
    button.addEventListener("click", () => renderMapMarkers(button.dataset.mapMode));
  });
}

loadDashboard().catch((error) => {
  console.error(error);
  elements.tableCount.textContent = "Could not load the static dashboard data.";
  elements.mapCount.textContent = "Could not load map data.";
});
