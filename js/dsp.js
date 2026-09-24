// Modified 2026 by Francisco Wilhelm (fork github.com/franciscowilhelm/eqbyear): tone width math (warble, critical-band noise).
// Pure DSP + axis math. No DOM. Reference: design/build_mocks.py (coeffs, band_db).

export const FMIN = 20;
export const FMAX = 20000;
export const FS = 48000;

const LOG_RANGE = Math.log(FMAX / FMIN);

export function clampFreq(f) {
  if (!Number.isFinite(f)) return 1000;
  return Math.min(FMAX, Math.max(FMIN, f));
}

export function freqToX(f, width) {
  return (width * Math.log(clampFreq(f) / FMIN)) / LOG_RANGE;
}

export function xToFreq(x, width) {
  const t = Math.min(1, Math.max(0, x / width));
  return FMIN * Math.exp(t * LOG_RANGE);
}

// RBJ Audio EQ Cookbook, Q form. Returns unnormalised coefficients.
export function coeffs(band) {
  const A = Math.pow(10, band.gain / 40);
  const w0 = (2 * Math.PI * band.fc) / FS;
  const c = Math.cos(w0);
  const s = Math.sin(w0);
  const al = s / (2 * band.q);
  if (band.type === 'PK') {
    return { b0: 1 + al * A, b1: -2 * c, b2: 1 - al * A, a0: 1 + al / A, a1: -2 * c, a2: 1 - al / A };
  }
  const sa = 2 * Math.sqrt(A) * al;
  if (band.type === 'LSC') {
    return {
      b0: A * ((A + 1) - (A - 1) * c + sa),
      b1: 2 * A * ((A - 1) - (A + 1) * c),
      b2: A * ((A + 1) - (A - 1) * c - sa),
      a0: (A + 1) + (A - 1) * c + sa,
      a1: -2 * ((A - 1) + (A + 1) * c),
      a2: (A + 1) + (A - 1) * c - sa,
    };
  }
  // HSC
  return {
    b0: A * ((A + 1) + (A - 1) * c + sa),
    b1: -2 * A * ((A - 1) + (A + 1) * c),
    b2: A * ((A + 1) + (A - 1) * c - sa),
    a0: (A + 1) - (A - 1) * c + sa,
    a1: 2 * ((A - 1) - (A + 1) * c),
    a2: (A + 1) - (A - 1) * c - sa,
  };
}

export function magnitudeDb(band, f) {
  const { b0, b1, b2, a0, a1, a2 } = coeffs(band);
  const w = (2 * Math.PI * f) / FS;
  const cw = Math.cos(w), sw = Math.sin(w), c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  const nr = b0 + b1 * cw + b2 * c2w, ni = -b1 * sw - b2 * s2w;
  const dr = a0 + a1 * cw + a2 * c2w, di = -a1 * sw - a2 * s2w;
  const num = nr * nr + ni * ni;
  const den = dr * dr + di * di;
  return 10 * Math.log10(num / den);
}

export function responseDb(bands, f) {
  let sum = 0;
  for (const b of bands) if (b.enabled !== false) sum += magnitudeDb(b, f);
  return sum;
}

// Log-spaced sample frequencies for drawing curves.
export function sampleFreqs(n = 320) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = FMIN * Math.pow(FMAX / FMIN, i / (n - 1));
  return out;
}

export function bandFromMarks(draft) {
  const { start, top, end, kind } = draft;
  let fc;
  if (top != null) fc = top;
  else if (start != null && end != null) fc = Math.sqrt(start * end);
  else return null;
  let q = 2.0;
  if (start != null && end != null && Math.abs(end - start) > 0) {
    q = fc / Math.abs(end - start);
  }
  q = Math.min(10, Math.max(0.3, q));
  q = Math.round(q * 20) / 20;
  return { type: 'PK', fc: Math.round(fc), gain: kind === 'dip' ? 3 : -3, q };
}

export function autoPreamp(bands) {
  let maxBoost = 0;
  for (const b of bands) if (b.enabled !== false && b.gain > maxBoost) maxBoost = b.gain;
  return -Math.round(maxBoost * 10) / 10;
}

// "3 100" with a thin space (U+2009) as thousands separator, integer Hz.
export function fmtHz(f) {
  const n = Math.round(f);
  const s = String(Math.abs(n));
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return (n < 0 ? '-' : '') + parts.join(' ');
}

