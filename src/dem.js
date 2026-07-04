import { decodeTerrarium } from './terrarium.js';

/**
 * Browser loader: fetch a stitched terrarium DEM + its sidecar, decode to a
 * height grid with a bilinear sampler. Returns null if the asset is absent so
 * callers fall back to the procedural heightfield.
 *   → { grid, width, height, sample(u,v)→meters, meta }
 */
export async function loadDemGrid(id) {
  try {
    const meta = await fetch(`/assets/dem/${id}.json`).then((r) => {
      if (!r.ok) throw new Error(`no sidecar (${r.status})`);
      return r.json();
    });
    const bitmap = await fetch(`/assets/dem/${id}.png`)
      .then((r) => { if (!r.ok) throw new Error(`no dem png (${r.status})`); return r.blob(); })
      .then((b) => createImageBitmap(b));

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

    const dem = decodeTerrarium(new Uint8Array(data.buffer), bitmap.width, bitmap.height);
    return { ...dem, meta };
  } catch (e) {
    console.warn(`[atlas] DEM '${id}' unavailable (${e.message}) — using procedural terrain`);
    return null;
  }
}
