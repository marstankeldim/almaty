import * as THREE from 'three';
import { loadGeo } from './geo.js';
import { createGlobe } from './globe.js';
import { createTerrainScene } from './terrain.js';
import { createDirector } from './director.js';
import { createSoundscape } from './audio.js';
import { createUI } from './ui.js';

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
  const globe = createGlobe(geo);
  const terrain = createTerrainScene();
  const director = createDirector({ camera, globe, terrain });
  const sound = createSoundscape();
  const ui = createUI(geo);

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
  window.addEventListener('pointerdown', () => sound.start(), { once: false });
  window.addEventListener('dblclick', () => director.skip());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- loop ----------------------------------------------------------------------
  const clock = new THREE.Clock();
  let wall = 0;
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
    sound.update(dt, wall);

    ui.apply(p, sound.started, director.elapsed);

    renderer.clear();
    if (p.scene === 'globe') {
      globe.update(wall, p);
      renderer.render(globe.scene, camera);
    } else {
      terrain.update(wall, dt);
      renderer.render(terrain.scene, camera);
    }
    if (p.whiteout > 0.002) {
      renderer.clearDepth();
      renderer.render(overlayScene, overlayCam);
    }
  }
  renderer.setAnimationLoop(() => frame(Math.min(clock.getDelta(), 0.1)));

  // manual stepping for automated visual checks (rAF pauses in hidden tabs)
  window.__atlas = { director, step: (dt = 1 / 30) => frame(dt) };
}

boot();
