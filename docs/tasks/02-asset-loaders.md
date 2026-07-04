# Task 02 — Client-side asset loaders (`src/assets.js`)

Branch: `codex/02-asset-loaders`
Depends on: Task 01 (file layout + sidecar format), but implement against the
documented layout — do not block on real downloads. Commit small synthetic
fixtures for tests.

## Goal

A `src/assets.js` module the rendering layer will consume:

```js
export async function loadDem(id)        // → { grid: Float32Array, width, height, metersPerPixel, bbox, sample(x01, y01) → meters }
export async function loadHdriEnvironment(renderer, path) // → { envMap /* PMREM RT texture */, backgroundTex }
export function loadColorTexture(path)   // → THREE.Texture, sRGB, mipmapped, anisotropy 8
export function loadDataTexture(path)    // → THREE.Texture, NoColorSpace (normal/roughness maps)
export async function loadPbrSet(name)   // → { albedo, normal, roughness } using the two helpers above
```

## Details

1. **Terrarium decode**: fetch DEM PNG → decode via `createImageBitmap` + canvas
   → `height_m = (R*256 + G + B/256) - 32768`. Return Float32Array plus a
   bilinear `sample(u, v)` helper (u,v in 0..1). Read the `<id>.json` sidecar
   for bbox/metersPerPixel.
2. **HDRI**: use `RGBELoader` + `PMREMGenerator` (three/addons). Dispose the
   generator after baking. Cache per-path (Map) so repeated loads are free.
3. **KTX2 readiness**: `loadColorTexture`/`loadDataTexture` check the extension —
   if `.ktx2`, route through `KTX2Loader` (transcoder path
   `node_modules/three/examples/jsm/libs/basis/` copied to `public/basis/` via a
   tiny Vite config `publicDir` note or postinstall copy — document what you do).
   JPEG/PNG path must work today; KTX2 is forward-provisioning.
4. **No rendering changes** — this module is not imported by anything yet.

## Tests (committed)

`scripts/test-assets.mjs`, run with `node scripts/test-assets.mjs`:
- Generates a 4×4 synthetic terrarium PNG fixture (known heights incl. negative
  and >256m values), decodes via the same math (extract the pure decode function
  so it runs in Node without DOM — e.g. `decodeTerrarium(rgbaBytes, w, h)` in
  `src/assets.js` with the DOM-dependent wrapper around it), asserts exact
  values and bilinear samples at corners/midpoints.
- Asserts sidecar parsing (fixture JSON).
- Exits non-zero on failure. Add `"test:assets": "node scripts/test-assets.mjs"`.

## Acceptance criteria

- `node scripts/test-assets.mjs` passes; `npm run build` passes.
- `decodeTerrarium` is pure (no DOM/three imports at module top-level that break Node — keep three imports inside browser-only functions or make the decode a separate tiny module `src/terrarium.js` if cleaner).
- No existing file behavior changes; nothing imports the new module yet.

---

## Review round 1 (Claude, 2026-07-04)

`src/terrarium.js` decode + bilinear sample: **correct** (verified with round-trip
probes). Test-file fixes seen in the working tree (in-range heights,
`import.meta.url` fixture path) look right — land them.

**`src/assets.js` must-fix defects before anything imports it:**

1. **`require('three')` in an ESM browser module** (`loadColorTexture`,
   `loadDataTexture`) — throws `ReferenceError: require is not defined` at
   runtime. Use a single top-level `import * as THREE from 'three'`; this
   module is browser-only by design (the pure decode already lives in
   `terrarium.js` for Node tests).
2. **Wrong colorSpace values**: `tex.colorSpace = 'SRGBColorSpace'` /
   `'NoColorSpace'` assign enum *names*, not values (the real strings are
   `'srgb'` / `''`), silently breaking color management. Use the constants:
   `THREE.SRGBColorSpace`, `THREE.NoColorSpace`.
3. **Fixture paths baked into production functions**: `loadDem` and
   `loadPbrSet` fetch from `/public/test-fixtures/...`. (a) Vite serves
   `public/` at the web root, so the `/public` prefix 404s even for fixtures;
   (b) production paths per task 01 are `/assets/dem/<id>.png` + `<id>.json`
   and `/assets/pbr/<set>/{albedo,normal,roughness}.jpg`. Fixtures belong only
   in the Node test.
4. `loadPbrSet` filename scheme (`<name>-albedo.jpg`) diverges from the task-01
   layout (`<set>/albedo.jpg`). Match task 01.
5. `src/terrarium.js` type guard references `Buffer`, which is undefined in
   browsers — a wrong-typed input would throw `ReferenceError` instead of the
   intended `TypeError`. Guard with `typeof Buffer !== 'undefined' && ...`.
6. Nits: unused `renderer` param on `loadColorTexture`; prefer
   `three/addons/loaders/RGBELoader.js` import path; validate sidecar fields
   (`metersPerPixel`, `bbox`) in `loadDem` and fail loudly.

Acceptance re-check after fixes: `npm run test:assets` (Node), `npm run build`,
and a browser smoke: `loadColorTexture('/assets/globe/earth-day-8k.jpg')`
resolves with `.colorSpace === 'srgb'`.
