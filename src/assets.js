import { decodeTerrarium } from './terrarium.js';

// Browser-only: load DEM PNG via createImageBitmap and canvas
export async function loadDem(id) {
  // Prefer production path but fall back to test fixtures for demo/test.
  const jsonCandidates = [`/assets/dem/${id}.json`, `/test-fixtures/${id}.json`];
  const pngCandidates = [`/assets/dem/${id}.png`, `/test-fixtures/${id}.png`];

  let sidecar = null;
  for (const p of jsonCandidates) {
    try {
      const r = await fetch(p);
      if (!r.ok) continue;
      sidecar = await r.json();
      break;
    } catch (e) {
      continue;
    }
  }
  if (!sidecar) throw new Error(`Sidecar not found for ${id}`);
  if (typeof sidecar.metersPerPixel !== 'number' || !Array.isArray(sidecar.bbox)) {
    throw new Error(`Invalid sidecar for ${id}`);
  }

  let imageBitmap = null;
  for (const p of pngCandidates) {
    try {
      const resp = await fetch(p);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      imageBitmap = await createImageBitmap(blob);
      break;
    } catch (e) {
      continue;
    }
  }
  if (!imageBitmap) throw new Error(`DEM PNG not found for ${id}`);

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    : document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (canvas.width !== imageBitmap.width) {
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;
  }
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
  const mod = await import('three/examples/jsm/loaders/RGBELoader.js');
  const RGBELoader = mod.RGBELoader || mod.default;
  const THREE = await import('three');
  const { PMREMGenerator } = THREE;

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
// This module is browser-only; import THREE at top-level to use constants.
import * as THREE from 'three';

export async function loadColorTexture(path, renderer) {
  // sRGB, mipmap, anisotropy 8
  if (path.endsWith('.ktx2')) {
    if (!renderer) throw new Error('KTX2 loading requires a WebGL renderer instance for feature detection');
    const mod = await import('three/examples/jsm/loaders/KTX2Loader.js');
    const KTX2Loader = mod.KTX2Loader || mod.default;
    const ktx2 = new KTX2Loader();
    // runtime expects the Basis transcoder files to be served from /basis/
    ktx2.setTranscoderPath('/basis/');
    ktx2.detectSupport(renderer);
    const tex = await new Promise((res, rej) => ktx2.load(path, res, undefined, rej));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    return tex;
  }
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  return tex;
}

export function loadDataTexture(path) {
  if (path.endsWith('.ktx2')) {
    throw new Error('KTX2 data textures must be loaded via the async KTX2 path; pass through loadColorTexture for KTX2 support');
  }
  const loader = new THREE.TextureLoader();
  const tex = loader.load(path);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.anisotropy = 1;
  return tex;
}

export async function loadPbrSet(name) {
  // Task-01 layout: /assets/pbr/<set>/{albedo,normal,roughness}.jpg
  const base = `/assets/pbr/${name}`;
  return {
    albedo: await loadColorTexture(`${base}/albedo.jpg`),
    normal: loadDataTexture(`${base}/normal.jpg`),
    roughness: loadDataTexture(`${base}/roughness.jpg`),
  };
}
