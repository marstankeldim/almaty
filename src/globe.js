import * as THREE from 'three';
import { lonLatToVec3 } from './geo.js';

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1, 0));
    float c = hash21(i + vec2(0, 1));
    float d = hash21(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 17.7;
      a *= 0.5;
    }
    return v;
  }
`;

// object-space normal -> equirect uv (matches geo.js canvas projection)
const UV_GLSL = /* glsl */ `
  vec2 sphereUv(vec3 n) {
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(-n.z, n.x);
    return vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);
  }
`;

export function createGlobe(geo) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);

  const maskTex = new THREE.CanvasTexture(geo.canvas);
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.wrapS = THREE.RepeatWrapping;

  const sunDir = new THREE.Vector3(1.0, 0.18, 0.62).normalize();

  const uniforms = {
    uMask:     { value: maskTex },
    uSunDir:   { value: sunDir.clone() },
    uTime:     { value: 0 },
    uIsolate:  { value: 0 },   // 0 = whole world, 1 = only Kazakhstan lit
    uAwaken:   { value: 0 },   // energy spreading through Kazakhstan
    uKzSeed:   { value: new THREE.Vector2(0.7136, 0.7403) }, // Almaty in uv
    uCloudBoost: { value: 0 },
  };

  // ---- surface -------------------------------------------------------------
  const surfMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vObjNormal;
      varying vec3 vWorldNormal;
      void main() {
        vObjNormal = normalize(position);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMask;
      uniform vec3 uSunDir;
      uniform float uTime, uIsolate, uAwaken;
      uniform vec2 uKzSeed;
      varying vec3 vObjNormal;
      varying vec3 vWorldNormal;
      ${NOISE_GLSL}
      ${UV_GLSL}

      void main() {
        vec2 uv = sphereUv(normalize(vObjNormal));
        vec4 mask = texture2D(uMask, uv);
        float land = mask.r;
        float kz = mask.g;
        float lights = mask.b;

        float ndl = dot(normalize(vWorldNormal), uSunDir);
        float day = smoothstep(-0.08, 0.25, ndl);
        float dusk = smoothstep(-0.18, 0.05, ndl) * (1.0 - day);

        // day palette: near-black ocean, muted land
        vec3 ocean = vec3(0.012, 0.028, 0.055) * (0.25 + 0.75 * day);
        // faint sun glint on the water
        ocean += vec3(0.10, 0.09, 0.07) * pow(max(ndl, 0.0), 8.0);
        vec3 landCol = mix(vec3(0.075, 0.085, 0.058), vec3(0.21, 0.19, 0.13),
                           fbm(uv * 26.0));
        landCol *= day;
        landCol += vec3(0.28, 0.12, 0.04) * dusk * 0.6; // terminator warmth

        vec3 col = mix(ocean, landCol, land);

        // night: city lights
        float night = 1.0 - smoothstep(-0.12, 0.12, ndl);
        float flicker = 0.85 + 0.15 * vnoise(uv * 900.0 + uTime * 0.15);
        vec3 cityGlow = vec3(1.0, 0.72, 0.42) * lights * night * flicker * 1.6;

        // isolation: the rest of the world sinks into darkness
        float keep = mix(1.0, kz, uIsolate);
        col *= mix(1.0, 0.008, uIsolate * (1.0 - kz));
        cityGlow *= mix(1.0, kz * 1.2 + 0.003, uIsolate);
        col += cityGlow;

        // ---- Kazakhstan awakens ------------------------------------------
        if (uAwaken > 0.001) {
          vec2 d2 = (uv - uKzSeed) * vec2(2.0, 1.0);
          float dist = length(d2);
          float front = uAwaken * 0.24;
          float spread = smoothstep(front, front - 0.10, dist);
          // energy veins flowing under the surface
          float veins = fbm(uv * 90.0 + vec2(uTime * 0.05, 0.0));
          veins = pow(veins, 3.0) * 3.0;
          // inner terrain shimmer: ranges, lakes, deserts emerging
          float terrain = fbm(uv * 160.0);
          vec3 terrCol = mix(vec3(0.10, 0.30, 0.34),   // lakes / rivers
                             vec3(0.95, 0.80, 0.50),   // ranges catching light
                             smoothstep(0.35, 0.75, terrain));
          float pulse = 0.85 + 0.15 * sin(uTime * 1.7 + dist * 30.0);
          col += kz * spread * (terrCol * 0.34 + vec3(1.0, 0.85, 0.5) * veins * 0.22) * pulse;

          // border: soft light bleeding at the mask's edge
          float e = 0.0015;
          float gx = texture2D(uMask, uv + vec2(e, 0.0)).g - texture2D(uMask, uv - vec2(e, 0.0)).g;
          float gy = texture2D(uMask, uv + vec2(0.0, e)).g - texture2D(uMask, uv - vec2(0.0, e)).g;
          float edge = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
          col += vec3(1.0, 0.83, 0.5) * edge * spread * 0.8 * pulse;
        }

        col *= keep * 0.5 + 0.5; // never fully crush lit KZ pixels
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), surfMat);
  group.add(surface);

  // ---- clouds ---------------------------------------------------------------
  const cloudMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vObjNormal;
      varying vec3 vWorldNormal;
      void main() {
        vObjNormal = normalize(position);
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uTime, uIsolate, uCloudBoost;
      varying vec3 vObjNormal;
      varying vec3 vWorldNormal;
      ${NOISE_GLSL}
      ${UV_GLSL}
      void main() {
        vec3 on = normalize(vObjNormal);
        vec2 uv = sphereUv(on);
        float n = fbm(uv * vec2(9.0, 5.0) + vec2(uTime * 0.004, 0.0));
        n = smoothstep(0.52 - uCloudBoost * 0.18, 0.78, n);
        float ndl = dot(normalize(vWorldNormal), uSunDir);
        float lit = smoothstep(-0.05, 0.35, ndl);
        vec3 col = vec3(0.9, 0.88, 0.85) * (0.06 + 0.94 * lit);
        float a = n * (0.13 + 0.5 * lit + uCloudBoost * 0.3);
        a *= smoothstep(0.97, 0.8, abs(on.y)); // hide equirect pole pinch
        a *= mix(1.0, 0.06, uIsolate); // clouds recede when the world dims
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 72), cloudMat);
  group.add(clouds);

  // ---- atmosphere rim --------------------------------------------------------
  const atmoMat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform float uIsolate;
      varying vec3 vWorldNormal;
      varying vec3 vViewDir;
      void main() {
        float rim = pow(1.0 - abs(dot(vWorldNormal, vViewDir)), 3.2);
        float sun = 0.35 + 0.65 * smoothstep(-0.4, 0.6, dot(vWorldNormal, uSunDir));
        vec3 col = mix(vec3(0.18, 0.35, 0.65), vec3(0.55, 0.42, 0.30), 0.25) * rim * sun;
        gl_FragColor = vec4(col * (1.0 - uIsolate * 0.7), rim * sun);
      }
    `,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 72), atmoMat);
  group.add(atmo);

  // ---- drifting void particles (visible only in the opening dark) ------------
  const pCount = 320;
  const pPos = new Float32Array(pCount * 3);
  const pPhase = new Float32Array(pCount);
  for (let i = 0; i < pCount; i++) {
    pPos[i * 3 + 0] = (Math.random() - 0.5) * 10;
    pPos[i * 3 + 1] = (Math.random() - 0.5) * 6;
    pPos[i * 3 + 2] = 1.5 + Math.random() * 3.5; // between earth and camera
    pPhase[i] = Math.random() * Math.PI * 2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aPhase', new THREE.BufferAttribute(pPhase, 1));
  const pUniforms = { uTime: { value: 0 }, uOpacity: { value: 1 } };
  const pMat = new THREE.ShaderMaterial({
    uniforms: pUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.05 + aPhase) * 0.4 + uTime * 0.012;
        p.y += cos(uTime * 0.04 + aPhase * 1.7) * 0.25;
        p.x = mod(p.x + 5.0, 10.0) - 5.0;
        vTwinkle = 0.5 + 0.5 * sin(uTime * 0.8 + aPhase * 3.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.5 + vTwinkle * 2.0) * (300.0 / -mv.z) * 0.01;
        gl_PointSize = max(gl_PointSize, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = smoothstep(0.5, 0.0, length(c));
        gl_FragColor = vec4(vec3(0.75, 0.8, 0.9), d * vTwinkle * 0.5 * uOpacity);
      }
    `,
  });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  // ---- orientation helpers ----------------------------------------------------
  const KZ_CENTER = { lon: 66.9, lat: 48.2 };

  /** Quaternion that puts (lon,lat) at the sub-camera point (+Z), poles upright. */
  function facingQuaternion(lon, lat, extraYaw = 0) {
    const [x, y, z] = lonLatToVec3(lon, lat);
    const alpha = Math.atan2(-x, z) + extraYaw;
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alpha);
    const p = new THREE.Vector3(x, y, z).applyQuaternion(qy);
    const beta = Math.atan2(p.y, p.z);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), beta);
    return qx.multiply(qy);
  }

  const qStart = facingQuaternion(KZ_CENTER.lon, KZ_CENTER.lat, -2.4);
  const qEnd = facingQuaternion(KZ_CENTER.lon, KZ_CENTER.lat, 0);

  /** World position of a lon/lat point given the current group orientation. */
  function worldPoint(lon, lat, r = 1) {
    const [x, y, z] = lonLatToVec3(lon, lat, r);
    return new THREE.Vector3(x, y, z).applyQuaternion(group.quaternion);
  }

  function update(t, params) {
    uniforms.uTime.value = t;
    uniforms.uIsolate.value = params.isolate;
    uniforms.uAwaken.value = params.awaken;
    uniforms.uCloudBoost.value = params.cloudBoost;
    pUniforms.uTime.value = t;
    pUniforms.uOpacity.value = params.voidParticles;
    particles.visible = params.voidParticles > 0.01;
    group.quaternion.slerpQuaternions(qStart, qEnd, params.spin);
  }

  return { scene, group, update, worldPoint, sunDir, KZ_CENTER };
}
