# Task 01 — Real-world asset fetch pipeline

Branch: `codex/01-fetch-assets`

## Goal

Create `scripts/fetch-assets.mjs` (Node ≥ 20, no new npm deps unless unavoidable —
prefer built-in `fetch` + `node:fs`; if image stitching needs a lib, use `sharp`
as a devDependency) that downloads and prepares every real-world asset the
photorealism milestones need, plus `assets.manifest.json` and `ATTRIBUTION.md`.

## Outputs (all under `public/assets/`, which is gitignored)

```
public/assets/
  globe/
    earth-day-8k.jpg          # NASA Blue Marble Next Generation (world.topo.bathy), Aug, 8192x4096
    earth-night-8k.jpg        # NASA Black Marble / Earth at Night, 8192x4096 (or largest available)
    earth-clouds-4k.jpg       # NASA cloud combined map (or equivalent public-domain cloud map)
  dem/
    trans-ili-alatau.png      # stitched terrarium tiles → single PNG, see bboxes below
    big-almaty-lake.png
    charyn-canyon.png
    <name>.json               # per-DEM metadata: bbox (lon/lat), zoom, pixel size, meters/px
  satellite/
    trans-ili-alatau.jpg      # EOX Sentinel-2 cloudless mosaic for same bbox, ≥2048px wide
    big-almaty-lake.jpg
    charyn-canyon.jpg
  hdri/
    sunrise-mountain-4k.hdr   # PolyHaven CC0 — pick: golden-hour mountain sky
    morning-alpine-4k.hdr     # crisp clear morning sky
    afternoon-desert-4k.hdr   # hot late-afternoon sky
  pbr/
    <set>/{albedo,normal,roughness}.jpg   # sets: cliff-rock, scree, alpine-grass, snow, red-sandstone, dry-soil
```

## Location bounding boxes (WGS84 lon/lat)

- `trans-ili-alatau`: 76.90–77.60 E, 43.00–43.25 N (zoom 12)
- `big-almaty-lake`: 76.93–77.03 E, 43.02–43.10 N (zoom 13)
- `charyn-canyon`: 78.95–79.15 E, 43.30–43.42 N (zoom 13)

## Sources

- DEM: AWS Terrain Tiles (terrarium PNG): `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (public, no key)
- Satellite: EOX Sentinel-2 cloudless WMTS/tiles (CC-BY 4.0 — needs attribution): `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg`
- Globe: NASA Visible Earth / NASA imagery servers (public domain). Choose stable direct URLs; document them in the manifest.
- HDRI + PBR: PolyHaven direct CDN (`https://dl.polyhaven.org/...`), CC0. Choose assets matching the descriptions; record exact slugs.

## Requirements

1. **Idempotent**: skip files that exist with matching SHA-256 (stored in `assets.manifest.json`).
2. **`--verify` flag**: checks all files exist + checksums match, exits non-zero on mismatch. No downloads in this mode.
3. **Tile stitching**: mercator tile math → fetch tile grid for bbox → stitch to one image → for DEMs keep terrarium RGB encoding untouched (decoding happens client-side). Crop to exact bbox. Write the `<name>.json` metadata sidecar.
4. **Politeness**: ≤4 concurrent requests, retry ×3 with backoff, clear progress logging.
5. **Manifest**: `assets.manifest.json` at repo root — every file: path, source URL(s), sha256, byte size, license, attribution string.
6. **`ATTRIBUTION.md`** at repo root: human-readable credits (EOX CC-BY line mandatory; NASA and PolyHaven credited as courtesy).
7. Add `"assets": "node scripts/fetch-assets.mjs"` to package.json scripts.
8. `.gitignore` gains `public/assets/`.

## Acceptance criteria

- `node scripts/fetch-assets.mjs` on a clean checkout populates everything and prints a summary table (file, size, license).
- Second run downloads nothing (all cached-valid).
- `node scripts/fetch-assets.mjs --verify` exits 0; after truncating any one file, exits non-zero naming it.
- `npm run build` still passes; no runtime code touched.
- DEM sidecar JSONs contain plausible meters/px and match bbox math (spot-check: Trans-Ili bbox spans ~57km E–W).
