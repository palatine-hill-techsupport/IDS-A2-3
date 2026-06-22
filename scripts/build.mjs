import fs from "node:fs/promises";
import path from "node:path";

const publicDir = path.resolve("public");
const distDir = path.resolve("dist");
const leafletDir = path.resolve("node_modules", "leaflet", "dist");

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(publicDir))) {
  throw new Error("Cannot build because the public directory does not exist.");
}

if (!(await exists(path.join(publicDir, "data", "property-median-house-suburb.class.json")))) {
  throw new Error("Class data is missing. Run npm run data:fetch before npm run build.");
}

if (!(await exists(path.join(publicDir, "data", "suburb-centroids.json")))) {
  throw new Error("Suburb centroids are missing. Run npm run data:centroids before npm run build.");
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.cp(publicDir, distDir, { recursive: true });

if (await exists(leafletDir)) {
  await fs.cp(leafletDir, path.join(distDir, "vendor", "leaflet"), { recursive: true });
} else {
  throw new Error("Leaflet assets are missing. Run npm install before npm run build.");
}

console.log(`Built static site in ${path.relative(process.cwd(), distDir)}.`);
