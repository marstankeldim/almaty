import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(repoRoot, 'public', 'assets');
const manifestPath = path.join(repoRoot, 'assets.manifest.json');
const attributionPath = path.join(repoRoot, 'ATTRIBUTION.md');
const verifyMode = process.argv.includes('--verify');
const concurrencyLimit = 4;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

function humanBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTable(rows) {
  const headers = ['file', 'size', 'license'];
  const values = rows.map((row) => [row.file, row.size, row.license]);
  const widths = headers.map((header, index) => Math.max(header.length, ...values.map((row) => String(row[index]).length)));
  const formatRow = (row) => `  ${row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ')}`;
  return [formatRow(headers), formatRow(widths.map((width) => '-'.repeat(width))), ...values.map(formatRow)].join('\n');
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delay = attempt * 500;
        console.warn(`[assets] retry ${attempt}/${attempts} for ${url} in ${delay}ms`);
        await wait(delay);
      }
    }
  }
  throw lastError;
}

function lonToMercatorX(lon, zoom) {
  return ((lon + 180) / 360) * (256 * 2 ** zoom);
}

function latToMercatorY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return (1 - mercN / Math.PI) * 0.5 * (256 * 2 ** zoom);
}

function tileRangeForBBox(bbox, zoom) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const minX = Math.floor(lonToMercatorX(minLon, zoom) / 256);
  const maxX = Math.floor(lonToMercatorX(maxLon, zoom) / 256);
  const minY = Math.floor(latToMercatorY(maxLat, zoom) / 256);
  const maxY = Math.floor(latToMercatorY(minLat, zoom) / 256);
  return { minX, maxX, minY, maxY };
}

function bboxMeterSpan(bbox) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const earthRadius = 6378137;
  const latRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const dLat = (maxLat - minLat) * (Math.PI / 180);
  const dLon = (maxLon - minLon) * (Math.PI / 180);
  const widthMeters = earthRadius * Math.cos(latRad) * dLon;
  const heightMeters = earthRadius * dLat;
  return { widthMeters, heightMeters };
}

function computeMetersPerPixel(bbox, zoom) {
  const centerLat = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  return (156543.03392804062 * Math.cos(centerLat)) / 2 ** zoom;
}

async function writeBuffer(filePath, buffer) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, buffer);
}

async function materializeFromBuffer(buffer, filePath, outputFormat) {
  await ensureDir(path.dirname(filePath));
  if (outputFormat === 'hdr') {
    await writeBuffer(filePath, buffer);
    return;
  }
  const image = sharp(buffer);
  if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
    await image.jpeg({ quality: 92 }).toFile(filePath);
  } else if (outputFormat === 'png') {
    await image.png({ compressionLevel: 9 }).toFile(filePath);
  } else {
    await image.toFile(filePath);
  }
}

async function generateSyntheticTexture({ color, filePath }) {
  await ensureDir(path.dirname(filePath));
  const image = sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: color,
    },
  });
  await image.jpeg({ quality: 92 }).toFile(filePath);
}

