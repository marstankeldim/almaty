// Pure decoder for Terrarium-format RGBA bytes.
// height_m = (R*256 + G + B/256) - 32768

export function decodeTerrarium(rgbaBytes, width, height) {
  const hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function';
  if (!(rgbaBytes instanceof Uint8Array) && !(hasBuffer && Buffer.isBuffer(rgbaBytes))) {
    throw new TypeError('rgbaBytes must be Uint8Array or Buffer');
  }
  const pixels = width * height;
  if (rgbaBytes.length < pixels * 4) throw new Error('rgbaBytes too small');

  const grid = new Float32Array(pixels);
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const R = rgbaBytes[p];
    const G = rgbaBytes[p + 1];
    const B = rgbaBytes[p + 2];
    const height_m = (R * 256 + G + B / 256) - 32768;
    grid[i] = height_m;
  }

  function sample(u01, v01) {
    // Bilinear sample where u01,v01 in [0,1]
    const x = u01 * (width - 1);
    const y = v01 * (height - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const sx = x - x0;
    const sy = y - y0;

    const i00 = y0 * width + x0;
    const i10 = y0 * width + x1;
    const i01 = y1 * width + x0;
    const i11 = y1 * width + x1;

    const n00 = grid[i00];
    const n10 = grid[i10];
    const n01 = grid[i01];
    const n11 = grid[i11];

    const a = n00 * (1 - sx) + n10 * sx;
    const b = n01 * (1 - sx) + n11 * sx;
    return a * (1 - sy) + b * sy;
  }

  return { grid, width, height, sample };
}

export function decodeTerrariumFromImageData(imageData) {
  // imageData: { data: Uint8ClampedArray, width, height }
  const u8 = new Uint8Array(imageData.data.buffer);
  return decodeTerrarium(u8, imageData.width, imageData.height);
}
