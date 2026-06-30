const dataUrl = new URL("./data/property-median-house-suburb.class.json", import.meta.url);
const metadataUrl = new URL("./data/metadata.json", import.meta.url);
const centroidsUrl = new URL("./data/suburb-centroids.json", import.meta.url);
const quartersUrl = new URL("./data/property-median-house-suburb.quarters.json", import.meta.url);

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
  datasetMode: document.querySelector("#dataset-mode"),
  quarterControl: document.querySelector("#quarter-control"),
  quarterSelect: document.querySelector("#quarter-select"),
  yearControl: document.querySelector("#year-control"),
  yearSelect: document.querySelector("#year-select"),
  dataWarning: document.querySelector("#data-warning"),
  fullscreenMap: document.querySelector("#fullscreen-map"),
  changeModeButtons: document.querySelectorAll("[data-change-mode]"),
  mapModeButtons: document.querySelectorAll("[data-map-mode]"),
  sortButtons: document.querySelectorAll("[data-sort]")
};

const MELBOURNE_VIEW = {
  center: [-37.86, 145.02],
  zoom: 9
};

const MAP_LABELS = [
  { name: "Melbourne", lat: -37.8136, lon: 144.9631 },
  { name: "Geelong", lat: -38.1499, lon: 144.3617 },
  { name: "Ballarat", lat: -37.5622, lon: 143.8503 },
  { name: "Bendigo", lat: -36.757, lon: 144.2794 },
  { name: "Mornington Peninsula", lat: -38.315, lon: 145.02 }
];
const BASEMAP_BOUNDS = [
  [-39.35, 140.75],
  [-33.75, 150.25]
];
const MAP_COLOURS = {
  low: "#2f6fbd",
  high: "#d84f3f"
};

let mapState = null;
const appState = {
  allQuarters: [],
  availableQuarters: [],
  currentRows: [],
  currentLabel: "",
  currentMode: "quarter",
  currentMapMode: "price",
  sortField: "suburb",
  sortDirection: "asc"
};

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
  updateSortButtons();
}

function sortedRows(rows) {
  const direction = appState.sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (appState.sortField === "suburb") {
      return a.suburb.localeCompare(b.suburb) * direction;
    }
    return (a[appState.sortField] - b[appState.sortField]) * direction;
  });
}

function filteredRows() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const rows = query
    ? appState.currentRows.filter((row) => row.suburb.toLowerCase().includes(query))
    : appState.currentRows;
  return sortedRows(rows);
}

function updateSortButtons() {
  elements.sortButtons.forEach((button) => {
    const active = button.dataset.sort === appState.sortField;
    button.classList.toggle("active", active);
    button.classList.toggle("sort-asc", active && appState.sortDirection === "asc");
    button.classList.toggle("sort-desc", active && appState.sortDirection === "desc");
    button.dataset.direction = active ? appState.sortDirection : "";
    button.setAttribute(
      "aria-sort",
      active ? (appState.sortDirection === "asc" ? "ascending" : "descending") : "none"
    );
  });
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
  return interpolateHex(MAP_COLOURS.low, MAP_COLOURS.high, ratio);
}

function changeColour(value, min, max) {
  const ratio = clamp((value - min) / (max - min || 1));
  return interpolateHex(MAP_COLOURS.low, MAP_COLOURS.high, ratio);
}

function popupHtml(row) {
  return `
    <strong class="popup-title">${escapeHtml(row.suburb)}</strong>
    <span class="popup-row"><span>Median price</span><strong>${formatPrice(row.median_price)}</strong></span>
    <span class="popup-row"><span>Annual change</span><strong class="${changeClass(row.annual_change_pct)}">${formatChange(row.annual_change_pct)}</strong></span>
  `;
}

function mapMarkerStyle(row, mode, priceExtent, changeExtent) {
  const ratio =
    mode === "price"
      ? clamp((row.median_price - priceExtent.min) / (priceExtent.max - priceExtent.min || 1))
      : clamp(Math.abs(row.annual_change_pct) / Math.max(Math.abs(changeExtent.min), Math.abs(changeExtent.max), 1));
  const colour =
    mode === "price"
      ? priceColour(row.median_price, priceExtent.min, priceExtent.max)
      : changeColour(row.annual_change_pct, changeExtent.min, changeExtent.max);

  return {
    radius: 6 + ratio * 9,
    color: "#ffffff",
    weight: 1,
    fillColor: colour,
    fillOpacity: 0.52 + ratio * 0.34
  };
}