async function stitchTiles(task) {
  const { bbox, zoom, tileUrlTemplate, outputFile, outputFormat, title } = task;
  const range = tileRangeForBBox(bbox, zoom);
  const width = (range.maxX - range.minX + 1) * 256;
  const height = (range.maxY - range.minY + 1) * 256;
  const tileBuffers = [];
  for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
    for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
      const url = tileUrlTemplate.replace('{z}', String(zoom)).replace('{x}', String(tileX)).replace('{y}', String(tileY));
      const buffer = await fetchWithRetry(url);
      tileBuffers.push({ buffer, tileX, tileY });
    }
  }

  const mosaic = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  for (const tile of tileBuffers) {
    mosaic.composite([{ input: tile.buffer, left: (tile.tileX - range.minX) * 256, top: (tile.tileY - range.minY) * 256 }]);
  }

  const mosaicBuffer = await mosaic.toBuffer();
  const xMinPx = Math.floor(lonToMercatorX(bbox[0], zoom));
  const xMaxPx = Math.ceil(lonToMercatorX(bbox[2], zoom));
  const yMaxPx = Math.floor(latToMercatorY(bbox[3], zoom));
  const yMinPx = Math.ceil(latToMercatorY(bbox[1], zoom));

  const left = Math.max(0, Math.floor(xMinPx - range.minX * 256));
  const top = Math.max(0, Math.floor(yMaxPx - range.minY * 256));
  const right = Math.min(width, Math.ceil(xMaxPx - range.minX * 256));
  const bottom = Math.min(height, Math.ceil(yMinPx - range.minY * 256));
  const cropWidth = Math.max(1, right - left);
  const cropHeight = Math.max(1, bottom - top);

  const cropped = sharp(mosaicBuffer).extract({ left, top, width: cropWidth, height: cropHeight });
  if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
    await cropped.jpeg({ quality: 92 }).toFile(outputFile);
  } else if (outputFormat === 'png') {
    await cropped.png({ compressionLevel: 9 }).toFile(outputFile);
  } else {
    await cropped.toFile(outputFile);
  }

  if (title) {
    console.log(`[assets] stitched ${title}`);
  }
}

async function processTask(task, manifestMap) {
  const destinationPath = path.join(repoRoot, task.path);
  const manifestEntry = manifestMap.get(task.path);
  const exists = await fs.access(destinationPath).then(() => true).catch(() => false);

  if (verifyMode) {
    if (!exists) {
      throw new Error(`missing ${task.path}`);
    }
    const fileBuffer = await fs.readFile(destinationPath);
    const sha = sha256(fileBuffer);
    if (!manifestEntry || manifestEntry.sha256 !== sha) {
      throw new Error(`checksum mismatch ${task.path}`);
    }
    return { path: task.path, sha256: sha, size: fileBuffer.length, license: task.license };
  }

  if (exists && manifestEntry) {
    const currentBuffer = await fs.readFile(destinationPath);
    if (sha256(currentBuffer) === manifestEntry.sha256) {
      return { path: task.path, sha256: manifestEntry.sha256, size: currentBuffer.length, license: task.license, skipped: true };
    }
  }

  if (task.kind === 'stitch') {
    await stitchTiles({ ...task, outputFile: destinationPath });
  } else if (task.kind === 'download') {
    const buffer = await fetchWithRetry(task.url);
    await materializeFromBuffer(buffer, destinationPath, task.outputFormat);
  } else if (task.kind === 'generate') {
    await generateSyntheticTexture({ filePath: destinationPath, color: task.color });
  }

  const outputBuffer = await fs.readFile(destinationPath);
  return { path: task.path, sha256: sha256(outputBuffer), size: outputBuffer.length, license: task.license };
}

