import { kazakhstanRing } from './geo.js';
import { LOCATIONS, loadDiscovered } from './locations.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createUI(geo, { implemented = new Set(), onTravel = () => {} } = {}) {
  const title = document.getElementById('title');
  const hud = document.getElementById('hud');
  const atlasEl = document.getElementById('atlas');
  const soundHint = document.getElementById('sound-hint');
  const tip = document.getElementById('atlas-tip');

  // ---- project the real border into SVG space ------------------------------
  const ring = kazakhstanRing(geo.kazakhstanFeature);
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180); // de-stretch equirect
  const W = 1000;
  const scale = W / ((maxLon - minLon) * kx);
  const H = (maxLat - minLat) * scale;
  const PAD = 70;
  const px = (lon) => (lon - minLon) * kx * scale + PAD;
  const py = (lat) => (maxLat - lat) * scale + PAD;

  const svg = document.getElementById('atlas-map');
  svg.setAttribute('viewBox', `0 0 ${W + PAD * 2} ${H + PAD * 2}`);

  svg.innerHTML = `
    <defs>
      <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="6" result="b"/>
        <feMerge>
          <feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="softglow" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge>
          <feMergeNode in="b"/><feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <style>
      .border { fill: rgba(232,196,122,0.03); stroke: rgba(232,196,122,0.35); stroke-width: 1.2; }
      .route { stroke: rgba(232,196,122,0.7); stroke-width: 1.5; fill: none;
               stroke-dasharray: 3 5; animation: routeflow 3s linear infinite; }
      @keyframes routeflow { to { stroke-dashoffset: -16; } }
      .star { fill: #f5dfa8; }
      .star-pulse { animation: pulse 3.2s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
      @keyframes pulse { 0%,100% { opacity: 0.85; } 50% { opacity: 1; } }
      .seed { fill: rgba(200, 210, 235, 0.22); }
      .lbl { fill: rgba(243,236,220,0.9); font-size: 15px; letter-spacing: 2.5px;
             font-family: inherit; text-transform: uppercase; }
    </style>
  `;

  // border path
  const d = ring.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join('') + 'Z';
  const border = document.createElementNS(SVG_NS, 'path');
  border.setAttribute('d', d);
  border.setAttribute('class', 'border');
  border.setAttribute('filter', 'url(#softglow)');
  svg.appendChild(border);

  const routeLayer = document.createElementNS(SVG_NS, 'g');
  const nodeLayer = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(routeLayer);
  svg.appendChild(nodeLayer);

  function renderConstellation() {
    const discovered = loadDiscovered();
    routeLayer.innerHTML = '';
    nodeLayer.innerHTML = '';

    // glowing routes between discoveries, in the order they were made
    for (let i = 1; i < discovered.length; i++) {
      const a = LOCATIONS.find((l) => l.id === discovered[i - 1]);
      const b = LOCATIONS.find((l) => l.id === discovered[i]);
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', px(a.lon)); line.setAttribute('y1', py(a.lat));
      line.setAttribute('x2', px(b.lon)); line.setAttribute('y2', py(b.lat));
      line.setAttribute('class', 'route');
      line.setAttribute('filter', 'url(#softglow)');
      routeLayer.appendChild(line);
    }

    for (const loc of LOCATIONS) {
      const found = discovered.includes(loc.id);
      const g = document.createElementNS(SVG_NS, 'g');
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', px(loc.lon));
      dot.setAttribute('cy', py(loc.lat));
      if (found) {
        dot.setAttribute('r', 7);
        dot.setAttribute('class', 'star star-pulse');
        dot.setAttribute('filter', 'url(#glow)');
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', px(loc.lon) + 16);
        label.setAttribute('y', py(loc.lat) + 5);
        label.setAttribute('class', 'lbl');
        label.textContent = loc.name;
        g.appendChild(label);
      } else {
        dot.setAttribute('r', 2.6);
        dot.setAttribute('class', 'seed');
      }
      g.appendChild(dot);
      const canGo = implemented.has(loc.id);
      g.style.cursor = canGo ? 'pointer' : 'default';
      if (canGo) {
        g.addEventListener('click', () => {
          atlasEl.classList.remove('visible');
          tip.style.opacity = '0';
          onTravel(loc.id);
        });
      }
      g.addEventListener('pointerenter', (e) => {
        tip.textContent = found ? loc.name
          : canGo ? 'A faint light... journey there?' : 'Undiscovered';
        tip.style.opacity = '1';
        tip.style.left = `${e.clientX + 16}px`;
        tip.style.top = `${e.clientY - 12}px`;
      });
      g.addEventListener('pointermove', (e) => {
        tip.style.left = `${e.clientX + 16}px`;
        tip.style.top = `${e.clientY - 12}px`;
      });
      g.addEventListener('pointerleave', () => { tip.style.opacity = '0'; });
      nodeLayer.appendChild(g);
    }

    document.getElementById('atlas-footer').textContent =
      `${discovered.length} of ${LOCATIONS.length} places discovered`;
  }

  // ---- wiring ----------------------------------------------------------------
  document.getElementById('hud-explore').addEventListener('click', () => {
    renderConstellation();
    atlasEl.classList.add('visible');
  });
  document.getElementById('atlas-close').addEventListener('click', () => {
    atlasEl.classList.remove('visible');
    tip.style.opacity = '0';
  });

  return {
    /** Called every frame with the director's params. */
    apply(params, audioStarted, elapsed) {
      title.classList.toggle('visible', params.title);
      hud.classList.toggle('visible', params.ui && !atlasEl.classList.contains('visible'));
      soundHint.classList.toggle('visible', !audioStarted && elapsed > 4);
    },
    setRegion(name) {
      document.getElementById('hud-region').textContent = name;
    },
    /** Mystical hover label for in-scene discovery beacons. */
    showBeaconTip(beacon, x, y) {
      if (!beacon) { tip.style.opacity = '0'; return; }
      tip.textContent = `${beacon.name} — journey there`;
      tip.style.opacity = '1';
      tip.style.left = `${x + 18}px`;
      tip.style.top = `${y - 14}px`;
    },
  };
}
