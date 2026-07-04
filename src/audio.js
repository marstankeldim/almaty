/**
 * Fully procedural soundscape — no audio files.
 *  - wind: filtered noise, slowly wandering
 *  - rumble: sub-bass "heartbeat" pulse for the void/globe phases
 *  - pad: warm detuned drone that blooms at sunrise
 *  - birds: sparse chirps in the hero scene
 * Browsers require a user gesture before audio; start() is wired to the
 * first pointerdown and everything ramps in gently from silence.
 */
export function createSoundscape() {
  let ctx = null;
  let started = false;

  const nodes = {};
  // phase mix targets, eased every frame from the director
  const mix = { wind: 0.25, rumble: 1.0, pad: 0.0, birds: 0.0, water: 0.0, master: 1.0 };

  function noiseBuffer(seconds = 4) {
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * seconds, sr);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // pinkish noise via leaky integrator
      const white = Math.random() * 2 - 1;
      last = last * 0.98 + white * 0.02;
      d[i] = last * 6 + white * 0.15;
    }
    return buf;
  }

  function start() {
    if (started) return;
    started = true;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 4);
    nodes.master = master;

    // --- wind -------------------------------------------------------------
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuffer(6);
    windSrc.loop = true;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 480;
    windBp.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windBp).connect(windGain).connect(master);
    windSrc.start();
    // slow wander of the wind's voice
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 220;
    windLfo.connect(windLfoGain).connect(windBp.frequency);
    windLfo.start();
    nodes.windGain = windGain;

    // gusts: second noise layer, higher and breathier
    const gustSrc = ctx.createBufferSource();
    gustSrc.buffer = noiseBuffer(5);
    gustSrc.loop = true;
    const gustHp = ctx.createBiquadFilter();
    gustHp.type = 'highpass';
    gustHp.frequency.value = 1400;
    const gustGain = ctx.createGain();
    gustGain.gain.value = 0;
    gustSrc.connect(gustHp).connect(gustGain).connect(master);
    gustSrc.start();
    nodes.gustGain = gustGain;

    // --- heartbeat rumble ---------------------------------------------------
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sine';
    rumbleOsc.frequency.value = 46;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain).connect(master);
    rumbleOsc.start();
    nodes.rumbleGain = rumbleGain;
    nodes.rumbleBeat = 0;

    // --- sunrise pad --------------------------------------------------------
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.connect(master);
    const padFreqs = [110, 164.8, 220.4, 329.2];
    for (const f of padFreqs) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = ctx.createGain();
      g.gain.value = f > 200 ? 0.06 : 0.12;
      o.connect(g).connect(padGain);
      o.start();
    }
    nodes.padGain = padGain;
    nodes.birdTimer = 0;

    // --- lake water: soft irregular lapping --------------------------------
    const lapSrc = ctx.createBufferSource();
    lapSrc.buffer = noiseBuffer(5);
    lapSrc.loop = true;
    const lapLp = ctx.createBiquadFilter();
    lapLp.type = 'lowpass';
    lapLp.frequency.value = 520;
    lapLp.Q.value = 0.8;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0;
    lapSrc.connect(lapLp).connect(lapGain).connect(master);
    lapSrc.start();
    nodes.lapGain = lapGain;
  }

  function chirp() {
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.connect(g).connect(nodes.master);
    const base = 2100 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 3);
    let t = t0;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < notes; i++) {
      const dur = 0.06 + Math.random() * 0.09;
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.2), t + dur);
      g.gain.linearRampToValueAtTime(0.05 * mix.birds, t + dur * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      t += dur + 0.04 + Math.random() * 0.1;
    }
    o.start(t0);
    o.stop(t + 0.1);
  }

  /** Called every frame with dt and the current wall time. */
  function update(dt, time) {
    if (!started) return;
    const k = 1 - Math.exp(-dt * 1.2); // gentle chase

    const windTarget = 0.05 + mix.wind * 0.22;
    nodes.windGain.gain.value += (windTarget - nodes.windGain.gain.value) * k;
    const gustTarget = mix.wind * 0.05 * (0.6 + 0.4 * Math.sin(time * 0.31) * Math.sin(time * 0.13));
    nodes.gustGain.gain.value += (Math.max(0, gustTarget) - nodes.gustGain.gain.value) * k;

    // lub-dub every ~1.4s
    nodes.rumbleBeat += dt;
    const cyc = nodes.rumbleBeat % 1.4;
    const lub = Math.exp(-cyc * 9);
    const dub = Math.exp(-Math.max(0, cyc - 0.28) * 11) * 0.6;
    nodes.rumbleGain.gain.value = (lub + dub) * 0.11 * mix.rumble;

    nodes.padGain.gain.value += (mix.pad * 0.16 - nodes.padGain.gain.value) * k * 0.5;

    // lapping: two beat frequencies make it irregular, like a real shore
    const lapWave = Math.max(0,
      (0.5 + 0.5 * Math.sin(time * 0.9)) * (0.55 + 0.45 * Math.sin(time * 3.1 + 0.7)));
    nodes.lapGain.gain.value += (mix.water * 0.09 * lapWave - nodes.lapGain.gain.value) * k * 2.0;

    if (mix.birds > 0.05) {
      nodes.birdTimer -= dt;
      if (nodes.birdTimer <= 0) {
        chirp();
        nodes.birdTimer = 2.5 + Math.random() * 6;
      }
    }
  }

  return { start, update, mix, get started() { return started; } };
}
