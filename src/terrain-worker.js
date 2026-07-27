import { buildHeightfield } from './terrain-geometry.js';

// One message per location: mesh the heightfield and hand the buffers back
// zero-copy, so the main thread only has to wrap them in a BufferGeometry.
self.onmessage = (e) => {
  const { id, spec } = e.data;
  try {
    const t0 = performance.now();
    const geo = buildHeightfield(spec);
    self.postMessage({ id, geo, ms: performance.now() - t0 }, [
      geo.positions.buffer, geo.uvs.buffer, geo.normals.buffer, geo.indices.buffer,
    ]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
