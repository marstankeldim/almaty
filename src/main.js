import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadGeo } from './geo.js';
import { createGlobe } from './globe.js';
import { createTerrainScene, presetHasDem } from './terrain.js';
import { loadDemGrid } from './dem.js';
import { createDirector } from './director.js';
import { createSoundscape } from './audio.js';
import { createUI } from './ui.js';
import { discover } from './locations.js';

async function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0;
  renderer.autoClear = false;
  document.getElementById('app').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0, 0, 1.9);

  const geo = await loadGeo();

  // Real-Earth textures (NASA); missing assets fall back to the procedural globe.
  async function loadEarthTextures() {
    const loader = new THREE.TextureLoader();
    const load = (path, srgb) => new Promise((res, rej) => {
      loader.load(path, (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = THREE.RepeatWrapping;
        t.anisotropy = 8;
        res(t);
      }, undefined, rej);
    });
    try {
      const [day, night, clouds] = await Promise.all([
        load('/assets/globe/earth-day-8k.jpg', true),
        load('/assets/globe/earth-night-8k.jpg', true),
        load('/assets/globe/earth-clouds-4k.jpg', false),
      ]);
      return { day, night, clouds };
    } catch {
      console.warn('[atlas] earth textures missing — run `node scripts/fetch-assets.mjs`; using procedural globe');
      return null;
    }
  }
  const earthTex = await loadEarthTextures();
  const globe = createGlobe(geo, earthTex);

  // Home builds at boot; every other destination builds lazily so first
  // paint stays fast no matter how many locations the atlas grows.
  const IMPLEMENTED = ['trans-ili-alatau', 'big-almaty-lake', 'charyn-canyon'];
  const HOME = IMPLEMENTED[0];

  // Real-geography assets (DEM height grid + satellite drape) for locations
  // that declare a `dem` preset. Absent files → procedural fallback.
  const locationAssets = {};
  async function loadLocationAssets() {
    const texLoader = new THREE.TextureLoader();
    for (const id of IMPLEMENTED) {
      if (!presetHasDem(id)) continue;
      const demGrid = await loadDemGrid(id);
      if (!demGrid) continue;
      const satelliteTex = await new Promise((res) => texLoader.load(
        `/assets/satellite/${id}.jpg`,
        (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); },
        undefined, () => res(null),
      ));
      locationAssets[id] = { demGrid, satelliteTex };
    }
  }
  await loadLocationAssets();

  const scenes = {};
  function ensureScene(id) {
    if (!IMPLEMENTED.includes(id)) return null;
    if (!scenes[id]) {
      const t0 = performance.now();
      scenes[id] = createTerrainScene(id, locationAssets[id] || {});
      console.log(`[atlas] built ${id} in ${(performance.now() - t0).toFixed(0)}ms`);
    }
    return scenes[id];
  }
  ensureScene(HOME);
  // pre-build the rest while the globe intro plays
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 3000));
  idle(() => IMPLEMENTED.forEach(ensureScene));

  const sound = createSoundscape();
  let ui;
  const director = createDirector({
    camera, globe, scenes, ensureScene,
    onArrive: (id) => {
      discover(id);
      ui.setRegion(scenes[id].name);
    },
  });
  ui = createUI(geo, {
    implemented: new Set(IMPLEMENTED),
    onTravel: (id) => director.travelTo(id),
  });

  // post: gentle HDR bloom — the awakening, the sunrise, the city lights
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(globe.scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.65, 0.85);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // ---- whiteout: the pass through the clouds --------------------------------
  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const overlayUniforms = { uAmount: { value: 0 }, uTime: { value: 0 } };
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: overlayUniforms,
      transparent: true,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmount, uTime;
        varying vec2 vUv;
        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
                     mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.1 + 31.0; a *= 0.5; }
          return v;
        }
        void main() {
          if (uAmount < 0.002) discard;
          float wisps = fbm(vUv * vec2(3.0, 2.0) + vec2(uTime * 0.12, -uTime * 0.05));
          // wisps arrive first, then the full white envelops everything
          float a = clamp(uAmount * 1.35 - (1.0 - wisps) * 0.5, 0.0, 1.0);
          a = smoothstep(0.0, 0.85, a);
          vec3 col = mix(vec3(0.86, 0.84, 0.86), vec3(1.0, 0.96, 0.92), wisps);
          gl_FragColor = vec4(col, a);
        }
      `,
    }),
  );
  overlayScene.add(overlay);

  // ---- input -------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function beaconAt(e) {
    const p = director.params;
    if (p.scene === 'globe' || !p.settled || director.traveling) return null;
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    for (const b of scenes[p.scene].beacons) {
      if (raycaster.intersectObject(b.hit, false).length) return b;
    }
    return null;
  }
  window.addEventListener('pointermove', (e) => {
    const b = beaconAt(e);
    document.body.style.cursor = b ? 'pointer' : 'default';
    ui.showBeaconTip(b, e.clientX, e.clientY);
  });
  window.addEventListener('pointerdown', (e) => {
    sound.start();
    const b = beaconAt(e);
    if (b) {
      ui.showBeaconTip(null);
      director.travelTo(b.to);
    }
  });
  window.addEventListener('dblclick', () => director.skip());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- loop ----------------------------------------------------------------------
  const clock = new THREE.Clock();
  let wall = 0;
  const stats = { ema: 16, fps: 60, pixelRatio: renderer.getPixelRatio(), frames: 0 };

  function setPixelRatio(pr) {
    stats.pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  function frame(dt) {
    wall += dt;

    const p = director.update(dt);
    renderer.toneMappingExposure = p.exposure;
    overlayUniforms.uAmount.value = p.whiteout;
    overlayUniforms.uTime.value = wall;

    sound.mix.wind = p.audio.wind;
    sound.mix.rumble = p.audio.rumble;
    sound.mix.pad = p.audio.pad;
    sound.mix.birds = p.audio.birds;
    sound.mix.water = p.audio.water;
    sound.update(dt, wall);

    ui.apply(p, sound.started, director.elapsed);

    renderer.clear();
    if (p.scene === 'globe') {
      globe.update(wall, p);
      renderPass.scene = globe.scene;
    } else {
      const s = scenes[p.scene];
      s.update(wall, dt);
      renderPass.scene = s.scene;
    }
    bloomPass.strength = p.bloom;
    composer.render();
    if (p.whiteout > 0.002) {
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCam);
    }
  }

  // adaptive quality: judge only real rAF cadence, never manual test steps
  let lastRaf = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (lastRaf && document.visibilityState === 'visible') {
      const ms = now - lastRaf;
      if (ms < 250) { // ignore tab-switch stalls
        stats.ema = stats.ema * 0.95 + ms * 0.05;
        stats.fps = 1000 / stats.ema;
        if (++stats.frames % 120 === 0) {
          const maxPr = Math.min(window.devicePixelRatio, 2);
          if (stats.ema > 22 && stats.pixelRatio > 1.0) {
            setPixelRatio(Math.max(1.0, stats.pixelRatio - 0.25));
          } else if (stats.ema < 13 && stats.pixelRatio < maxPr) {
            setPixelRatio(Math.min(maxPr, stats.pixelRatio + 0.25));
          }
        }
      }
    }
    lastRaf = now;
    frame(Math.min(clock.getDelta(), 0.1));
  });

  // manual stepping for automated visual checks (rAF pauses in hidden tabs)
  window.__atlas = {
    director,
    stats,
    step: (dt = 1 / 30) => frame(dt),
    travelTo: (id) => director.travelTo(id),
    // screen-space position of the active scene's first beacon (for tests)
    beaconScreen() {
      const p = director.params;
      if (p.scene === 'globe') return null;
      const b = scenes[p.scene].beacons[0];
      if (!b) return null;
      const v = b.hit.position.clone().project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
        inFront: v.z < 1,
      };
    },
  };
}

boot();
