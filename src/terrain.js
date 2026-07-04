import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Deterministic 2D value noise (CPU) — heightfields & placement
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

const NOISE_GLSL = /* glsl */ `
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
`;

// ---------------------------------------------------------------------------
// Location presets — each destination is a lighting + terrain + life recipe
// ---------------------------------------------------------------------------

// Trans-Ili Alatau: alpine ridge at sunrise above a cloud-filled valley
function heightTransIli(x, z) {
  const base = N.fbm(x * 0.012, z * 0.012) * 10 - 4;
  const local = N.ridged(x * 0.03 + 3, z * 0.03) * 5;
  const wallMask = smoothstep(-70, -300, z);
  const wall = Math.pow(N.ridged(x * 0.0045 + 11, z * 0.0045 + 4), 1.7) * 235 * wallMask;
  const sideMask = smoothstep(120, 320, Math.abs(x));
  const side = Math.pow(N.ridged(x * 0.005 + 23, z * 0.005 + 9), 1.6) * 150 * sideMask;
  const valley = -26 * Math.exp(-((z + 130) ** 2) / (2 * 55 ** 2)) * (1 - sideMask);
  return base + local + wall + side + valley;
}

// Big Almaty Lake: turquoise cirque lake at ~2500m ringed by scree and spruce
const BAL_CENTER = { x: 0, z: -95 };
const BAL_RADIUS = 68;
function heightBigAlmaty(x, z) {
  const dx = x - BAL_CENTER.x, dz = z - BAL_CENTER.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const base = N.fbm(x * 0.02 + 9, z * 0.02) * 4;
  const bowl = smoothstep(BAL_RADIUS + 8, 320, d);
  const slopes = Math.pow(N.ridged(x * 0.006 + 41, z * 0.006 + 17), 1.6) * 215 * bowl;
  // the wall of peaks across the water (south — Sovetov side)
  const southMask = smoothstep(-150, -400, z);
  const south = Math.pow(N.ridged(x * 0.005 + 5, z * 0.005 + 31), 1.7) * 130 * southMask;
  const lakebed = -9 * smoothstep(BAL_RADIUS + 4, BAL_RADIUS * 0.4, d);
  return base + bowl * 3 + slopes + south + lakebed;
}

