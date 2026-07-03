import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic 2D value noise (CPU) — used for the heightfield & placement
// ---------------------------------------------------------------------------
function makeNoise(seed = 7) {
  const hash = (x, y) => {
    let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 5) {
    let val = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      val += amp * noise(x * f, y * f);
      f *= 2.02; amp *= 0.5;
    }
    return val;
  }
  function ridged(x, y, oct = 5) {
    let val = 0, amp = 0.55, f = 1;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
      val += amp * n * n;
      f *= 2.1; amp *= 0.5;
    }
    return val;
  }
  return { noise, fbm, ridged };
}

const N = makeNoise(7);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The Trans-Ili Alatau heightfield. Camera stands near the origin. */
export function terrainHeight(x, z) {
  // gentle grassy ridge underfoot
  const base = N.fbm(x * 0.012, z * 0.012) * 10 - 4;
  const local = N.ridged(x * 0.03 + 3, z * 0.03) * 5;

  // the great wall of peaks to the south (-Z)
  const wallMask = smoothstep(-70, -300, z);
  const wall = Math.pow(N.ridged(x * 0.0045 + 11, z * 0.0045 + 4), 1.7) * 235 * wallMask;

  // flanking ranges east & west
  const sideMask = smoothstep(120, 320, Math.abs(x));
  const side = Math.pow(N.ridged(x * 0.005 + 23, z * 0.005 + 9), 1.6) * 150 * sideMask;

  // the cloud-filled valley between us and the wall
  const valley = -26 * Math.exp(-((z + 130) ** 2) / (2 * 55 ** 2)) * (1 - sideMask);

  return base + local + wall + side + valley;
}

const SUN_DIR = new THREE.Vector3(-0.62, 0.26, -0.55).normalize();
const FOG_COLOR = new THREE.Color(0.72, 0.62, 0.60);

