# Melbourne Property Price Map

Static IDS201 dashboard for Victorian median house prices by suburb.

## Run locally

```powershell
npm install
npm run data:fetch
npm run build
```

The dashboard source lives in `public/`. The build output is copied to `dist/` for GitHub Pages.

## Data pipeline

The fetch script uses the Data Vic CKAN API, sorts active XLS resources by `period_end` descending, and tries the newest resource first. If a workbook cannot be downloaded or parsed, it logs the problem and falls back to the next most recent active XLS resource.

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

Full mode keeps extra fields for later tinkering:

```powershell
npm run data:fetch:full
```

To attempt every active historical resource instead of stopping at the first usable workbook:

```powershell
node scripts/fetch-property-data.mjs --full --historical
```

## GitHub Pages

`.github/workflows/update-property-data.yml` runs manually and monthly. It installs dependencies, refreshes the class dataset, builds the static dashboard, and deploys the `dist/` folder through GitHub Pages.

If Pages is not already enabled for the repository, set **Settings > Pages > Source** to **GitHub Actions**.