function mapLegendHtml(lowLabel, highLabel) {
  return `
    <div class="legend-scale">
      <span>${escapeHtml(lowLabel)}</span>
      <span
        class="legend-gradient"
        style="background: linear-gradient(90deg, ${MAP_COLOURS.low}, ${MAP_COLOURS.high})"
        aria-hidden="true"
      ></span>
      <span>${escapeHtml(highLabel)}</span>
    </div>
  `;
}

function renderMapMarkers(mode = "price") {
  if (!mapState) return;

  const { markers, priceExtent, changeExtent } = mapState;
  for (const { marker, row } of markers) {
    const style = mapMarkerStyle(row, mode, priceExtent, changeExtent);
    marker.setStyle(style);
    marker.setRadius(style.radius);
  }
  elements.map.dataset.markerCount = String(markers.length);
  elements.map.dataset.currentMode = mode;

  elements.mapLegend.innerHTML =
    mode === "price"
      ? mapLegendHtml("Lower median price", "Higher median price")
      : mapLegendHtml("Lower annual change", "Higher annual change");

  setActiveButton(elements.mapModeButtons, mode, "mapMode");
}

function mapRows(rows, centroidData) {
  const centroidBySuburb = new Map(
    centroidData.centroids.map((row) => [normaliseName(row.suburb), row])
  );
  return rows
    .map((row) => ({ ...row, ...centroidBySuburb.get(normaliseName(row.suburb)) }))
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));
}

function updateMapData(rows, centroidData) {
  if (!mapState) return;
  const { L, markerLayer, markerRenderer } = mapState;
  const mappedRows = mapRows(rows, centroidData);
  elements.mapCount.textContent = `${mappedRows.length} of ${rows.length} suburbs plotted. The map opens on Greater Melbourne; pan or zoom out for regional suburbs.`;
  markerLayer.clearLayers();
  const prices = mappedRows.map((row) => row.median_price);
  const changes = mappedRows.map((row) => row.annual_change_pct);
  mapState.mappedRows = mappedRows;
  mapState.priceExtent = { min: Math.min(...prices), max: Math.max(...prices) };
  mapState.changeExtent = { min: Math.min(...changes), max: Math.max(...changes) };
  mapState.markers = mappedRows.map((row) => {
    const style = mapMarkerStyle(row, appState.currentMapMode, mapState.priceExtent, mapState.changeExtent);
    const marker = L.circleMarker([row.lat, row.lon], {
      ...style,
      bubblingMouseEvents: false,
      interactive: true,
      pane: "suburbMarkerPane",
      renderer: markerRenderer
    })
      .bindTooltip(popupHtml(row), {
        className: "map-tooltip",
        direction: "top",
        opacity: 0.96,
        sticky: true
      })
      .bindPopup(popupHtml(row))
      .addTo(markerLayer);

    return { marker, row };
  });
  renderMapMarkers(appState.currentMapMode);
}

