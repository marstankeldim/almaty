import * as THREE from 'three';

// easing -----------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeInOut = (x) => x * x * (3 - 2 * x);
const easeIn = (x) => x * x * x;
const easeOut = (x) => 1 - (1 - x) ** 3;

// intro timeline keypoints (seconds) ---------------------------------------
export const T = {
  REVEAL: 5,
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

// travel choreography (seconds within a journey)
const J = { LIFT: 6, WHITEOUT_IN: 3.8, ARRIVE: 14, WHITEOUT_OUT: 10 };

const TRANS_ILI = { lon: 77.35, lat: 43.05 };
const HOME = 'trans-ili-alatau';

/**
 * Owns time, the camera, and every per-frame parameter.
 * One camera, one clock, no cuts — the intro flows into a network of
 * locations linked by lift-through-the-clouds journeys.
 */
export function createDirector({ camera, globe, scenes, ensureScene, onArrive }) {
  const q = new URLSearchParams(location.search);
  const timeScale = q.has('fast') ? Number(q.get('fast')) || 4 : 1;
  let elapsed = q.get('scene') === 'hero' ? T.HERO : 0;

  let activeLoc = HOME;
  let travel = null; // { t, to, fromPos, fromLook, swapped }

  const _dir = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _pos = new THREE.Vector3();
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
    bloom: 0.35,
    title: false,
    ui: false,
    settled: false,
    audio: { wind: 0.2, rumble: 1, pad: 0, birds: 0, water: 0 },
  };

  function skip() {
    if (travel) return;
    const next = MILESTONES.find((m) => m > elapsed + 0.5);
    if (next !== undefined) elapsed = next;
  }

  function travelTo(id) {
    if (travel || params.scene === 'globe' || elapsed < T.SETTLE) return false;
    if (id === activeLoc || !ensureScene(id)) return false;
    travel = {
      t: 0,
      to: id,
      fromPos: camera.position.clone(),
      fromLook: scenes[activeLoc].anchors.lookRest.clone(),
      swapped: false,
    };
    return true;
  }

  function idleSway(t, A) {
    camera.position.set(
      A.stand.x + Math.sin(t * 0.19) * 0.6,
      A.stand.y + Math.sin(t * 0.45) * 0.18,
      A.stand.z,
    );
    _look.copy(A.lookRest);
    _look.x += Math.sin(t * 0.11) * 14;
    _look.y += Math.sin(t * 0.23) * 5;
    camera.lookAt(_look);
  }

  function update(dt) {
    const sdt = dt * timeScale;
    elapsed += sdt;
    const t = elapsed;

    params.title = t >= T.TITLE_IN && t < T.TITLE_OUT;
    params.settled = t >= T.SETTLE;
    params.ui = t >= T.UI && !travel;

    if (t < T.HERO) {
      // ================= the globe: void → reveal → awakening → dive ========
      params.scene = 'globe';
      params.exposure = 0.04 + easeInOut(seg(t, T.REVEAL, T.REVEAL + 9)) * 1.08;
      params.voidParticles = 1 - seg(t, T.REVEAL + 2, T.REVEAL + 7);
      params.spin = easeInOut(seg(t, T.SPIN_START, T.SPIN_END));
      params.isolate = easeInOut(seg(t, T.ISOLATE, T.ISOLATE + 4.5));
      params.awaken = easeOut(seg(t, T.AWAKEN, T.AWAKEN + 6));
      const dive = easeIn(seg(t, T.DIVE, T.HERO));
      params.cloudBoost = seg(t, T.DIVE + 2, T.HERO - 1);
      params.whiteout = easeIn(seg(t, T.WHITEOUT, T.HERO - 0.2));
      params.bloom = 0.3 + params.awaken * 0.3 - dive * 0.25;

      const pull = easeOut(seg(t, T.REVEAL, T.REVEAL + 11));
      let dist = 1.9 + pull * 1.5;
      dist = THREE.MathUtils.lerp(dist, 1.045, dive);
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
      params.audio.water = 0;
    } else {
      // ================= on the ground somewhere in Kazakhstan ==============
      params.scene = activeLoc;
      params.exposure = 1.05;
      params.bloom = 0.3;
      camera.fov = 55;
      camera.near = 0.1;
      camera.far = 6000;

      const A = scenes[activeLoc].anchors;

      if (travel) {
        // ---- journey: lift into the clouds, cross, descend somewhere new ---
        travel.t += sdt;
        const tt = travel.t;

        if (tt < J.LIFT) {
          const k = easeIn(seg(tt, 0, J.LIFT));
          const arc = Math.sin(k * Math.PI); // helicopter arc, not an elevator
          _pos.copy(travel.fromPos);
          _pos.y += k * 260;
          _pos.z += k * 40;
          _pos.x += arc * 28;
          camera.position.copy(_pos);
          _look.copy(travel.fromLook);
          _look.y += k * 120; // gaze rises toward the horizon as we climb
          camera.lookAt(_look);
          camera.rotateZ(arc * -0.06); // bank into the turn
          params.whiteout = seg(tt, J.WHITEOUT_IN, J.LIFT - 0.2);
        } else {
          if (!travel.swapped) {
            travel.swapped = true;
            activeLoc = travel.to;
          }
          const B = scenes[activeLoc].anchors;
          const k = easeInOut(seg(tt, J.LIFT, J.ARRIVE));
          const arc = Math.sin(k * Math.PI);
          camera.position.lerpVectors(B.entryPos, B.stand, k);
          camera.position.x += arc * 20;
          _look.lerpVectors(B.entryLook, B.lookRest, easeInOut(seg(tt, J.LIFT + 1, J.ARRIVE)));
          camera.lookAt(_look);
          camera.rotateZ(arc * 0.05); // level out before touching down
          params.whiteout = 1 - easeInOut(seg(tt, J.LIFT, J.WHITEOUT_OUT));
          if (tt >= J.ARRIVE) {
            travel = null;
            onArrive?.(activeLoc);
          }
        }
        params.audio.wind = 1.3;
        params.audio.pad = 0.5;
        params.audio.birds = 0;
      } else if (t < T.SETTLE) {
        // ---- the intro's first descent onto the home ridge ------------------
        params.whiteout = 1 - easeInOut(seg(t, T.HERO, T.HERO + 4.5));
        const g = easeInOut(seg(t, T.HERO, T.SETTLE));
        camera.position.lerpVectors(A.entryPos, A.stand, g);
        _look.lerpVectors(A.entryLook, A.lookRest, easeInOut(seg(t, T.HERO + 1, T.SETTLE)));
        camera.lookAt(_look);
        camera.rotateZ(Math.sin(g * Math.PI) * 0.04); // gentle bank on approach
        params.audio.wind = 1;
        params.audio.pad = 0.8;
        params.audio.birds = seg(t, T.HERO + 5, T.SETTLE);
      } else {
        // ---- settled: idle breathing, never frozen --------------------------
        params.whiteout = 0;
        idleSway(t - T.SETTLE, A);
        params.audio.wind = 1;
        params.audio.pad = 0.8;
        params.audio.birds = 1;
      }
      params.audio.rumble = 0;
      params.audio.water = !travel && scenes[activeLoc].hasWater ? 1 : 0;
    }

    camera.updateProjectionMatrix();
    return params;
  }

  return {
    update, skip, travelTo, params,
    get elapsed() { return elapsed; },
    get activeLoc() { return activeLoc; },
    get traveling() { return !!travel; },
  };
}