// Tick labels: 105 → "105", 2500 → "2.5k", 20000 → "20k".
export function fmtK(f) {
  if (f >= 1000) {
    const v = f / 1000;
    return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}k`;
  }
  return String(Math.round(f));
}

export const MAJOR_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const MINOR_TICKS = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];

// ---- tone width: sine -> warble -> narrowband noise ------------------------
// One control for how much of the spectrum around the needle the test signal
// covers. A sine finds sharp resonances; wider signals smooth over very narrow
// features (fit-dependent notches, threshold microstructure), closer to how
// broadband music is heard.

export const TONE_WIDTHS = ['sine', 'warble', 'noise'];

// Warble: sinusoidal frequency modulation, ±5 % at 5 Hz (audiometric range is
// roughly ±2–5 % at 4–10 Hz). Expressed in cents so one depth works at any fc.
export const WARBLE_RATE_HZ = 5;
export const WARBLE_DEPTH = 0.05;
export const WARBLE_CENTS = 1200 * Math.log2(1 + WARBLE_DEPTH);

// Narrowband noise is shaped by NOISE_STAGES cascaded RBJ band-pass filters.
export const NOISE_STAGES = 2;
// Widest band allowed: one octave. Below ~200 Hz a critical band is wider than
// that, and an unlimited band would spread noise far from the needle.
const MAX_BW_FRACTION = Math.SQRT2 - Math.SQRT1_2; // octave width / fc

// Critical bandwidth in Hz (Zwicker & Terhardt 1980). ~100 Hz below 500 Hz,
// about 1/3 octave above.
export function criticalBandHz(f) {
  const k = f / 1000;
  return 25 + 75 * Math.pow(1 + 1.4 * k * k, 0.69);
}

// Target -3 dB bandwidth of the noise band at fc, in Hz.
export function noiseBandwidthHz(fc) {
  return Math.min(criticalBandHz(fc), MAX_BW_FRACTION * fc);
}

// Q for each stage so the cascade has the target -3 dB bandwidth. Cascading n
// equal band-passes narrows the band by sqrt(2^(1/n) - 1), so each stage is
// made that much wider. The analog Q is then pre-warped through RBJ's
// bandwidth-in-octaves form; without it the band shrinks towards Nyquist
// (to less than half the target at 16 kHz / 48 kHz). The correction is capped:
// above ~18 kHz a critical band no longer fits below Nyquist, and the band is
// kept narrower rather than smeared down the spectrum.
const MAX_PREWARP = 4;
export function noiseStageQ(fc, fs = FS, stages = NOISE_STAGES) {
  const q = (fc / noiseBandwidthHz(fc)) * Math.sqrt(Math.pow(2, 1 / stages) - 1);
  const octaves = (2 / Math.LN2) * Math.asinh(1 / (2 * q));
  const w0 = (2 * Math.PI * fc) / fs;
  const warp = Math.min(MAX_PREWARP, w0 / Math.sin(w0));
  return 1 / (2 * Math.sinh((Math.LN2 / 2) * octaves * warp));
}

// |H|^2 of one RBJ band-pass (constant 0 dB peak gain), the same filter as
// Web Audio's 'bandpass' BiquadFilterNode.
export function bandpassPower(fc, q, f, fs = FS) {
  const w0 = (2 * Math.PI * fc) / fs;
  const al = Math.sin(w0) / (2 * q);
  const c0 = Math.cos(w0);
  const w = (2 * Math.PI * f) / fs;
  const cw = Math.cos(w), sw = Math.sin(w), c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  // numerator al * (1 - z^-2)
  const nr = al * (1 - c2w), ni = al * s2w;
  const a0 = 1 + al, a1 = -2 * c0, a2 = 1 - al;
  const dr = a0 + a1 * cw + a2 * c2w, di = -a1 * sw - a2 * s2w;
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}

// Gain that gives unit-variance white noise, after the band-pass cascade, the
// same RMS as a full-scale sine (1/sqrt 2). Equal RMS within about one
// critical band means roughly equal loudness, so switching width at the same
// needle position should not jump in level.
export function noiseNormGain(fc, fs = FS, stages = NOISE_STAGES) {
  const q = noiseStageQ(fc, fs, stages);
  const nyq = fs / 2;
  // Trapezoid over a log grid from 1 Hz to Nyquist; fine near any fc.
  const N = 4000;
  const ratio = Math.pow(nyq, 1 / (N - 1));
  let f0 = 1;
  let p0 = Math.pow(bandpassPower(fc, q, f0, fs), stages);
  let area = 0;
  for (let i = 1; i < N; i++) {
    const f1 = f0 * ratio;
    const p1 = Math.pow(bandpassPower(fc, q, Math.min(f1, nyq), fs), stages);
    area += 0.5 * (p0 + p1) * (f1 - f0);
    f0 = f1;
    p0 = p1;
  }
  // White noise of variance 1 spreads its power evenly over 0..Nyquist.
  const passed = area / nyq;
  return Math.sqrt(0.5 / passed);
}
