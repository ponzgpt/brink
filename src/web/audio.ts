/**
 * Everything here is synthesised at runtime. No audio files ship with the game:
 * a drone and a klaxon are a handful of oscillators, and generating them avoids
 * both the download and any question of whose recording it is.
 *
 * Browsers will not start audio before a gesture, so the context is created on
 * the first interaction and the menu bed fades in from there.
 */
let ctx: AudioContext | null = null;
let bed: { gain: GainNode; stop: () => void } | null = null;
let muted = read();

function read(): boolean {
  try {
    return localStorage.getItem('brink.muted') === '1';
  } catch {
    return false;
  }
}

function write(v: boolean): void {
  try {
    localStorage.setItem('brink.muted', v ? '1' : '0');
  } catch {
    /* private browsing; the preference simply does not persist */
  }
}

function context(): AudioContext {
  ctx ??= new AudioContext();
  void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  write(v);
  if (bed) bed.gain.gain.setTargetAtTime(v ? 0 : 0.09, context().currentTime, 0.4);
}

/** Pink-ish noise, used as the air in the room behind everything else. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  const len = c.sampleRate * 3;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.0555179;
    b1 = 0.963 * b1 + w * 0.0750759;
    b2 = 0.573 * b2 + w * 0.153852;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return buf;
}

/**
 * The menu bed: a low drone a fifth apart, slightly detuned so it beats, under a
 * filtered noise floor. Ominous by interval rather than by volume — it has to sit
 * under a menu for minutes without becoming tiring.
 */
export function startBed(): void {
  if (bed) return;
  const c = context();
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(c.destination);

  const voices: OscillatorNode[] = [];
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  lp.Q.value = 0.6;
  lp.connect(out);

  for (const [freq, detune, level] of [
    [55, -4, 0.5],
    [55, 5, 0.5],
    [82.5, 0, 0.26],
    [110, -7, 0.16],
  ] as const) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = c.createGain();
    g.gain.value = level;
    o.connect(g).connect(lp);
    o.start();
    voices.push(o);
  }

  // A very slow swell keeps it alive without ever demanding attention.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.035;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain).connect(lp.frequency);
  lfo.start();

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c);
  noise.loop = true;
  const nf = c.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 480;
  nf.Q.value = 0.5;
  const ng = c.createGain();
  ng.gain.value = 0.1;
  noise.connect(nf).connect(ng).connect(out);
  noise.start();

  out.gain.setTargetAtTime(muted ? 0 : 0.09, c.currentTime, 2.5);
  bed = {
    gain: out,
    stop: () => {
      for (const v of voices) v.stop();
      lfo.stop();
      noise.stop();
    },
  };
}

/** Duck the bed rather than cutting it, so the klaxon lands on top of something. */
export function duckBed(to = 0.03, seconds = 1): void {
  if (bed && !muted) bed.gain.gain.setTargetAtTime(to, context().currentTime, seconds);
}

export function raiseBed(to = 0.09, seconds = 3): void {
  if (bed && !muted) bed.gain.gain.setTargetAtTime(to, context().currentTime, seconds);
}

/**
 * Attack warning. A two-tone klaxon over a rising sweep — the shape of every
 * civil-defence siren, which is why three seconds of it is enough to set a scene.
 */
export function klaxon(): void {
  if (muted) return;
  const c = context();
  const t0 = c.currentTime;
  const out = c.createGain();
  out.gain.value = 0.0001;
  out.connect(c.destination);
  out.gain.exponentialRampToValueAtTime(0.3, t0 + 0.08);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);

  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 2.4;
  bp.connect(out);

  const horn = c.createOscillator();
  horn.type = 'sawtooth';
  horn.connect(bp);
  // Two alternating tones, the interval that reads as an alarm rather than a note.
  const steps = [440, 587, 440, 587, 440, 587];
  steps.forEach((f, i) => horn.frequency.setValueAtTime(f, t0 + i * 0.55));
  horn.start(t0);
  horn.stop(t0 + 3.6);

  // A slow rise underneath gives it the lift a flat klaxon lacks.
  const sweep = c.createOscillator();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(70, t0);
  sweep.frequency.exponentialRampToValueAtTime(190, t0 + 3.2);
  const sg = c.createGain();
  sg.gain.value = 0.1;
  const slp = c.createBiquadFilter();
  slp.type = 'lowpass';
  slp.frequency.value = 600;
  sweep.connect(slp).connect(sg).connect(out);
  sweep.start(t0);
  sweep.stop(t0 + 3.6);

  duckBed(0.02, 0.5);
  window.setTimeout(() => raiseBed(0.05, 4), 3800);
}

/** A short confirmation for each step of the authorisation chain. */
export function clunk(pitch = 180): void {
  if (muted) return;
  const c = context();
  const t0 = c.currentTime;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(pitch, t0);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.55, t0 + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + 0.16);
}

/** Detonation: a filtered noise burst with a long tail. */
export function detonation(): void {
  if (muted) return;
  const c = context();
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1800, t0);
  lp.frequency.exponentialRampToValueAtTime(90, t0 + 2.2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.34, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
  src.connect(lp).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + 2.6);
}