function initialiseMap(rows, centroidData) {
  const L = window.L;
  if (!L) {
    elements.map.textContent = "Map library could not load.";
    return;
  }

  const map = L.map(elements.map, {
    markerZoomAnimation: false,
    maxZoom: 12,
    minZoom: 7,
    scrollWheelZoom: false,
    tap: false,
    preferCanvas: false
  }).setView(MELBOURNE_VIEW.center, MELBOURNE_VIEW.zoom);
  map.createPane("labelPane");
  map.createPane("localBasemapPane");
  map.createPane("suburbMarkerPane");
  const localBasemapPane = map.getPane("localBasemapPane");
  localBasemapPane.style.zIndex = 150;
  map.getPane("localBasemapPane").style.pointerEvents = "none";
  map.getPane("labelPane").style.zIndex = 350;
  map.getPane("labelPane").style.pointerEvents = "none";
  map.getPane("suburbMarkerPane").style.zIndex = 500;
  map.getPane("suburbMarkerPane").style.pointerEvents = "auto";

  L.imageOverlay("assets/victoria-basemap.svg", BASEMAP_BOUNDS, {
    pane: "localBasemapPane",
    opacity: 0.24,
    interactive: false
  }).addTo(map);

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 12,
    minZoom: 7,
    attribution: "Tiles &copy; Esri, OpenStreetMap contributors"
  }).addTo(map);

  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 12,
    minZoom: 7,
    pane: "labelPane",
    attribution: "Labels &copy; Esri"
  }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);
  const labelLayer = L.layerGroup().addTo(map);
  // SVG markers stay visible above the tile panes and are still light enough for this static dataset.
  const markerRenderer = L.svg({ pane: "suburbMarkerPane", padding: 0.35 });

  mapState = {
    L,
    map,
    markerLayer,
    markerRenderer,
    labelLayer,
    mappedRows: [],
    markers: [],
    priceExtent: { min: 0, max: 1 },
    changeExtent: { min: -1, max: 1 }
  };

  MAP_LABELS.forEach((label) => {
    L.marker([label.lat, label.lon], {
      icon: L.divIcon({
        className: "map-place-label",
        html: escapeHtml(label.name),
        iconSize: [150, 24],
        iconAnchor: [75, 12]
      }),
      interactive: false,
      keyboard: false,
      pane: "labelPane"
    }).addTo(labelLayer);
  });

  updateMapData(rows, centroidData);
  const bounds = L.latLngBounds(mapRows(rows, centroidData).map((row) => [row.lat, row.lon]));
  if (bounds.isValid()) map.setMaxBounds(bounds.pad(0.35));

  const refreshMapSize = () => map.invalidateSize({ pan: false });
  requestAnimationFrame(refreshMapSize);
  setTimeout(refreshMapSize, 150);
  setTimeout(refreshMapSize, 600);
  window.addEventListener("load", refreshMapSize, { once: true });

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(refreshMapSize);
    resizeObserver.observe(elements.map);
    mapState.resizeObserver = resizeObserver;
  }
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

function yearFromQuarter(quarter) {
  return quarter.period_end ? new Date(`${quarter.period_end}T00:00:00`).getFullYear() : null;
}

function populateDataControls(quarterManifest) {
  appState.allQuarters = quarterManifest.quarters ?? [];
  appState.availableQuarters = appState.allQuarters.filter((quarter) => quarter.available && quarter.rows?.length);

  elements.quarterSelect.innerHTML = appState.allQuarters
    .map((quarter) => {
      const suffix = quarter.available ? "" : " (unavailable)";
      return `<option value="${escapeHtml(quarter.period_end)}" ${quarter.available ? "" : "disabled"}>${escapeHtml(quarter.resource_name + suffix)}</option>`;
    })
    .join("");

  const years = [...new Set(appState.availableQuarters.map(yearFromQuarter).filter(Boolean))]
    .sort((a, b) => b - a);
  elements.yearSelect.innerHTML = years
    .map((year) => `<option value="${year}">${year}</option>`)
    .join("");

  const defaultQuarter = appState.availableQuarters.find((quarter) => quarter.period_end === quarterManifest.default_period_end) ?? appState.availableQuarters[0];
  if (defaultQuarter) elements.quarterSelect.value = defaultQuarter.period_end;
}

function aggregateYearRows(year) {
  const quarters = appState.availableQuarters.filter((quarter) => yearFromQuarter(quarter) === Number(year));
  const bySuburb = new Map();

  for (const quarter of quarters) {
    for (const row of quarter.rows) {
      if (!bySuburb.has(row.suburb)) bySuburb.set(row.suburb, []);
      bySuburb.get(row.suburb).push(row);
    }
  }

  return [...bySuburb.entries()]
    .map(([suburb, rows]) => ({
      suburb,
      median_price: Math.round(rows.reduce((sum, row) => sum + row.median_price, 0) / rows.length),
      annual_change_pct: Number((rows.reduce((sum, row) => sum + row.annual_change_pct, 0) / rows.length).toFixed(1))
    }))
    .sort((a, b) => a.suburb.localeCompare(b.suburb));
}

