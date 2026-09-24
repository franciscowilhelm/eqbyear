// Checks js/dsp.js against reference numbers produced by design/build_mocks.py
// (xlog, coeffs, band_db). Run:  node tests/dsp.test.mjs
// Exits non-zero on the first failing assertion group.

import {
  freqToX, xToFreq, magnitudeDb, bandFromMarks, autoPreamp, fmtHz, fmtK,
  criticalBandHz, noiseBandwidthHz, noiseStageQ, bandpassPower, noiseNormGain,
  WARBLE_CENTS, NOISE_STAGES,
} from '../js/dsp.js';

let failures = 0;
let checks = 0;

function ok(name, pass, detail) {
  checks++;
  if (pass) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(name, actual, expected, tol) {
  const d = Math.abs(actual - expected);
  ok(name, d <= tol, `got ${actual}, expected ${expected} (|Δ| ${d.toExponential(3)} > ${tol})`);
}

function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const TOL_DB = 1e-6;

// ---- magnitudeDb vs. build_mocks.band_db ----------------------------------
// Values printed by python3 using the reference implementation verbatim.
const MAG_CASES = [
  ['PK 3100 -4.5 q2.6', { type: 'PK', fc: 3100, gain: -4.5, q: 2.6 }, [
    [3100, -4.500000000000003],
    [2500, -1.9382854628399797],
    [3750, -2.1842670925242516],
    [1000, -0.08568362244277694],
  ]],
  ['LSC 105 +2.0 q0.7', { type: 'LSC', fc: 105, gain: 2.0, q: 0.7 }, [
    [20, 1.9958718268450384],
    [105, 0.9999999999992859],
    [1000, 0.0006931946745789644],
  ]],
  ['HSC 8000 -3.0 q0.7', { type: 'HSC', fc: 8000, gain: -3.0, q: 0.7 }, [
    [1000, -0.001300311154891513],
    [8000, -1.4999999999999996],
    [20000, -2.9967799878692993],
  ]],
];

console.log('magnitudeDb vs Python reference (tol 1e-6 dB)');
for (const [label, band, points] of MAG_CASES) {
  for (const [f, expected] of points) {
    near(`${label} @ ${f} Hz`, magnitudeDb(band, f), expected, TOL_DB);
  }
}

// ---- axis mapping ---------------------------------------------------------
console.log('axis mapping');
// xlog(1000, 1000) from build_mocks.py = 566.3233347786729.
// NOTE: SPEC.md acceptance item 3 says "1 kHz at 60.2 %"; the reference mapping
// puts it at 56.63 %. The Python reference wins — dsp.js agrees with it.
near('freqToX(1000, 1000)', freqToX(1000, 1000), 566.3233347786729, 1e-9);
near('freqToX(20, 1000)', freqToX(20, 1000), 0, 1e-12);
near('freqToX(20000, 1000)', freqToX(20000, 1000), 1000, 1e-9);
near('freqToX(105, 1000)', freqToX(105, 1000), 240.05310113531897, 1e-9);
near('freqToX(3100, 1000)', freqToX(3100, 1000), 730.1105660567639, 1e-9);

for (const w of [800, 1000, 1440]) {
  for (const f of [20, 105, 440, 1000, 3100, 8000, 20000]) {
    near(`round-trip ${f} Hz @ w=${w}`, xToFreq(freqToX(f, w), w), f, 1e-9);
  }
}

// ---- bandFromMarks --------------------------------------------------------
console.log('bandFromMarks');
{
  const b = bandFromMarks({ start: 2500, top: 3100, end: 3750, kind: 'peak' });
  eq('fc', b.fc, 3100);
  eq('gain', b.gain, -3);
  eq('q (3100/1250 = 2.48 → 2.5)', b.q, 2.5);
  eq('type', b.type, 'PK');
}

// ---- formatting + preamp --------------------------------------------------
console.log('formatting and preamp');
eq('fmtHz(3100)', fmtHz(3100), '3 100'); // thin space U+2009
eq('fmtK(2500)', fmtK(2500), '2.5k');
eq('fmtK(20000)', fmtK(20000), '20k');
eq('autoPreamp([+2, -4.5])', autoPreamp([
  { fc: 105, gain: 2, q: 0.7, type: 'LSC', enabled: true },
  { fc: 3100, gain: -4.5, q: 2.6, type: 'PK', enabled: true },
]), -2);

// ---- tone width -------------------------------------------------------------
console.log('tone width');
near('warble ±5 % in cents', WARBLE_CENTS, 84.467, 1e-3);
near('critical band at 1 kHz (Zwicker)', criticalBandHz(1000), 162.2, 0.5);
near('critical band at 100 Hz ≈ 100 Hz', criticalBandHz(100), 100.8, 0.5);
near('noise band at 50 Hz capped at one octave', noiseBandwidthHz(50), 50 * (Math.SQRT2 - Math.SQRT1_2), 1e-9);

// The cascade's measured -3 dB width should match the target within 10 %.
function measuredBw(fc, fs) {
  const q = noiseStageQ(fc, fs);
  const p = (f) => Math.pow(bandpassPower(fc, q, f, fs), NOISE_STAGES);
  const edge = (dir) => {
    let lo = fc, hi = dir > 0 ? fs / 2 - 1 : 1; // bisect for |H|^2 = 0.5
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      if (p(mid) > 0.5) lo = mid; else hi = mid;
    }
    return lo;
  };
  return edge(1) - edge(-1);
}
for (const [fc, fs] of [[1000, 48000], [4000, 48000], [10000, 44100], [16000, 48000]]) {
  const bw = measuredBw(fc, fs);
  const target = noiseBandwidthHz(fc);
  ok(`noise band -3 dB width at ${fc} Hz / ${fs}`, Math.abs(bw / target - 1) < 0.1,
    `measured ${bw.toFixed(1)} Hz, target ${target.toFixed(1)} Hz`);
}

// Simulate the Web Audio chain: seeded Gaussian noise through the cascade,
// times noiseNormGain, should have the RMS of a unit sine (-3.01 dBFS) ±0.5 dB.
function rng(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) + 0.5) / 4294967296;
}
function simulatedRmsDb(fc, fs) {
  const rand = rng(12345);
  const q = noiseStageQ(fc, fs);
  const w0 = (2 * Math.PI * fc) / fs, al = Math.sin(w0) / (2 * q), c = Math.cos(w0);
  const a0 = 1 + al, b0 = al / a0, b2 = -al / a0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
  const st = Array.from({ length: NOISE_STAGES }, () => [0, 0, 0, 0]);
  const g = noiseNormGain(fc, fs);
  const n = fs * 4, skip = fs / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let x = Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand());
    for (const s of st) { // direct form I
      const y = b0 * x + b2 * s[1] - a1 * s[2] - a2 * s[3];
      s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y; x = y;
    }
    if (i >= skip) sum += (g * x) ** 2;
  }
  return 10 * Math.log10(sum / (n - skip));
}
for (const fc of [100, 1000, 8000]) {
  near(`noise band RMS at ${fc} Hz matches sine (dB)`, simulatedRmsDb(fc, 48000), -3.0103, 0.5);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} failing check(s)`);
  process.exit(1);
}
