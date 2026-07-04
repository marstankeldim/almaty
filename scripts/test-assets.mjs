import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { decodeTerrarium } from '../src/terrarium.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('Assertion failed:', msg);
    process.exitCode = 2;
    throw new Error(msg);
  }
}

// Generate a 4x4 RGBA buffer encoded with terrarium math for known heights.
const width = 4, height = 4;
// choose these test heights (meters)
const heights = new Float32Array([
  -32768, -32767, -32766, -32765,
  -100, -1, 0, 1,
  256, 257, 1024, 2048,
  30000, 32766, 32767, -123
]);

function encodeTerrariumValue(h) {
  // reverse: value = (R*256 + G + B/256) - 32768
  const v = h + 32768;
  const R = Math.floor(v / 256) & 0xff;
  const G = Math.floor(v - R * 256) & 0xff;
  const B = Math.round((v - Math.floor(v)) * 256) & 0xff;
  return [R, G, B, 255];
}

const rgba = new Uint8Array(width * height * 4);
for (let i = 0; i < width * height; i++) {
  const [R, G, B, A] = encodeTerrariumValue(heights[i]);
  const p = i * 4;
  rgba[p] = R; rgba[p+1] = G; rgba[p+2] = B; rgba[p+3] = A;
}

// Ensure test fixture PNG exists by writing it using sharp (raw RGBA input)
const outDir = path.resolve(fileURLToPath(new URL('../public/test-fixtures/', import.meta.url)));
try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
const pngPath = path.join(outDir, 'terrarium-4x4.png');
await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toFile(pngPath);

const decoded = decodeTerrarium(rgba, width, height);

// check exact pixels
for (let i = 0; i < width * height; i++) {
  const got = decoded.grid[i];
  const want = heights[i];
  assert(Math.abs(got - want) < 1e-6, `pixel ${i} expected ${want} got ${got}`);
}

// test bilinear sample at corners and center
assert(Math.abs(decoded.sample(0,0) - heights[0]) < 1e-6, 'corner 0,0');
assert(Math.abs(decoded.sample(1,0) - heights[3]) < 1e-6, 'corner 1,0');
assert(Math.abs(decoded.sample(0,1) - heights[12]) < 1e-6, 'corner 0,1');
assert(Math.abs(decoded.sample(1,1) - heights[15]) < 1e-6, 'corner 1,1');

// midpoint (0.5,0.5) average of four center pixels
const mid = decoded.sample(0.5, 0.5);
// compute expected bilinear of four neighbors around center (x=1.5,y=1.5)
function idx(x,y){return y*width+x}
const v00 = heights[idx(1,1)], v10 = heights[idx(2,1)], v01 = heights[idx(1,2)], v11 = heights[idx(2,2)];
const expectedMid = (v00 + v10 + v01 + v11) / 4;
assert(Math.abs(mid - expectedMid) < 1e-6, `mid expected ${expectedMid} got ${mid}`);

// sidecar JSON parsing test
const fixtureUrl = new URL('../public/test-fixtures/terrarium-4x4.json', import.meta.url);
const sidecar = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
assert(typeof sidecar.metersPerPixel === 'number', 'sidecar metersPerPixel');
assert(Array.isArray(sidecar.bbox) && sidecar.bbox.length === 4, 'sidecar bbox');

console.log('All asset tests passed.');