function selectedDataset() {
  if (elements.datasetMode.value === "year") {
    const year = Number(elements.yearSelect.value);
    return {
      rows: aggregateYearRows(year),
      label: `${year} year summary`,
      warning: `Averaging ${appState.availableQuarters.filter((quarter) => yearFromQuarter(quarter) === year).length} available quarter(s) for ${year}.`
    };
  }

  const quarter = appState.availableQuarters.find((item) => item.period_end === elements.quarterSelect.value) ?? appState.availableQuarters[0];
  const publishedLatest = appState.allQuarters[0];
  const warning = publishedLatest && publishedLatest.period_end !== quarter?.period_end
    ? `${publishedLatest.resource_name} is published by Data Vic but its XLS download is blocked for static fetching, so this view uses ${quarter.resource_name}.`
    : "";
  return {
    rows: quarter?.rows ?? [],
    label: quarter?.resource_name ?? "No available quarter",
    warning
  };
}

function updateDashboardDataset(centroidData) {
  const dataset = selectedDataset();
  const rows = sanitiseRows(dataset.rows);
  appState.currentRows = rows;
  appState.currentLabel = dataset.label;
  appState.currentMode = elements.datasetMode.value;
  elements.dataWarning.textContent = dataset.warning;
  elements.quarterControl.hidden = appState.currentMode !== "quarter";
  elements.yearControl.hidden = appState.currentMode !== "year";

  renderSummary(rows);
  renderPriceChart(rows);
  renderChangeChart(rows, "growth");
  renderDistribution(rows);
  renderTable(filteredRows());
  renderSelectedPeriodLabel();
  if (mapState) updateMapData(rows, centroidData);
}

function renderSelectedPeriodLabel() {
  elements.resourceName.textContent = appState.currentLabel;
  if (appState.currentMode === "quarter") {
    const quarter = appState.availableQuarters.find((item) => item.period_end === elements.quarterSelect.value);
    elements.dataPeriod.textContent = quarter?.period_end
      ? new Date(`${quarter.period_end}T00:00:00`).toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric"
        })
      : "Unknown";
  } else {
    elements.dataPeriod.textContent = elements.yearSelect.value;
  }
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
  const [rawRows, metadata, centroidData, quarterManifest] = await Promise.all([
    fetchJson(dataUrl),
    fetchJson(metadataUrl),
    fetchJson(centroidsUrl),
    fetchJson(quartersUrl)
  ]);
  const rows = sanitiseRows(rawRows);

  renderMetadata(metadata);
  populateDataControls(quarterManifest);
  appState.currentRows = rows;
  initialiseMap(rows, centroidData);
  updateDashboardDataset(centroidData);

  elements.searchInput.addEventListener("input", () => {
    renderTable(filteredRows());
  });

  elements.sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.sort;
      if (appState.sortField === field) {
        appState.sortDirection = appState.sortDirection === "asc" ? "desc" : "asc";
      } else {
        appState.sortField = field;
        appState.sortDirection = field === "suburb" ? "asc" : "desc";
      }
      renderTable(filteredRows());
    });
  });

  elements.datasetMode.addEventListener("change", () => {
    updateDashboardDataset(centroidData);
  });

  elements.quarterSelect.addEventListener("change", () => {
    updateDashboardDataset(centroidData);
  });

  elements.yearSelect.addEventListener("change", () => {
    updateDashboardDataset(centroidData);
  });

  elements.changeModeButtons.forEach((button) => {
    button.addEventListener("click", () => renderChangeChart(appState.currentRows, button.dataset.changeMode));
  });

  elements.mapModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      appState.currentMapMode = button.dataset.mapMode;
      renderMapMarkers(appState.currentMapMode);
    });
  });

  elements.fullscreenMap.addEventListener("click", async () => {
    const shell = elements.map.closest(".map-shell");
    try {
      if (!document.fullscreenElement && shell?.requestFullscreen) {
        await shell.requestFullscreen();
        elements.fullscreenMap.textContent = "Exit fullscreen";
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        elements.fullscreenMap.textContent = "Fullscreen";
      }
    } catch (error) {
      console.warn("Fullscreen is not available in this browser context.", error);
    }
    setTimeout(() => mapState?.map.invalidateSize({ pan: false }), 120);
  });

  document.addEventListener("fullscreenchange", () => {
    elements.fullscreenMap.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    setTimeout(() => mapState?.map.invalidateSize({ pan: false }), 120);
  });
}

loadDashboard().catch((error) => {
  console.error(error);
  elements.tableCount.textContent = "Could not load the static dashboard data.";
  elements.mapCount.textContent = "Could not load map data.";
});
