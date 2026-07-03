import * as topojson from 'topojson-client';

// Equirectangular helpers ---------------------------------------------------
export function lonLatToVec3(lon, lat, r = 1) {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return [
    r * Math.cos(phi) * Math.cos(theta),
    r * Math.sin(phi),
    -r * Math.cos(phi) * Math.sin(theta),
  ];
}

function projX(lon, w) { return ((lon + 180) / 360) * w; }
function projY(lat, h) { return ((90 - lat) / 180) * h; }

function drawGeometry(ctx, geom, w, h) {
  const polys =
    geom.type === 'Polygon' ? [geom.coordinates] :
    geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    ctx.beginPath();
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const x = projX(lon, w);
        const y = projY(lat, h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill();
  }
}

/**
 * Loads world land + Kazakhstan geometry and bakes them into a single
 * equirectangular mask canvas:
 *   R — land, G — Kazakhstan, B — city lights
 * Returns { canvas, kazakhstanFeature, landFeature }
 */
export async function loadGeo() {
  const [landTopo, countriesTopo] = await Promise.all([
    fetch('/data/land-110m.json').then((r) => r.json()),
    fetch('/data/countries-110m.json').then((r) => r.json()),
  ]);

  const land = topojson.feature(landTopo, landTopo.objects.land);
  const countries = topojson.feature(countriesTopo, countriesTopo.objects.countries);
  const kz = countries.features.find((f) => f.properties.name === 'Kazakhstan');

  const w = 2048, h = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // R channel: all land
  ctx.fillStyle = 'rgb(255,0,0)';
  for (const f of land.features) drawGeometry(ctx, f.geometry, w, h);

  // G channel: Kazakhstan (additive so R survives)
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgb(0,255,0)';
  drawGeometry(ctx, kz.geometry, w, h);

  // B channel: procedural city lights, seeded so every load is identical
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const isLand = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    return data[(y * w + x) * 4] > 128;
  };
  for (let i = 0; i < 90000; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    if (!isLand(x, y)) continue;
    const lat = 90 - (y / h) * 180;
    // population density proxy: temperate bands glow, poles/deep deserts don't
    const band = Math.exp(-((Math.abs(lat) - 35) ** 2) / 520);
    if (rand() > band * 0.85) continue;
    const bright = 90 + Math.floor(rand() * 165);
    const px = (y * w + x) * 4;
    data[px + 2] = Math.min(255, data[px + 2] + bright);
    // occasional cluster (a "city")
    if (rand() < 0.18) {
      for (let k = 0; k < 6; k++) {
        const dx = Math.floor((rand() - 0.5) * 6);
        const dy = Math.floor((rand() - 0.5) * 4);
        if (!isLand(x + dx, y + dy)) continue;
        const q = ((y + dy) * w + (x + dx)) * 4;
        data[q + 2] = Math.min(255, data[q + 2] + 60 + Math.floor(rand() * 120));
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  return { canvas, kazakhstanFeature: kz, landFeature: land };
}

/** Largest outer ring of the Kazakhstan polygon, as [lon,lat] pairs. */
export function kazakhstanRing(kzFeature) {
  const g = kzFeature.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = polys[0][0];
  for (const p of polys) if (p[0].length > best.length) best = p[0];
  return best;
}
