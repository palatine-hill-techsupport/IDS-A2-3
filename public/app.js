const dataUrl = "data/property-median-house-suburb.class.json";
const metadataUrl = "data/metadata.json";

const currency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0
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
  suburbTable: document.querySelector("#suburb-table"),
  tableCount: document.querySelector("#table-count"),
  searchInput: document.querySelector("#search-input"),
  dataPeriod: document.querySelector("#data-period"),
  resourceName: document.querySelector("#resource-name")
};

function formatPrice(value) {
  return currency.format(value);
}

function formatChange(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
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
  return rows
    .filter((row) => Number.isFinite(row[field]))
    .sort((a, b) => (a[field] - b[field]) * multiplier)
    .slice(0, count);
}

function renderRankList(target, rows, field, formatter) {
  target.innerHTML = rows
    .map(
      (row) => `
        <li>
          <strong>${row.suburb}</strong>
          <span>${formatter(row[field])}</span>
        </li>
      `
    )
    .join("");
}

function renderChart(rows) {
  const maxPrice = Math.max(...rows.map((row) => row.median_price));
  elements.priceChart.innerHTML = rows
    .map((row) => {
      const width = Math.max(4, (row.median_price / maxPrice) * 100);
      return `
        <div class="bar-row">
          <span class="bar-label" title="${row.suburb}">${row.suburb}</span>
          <span class="bar-track" aria-hidden="true">
            <span class="bar-fill" style="width: ${width}%"></span>
          </span>
          <span class="bar-value">${formatPrice(row.median_price)}</span>
        </div>
      `;
    })
    .join("");
}

function changeClass(value) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "";
}

function renderTable(rows) {
  elements.tableCount.textContent = `${rows.length} suburb${rows.length === 1 ? "" : "s"} shown`;
  elements.suburbTable.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.suburb}</td>
          <td>${formatPrice(row.median_price)}</td>
          <td class="${changeClass(row.annual_change_pct)}">${formatChange(row.annual_change_pct)}</td>
        </tr>
      `
    )
    .join("");
}

function renderDashboard(rows) {
  const highestPrices = topBy(rows, "median_price", "desc", 5);
  const lowestPrices = topBy(rows, "median_price", "asc", 5);
  const growth = topBy(rows, "annual_change_pct", "desc", 5);
  const decline = topBy(rows, "annual_change_pct", "asc", 5);
  const topChartRows = topBy(rows, "median_price", "desc", 10);
  const medianMedianPrice = median(rows.map((row) => row.median_price));

  elements.totalSuburbs.textContent = rows.length.toLocaleString("en-AU");
  elements.medianPrice.textContent = formatPrice(medianMedianPrice);
  elements.highestPrice.textContent = `${highestPrices[0].suburb} ${formatPrice(highestPrices[0].median_price)}`;
  elements.strongestGrowth.textContent = `${growth[0].suburb} ${formatChange(growth[0].annual_change_pct)}`;

  renderRankList(elements.highestList, highestPrices, "median_price", formatPrice);
  renderRankList(elements.lowestList, lowestPrices, "median_price", formatPrice);
  renderRankList(elements.growthList, growth, "annual_change_pct", formatChange);
  renderRankList(elements.declineList, decline, "annual_change_pct", formatChange);
  renderChart(topChartRows);
  renderTable([...rows].sort((a, b) => a.suburb.localeCompare(b.suburb)));
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

async function loadDashboard() {
  const [rows, metadata] = await Promise.all([
    fetch(dataUrl).then((response) => response.json()),
    fetch(metadataUrl).then((response) => response.json())
  ]);

  renderMetadata(metadata);
  renderDashboard(rows);

  elements.searchInput.addEventListener("input", () => {
    const query = elements.searchInput.value.trim().toLowerCase();
    const filtered = query ? rows.filter((row) => row.suburb.toLowerCase().includes(query)) : rows;
    renderTable([...filtered].sort((a, b) => a.suburb.localeCompare(b.suburb)));
  });
}

loadDashboard().catch((error) => {
  console.error(error);
  elements.tableCount.textContent = "Could not load the class dataset.";
});