async function run() {
  await ensureDir(assetsRoot);

  const existingManifest = await readJson(manifestPath, { files: [] });
  const manifestMap = new Map(existingManifest.files ? existingManifest.files.map((entry) => [entry.path, entry]) : []);

  const tasks = [
    { kind: 'download', path: 'public/assets/globe/earth-day-8k.jpg', url: 'https://images-assets.nasa.gov/image/PIA18033/PIA18033~orig.jpg', outputFormat: 'jpg', license: 'Public domain', attribution: 'NASA Visible Earth / NASA image archive (public domain).' },
    { kind: 'download', path: 'public/assets/globe/earth-night-8k.jpg', url: 'https://images-assets.nasa.gov/image/PIA00422/PIA00422~orig.jpg', outputFormat: 'jpg', license: 'Public domain', attribution: 'NASA Visible Earth / NASA image archive (public domain).' },
    { kind: 'download', path: 'public/assets/globe/earth-clouds-4k.jpg', url: 'https://images-assets.nasa.gov/image/PIA03519/PIA03519~orig.jpg', outputFormat: 'jpg', license: 'Public domain', attribution: 'NASA Visible Earth / NASA image archive (public domain).' },
    { kind: 'stitch', path: 'public/assets/dem/trans-ili-alatau.png', bbox: [76.9, 43.0, 77.6, 43.25], zoom: 12, tileUrlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', outputFormat: 'png', license: 'Public domain', attribution: 'AWS Terrain Tiles (public domain / no key required).', title: 'Trans-Ili DEM' },
    { kind: 'stitch', path: 'public/assets/dem/big-almaty-lake.png', bbox: [76.93, 43.02, 77.03, 43.10], zoom: 13, tileUrlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', outputFormat: 'png', license: 'Public domain', attribution: 'AWS Terrain Tiles (public domain / no key required).', title: 'Big Almaty Lake DEM' },
    { kind: 'stitch', path: 'public/assets/dem/charyn-canyon.png', bbox: [78.95, 43.30, 79.15, 43.42], zoom: 13, tileUrlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', outputFormat: 'png', license: 'Public domain', attribution: 'AWS Terrain Tiles (public domain / no key required).', title: 'Charyn Canyon DEM' },
    { kind: 'stitch', path: 'public/assets/satellite/trans-ili-alatau.jpg', bbox: [76.9, 43.0, 77.6, 43.25], zoom: 12, tileUrlTemplate: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', outputFormat: 'jpg', license: 'CC-BY 4.0', attribution: 'EOX Sentinel-2 cloudless mosaic, CC-BY 4.0.' , title: 'Trans-Ili satellite mosaic' },
    { kind: 'stitch', path: 'public/assets/satellite/big-almaty-lake.jpg', bbox: [76.93, 43.02, 77.03, 43.10], zoom: 13, tileUrlTemplate: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', outputFormat: 'jpg', license: 'CC-BY 4.0', attribution: 'EOX Sentinel-2 cloudless mosaic, CC-BY 4.0.', title: 'Big Almaty Lake satellite mosaic' },
    { kind: 'stitch', path: 'public/assets/satellite/charyn-canyon.jpg', bbox: [78.95, 43.30, 79.15, 43.42], zoom: 13, tileUrlTemplate: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg', outputFormat: 'jpg', license: 'CC-BY 4.0', attribution: 'EOX Sentinel-2 cloudless mosaic, CC-BY 4.0.', title: 'Charyn Canyon satellite mosaic' },
    { kind: 'download', path: 'public/assets/hdri/sunrise-mountain-4k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloppenheim_06_4k.hdr', outputFormat: 'hdr', license: 'CC0', attribution: 'PolyHaven HDRI asset (CC0).' },
    { kind: 'download', path: 'public/assets/hdri/morning-alpine-4k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/forest_slope_4k.hdr', outputFormat: 'hdr', license: 'CC0', attribution: 'PolyHaven HDRI asset (CC0).' },
    { kind: 'download', path: 'public/assets/hdri/afternoon-desert-4k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/green_point_park_4k.hdr', outputFormat: 'hdr', license: 'CC0', attribution: 'PolyHaven HDRI asset (CC0).' },
    { kind: 'generate', path: 'public/assets/pbr/cliff-rock/albedo.jpg', color: [88, 95, 103], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/cliff-rock/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/cliff-rock/roughness.jpg', color: [180, 180, 180], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/scree/albedo.jpg', color: [122, 104, 90], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/scree/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/scree/roughness.jpg', color: [160, 160, 160], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/alpine-grass/albedo.jpg', color: [80, 118, 68], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/alpine-grass/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/alpine-grass/roughness.jpg', color: [140, 140, 140], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/snow/albedo.jpg', color: [242, 248, 252], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/snow/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/snow/roughness.jpg', color: [220, 220, 220], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/red-sandstone/albedo.jpg', color: [171, 96, 52], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/red-sandstone/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/red-sandstone/roughness.jpg', color: [170, 150, 140], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/dry-soil/albedo.jpg', color: [122, 98, 62], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/dry-soil/normal.jpg', color: [128, 128, 255], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
    { kind: 'generate', path: 'public/assets/pbr/dry-soil/roughness.jpg', color: [150, 140, 130], license: 'Synthetic fallback', attribution: 'Synthetic fallback generated for local asset pipeline compatibility.' },
  ];

  const rows = [];
  const outputEntries = [];

  const executeTask = async (task, index) => {
    const result = await processTask(task, manifestMap);
    rows[index] = { file: task.path, size: humanBytes(result.size), license: task.license };
    outputEntries[index] = {
      path: task.path,
      sourceUrls: task.url ? [task.url] : [task.tileUrlTemplate],
      sha256: result.sha256,
      size: result.size,
      license: task.license,
      attribution: task.attribution,
    };
    return result;
  };

  for (let offset = 0; offset < tasks.length; offset += concurrencyLimit) {
    const batch = tasks.slice(offset, offset + concurrencyLimit);
    const batchResults = await Promise.all(batch.map((task, batchIndex) => executeTask(task, offset + batchIndex)));
    if (batchResults.some((result) => result && result.skipped)) {
      console.log(`[assets] cached ${batch.length} item(s)`);
    }
  }

  const demMeta = [
    {
      path: 'public/assets/dem/trans-ili-alatau.json',
      bbox: [76.9, 43.0, 77.6, 43.25],
      zoom: 12,
      pixelSize: computeMetersPerPixel([76.9, 43.0, 77.6, 43.25], 12),
      metersPerPixel: computeMetersPerPixel([76.9, 43.0, 77.6, 43.25], 12),
      bboxMeters: bboxMeterSpan([76.9, 43.0, 77.6, 43.25]),
    },
    {
      path: 'public/assets/dem/big-almaty-lake.json',
      bbox: [76.93, 43.02, 77.03, 43.10],
      zoom: 13,
      pixelSize: computeMetersPerPixel([76.93, 43.02, 77.03, 43.10], 13),
      metersPerPixel: computeMetersPerPixel([76.93, 43.02, 77.03, 43.10], 13),
      bboxMeters: bboxMeterSpan([76.93, 43.02, 77.03, 43.10]),
    },
    {
      path: 'public/assets/dem/charyn-canyon.json',
      bbox: [78.95, 43.30, 79.15, 43.42],
      zoom: 13,
      pixelSize: computeMetersPerPixel([78.95, 43.30, 79.15, 43.42], 13),
      metersPerPixel: computeMetersPerPixel([78.95, 43.30, 79.15, 43.42], 13),
      bboxMeters: bboxMeterSpan([78.95, 43.30, 79.15, 43.42]),
    },
  ];

  for (const item of demMeta) {
    const sidecarPath = path.join(repoRoot, item.path);
    await fs.writeFile(sidecarPath, `${JSON.stringify(item, null, 2)}\n`);
    const buffer = await fs.readFile(sidecarPath);
    outputEntries.push({
      path: item.path,
      sourceUrls: [],
      sha256: sha256(buffer),
      size: buffer.length,
      license: 'Public domain',
      attribution: 'DEM metadata derived from the requested bounding box and zoom level.',
    });
  }

  const manifestPayload = { generatedAt: new Date().toISOString(), files: outputEntries };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifestPayload, null, 2)}\n`);

  const attribution = `# Attribution

This repository includes assets sourced from public or CC-licensed providers.

- NASA Visible Earth / NASA image archive: public domain. The globe textures use public-domain imagery from NASA and are credited as courtesy of NASA.
- EOX Sentinel-2 cloudless mosaic: CC-BY 4.0. Please retain attribution whenever these tiles are used in downstream work.
- PolyHaven: CC0. HDRI assets were sourced from PolyHaven and are credited as courtesy of PolyHaven.
- AWS Terrain Tiles: public, no API key required. DEM tiles are used as-is for terrain previewing.
`;
  await fs.writeFile(attributionPath, attribution);

  console.log('[assets] summary');
  console.log(formatTable(rows));
  console.log(`[assets] manifest: ${manifestPath}`);
  console.log(`[assets] attribution: ${attributionPath}`);
}

run().catch((error) => {
  console.error(`[assets] failed: ${error.message}`);
  if (error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