export function createTerrainScene() {
  const scene = new THREE.Scene();

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: SUN_DIR.clone() },
    uFogColor: { value: FOG_COLOR.clone() },
  };

  // ---- sky dome --------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = (projectionMatrix * mv).xyww; // pin to far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.05, 1.0);
        vec3 zenith = vec3(0.10, 0.19, 0.38);
        vec3 horizon = vec3(0.85, 0.62, 0.45);
        vec3 sky = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
        float sunAmt = max(dot(d, uSunDir), 0.0);
        sky += vec3(1.0, 0.72, 0.42) * pow(sunAmt, 6.0) * 0.55;   // warm bloom
        sky += vec3(1.0, 0.9, 0.7) * pow(sunAmt, 90.0) * 2.2;     // halo
        sky += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, sunAmt) * 8.0; // disc
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), skyMat);
  scene.add(sky);

  // ---- terrain ----------------------------------------------------------------
  const SIZE = 1600, SEGS = 400, CENTER_Z = -260;
  const tGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  tGeo.rotateX(-Math.PI / 2);
  tGeo.translate(0, 0, CENTER_Z);
  {
    const pos = tGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    tGeo.computeVertexNormals();
  }
  const terrMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vNormal = normal;
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vWorld;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
                   mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.1 + 13.0; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 n = normalize(vNormal);
        float slope = 1.0 - n.y;
        float h = vWorld.y;
        float detail = fbm(vWorld.xz * 0.06);

        // material zones
        vec3 grass = mix(vec3(0.16, 0.24, 0.10), vec3(0.30, 0.34, 0.14), detail);
        vec3 rock  = mix(vec3(0.20, 0.17, 0.15), vec3(0.34, 0.30, 0.27), detail);
        vec3 snow  = vec3(0.93, 0.95, 1.0);

        float snowLine = 48.0 + detail * 24.0;
        float snowAmt = smoothstep(snowLine, snowLine + 16.0, h) * smoothstep(0.85, 0.3, slope);
        float rockAmt = smoothstep(0.25, 0.55, slope) + smoothstep(35.0, 90.0, h) * 0.5;

        vec3 albedo = mix(grass, rock, clamp(rockAmt, 0.0, 1.0));
        albedo = mix(albedo, snow, snowAmt);

        // sunrise lighting
        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 sunCol = vec3(1.0, 0.66, 0.40) * 2.1;
        vec3 skyCol = vec3(0.36, 0.44, 0.62) * 0.9;
        vec3 col = albedo * (sunCol * ndl + skyCol * (0.45 + 0.55 * n.y));

        // alpenglow: snow facing the sun catches fire
        col += snow * snowAmt * vec3(1.0, 0.45, 0.25) * pow(ndl, 2.0) * 0.55;

        // travelling cloud shadows
        float shadow = 0.72 + 0.28 * smoothstep(0.35, 0.65,
          fbm(vWorld.xz * 0.004 + vec2(uTime * 0.013, uTime * 0.006)));
        col *= shadow;

        // aerial perspective
        float dist = length(vWorld - cameraPosition);
        float fogAmt = 1.0 - exp(-dist * 0.00115);
        float heightFog = smoothstep(20.0, -30.0, h) * 0.5; // valleys drown in haze
        col = mix(col, uFogColor, clamp(fogAmt + heightFog * fogAmt, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(tGeo, terrMat));

  // ---- grass ------------------------------------------------------------------
  const standH = terrainHeight(0, 6);
  const GRASS_COUNT = 14000;
  const bladeGeo = new THREE.PlaneGeometry(0.09, 0.9, 1, 3);
  bladeGeo.translate(0, 0.45, 0);
  const grassGeo = new THREE.InstancedBufferGeometry();
  grassGeo.index = bladeGeo.index;
  grassGeo.attributes.position = bladeGeo.attributes.position;
  grassGeo.attributes.uv = bladeGeo.attributes.uv;
  const gOffsets = new Float32Array(GRASS_COUNT * 3);
  const gData = new Float32Array(GRASS_COUNT * 3); // rot, scale, colorShift
  let gi = 0;
  let guard = 0;
  while (gi < GRASS_COUNT && guard++ < GRASS_COUNT * 30) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.pow(Math.random(), 0.6) * 80;
    const x = Math.cos(a) * r;
    const z = 6 + Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h > 55 || h < standH - 22) continue; // above grass zone or down-cliff
    gOffsets[gi * 3 + 0] = x;
    gOffsets[gi * 3 + 1] = h;
    gOffsets[gi * 3 + 2] = z;
    gData[gi * 3 + 0] = Math.random() * Math.PI * 2;
    gData[gi * 3 + 1] = 0.55 + Math.random() * 0.6;
    gData[gi * 3 + 2] = Math.random();
    gi++;
  }
  grassGeo.instanceCount = gi;
  grassGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(gOffsets, 3));
  grassGeo.setAttribute('aData', new THREE.InstancedBufferAttribute(gData, 3));
  const grassMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;
      attribute vec3 aData;
      uniform float uTime;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vUv = uv;
        float rot = aData.x, scl = aData.y;
        vShade = aData.z;
        vec3 p = position * scl;
        float c = cos(rot), s = sin(rot);
        p.xz = mat2(c, -s, s, c) * p.xz;
        // wind: stronger at the tip, gusts roll across the field
        float tip = uv.y * uv.y;
        float gust = sin(uTime * 1.1 + aOffset.x * 0.08 + aOffset.z * 0.06)
                   + 0.5 * sin(uTime * 2.3 + aOffset.z * 0.15);
        p.x += tip * gust * 0.22 * scl;
        p.z += tip * gust * 0.13 * scl;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p + aOffset, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vec3 base = mix(vec3(0.07, 0.13, 0.045), vec3(0.24, 0.30, 0.10), vUv.y);
        base *= 0.75 + 0.5 * vShade;
        base += vec3(0.45, 0.25, 0.10) * vUv.y * 0.35; // sunrise rim on tips
        gl_FragColor = vec4(mix(base, uFogColor, 0.06), 1.0);
      }
    `,
  });
  const grass = new THREE.Mesh(grassGeo, grassMat);
  grass.frustumCulled = false;
  scene.add(grass);

  // ---- wildflowers ---------------------------------------------------------------
  const FLOWERS = 500;
  const flowerGeo = new THREE.InstancedBufferGeometry();
  const fBase = new THREE.PlaneGeometry(0.15, 0.15);
  fBase.translate(0, 0.42, 0);
  flowerGeo.index = fBase.index;
  flowerGeo.attributes.position = fBase.attributes.position;
  flowerGeo.attributes.uv = fBase.attributes.uv;
  const fOffsets = new Float32Array(FLOWERS * 3);
  const fColors = new Float32Array(FLOWERS * 3);
  const palette = [
    [0.95, 0.85, 0.35], [0.90, 0.90, 0.95], [0.75, 0.45, 0.85], [0.95, 0.40, 0.35],
  ];
  let fi = 0;
  guard = 0;
  while (fi < FLOWERS && guard++ < FLOWERS * 40) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.pow(Math.random(), 0.7) * 45;
    const x = Math.cos(a) * r, z = 6 + Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h > 45 || h < standH - 15) continue;
    fOffsets[fi * 3] = x; fOffsets[fi * 3 + 1] = h + 0.35; fOffsets[fi * 3 + 2] = z;
    const c = palette[Math.floor(Math.random() * palette.length)];
    fColors[fi * 3] = c[0]; fColors[fi * 3 + 1] = c[1]; fColors[fi * 3 + 2] = c[2];
    fi++;
  }
  flowerGeo.instanceCount = fi;
  flowerGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(fOffsets, 3));
  flowerGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(fColors, 3));
  const flowerMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    vertexShader: /* glsl */ `
      attribute vec3 aOffset;
      attribute vec3 aColor;
      uniform float uTime;
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        vColor = aColor;
        vUv = uv;
        // camera-facing billboard
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float sway = sin(uTime * 1.4 + aOffset.x * 0.5) * 0.05;
        vec3 p = aOffset + right * (position.x + sway) + up * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5);
        float petals = smoothstep(0.5, 0.28, d);
        if (petals < 0.05) discard;
        vec3 col = mix(vColor, vec3(0.98, 0.85, 0.3), smoothstep(0.16, 0.0, d));
        gl_FragColor = vec4(col * 1.1, petals);
      }
    `,
  });
  const flowers = new THREE.Mesh(flowerGeo, flowerMat);
  flowers.frustumCulled = false;
  scene.add(flowers);

  // ---- valley clouds ----------------------------------------------------------
  const cloudTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 126);
    grad.addColorStop(0, 'rgba(255,250,244,0.85)');
    grad.addColorStop(0.55, 'rgba(250,240,232,0.35)');
    grad.addColorStop(1, 'rgba(245,235,228,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const cloudGroup = new THREE.Group();
  const cloudSprites = [];
  for (let i = 0; i < 42; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.38 + Math.random() * 0.25,
      depthWrite: false,
      color: new THREE.Color(1.15, 1.02 + Math.random() * 0.06, 0.95),
    });
    const s = new THREE.Sprite(mat);
    const x = (Math.random() - 0.5) * 800;
    const z = -95 - Math.random() * 220;
    s.position.set(x, -22 + Math.random() * 14, z);
    const sc = 70 + Math.random() * 130;
    s.scale.set(sc, sc * 0.3, 1);
    s.userData = { drift: 0.6 + Math.random() * 1.2, phase: Math.random() * 100, baseY: s.position.y };
    cloudGroup.add(s);
    cloudSprites.push(s);
  }
  scene.add(cloudGroup);

  // ---- dust motes ---------------------------------------------------------------
  const DUST = 420;
  const dPos = new Float32Array(DUST * 3);
  const dPhase = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dPos[i * 3] = (Math.random() - 0.5) * 46;
    dPos[i * 3 + 1] = standH + 0.5 + Math.random() * 7;
    dPos[i * 3 + 2] = 6 + (Math.random() - 0.5) * 46;
    dPhase[i] = Math.random() * Math.PI * 2;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('aPhase', new THREE.BufferAttribute(dPhase, 1));
  const dustMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      varying float vSpark;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.32 + aPhase) * 1.6 + uTime * 0.14;
        p.y += sin(uTime * 0.21 + aPhase * 2.1) * 0.9;
        p.z += cos(uTime * 0.26 + aPhase * 1.3) * 1.4;
        p.x = mod(p.x + 23.0, 46.0) - 23.0;
        vSpark = pow(0.5 + 0.5 * sin(uTime * 1.8 + aPhase * 5.0), 4.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((2.2 + vSpark * 3.5) * (120.0 / -mv.z), 0.5, 4.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vSpark;
      void main() {
        float d = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        gl_FragColor = vec4(vec3(1.0, 0.85, 0.6), d * (0.08 + vSpark * 0.5));
      }
    `,
  });
  const dust = new THREE.Points(dGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  // ---- birds --------------------------------------------------------------------
  const birds = [];
  const birdGroup = new THREE.Group();
  // swept-back gull wing: root chord wide, tip narrow
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, -0.16,   0, 0, 0.14,   0.65, 0, -0.05,
    0.65, 0, -0.05, 0, 0, -0.16, 0.62, 0, -0.22,
  ]), 3));
  wingGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1a1611, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Group();
    const wl = new THREE.Mesh(wingGeo, birdMat);
    wl.scale.x = -1;
    const wr = new THREE.Mesh(wingGeo, birdMat);
    b.add(wl, wr);
    const sc = 0.8 + Math.random() * 0.5;
    b.scale.setScalar(sc);
    b.userData = {
      radius: 35 + Math.random() * 50,
      height: standH + 30 + Math.random() * 30,
      speed: 0.08 + Math.random() * 0.08,
      phase: Math.random() * Math.PI * 2,
      flap: 4.0 + Math.random() * 2.5,
      wl, wr,
    };
    birdGroup.add(b);
    birds.push(b);
  }
  scene.add(birdGroup);

  // ---- update ---------------------------------------------------------------------
  function update(t, dt) {
    uniforms.uTime.value = t;
    for (const s of cloudSprites) {
      s.position.x += s.userData.drift * dt;
      if (s.position.x > 380) s.position.x = -380;
      s.position.y = s.userData.baseY + Math.sin(t * 0.1 + s.userData.phase) * 1.6;
    }
    for (const b of birds) {
      const u = b.userData;
      const a = t * u.speed + u.phase;
      b.position.set(
        Math.cos(a) * u.radius,
        u.height + Math.sin(t * 0.4 + u.phase) * 2.5,
        6 - 30 + Math.sin(a) * u.radius,
      );
      b.rotation.y = -a - Math.PI / 2;
      // glide-flap cycle: bursts of flapping, then soaring
      const cycle = 0.5 + 0.5 * Math.sin(t * 0.35 + u.phase * 2.0);
      const flap = Math.sin(t * u.flap + u.phase) * (0.15 + 0.55 * cycle);
      u.wl.rotation.z = -flap - 0.12;
      u.wr.rotation.z = flap + 0.12;
    }
  }

  return { scene, update, standH, SUN_DIR, FOG_COLOR };
}
