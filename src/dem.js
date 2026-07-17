import { decodeTerrarium } from './terrarium.js';

/**
 * High-zoom terrarium tiles carry raw SRTM voids (decode to −32768) and the
 * odd corrupt speckle. Replace anything implausible — or wildly divergent
 * from its 4-neighborhood — with the neighbor average, in place.
 */
function repairDem(grid, width, height) {
  const FLOOR = -200; // Karagiye depression (−132m) is Kazakhstan's true minimum
  const SPIKE = 800;  // meters of disagreement with neighbors ⇒ bad sample
  let repaired = 0;
  const at = (x, y) => grid[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const h = grid[i];
      const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)]
        .filter((v) => v > FLOOR);
      if (!nb.length) continue;
      const avg = nb.reduce((a, b) => a + b, 0) / nb.length;
      if (h <= FLOOR || Math.abs(h - avg) > SPIKE) {
        grid[i] = avg;
        repaired++;
      }
    }
  }
  return repaired;
}

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
    const repaired = repairDem(dem.grid, dem.width, dem.height);
    if (repaired) console.log(`[atlas] DEM '${id}': repaired ${repaired} void/spike samples`);
    return { ...dem, meta };
  } catch (e) {
    console.warn(`[atlas] DEM '${id}' unavailable (${e.message}) — using procedural terrain`);
    return null;
  }
}