const PRESETS = {
  'trans-ili-alatau': {
    name: 'Trans-Ili Alatau',
    heightFn: heightTransIli,
    sunDir: [-0.62, 0.26, -0.55],
    fog: { color: [0.52, 0.40, 0.36], density: 0.00082 },
    sky: { zenith: [0.045, 0.085, 0.22], horizon: [0.72, 0.38, 0.20], bloom: 0.7, halo: 3.0 },
    sun: { color: [1.0, 0.58, 0.32], power: 2.4 },
    ambient: [0.15, 0.19, 0.29],
    palette: {
      grassA: [0.16, 0.24, 0.10], grassB: [0.30, 0.34, 0.14],
      rockA: [0.20, 0.17, 0.15], rockB: [0.34, 0.30, 0.27],
      snowLine: 48, alpenglow: 0.55,
    },
    grass: { count: 14000, minR: 6, maxR: 86, maxH: 55, cz: 6 },
    flowers: { count: 500, minR: 8, maxR: 53, maxH: 45, cz: 6 },
    spruce: null,
    water: null,
    clouds: { count: 42, y: [-28, -16], zRange: [-95, -315], xSpread: 800, opacity: [0.22, 0.38] },
    stand: { x: 0, z: 6, eye: 2.7 },
    lookRest: [-40, 55, -280],
    entryPos: [-14, 46, 96],
    entryLook: [0, 10, -60],
    birds: { height: [30, 60], radius: [35, 85], cz: -24 },
    beacons: [{ to: 'big-almaty-lake', name: 'Big Almaty Lake', x: -38, z: -150, h: 58 }],
  },

  'big-almaty-lake': {
    name: 'Big Almaty Lake',
    heightFn: heightBigAlmaty,
    sunDir: [-0.42, 0.40, -0.62],
    fog: { color: [0.58, 0.56, 0.55], density: 0.00060 },
    sky: { zenith: [0.055, 0.13, 0.34], horizon: [0.62, 0.52, 0.38], bloom: 0.3, halo: 2.6 },
    sun: { color: [1.0, 0.82, 0.55], power: 2.3 },
    ambient: [0.16, 0.21, 0.30],
    palette: {
      grassA: [0.085, 0.125, 0.055], grassB: [0.155, 0.185, 0.075],
      rockA: [0.22, 0.20, 0.185], rockB: [0.36, 0.33, 0.30],
      snowLine: 105, alpenglow: 0.25,
    },
    grass: { count: 5000, minR: 7, maxR: 46, maxH: 22, cz: -14 },
    flowers: { count: 160, minR: 6, maxR: 34, maxH: 18, cz: -14 },
    spruce: {
      count: 900, minD: BAL_RADIUS + 14, maxD: 260,
      minH: 4, maxH: 85,
      colorA: [0.010, 0.026, 0.014], colorB: [0.022, 0.052, 0.024],
    },
    water: {
      center: BAL_CENTER, radius: BAL_RADIUS + 6, level: 0.4,
      deep: [0.010, 0.115, 0.130], shallow: [0.045, 0.330, 0.310],
      sky: [0.55, 0.68, 0.78],
    },
    clouds: { count: 16, y: [95, 150], zRange: [-160, -380], xSpread: 700, opacity: [0.14, 0.24] },
    stand: { x: 0, z: -14, eye: 2.4 },
    lookRest: [-18, 34, -300],
    entryPos: [0, 130, 80],
    entryLook: [0, 0, -95],
    birds: { height: [22, 40], radius: [30, 60], cz: -95 },
    beacons: [{ to: 'trans-ili-alatau', name: 'Trans-Ili Alatau', x: 38, z: -160, h: 58 }],
  },
};

