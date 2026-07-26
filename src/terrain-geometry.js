/**
 * Pure heightfield meshing — no three.js, no DOM, so it runs identically on
 * the main thread or inside a worker.
 *
 * Builds the DEM-draped grid directly instead of displacing a PlaneGeometry:
 * that skips a full set of intermediate allocations, and lets normals come
 * from central differences on the grid (cheaper and smoother than averaging
 * triangle normals).
 */

/** Bilinear sample of a row-major grid at (u,v) in 0..1. */
function sampleGrid(grid, w, h, u, v) {
  const x = Math.min(1, Math.max(0, u)) * (w - 1);
  const y = Math.min(1, Math.max(0, v)) * (h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const sx = x - x0, sy = y - y0;
  const a = grid[y0 * w + x0] * (1 - sx) + grid[y0 * w + x1] * sx;
  const b = grid[y1 * w + x0] * (1 - sx) + grid[y1 * w + x1] * sx;
  return a * (1 - sy) + b * sy;
}

/**
 * @param spec {
 *   grid, gridW, gridH,          // decoded DEM heights, metres
 *   station: [u, v], elevStation, // rebasing origin
 *   spanX, spanZ,                // scene-unit extent of the whole DEM
 *   upm, vExag, deepen,          // vertical mapping
 *   xMin, xMax, zFront, zBack,   // scene bounds to mesh
 *   segX, segZ,                  // grid resolution
 * }
 * @returns { positions, uvs, normals, indices } typed arrays, transferable
 */
export function buildHeightfield(spec) {
  const {
    grid, gridW, gridH, station, elevStation, spanX, spanZ,
    upm, vExag, deepen = 1, xMin, xMax, zFront, zBack, segX, segZ,
  } = spec;
  const [uS, vS] = station;
  const nx = segX + 1, nz = segZ + 1;
  const count = nx * nz;

  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const normals = new Float32Array(count * 3);
  // >65535 verts is the norm here, so 32-bit indices
  const indices = new Uint32Array(segX * segZ * 6);

  const dx = (xMax - xMin) / segX;
  const dz = (zBack - zFront) / segZ;
  const heights = new Float32Array(count); // scene-space Y, reused for normals

  for (let iz = 0; iz < nz; iz++) {
    const z = zBack - iz * dz; // front rows last, matching -Z forward
    const v = Math.min(1, Math.max(0, vS - z / spanZ));
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + ix * dx;
      const u = Math.min(1, Math.max(0, uS + x / spanX));
      let h = sampleGrid(grid, gridW, gridH, u, v) - elevStation;
      if (h < 0) h *= deepen;
      h *= upm * vExag;

      const i = iz * nx + ix;
      heights[i] = h;
      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = 1 - v; // texture row 0 is south (flipY); DEM v=0 is north
    }
  }

  // central-difference normals; edges clamp to their neighbour
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const l = heights[iz * nx + Math.max(0, ix - 1)];
      const r = heights[iz * nx + Math.min(nx - 1, ix + 1)];
      const b = heights[Math.max(0, iz - 1) * nx + ix];
      const f = heights[Math.min(nz - 1, iz + 1) * nx + ix];
      // z decreases as iz grows, so the forward difference flips sign
      const nX = (l - r) / (2 * dx);
      const nZ = (f - b) / (2 * dz);
      const len = Math.hypot(nX, 1, nZ);
      normals[i * 3] = nX / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = nZ / len;
    }
  }

  let t = 0;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * nx + ix, b2 = a + 1, c = a + nx, d = c + 1;
      indices[t++] = a; indices[t++] = c; indices[t++] = b2;
      indices[t++] = b2; indices[t++] = c; indices[t++] = d;
    }
  }

  return { positions, uvs, normals, indices };
}
