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
| `src/terrain.js` | Location factory: `PRESETS` (one recipe per destination — heightfield, palette, lighting, vegetation, water, beacons, camera anchors) → `createTerrainScene(id)` |
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

## Asset policy

`public/assets/**` is **gitignored** (150–400MB). Committed instead:
`assets.manifest.json` (urls, checksums, licenses) and `ATTRIBUTION.md`.
Only public-domain / CC0 / CC-BY sources (NASA, AWS Terrain Tiles, EOX
Sentinel-2 cloudless, PolyHaven). CC-BY requires an ATTRIBUTION.md entry.
