import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { N8AOPass } from 'n8ao';
import { loadGeo } from './geo.js';
import { createGlobe } from './globe.js';
import { createTerrainScene, presetDem, demMeshSpec } from './terrain.js';
import { loadDemGrid } from './dem.js';
import { loadHdriEnvironment } from './assets.js';
import { createDirector } from './director.js';
import { createSoundscape } from './audio.js';
import { createUI } from './ui.js';
import { discover } from './locations.js';

// A hidden or collapsing pane can report 0×0 — a NaN camera aspect poisons
// the projection matrix silently. Never trust raw window dimensions.
const viewW = () => Math.max(1, window.innerWidth);
const viewH = () => Math.max(1, window.innerHeight);

async function boot() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewW(), viewH());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(40, viewW() / viewH(), 0.01, 50);
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
      const dem = presetDem(id);
      if (!dem) continue;
      const demGrid = await loadDemGrid(id);
      if (!demGrid) continue;
      // Anisotropy 2, not 8: these vantages look along the terrain, so the
      // far range is sampled at footprint ratios far beyond 8 taps. The GPU
      // then picks its mip from the minor axis and aliases along the major
      // one, which showed as horizontal streaks smeared across the slopes.
      // A lower cap forces a blurrier, correct mip at grazing incidence.
      const satelliteTex = await new Promise((res) => texLoader.load(
        `/assets/satellite/${id}.jpg`,
        (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; res(t); },
        undefined, () => res(null),
      ));
      let envMap = null;
      if (dem.hdri) {
        envMap = await loadHdriEnvironment(renderer, dem.hdri)
          .then((r) => r.envMap)
          .catch((e) => {
            console.warn(`[atlas] HDRI for '${id}' unavailable (${e.message}) — hemisphere fill`);
            return null;
          });
      }
      // Tiling detail plates. flipY MUST be false: the shader projects from
      // world XZ, so image +V has to align with world +Z or the relief reads
      // as dents instead of bumps.
      let plates = null;
      if (dem.plates) {
        const loadPlate = (map, colorSpace = THREE.NoColorSpace) => new Promise((res) => texLoader.load(
          `/assets/pbr/${dem.plates.set}/${map}.jpg`,
          (t) => {
            t.colorSpace = colorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.flipY = false;
            t.anisotropy = 8;
            res(t);
          },
          undefined, () => res(null),
        ));
        const [albedo, normal, roughness] = await Promise.all([
          loadPlate('albedo', THREE.SRGBColorSpace), loadPlate('normal'), loadPlate('roughness'),
        ]);
        if (albedo && normal && roughness) plates = { albedo, normal, roughness };
        else console.warn(`[atlas] detail plates for '${id}' unavailable — satellite only`);
      }
      locationAssets[id] = { demGrid, satelliteTex, envMap, plates };
    }
  }
  await loadLocationAssets();

  // Mesh heightfields off the main thread — inline meshing costs ~1.5s per
  // location and froze the intro. Scenes still build synchronously; they just
  // consume a ready payload when the worker has one.
  function startGeometryWorker() {
    let worker;
    try {
      worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      console.warn(`[atlas] geometry worker unavailable (${e.message}) — meshing inline`);
      return null;
    }
    const pending = new Map();
    worker.onmessage = (e) => {
      const { id, geo, ms, error } = e.data;
      const resolve = pending.get(id);
      pending.delete(id);
      if (error) {
        console.warn(`[atlas] worker failed for ${id} (${error}) — meshing inline`);
        return resolve?.(null);
      }
      console.log(`[atlas] meshed ${id} in worker: ${ms.toFixed(0)}ms`);
      resolve?.(geo);
    };
    worker.onerror = (e) => {
      console.warn(`[atlas] geometry worker error (${e.message}) — meshing inline`);
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
    };
    return {
      mesh(id, spec) {
        return new Promise((resolve) => {
          pending.set(id, resolve);
          // the grid is copied, not transferred — the sampler still needs it
          worker.postMessage({ id, spec });
        });
      },
      dispose: () => worker.terminate(),
    };
  }

  const scenes = {};
  function ensureScene(id) {
    if (!IMPLEMENTED.includes(id)) return null;
    if (!scenes[id]) {
      const t0 = performance.now();
      scenes[id] = createTerrainScene(id, { ...(locationAssets[id] || {}), camera });
      console.log(`[atlas] built ${id} in ${(performance.now() - t0).toFixed(0)}ms`);
    }
    return scenes[id];
  }

  const geoWorker = startGeometryWorker();
  async function premesh(id) {
    const a = locationAssets[id];
    if (!geoWorker || !a?.demGrid || a.geometry) return;
    const spec = demMeshSpec(id, a.demGrid);
    // the grid is copied into the worker, not transferred — the sampler
    // on this side still needs it for anchors, water level and beacons
    if (spec) a.geometry = await geoWorker.mesh(id, spec);
  }

  // home must be renderable on frame one (?scene=hero starts there)
  await premesh(HOME);
  ensureScene(HOME);

  // the rest stream in behind the intro, one at a time to keep the worker cool
  (async () => {
    for (const id of IMPLEMENTED) {
      if (scenes[id]) continue;
      await premesh(id);
      ensureScene(id);
    }
    geoWorker?.dispose();
  })();

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

  // post chain: MSAA render → AO (location scenes) → bloom → tonemap → grade
  const drawSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
    drawSize.x, drawSize.y, { samples: 4, type: THREE.HalfFloatType }));

  // two mutually-exclusive scene renderers: plain for the globe,
  // N8AO (renders the scene itself) for the ground scenes
  const renderPass = new RenderPass(globe.scene, camera);
  const aoPass = new N8AOPass(globe.scene, camera, drawSize.x, drawSize.y);
  aoPass.configuration.halfRes = true;
  aoPass.configuration.aoRadius = 22;
  aoPass.configuration.intensity = 2.2;
  aoPass.configuration.aoSamples = 12;
  // OutputPass does the sRGB conversion — n8ao must not gamma-correct too
  aoPass.configuration.gammaCorrection = false;
  aoPass.enabled = false;

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(viewW(), viewH()), 0.35, 0.65, 1.0);

  // display-space filmic grade: gentle S-curve, cool shadow lift,
  // warm highlights, fine animated grain — "camera", not "filter"
  const gradePass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 s = c * c * (3.0 - 2.0 * c);
        c = mix(c, s, 0.22);
        c += vec3(0.005, 0.007, 0.014) * smoothstep(0.18, 0.0, l);
        c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), smoothstep(0.55, 1.0, l) * 0.6);
        float g = fract(sin(dot(gl_FragCoord.xy + mod(uTime, 10.0) * 61.7,
                                vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        c += g * 0.015 * (1.0 - l * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });

  composer.addPass(renderPass);
  composer.addPass(aoPass);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.addPass(gradePass);

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
    pointer.set((e.clientX / viewW()) * 2 - 1, -(e.clientY / viewH()) * 2 + 1);
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
    camera.aspect = viewW() / viewH();
    camera.updateProjectionMatrix();
    renderer.setSize(viewW(), viewH());
    composer.setSize(viewW(), viewH());
  });

  // ---- loop ----------------------------------------------------------------------
  const clock = new THREE.Clock();
  let wall = 0;
  const MAX_PR = Math.min(window.devicePixelRatio, 2);
  const stats = {
    ema: 16, fps: 60, pixelRatio: renderer.getPixelRatio(), frames: 0,
    aoQuality: true, level: 0, shadowMapSize: 2048, msaa: 4, detail: 1, plates: 1,
  };

  function setPixelRatio(pr) {
    stats.pixelRatio = pr;
    renderer.setPixelRatio(pr);
    renderer.setSize(viewW(), viewH());
    composer.setSize(viewW(), viewH());
  }

  function setShadowMapSize(size) {
    if (stats.shadowMapSize === size) return;
    stats.shadowMapSize = size;
    for (const s of Object.values(scenes)) {
      if (!s.csm) continue;
      s.csm.shadowMapSize = size;
      for (const l of s.csm.lights) {
        l.shadow.mapSize.setScalar(size);
        // dropping the allocated map forces three to rebuild it at the new size
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    }
  }

  // MSAA is deliberately NOT in the ladder. Toggling it means disposing the
  // composer's render targets mid-session, and the reallocated pair stops
  // being cleared — previous scenes bleed through as composited garbage.
  // The sample count is worth far less than the last DPR step anyway.

  /**
   * Quality ladder, shed in this order and restored in reverse. Structure of
   * the image is preserved as long as possible: occlusion and shadow crispness
   * go before resolution, and geometric anti-aliasing goes last.
   *   0 full · 1 no AO · 2 soft shadows · 3 lower DPR · 4 lowest DPR + no detail
   */
  function applyQualityLevel(level) {
    stats.level = level = Math.max(0, Math.min(4, level));
    stats.aoQuality = level < 1;
    setShadowMapSize(level < 2 ? 2048 : 1024);
    setPixelRatio(level < 3 ? MAX_PR : (level < 4 ? 1.0 : 0.75));
    // mesoscale detail is pure ALU — cheap enough to keep until the last tier
    stats.detail = level < 4 ? 1 : 0;
    stats.plates = level < 2 ? 1 : 0;
    for (const s of Object.values(scenes)) {
      s.setDetail?.(stats.detail);
      s.setPlates?.(stats.plates);
    }
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
    gradePass.uniforms.uTime.value = wall;
    const isGlobe = p.scene === 'globe';
    if (isGlobe) {
      globe.update(wall, p);
      renderPass.scene = globe.scene;
    } else {
      const s = scenes[p.scene];
      s.update(wall, dt);
      if (s.csm) {
        // recompute cascade frusta when the camera's projection changes
        if (s._csmFov !== camera.fov || s._csmAspect !== camera.aspect) {
          s.csm.updateFrustums();
          s._csmFov = camera.fov; s._csmAspect = camera.aspect;
        }
        s.csm.update();
        s.csm.updateUniforms();
      }
      renderPass.scene = s.scene;
      aoPass.scene = s.scene;
    }
    // AO renders the scene itself — exactly one scene renderer active
    aoPass.enabled = !isGlobe && stats.aoQuality;
    renderPass.enabled = !aoPass.enabled;
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
        // Re-judge every ~2s. Recovery needs a wider margin than degradation
        // so a tier that costs ~4ms can't oscillate on and off every window.
        if (++stats.frames % 120 === 0) {
          if (stats.ema > 22 && stats.level < 4) applyQualityLevel(stats.level + 1);
          else if (stats.ema < 12 && stats.level > 0) applyQualityLevel(stats.level - 1);
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
    scenes,
    setQuality: applyQualityLevel,
    setDetail: (v) => { for (const s of Object.values(scenes)) s.setDetail?.(v); },
    post: { composer, renderPass, aoPass, bloomPass, gradePass },
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
        x: (v.x * 0.5 + 0.5) * viewW(),
        y: (-v.y * 0.5 + 0.5) * viewH(),
        inFront: v.z < 1,
      };
    },
  };
}

boot();
