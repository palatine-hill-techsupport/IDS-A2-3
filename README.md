# Melbourne Property Price Map

Static IDS201 dashboard for Victorian median house prices by suburb. The public dashboard keeps the class dataset to three row variables while using separate metadata and centroid files for attribution and mapping.

## Run locally

```powershell
npm install
npm run data:fetch:quarters
npm run data:centroids
npm run build
```

The dashboard source lives in `public/`. The build output is copied to `dist/` for GitHub Pages.

The page includes:

- summary cards and ranked suburb lists
- map-first layout centred on Greater Melbourne
- top 10 median price bar chart
- annual growth/decline chart with a toggle
- median price band distribution chart
- Leaflet suburb map with price/change toggle, zoom controls, fullscreen, and a local fallback basemap
- searchable, sortable suburb table
- single-quarter and year-summary selectors built from static data files

The map uses Leaflet canvas markers rather than SVG markers so the 700+ plotted suburb points remain reasonably responsive on GitHub Pages. Basemap tiles are requested from Esri's light grey tile service when available; a small local fallback basemap remains visible if the tile server or browser blocks external tiles.

## Data pipeline

The fetch script uses the Data Vic CKAN API, sorts active XLS resources by `period_end` descending, and tries the newest resource first. If a workbook cannot be downloaded or parsed, it logs the problem and falls back to the next most recent active XLS resource.

Data Vic currently publishes December 2025 Quarter as the newest resource, but its Land Victoria XLS download can return HTTP 403 to automated static builds. The generated metadata preserves that published-latest resource separately, while the dashboard defaults to the newest workbook that the static pipeline can actually download and parse.

If you manually download a blocked workbook, put it in the project root or `assets/source/` using the Data Vic filename, for example `median-house-q4-2025.xls`. Raw workbook files are ignored by git, and the fetch script will use the local workbook before trying the web URL.

Assignment mode is the default:

```powershell
npm run data:fetch
```

This writes exactly three row variables to:

- `public/data/property-median-house-suburb.class.json`
- `public/data/property-median-house-suburb.class.csv`

Those variables are:

- `suburb`
- `median_price`
- `annual_change_pct`

Metadata is kept separately in `public/data/metadata.json`.

The map uses a separate static centroid lookup at `public/data/suburb-centroids.json`, generated from Matthew Proctor's Australian Postcodes database:

```powershell
npm run data:centroids
```

This lookup is map support data, not part of the three-variable class dataset. Some suburb names may not have exact centroid matches, so the map notes how many suburbs are plotted.

To attempt every active historical resource instead of stopping at the first usable workbook:

```powershell
npm run data:fetch:quarters
```

That writes `public/data/property-median-house-suburb.quarters.json` plus per-quarter class files in `public/data/quarters/`. Unavailable quarters are still listed in the manifest so the dashboard can explain why they are disabled.

Full mode keeps extra fields for later tinkering:

```powershell
npm run data:fetch:full
```

## GitHub Pages

`.github/workflows/update-property-data.yml` runs manually and monthly. It installs dependencies, refreshes the class dataset, builds the static dashboard, and deploys the `dist/` folder through GitHub Pages.

If Pages is not already enabled for the repository, set **Settings > Pages > Source** to **GitHub Actions**.

## Credits

- Property data: Victorian Government Data Vic
- Map centroids: Matthew Proctor Australian Postcodes database
- Hero image: Pexels
- Map library: Leaflet
- Map tiles: Esri Light Gray Canvas, with OpenStreetMap contributors credited by the tile layer

The original hero image is kept locally at `assets/source/brand-image.jpg` and ignored because it is large. The deployed dashboard uses the optimised copy at `public/assets/melbourne-hero.jpg`.
