// Per-ear bands: capacity per ear, channel moves, validation and PEQ export.
// Run:  node tests/store.test.mjs

import { createStore, validate, canAdd, earLoad, channelForEar, MAX_BANDS } from '../js/store.js';
import { toPeqText, sessionToJson } from '../js/export.js';

let failures = 0;
let checks = 0;

function eq(name, actual, expected) {
  checks++;
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// Adds a top-only band at fc while listening with `ear`.
function addAt(store, ear, fc) {
  store.setEar(ear);
  store.setFreq(fc);
  store.mark('top');
  return store.commitDraft();
}

console.log('ear → channel');
eq('left → L', channelForEar('left'), 'L');
eq('right → R', channelForEar('right'), 'R');
eq('both → both', channelForEar('both'), 'both');

console.log('capacity per ear');
{
  const s = createStore();
  for (let i = 0; i < MAX_BANDS; i++) addAt(s, 'left', 1000 + i * 100);
  eq('8 left bands fit', s.get().bands.length, 8);
  eq('9th left band refused', addAt(s, 'left', 5000), null);
  eq('right ear still has room', canAdd(s.get().bands, 'R'), true);
  eq('L+R band refused (left full)', addAt(s, 'both', 5000), null);
  for (let i = 0; i < MAX_BANDS; i++) addAt(s, 'right', 2000 + i * 100);
  eq('8 L + 8 R = 16 bands', s.get().bands.length, 16);
  eq('load', earLoad(s.get().bands), { L: 8, R: 8 });
  eq('9th right band refused', addAt(s, 'right', 9000), null);
}
{
  const s = createStore();
  addAt(s, 'both', 3000);
  eq('band marked on both ears is L+R', s.get().bands[0].channel, 'both');
  const r = addAt(s, 'right', 6000);
  eq('band marked on right ear is R', r.channel, 'R');
  s.updateBand(r.id, { channel: 'L' });
  eq('channel move applies', s.get().bands[1].channel, 'L');
  for (let i = 0; i < 6; i++) addAt(s, 'left', 7000 + i * 100);
  eq('left now full', earLoad(s.get().bands).L, 8);
  const rr = addAt(s, 'right', 9000);
  s.updateBand(rr.id, { channel: 'both' });
  eq('move onto a full ear refused', s.get().bands.find((b) => b.id === rr.id).channel, 'R');
}

console.log('validation');
{
  const raw = { bands: [] };
  for (let i = 0; i < 10; i++) raw.bands.push({ type: 'PK', fc: 1000 + i, gain: -3, q: 2, channel: 'L' });
  raw.bands.push({ type: 'PK', fc: 4000, gain: -3, q: 2, channel: 'R' });
  raw.bands.push({ type: 'PK', fc: 5000, gain: -3, q: 2, channel: 'bogus' });
  const v = validate(raw);
  eq('over-capacity left bands dropped, right kept', earLoad(v.bands), { L: 8, R: 1 });
  eq('old sessions without channel load as L+R', validate({ bands: [{ type: 'PK', fc: 100, gain: 1, q: 1 }] }).bands[0].channel, 'both');
  eq('unknown ear falls back to both', validate({ ear: 'middle' }).ear, 'both');
  eq('session JSON keeps channel and ear', (() => {
    const j = JSON.parse(sessionToJson({ ...v, ear: 'left' }));
    return [j.ear, j.bands[8].channel];
  })(), ['left', 'R']);
}

console.log('PEQ text');
{
  const both = [
    { type: 'PK', fc: 3100, gain: -3, q: 2.5, enabled: true, channel: 'both' },
    { type: 'LSC', fc: 105, gain: 2, q: 0.7, enabled: true, channel: 'both' },
  ];
  eq('no per-ear bands: unchanged format', toPeqText({ preampDb: -2, bands: both }),
    'Preamp: -2.0 dB\n' +
    'Filter 1: ON LSC Fc 105 Hz Gain 2.0 dB Q 0.70\n' +
    'Filter 2: ON PK Fc 3100 Hz Gain -3.0 dB Q 2.50');
  const mixed = [
    ...both,
    { type: 'PK', fc: 8000, gain: -4, q: 4, enabled: true, channel: 'L' },
    { type: 'PK', fc: 6500, gain: 1.5, q: 3, enabled: true, channel: 'R' },
    { type: 'PK', fc: 9000, gain: -2, q: 3, enabled: false, channel: 'R' },
  ];
  eq('per-ear bands: APO channel blocks, same preamp', toPeqText({ preampDb: -2, bands: mixed }),
    'Channel: L\n' +
    'Preamp: -2.0 dB\n' +
    'Filter 1: ON LSC Fc 105 Hz Gain 2.0 dB Q 0.70\n' +
    'Filter 2: ON PK Fc 3100 Hz Gain -3.0 dB Q 2.50\n' +
    'Filter 3: ON PK Fc 8000 Hz Gain -4.0 dB Q 4.00\n' +
    '\n' +
    'Channel: R\n' +
    'Preamp: -2.0 dB\n' +
    'Filter 1: ON LSC Fc 105 Hz Gain 2.0 dB Q 0.70\n' +
    'Filter 2: ON PK Fc 3100 Hz Gain -3.0 dB Q 2.50\n' +
    'Filter 3: ON PK Fc 6500 Hz Gain 1.5 dB Q 3.00');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} failing check(s)`);
  process.exit(1);
}
