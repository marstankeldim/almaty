# Kazakhstan Interactive Digital Atlas — Agent Guide

A cinematic WebGL experience (Three.js + Vite, plain JavaScript, no TypeScript).
A globe intro dives seamlessly into explorable Kazakhstan locations linked by
in-scene light beacons. The goal of the current milestone series is
**photorealism**: real DEMs, satellite imagery, HDRI lighting, PBR materials.

## Commands

- `npm install` — deps (three, topojson-client, vite)
- `npm run dev` — Vite dev server
- `npm run build` — production build (must stay green)
- `node scripts/fetch-assets.mjs` — download real-world assets into `public/assets/` (gitignored)

## Architecture

| File | Role |
|---|---|
| `src/main.js` | Boot, render loop, EffectComposer chain, lazy scene registry (`ensureScene`), beacon raycasting, adaptive pixel-ratio scaler, `window.__atlas` debug API |
| `src/director.js` | Single camera + master timeline (`T` keypoints), travel choreography (`travelTo`), per-frame `params` consumed by everything |
| `src/terrain.js` | Location factory: `PRESETS` (one recipe per destination — heightfield, palette, lighting, vegetation, water, beacons, camera anchors) → `createTerrainScene(id, assets)`; a preset with a `dem` block renders real geography |
| `src/dem.js` | Fetch + decode a stitched terrarium DEM; repairs SRTM voids/spikes |
| `src/terrain-geometry.js` | Pure heightfield mesher (no three/DOM) — shared by the worker and the inline fallback |
| `src/terrain-worker.js` | Module worker: meshes a heightfield and transfers the buffers back |
| `src/globe.js` | Shader Earth (land/KZ/city-light masks), Kazakhstan awakening effect, orientation quaternions |
| `src/geo.js` | TopoJSON → equirect mask canvas + KZ border ring |
| `src/ui.js` | Title, HUD, constellation atlas SVG, beacon tooltips |
| `src/audio.js` | Fully synthesized WebAudio soundscape (wind/rumble/pad/birds/water) |
| `src/locations.js` | Destination registry + localStorage discovery persistence |

## Debug API (in-browser)

`window.__atlas`:
- `.step(dt?)` — advance one frame manually (works in hidden tabs; used by automated checks)
- `.director` — `.elapsed`, `.activeLoc`, `.traveling`, `.travelTo(id)`, `.skip()`
- `.travelTo(id)` — convenience wrapper
- `.beaconScreen()` — screen-space position of active scene's first beacon
- `.stats` — `{ema, fps, pixelRatio}` rolling real-rAF frame stats

URL params: `?scene=hero` (skip intro), `?fast=N` (timeline speed).

## Conventions

- Plain JS ES modules, no TS annotations.
- Shaders are inline GLSL template strings tagged `/* glsl */`.
- Colors are linear-space values graded for ACES + sRGB output (rendering goes
  through EffectComposer → OutputPass; do NOT bypass the composer).
- New location = new entry in `PRESETS` (`src/terrain.js`) + id in
  `IMPLEMENTED` (`src/main.js`) + registry entry (`src/locations.js`).
- Deterministic where possible: CPU noise is seeded; asset scripts must be
  idempotent and checksum-verified.
- Comments state constraints, not narration.

## Do NOT touch

- `src/director.js` timeline keypoints/grammar (`T`, `J`) and easing feel
- Discovery persistence format (`kz-atlas-discovered` in localStorage)
- UI copy and typography in `index.html`
- The `window.__atlas` debug API surface (extend, never break)

## Verification expectations for agent tasks

Codex cloud cannot take screenshots. Every task must be verifiable by:
- `npm run build` passing,
- console logs / numeric probes (e.g. `[atlas] built <id> in <ms>ms`),
- small Node test scripts colocated under `scripts/` or `docs/tasks/fixtures/`,
- documented manual-check notes for the human reviewer.

Branch naming: `codex/<task-number>-<slug>`. One task spec (`docs/tasks/NN-*.md`)
per branch. Do not bundle unrelated changes.

## Asset policy — fetch at build

`public/assets/**` is **gitignored** (150–400MB). Committed instead:
`assets.manifest.json` (urls, checksums, licenses) and `ATTRIBUTION.md`.
Only public-domain / CC0 / CC-BY sources (NASA, AWS Terrain Tiles, EOX
Sentinel-2 cloudless, PolyHaven). CC-BY requires an ATTRIBUTION.md entry.

Assets are **fetched at build time, never committed**. Any deploy runs:

```
npm ci
node scripts/fetch-assets.mjs          # populates public/assets/
node scripts/fetch-assets.mjs --verify # checksums against the manifest
npm run build
```

`scripts/fetch-assets.mjs` is idempotent (skips files whose sha256 matches the
manifest), so repeat runs and warm CI caches cost nothing. Coverage per
location lives in one place — the `DEM_LOCATIONS` table at the top of `run()`
(bbox + zoom; zoom is chosen per feature scale, e.g. z12 for a whole range,
z14 for a lake or gorge).

**A missing asset is never fatal.** `loadDemGrid`, the satellite/HDRI loaders,
and the globe textures all fall back (procedural terrain, hemisphere-only
light, procedural globe) and warn once. A fresh clone runs without assets.

## Performance notes

- Heightfield meshing runs in a **worker** (`terrain-worker.js`); scenes still
  build synchronously and mesh inline if a payload isn't ready. Inline meshing
  costs ~1.5s per location, so keep the worker path healthy.
- Normals come from a **smoothed** copy of the height field. The mesh is
  sampled coarser than the DEM's pixels, and differentiating the raw bilinear
  field flips normals into black streaks and terraces the shading.
- Adaptive quality ladder (`applyQualityLevel` in main.js), shed in order:
  AO → shadow resolution → device pixel ratio → MSAA. Drive it from
  `window.__atlas.setQuality(0..4)` when testing.
- **Avoid reserved GLSL identifiers in injected chunks** (`flat`, `sample`,
  `input`, `output`, `filter`, …). GLSL ES 3.0 rejects them and the failure is
  a silent non-compiling material.
- **Every material patched via `onBeforeCompile` needs a
  `customProgramCacheKey`.** three's default key is
  `onBeforeCompile.toString()` — the function's *source text*. Our per-location
  closures are byte-identical (the template expressions are unevaluated in the
  source), so all three DEM terrains silently shared one compiled program and
  per-preset GLSL never ran. Key on the location id.
- **Do not toggle MSAA at runtime.** Changing it means disposing the composer's
  render targets mid-session; the reallocated pair stops being cleared and
  earlier scenes bleed through as composited garbage. The quality ladder ends
  at a DPR step instead.
- Detail/ripple frequencies must be checked against the **pixel footprint** at
  the vantage that renders them. The nearest visible ground is 442m (lake),
  1282m (canyon), 3235m (range) — a few metres per pixel. Anything finer than
  that aliases (water) or averages to nothing (texture detail).