// ---------------------------------------------------------------------------
export function createTerrainScene(id) {
  const P = PRESETS[id];
  if (!P) throw new Error(`unknown location preset: ${id}`);
  const H = P.heightFn;
  const scene = new THREE.Scene();

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(...P.sunDir).normalize() },
    uSunCol: { value: new THREE.Color(...P.sun.color).multiplyScalar(P.sun.power) },
    uAmbient: { value: new THREE.Color(...P.ambient) },
    uFogColor: { value: new THREE.Color(...P.fog.color) },
    uFogDensity: { value: P.fog.density },
    uZenith: { value: new THREE.Color(...P.sky.zenith) },
    uHorizon: { value: new THREE.Color(...P.sky.horizon) },
    uSkyBloom: { value: P.sky.bloom },
    uSkyHalo: { value: P.sky.halo },
    uGrassA: { value: new THREE.Color(...P.palette.grassA) },
    uGrassB: { value: new THREE.Color(...P.palette.grassB) },
    uRockA: { value: new THREE.Color(...P.palette.rockA) },
    uRockB: { value: new THREE.Color(...P.palette.rockB) },
    uSnowLine: { value: P.palette.snowLine },
    uAlpenglow: { value: P.palette.alpenglow },
  };

  // ---- sky dome -------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = (projectionMatrix * mv).xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uZenith, uHorizon;
      uniform float uSkyBloom, uSkyHalo;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.05, 1.0);
        vec3 sky = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.48));
        float sunAmt = max(dot(d, uSunDir), 0.0);
        sky += vec3(1.0, 0.60, 0.30) * pow(sunAmt, 5.0) * uSkyBloom;
        sky += vec3(1.0, 0.85, 0.6) * pow(sunAmt, 80.0) * uSkyHalo;
        sky += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, sunAmt) * 8.0;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 20), skyMat));

  // ---- terrain ----------------------------------------------------------------
  const SIZE = 1600, SEGS = 400, CENTER_Z = -260;
  const tGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS);
  tGeo.rotateX(-Math.PI / 2);
  tGeo.translate(0, 0, CENTER_Z);
  {
    const pos = tGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, H(pos.getX(i), pos.getZ(i)));
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
      uniform vec3 uSunDir, uSunCol, uAmbient, uFogColor;
      uniform vec3 uGrassA, uGrassB, uRockA, uRockB;
      uniform float uTime, uFogDensity, uSnowLine, uAlpenglow;
      varying vec3 vNormal;
      varying vec3 vWorld;
      ${NOISE_GLSL}

      void main() {
        vec3 n = normalize(vNormal);
        float dist = length(vWorld - cameraPosition);

        // fine bump from noise gradients — melts the faceted mesh look
        float bumpScale = 0.14;
        float be = 1.2;
        float bump = exp(-dist * 0.0016) * 2.2;
        float hL = fbm((vWorld.xz - vec2(be, 0.0)) * bumpScale);
        float hR = fbm((vWorld.xz + vec2(be, 0.0)) * bumpScale);
        float hD = fbm((vWorld.xz - vec2(0.0, be)) * bumpScale);
        float hU = fbm((vWorld.xz + vec2(0.0, be)) * bumpScale);
        n = normalize(n + vec3((hL - hR) * bump, 0.0, (hD - hU) * bump));

        float slope = 1.0 - n.y;
        float h = vWorld.y;
        float detail = fbm(vWorld.xz * 0.06);

        vec3 grass = mix(uGrassA, uGrassB, detail);
        vec3 rock  = mix(uRockA, uRockB, detail);
        vec3 snow  = vec3(0.93, 0.95, 1.0);

        float snowLine = uSnowLine + detail * 24.0;
        float snowAmt = smoothstep(snowLine, snowLine + 16.0, h) * smoothstep(0.85, 0.3, slope);
        float rockAmt = smoothstep(0.25, 0.55, slope) + smoothstep(35.0, 90.0, h) * 0.5;

        vec3 albedo = mix(grass, rock, clamp(rockAmt, 0.0, 1.0));
        albedo = mix(albedo, snow, snowAmt);

        float ndl = max(dot(n, uSunDir), 0.0);
        vec3 col = albedo * (uSunCol * ndl + uAmbient * (0.45 + 0.55 * n.y));

        // alpenglow on sunlit snow
        col += snow * snowAmt * vec3(1.0, 0.45, 0.25) * pow(ndl, 2.0) * uAlpenglow;

        // travelling cloud shadows
        float shadow = 0.72 + 0.28 * smoothstep(0.35, 0.65,
          fbm(vWorld.xz * 0.004 + vec2(uTime * 0.013, uTime * 0.006)));
        col *= shadow;

        // aerial perspective
        float fogAmt = 1.0 - exp(-dist * uFogDensity);
        float heightFog = smoothstep(20.0, -30.0, h) * 0.35;
        col = mix(col, uFogColor, clamp(fogAmt + heightFog * fogAmt, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(tGeo, terrMat));

  const standH = H(P.stand.x, P.stand.z);

  // ---- water (Big Almaty Lake's turquoise mirror) -----------------------------
  if (P.water) {
    const W = P.water;
    const wGeo = new THREE.CircleGeometry(W.radius, 72);
    wGeo.rotateX(-Math.PI / 2);
    wGeo.translate(W.center.x, W.level, W.center.z);
    const wUniforms = {
      uTime: uniforms.uTime,
      uSunDir: uniforms.uSunDir,
      uDeep: { value: new THREE.Color(...W.deep) },
      uShallow: { value: new THREE.Color(...W.shallow) },
      uSkyRef: { value: new THREE.Color(...W.sky) },
      uCenter: { value: new THREE.Vector2(W.center.x, W.center.z) },
      uRadius: { value: W.radius },
    };
    const wMat = new THREE.ShaderMaterial({
      uniforms: wUniforms,
      transparent: true,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uRadius;
        uniform vec3 uSunDir, uDeep, uShallow, uSkyRef;
        uniform vec2 uCenter;
        varying vec3 vWorld;
        ${NOISE_GLSL}
        void main() {
          vec2 p = vWorld.xz * 0.22;
          // rippled micro-normal from two scrolling noise fields
          float e = 0.11;
          float n1 = fbm(p + vec2(uTime * 0.045, uTime * 0.028));
          float nx = fbm(p + vec2(e, 0.0) + vec2(uTime * 0.045, uTime * 0.028)) - n1;
          float nz = fbm(p + vec2(0.0, e) + vec2(uTime * 0.045, uTime * 0.028)) - n1;
          vec3 n = normalize(vec3(nx * 2.4, 1.0, nz * 2.4));

          float dC = distance(vWorld.xz, uCenter);
          float shore = smoothstep(uRadius, uRadius * 0.45, dC); // 1 deep, 0 rim
          vec3 water = mix(uShallow, uDeep, shore);

          vec3 view = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(view, n), 0.0), 2.4);
          vec3 col = mix(water, uSkyRef, fres * 0.62);

          // sun glitter — sharp, sparkling
          vec3 refl = reflect(-view, n);
          float g = pow(max(dot(refl, uSunDir), 0.0), 480.0);
          float sparkle = 0.5 + 0.5 * vnoise(vWorld.xz * 9.0 + uTime * 1.7);
          col += vec3(1.0, 0.92, 0.75) * g * 3.2 * sparkle;

          // soft breathing shore line
          float rim = smoothstep(uRadius * 0.985, uRadius * 0.93, dC)
                    - smoothstep(uRadius * 0.93, uRadius * 0.80, dC);
          col += vec3(0.4, 0.55, 0.55) * max(rim, 0.0)
               * (0.10 + 0.08 * sin(uTime * 0.9 + dC * 0.8));

          gl_FragColor = vec4(col, 0.96);
        }
      `,
    });
    scene.add(new THREE.Mesh(wGeo, wMat));
  }

  // ---- instanced vegetation helpers -------------------------------------------
  function scatter(count, opts, accept) {
    const out = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const a = Math.random() * Math.PI * 2;
      const r = opts.minR + Math.pow(Math.random(), 0.65) * (opts.maxR - opts.minR);
      const x = opts.cx + Math.cos(a) * r;
      const z = opts.cz + Math.sin(a) * r;
      const h = H(x, z);
      if (accept(x, z, h)) out.push([x, h, z]);
    }
    return out;
  }

  // grass
  {
    const G = P.grass;
    const blade = new THREE.PlaneGeometry(0.09, 0.9, 1, 3);
    blade.translate(0, 0.45, 0);
    const pts = scatter(G.count, { minR: G.minR, maxR: G.maxR, cx: 0, cz: G.cz },
      (x, z, h) => h < G.maxH && h > (P.water ? P.water.level + 0.6 : standH - 22));
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = blade.index;
    geo.attributes.position = blade.attributes.position;
    geo.attributes.uv = blade.attributes.uv;
    const off = new Float32Array(pts.length * 3);
    const dat = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      off.set(p, i * 3);
      dat[i * 3] = Math.random() * Math.PI * 2;
      dat[i * 3 + 1] = 0.55 + Math.random() * 0.6;
      dat[i * 3 + 2] = Math.random();
    });
    geo.instanceCount = pts.length;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(dat, 3));
    const mat = new THREE.ShaderMaterial({
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
          float tip = uv.y * uv.y;
          float gust = sin(uTime * 1.1 + aOffset.x * 0.08 + aOffset.z * 0.06)
                     + 0.5 * sin(uTime * 2.3 + aOffset.z * 0.15);
          p.x += tip * gust * 0.22 * scl;
          p.z += tip * gust * 0.13 * scl;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p + aOffset, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor, uGrassA, uGrassB;
        varying vec2 vUv;
        varying float vShade;
        void main() {
          vec3 base = mix(uGrassA * 0.22, uGrassB * 0.6, vUv.y);
          base *= 0.75 + 0.5 * vShade;
          base += vec3(0.45, 0.25, 0.10) * vUv.y * 0.18;
          gl_FragColor = vec4(mix(base, uFogColor, 0.06), 1.0);
        }
      `,
    });
    const grass = new THREE.Mesh(geo, mat);
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // wildflowers
  {
    const F = P.flowers;
    const fBase = new THREE.PlaneGeometry(0.15, 0.15);
    fBase.translate(0, 0.42, 0);
    const pts = scatter(F.count, { minR: F.minR, maxR: F.maxR, cx: 0, cz: F.cz },
      (x, z, h) => h < F.maxH && h > (P.water ? P.water.level + 0.6 : standH - 15));
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = fBase.index;
    geo.attributes.position = fBase.attributes.position;
    geo.attributes.uv = fBase.attributes.uv;
    const off = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const palette = [
      [0.95, 0.85, 0.35], [0.90, 0.90, 0.95], [0.75, 0.45, 0.85], [0.95, 0.40, 0.35],
    ];
    pts.forEach((p, i) => {
      off[i * 3] = p[0]; off[i * 3 + 1] = p[1] + 0.35; off[i * 3 + 2] = p[2];
      const c = palette[Math.floor(Math.random() * palette.length)];
      col.set(c, i * 3);
    });
    geo.instanceCount = pts.length;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
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
    const flowers = new THREE.Mesh(geo, mat);
    flowers.frustumCulled = false;
    scene.add(flowers);
  }

  // Tian Shan spruce — narrow dark spires on the slopes
  if (P.spruce) {
    const S = P.spruce;
    const cone = new THREE.ConeGeometry(1, 1, 6, 3);
    cone.translate(0, 0.5, 0);
    const pts = [];
    let guard = 0;
    while (pts.length < S.count && guard++ < S.count * 50) {
      const a = Math.random() * Math.PI * 2;
      const d = S.minD + Math.random() * (S.maxD - S.minD);
      const x = BAL_CENTER.x + Math.cos(a) * d;
      const z = BAL_CENTER.z + Math.sin(a) * d;
      const h = H(x, z);
      if (h < S.minH || h > S.maxH) continue;
      // spruce prefers the gentler aprons, not sheer scree
      const g = (H(x + 3, z) - h) ** 2 + (H(x, z + 3) - h) ** 2;
      if (g > 20) continue;
      pts.push([x, h - 0.3, z]);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = cone.index;
    geo.attributes.position = cone.attributes.position;
    geo.attributes.uv = cone.attributes.uv;
    const off = new Float32Array(pts.length * 3);
    const dat = new Float32Array(pts.length * 3); // widthScale, heightScale, shade
    pts.forEach((p, i) => {
      off.set(p, i * 3);
      const ht = 4.5 + Math.random() * 6.5;
      dat[i * 3] = ht * 0.16 + Math.random() * 0.3;
      dat[i * 3 + 1] = ht;
      dat[i * 3 + 2] = Math.random();
    });
    geo.instanceCount = pts.length;
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(dat, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...uniforms,
        uSpruceA: { value: new THREE.Color(...S.colorA) },
        uSpruceB: { value: new THREE.Color(...S.colorB) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aData;
        uniform float uTime;
        varying float vShade;
        varying float vY;
        varying vec3 vWorld;
        void main() {
          vShade = aData.z;
          vY = position.y;
          vec3 p = position;
          p.xz *= aData.x;
          p.y *= aData.y;
          // treetops sway barely — old, stiff trees
          p.x += sin(uTime * 1.3 + aOffset.x) * position.y * position.y * 0.05;
          vWorld = p + aOffset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSpruceA, uSpruceB, uFogColor;
        uniform float uFogDensity;
        varying float vShade;
        varying float vY;
        varying vec3 vWorld;
        void main() {
          vec3 col = mix(uSpruceA, uSpruceB, vShade * 0.7 + vY * 0.3);
          float dist = length(vWorld - cameraPosition);
          float fogAmt = 1.0 - exp(-dist * uFogDensity * 1.15);
          gl_FragColor = vec4(mix(col, uFogColor, fogAmt), 1.0);
        }
      `,
    });
    const spruce = new THREE.Mesh(geo, mat);
    spruce.frustumCulled = false;
    scene.add(spruce);
  }

  // ---- clouds -------------------------------------------------------------------
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
  const cloudSprites = [];
  {
    const C = P.clouds;
    for (let i = 0; i < C.count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: C.opacity[0] + Math.random() * (C.opacity[1] - C.opacity[0]),
        depthWrite: false,
        color: new THREE.Color(0.92, 0.82 + Math.random() * 0.05, 0.76),
      });
      const s = new THREE.Sprite(mat);
      const x = (Math.random() - 0.5) * C.xSpread;
      const z = C.zRange[0] + Math.random() * (C.zRange[1] - C.zRange[0]);
      s.position.set(x, C.y[0] + Math.random() * (C.y[1] - C.y[0]), z);
      const sc = 70 + Math.random() * 130;
      s.scale.set(sc, sc * 0.3, 1);
      s.userData = { drift: 0.6 + Math.random() * 1.2, phase: Math.random() * 100, baseY: s.position.y };
      scene.add(s);
      cloudSprites.push(s);
    }
  }

  // ---- dust motes -----------------------------------------------------------------
  {
    const DUST = 420;
    const dPos = new Float32Array(DUST * 3);
    const dPhase = new Float32Array(DUST);
    for (let i = 0; i < DUST; i++) {
      dPos[i * 3] = (Math.random() - 0.5) * 46;
      dPos[i * 3 + 1] = standH + 0.5 + Math.random() * 7;
      dPos[i * 3 + 2] = P.stand.z + (Math.random() - 0.5) * 46;
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
          gl_PointSize = clamp((2.2 + vSpark * 3.5) * (120.0 / -mv.z), 0.5, 2.6);
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
  }

  // ---- birds ---------------------------------------------------------------------
  const birds = [];
  {
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
      b.scale.setScalar(0.8 + Math.random() * 0.5);
      b.userData = {
        radius: P.birds.radius[0] + Math.random() * (P.birds.radius[1] - P.birds.radius[0]),
        height: standH + P.birds.height[0] + Math.random() * (P.birds.height[1] - P.birds.height[0]),
        speed: 0.08 + Math.random() * 0.08,
        phase: Math.random() * Math.PI * 2,
        flap: 4.0 + Math.random() * 2.5,
        wl, wr,
      };
      scene.add(b);
      birds.push(b);
    }
  }

  // ---- discovery beacons: faint pillars of light on the horizon ---------------------
  const beacons = [];
  for (const B of P.beacons || []) {
    const groundY = H(B.x, B.z);
    const group = new THREE.Group();

    const pillarGeo = new THREE.CylinderGeometry(1.7, 2.4, B.h, 16, 1, true);
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uH: { value: B.h } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uH;
        varying float vH;
        varying vec2 vUv;
        varying float vEdge;
        void main() {
          vH = position.y / uH + 0.5;
          vUv = uv;
          vec3 wN = normalize(mat3(modelMatrix) * normal);
          vec3 wP = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 view = normalize(cameraPosition - wP);
          vEdge = abs(dot(wN, view)); // 1 facing camera, 0 at silhouette
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vH;
        varying vec2 vUv;
        varying float vEdge;
        ${NOISE_GLSL}
        void main() {
          float fade = pow(1.0 - vH, 1.7) * smoothstep(0.0, 0.06, vH);
          float streaks = 0.35 + 0.65 * vnoise(vec2(vUv.x * 9.0, vH * 5.0 - uTime * 0.35));
          float pulse = 0.65 + 0.35 * sin(uTime * 1.15);
          float soft = pow(vEdge, 1.6); // gaseous, no hard cylinder rim
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.55), fade * streaks * pulse * soft * 0.28);
        }
      `,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(B.x, groundY + B.h / 2, B.z);
    group.add(pillar);

    const glowMat = new THREE.SpriteMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(1.0, 0.8, 0.45),
      opacity: 0.55,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(B.x, groundY + 3.5, B.z);
    glow.scale.set(16, 10, 1);
    group.add(glow);

    // slow-rising embers inside the pillar
    const EMBERS = 26;
    const ePos = new Float32Array(EMBERS * 3);
    const ePhase = new Float32Array(EMBERS);
    for (let i = 0; i < EMBERS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6;
      ePos[i * 3] = B.x + Math.cos(a) * r;
      ePos[i * 3 + 1] = groundY;
      ePos[i * 3 + 2] = B.z + Math.sin(a) * r;
      ePhase[i] = Math.random();
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('aPhase', new THREE.BufferAttribute(ePhase, 1));
    const eMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uH: { value: B.h } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime, uH;
        varying float vLife;
        void main() {
          float cycle = fract(uTime * 0.04 + aPhase);
          vLife = 1.0 - cycle;
          vec3 p = position;
          p.y += cycle * uH * 0.85;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(vLife * 3.2 * (160.0 / -mv.z), 0.5, 4.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        void main() {
          float d = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vec3(1.0, 0.88, 0.6), d * vLife * 0.7);
        }
      `,
    });
    const embers = new THREE.Points(eGeo, eMat);
    embers.frustumCulled = false;
    group.add(embers);

    const hit = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, B.h * 1.15, 8),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.position.set(B.x, groundY + B.h * 0.5, B.z);
    group.add(hit);

    scene.add(group);
    beacons.push({ to: B.to, name: B.name, hit });
  }

  // ---- update ---------------------------------------------------------------------
  function update(t, dt) {
    uniforms.uTime.value = t;
    for (const s of cloudSprites) {
      s.position.x += s.userData.drift * dt;
      if (s.position.x > 420) s.position.x = -420;
      s.position.y = s.userData.baseY + Math.sin(t * 0.1 + s.userData.phase) * 1.6;
    }
    for (const b of birds) {
      const u = b.userData;
      const a = t * u.speed + u.phase;
      b.position.set(
        Math.cos(a) * u.radius,
        u.height + Math.sin(t * 0.4 + u.phase) * 2.5,
        P.birds.cz + Math.sin(a) * u.radius,
      );
      b.rotation.y = -a - Math.PI / 2;
      const cycle = 0.5 + 0.5 * Math.sin(t * 0.35 + u.phase * 2.0);
      const flap = Math.sin(t * u.flap + u.phase) * (0.15 + 0.55 * cycle);
      u.wl.rotation.z = -flap - 0.12;
      u.wr.rotation.z = flap + 0.12;
    }
  }

  const anchors = {
    stand: new THREE.Vector3(P.stand.x, standH + P.stand.eye, P.stand.z),
    lookRest: new THREE.Vector3(P.lookRest[0], standH + P.lookRest[1], P.lookRest[2]),
    entryPos: new THREE.Vector3(P.entryPos[0], standH + P.entryPos[1], P.entryPos[2]),
    entryLook: new THREE.Vector3(P.entryLook[0], standH + P.entryLook[1], P.entryLook[2]),
  };

  return { id, name: P.name, scene, update, anchors, beacons, hasWater: !!P.water };
}
