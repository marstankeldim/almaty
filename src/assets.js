import { decodeTerrarium } from './terrarium.js';

// Browser-only: load DEM PNG via createImageBitmap and canvas
export async function loadDem(id) {
  const jsonPath = `/public/test-fixtures/${id}.json`;
  const pngPath = `/public/test-fixtures/${id}.png`;
  const sidecar = await fetch(jsonPath).then(r => r.json());

  const resp = await fetch(pngPath);
  const blob = await resp.blob();
  const imageBitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);

  const decoded = decodeTerrarium(new Uint8Array(imageData.data.buffer), imageBitmap.width, imageBitmap.height);

  return {
    grid: decoded.grid,
    width: decoded.width,
    height: decoded.height,
    metersPerPixel: sidecar.metersPerPixel,
    bbox: sidecar.bbox,
    sample: decoded.sample,
  };
}

// HDRI loader using three.js addons (browser-only). Loads and caches env maps.
const _hdriCache = new Map();
export async function loadHdriEnvironment(renderer, path) {
  if (_hdriCache.has(path)) return _hdriCache.get(path);
  // Lazy import to avoid Node-side errors
  const { RGBELoader } = await import('three/examples/jsm/loaders/RGBELoader.js');
  const { PMREMGenerator } = await import('three');

  const loader = new RGBELoader();
  const tex = await new Promise((res, rej) => loader.load(path, res, undefined, rej));
  const pmrem = new PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();

  const result = { envMap, backgroundTex: tex };
  _hdriCache.set(path, result);
  return result;
}

// Texture loaders: ready for KTX2 but handle JPEG/PNG today.
export function loadColorTexture(path, renderer) {
  // sRGB, mipmap, anisotropy 8
  if (path.endsWith('.ktx2')) {
    if (!renderer) throw new Error('KTX2 loading requires a WebGL renderer instance for feature detection');
    const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
    const THREE = await import('three');
    const ktx2 = new KTX2Loader();
    // runtime expects the Basis transcoder files to be served from /basis/
    ktx2.setTranscoderPath('/basis/');
    ktx2.detectSupport(renderer);
    const tex = await new Promise((res, rej) => ktx2.load(path, res, undefined, rej));
    tex.colorSpace = 'SRGBColorSpace';
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
  }
  // Lazy import three to avoid Node resolution at module load
  const THREE = require('three');
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.colorSpace = 'SRGBColorSpace';
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  return tex;
}

export function loadDataTexture(path) {
  if (path.endsWith('.ktx2')) {
    // For KTX2 data textures we still require renderer for support detection
    throw new Error('KTX2 data textures must be loaded via the async KTX2 path; call loadColorTexture/loadDataTexture with a renderer (browser-only)');
  }
  const THREE = require('three');
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.colorSpace = 'NoColorSpace';
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  return tex;
}

export async function loadPbrSet(name) {
  const base = `/public/test-fixtures/pbr/${name}`;
  return {
    albedo: loadColorTexture(`${base}-albedo.jpg`),
    normal: loadDataTexture(`${base}-normal.jpg`),
    roughness: loadDataTexture(`${base}-roughness.jpg`),
  };
}
