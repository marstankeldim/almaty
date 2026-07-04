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
