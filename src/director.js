import * as THREE from 'three';

// easing -----------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeInOut = (x) => x * x * (3 - 2 * x);
const easeIn = (x) => x * x * x;
const easeOut = (x) => 1 - (1 - x) ** 3;

// timeline keypoints (seconds) --------------------------------------------
export const T = {
  REVEAL: 5,        // the point of light becomes Earth
  SPIN_START: 12,
  SPIN_END: 26,
  ISOLATE: 26,
  AWAKEN: 29,
  TITLE_IN: 33,
  TITLE_OUT: 39.5,
  DIVE: 41,
  WHITEOUT: 47.5,
  HERO: 51,
  SETTLE: 61,
  UI: 62.5,
};
const MILESTONES = [T.SPIN_START, T.ISOLATE, T.TITLE_IN, T.DIVE, T.HERO, T.SETTLE];

const TRANS_ILI = { lon: 77.35, lat: 43.05 };

/**
 * Owns time, the camera, and every per-frame parameter of the experience.
 * One camera, one clock, no cuts.
 */
export function createDirector({ camera, globe, terrain }) {
  const q = new URLSearchParams(location.search);
  const timeScale = q.has('fast') ? Number(q.get('fast')) || 4 : 1;
  let elapsed = q.get('scene') === 'hero' ? T.HERO : 0;

  const heroStart = new THREE.Vector3(-14, terrain.standH + 46, 96);
  const heroEnd = new THREE.Vector3(0, terrain.standH + 2.7, 6);
  const heroLookStart = new THREE.Vector3(0, terrain.standH + 10, -60);
  const heroLookEnd = new THREE.Vector3(-40, terrain.standH + 55, -280);

  const _dir = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  const params = {
    scene: 'globe',
    exposure: 0,
    voidParticles: 1,
    spin: 0,
    isolate: 0,
    awaken: 0,
    cloudBoost: 0,
    whiteout: 0,
    title: false,
    ui: false,
    settled: false,
    audio: { wind: 0.2, rumble: 1, pad: 0, birds: 0 },
  };

  function skip() {
    const next = MILESTONES.find((m) => m > elapsed + 0.5);
    if (next !== undefined) elapsed = next;
  }

  function update(dt) {
    elapsed += dt * timeScale;
    const t = elapsed;

    params.scene = t < T.HERO ? 'globe' : 'terrain';
    params.title = t >= T.TITLE_IN && t < T.TITLE_OUT;
    params.ui = t >= T.UI;
    params.settled = t >= T.SETTLE;

    if (params.scene === 'globe') {
      // --- brightness: void -> a living planet -------------------------------
      params.exposure = 0.04 + easeInOut(seg(t, T.REVEAL, T.REVEAL + 9)) * 1.08;
      params.voidParticles = 1 - seg(t, T.REVEAL + 2, T.REVEAL + 7);
      params.spin = easeInOut(seg(t, T.SPIN_START, T.SPIN_END));
      params.isolate = easeInOut(seg(t, T.ISOLATE, T.ISOLATE + 4.5));
      params.awaken = easeOut(seg(t, T.AWAKEN, T.AWAKEN + 6));
      const dive = easeIn(seg(t, T.DIVE, T.HERO));
      params.cloudBoost = seg(t, T.DIVE + 2, T.HERO - 1);
      params.whiteout = easeIn(seg(t, T.WHITEOUT, T.HERO - 0.2));

      // --- camera: pull back, hold, then fall toward the Trans-Ili Alatau ----
      const pull = easeOut(seg(t, T.REVEAL, T.REVEAL + 11));
      let dist = 1.9 + pull * 1.5;                    // 1.9 -> 3.4
      dist = THREE.MathUtils.lerp(dist, 1.045, dive); // then down through clouds
      const target = globe.worldPoint(TRANS_ILI.lon, TRANS_ILI.lat, 1);
      _dir.copy(Z_AXIS).lerp(_dir.copy(target).normalize(), dive * 0.9).normalize();
      camera.position.copy(_dir).multiplyScalar(dist);
      _look.set(0, 0, 0).lerp(target, dive);
      camera.lookAt(_look);
      camera.fov = 40 + dive * 15;
      camera.near = 0.01;
      camera.far = 50;

      params.audio.wind = 0.15 + dive * 0.85;
      params.audio.rumble = 1 - params.isolate * 0.4 - dive * 0.6;
      params.audio.pad = params.awaken * 0.4 + dive * 0.3;
      params.audio.birds = 0;
    } else {
      // --- the hero glide: out of the whiteout onto the ridge ----------------
      params.exposure = 1.05;
      params.whiteout = 1 - easeInOut(seg(t, T.HERO, T.HERO + 4.5));
      const g = easeInOut(seg(t, T.HERO, T.SETTLE));
      camera.position.lerpVectors(heroStart, heroEnd, g);
      _look.lerpVectors(heroLookStart, heroLookEnd, easeInOut(seg(t, T.HERO + 1, T.SETTLE)));

      // idle breathing once settled — alive, never frozen
      if (params.settled) {
        const it = t - T.SETTLE;
        camera.position.y = heroEnd.y + Math.sin(it * 0.45) * 0.18;
        camera.position.x = heroEnd.x + Math.sin(it * 0.19) * 0.6;
        _look.x += Math.sin(it * 0.11) * 14;
        _look.y += Math.sin(it * 0.23) * 5;
      }
      camera.lookAt(_look);
      camera.fov = 55;
      camera.near = 0.1;
      camera.far = 6000;

      params.audio.wind = 1;
      params.audio.rumble = 0;
      params.audio.pad = 0.8;
      params.audio.birds = seg(t, T.HERO + 5, T.SETTLE);
    }

    camera.updateProjectionMatrix();
    return params;
  }

  return { update, skip, params, get elapsed() { return elapsed; } };
}
