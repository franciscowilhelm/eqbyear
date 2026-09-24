// Wiring: DOM for band list / mark panel / gate / theme, keyboard, autosave.

import * as dsp from './dsp.js';
import { createStore } from './store.js';
import * as storage from './storage.js';
import {
  toPeqText,
  copyText,
  downloadText,
  downloadJson,
  sessionToJson,
  sessionFromJson,
  PEQ_FILENAME,
  SESSION_FILENAME,
} from './export.js';
import { AudioEngine } from './audio.js';
import { Graph } from './graph.js';
import { SweepStrip } from './sweep.js';

const MAX_BANDS = 8;
const TYPE_LABEL = { PK: 'Peak', LSC: 'Low shelf', HSC: 'High shelf' };
const MARK_LABEL = { start: 'Start', top: 'Top', end: 'End' };
const MARK_KEY = { start: '1', top: '2', end: '3' };

const $ = (id) => document.getElementById(id);

const el = {
  html: document.documentElement,
  statTone: $('statTone'),
  statEq: $('statEq'),
  saved: $('saved'),
  themeBtn: $('themeBtn'),
  tape: $('tape'),
  graph: $('graph'),
  readout: $('readout'),
  level: $('level'),
  levelOut: $('levelOut'),
  playBtn: $('playBtn'),
  playLabel: $('playLabel'),
  marks: { start: $('mkStart'), top: $('mkTop'), end: $('mkEnd') },
  kindSw: $('kindSw'),
  widthSeg: $('widthSeg'),
  addBand: $('addBand'),
  undoBtn: $('undoBtn'),
  clearBtn: $('clearBtn'),
  bandCount: $('bandCount'),
  bandList: $('bandList'),
  peq: $('peq'),
  preamp: $('preamp'),
  preampAuto: $('preampAuto'),
  sessionDown: $('sessionDown'),
  sessionUp: $('sessionUp'),
  sessionFile: $('sessionFile'),
  txtBtn: $('txtBtn'),
  copyBtn: $('copyBtn'),
  copyLabel: $('copyLabel'),
  gate: $('gate'),
  gateLevel: $('gateLevel'),
  gateLevelOut: $('gateLevelOut'),
  gateBtn: $('gateBtn'),
};

// ----------------------------------------------------------------- state ---

const restored = storage.load();
const store = createStore(restored);

// One-time move to the light default for sessions saved before the theme change.
try {
  if (!localStorage.getItem('dms-sweep:theme-v3')) {
    store.setTheme('light');
    localStorage.setItem('dms-sweep:theme-v3', '1');
  }
} catch (e) {
  /* storage unavailable */
}

const engine = new AudioEngine();
let started = false;

const sweep = new SweepStrip(el.tape, {
  onFreq: (hz) => store.setFreq(hz),
  onPointerDown: () => startTone(),
});
const graph = new Graph(el.graph);

// Handles for the browser console (QA and power users).
window.dmsSweep = { store, engine, graph, sweep };

// ---------------------------------------------------------------- helpers ---

function fmtDb(db) {
  const n = Math.round(db * 10) / 10;
  const s = Math.abs(n) % 1 === 0 ? String(Math.abs(n)) : Math.abs(n).toFixed(1);
  return `${n < 0 ? '−' : ''}${s} dB`;
}

function trimNum(v, places) {
  return String(Number(Number(v).toFixed(places)));
}

function isTyping(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || node.isContentEditable === true;
}

function setValue(node, value) {
  if (node !== document.activeElement && node.value !== value) node.value = value;
}

// ------------------------------------------------------------ audio calls ---

// The engine keeps these while idle and applies them on start().
function pushAudio(s) {
  try {
    engine.setFrequency(s.freq);
    engine.setWidth(s.toneWidth);
    engine.setLevel(s.levelDb);
    engine.setBands(s.bands, s.eqOn, s.preampDb);
  } catch (e) {
    /* engine not ready */
  }
}

function startTone() {
  if (!started) return;
  if (!store.get().playing) {
    engine.play();
    store.setPlaying(true);
  }
}

function togglePlay() {
  if (!started) return;
  if (store.get().playing) {
    engine.stop();
    store.setPlaying(false);
  } else {
    engine.play();
    store.setPlaying(true);
  }
}

// ------------------------------------------------------------- band rows ---

const rows = new Map(); // id -> row element
let rowKey = '';
const patchTimers = new Map();

// The two drawn 95 spinner arrows; the native ones are hidden in CSS.
const ARROWS =
  '<span class="spin">' +
  '<button type="button" data-step="up" tabindex="-1" aria-hidden="true">▲</button>' +
  '<button type="button" data-step="down" tabindex="-1" aria-hidden="true">▼</button>' +
  '</span>';

const CHEV = '<span class="spin one" aria-hidden="true"><i>▼</i></span>';

function bandRow(band) {
  const row = document.createElement('div');
  row.className = 'bcard';
  row.dataset.id = band.id;
  row.innerHTML =
    '<span class="n"></span>' +
    '<span class="f95">' +
    '<select class="sel95" data-f="type" aria-label="Filter type">' +
    '<option value="PK">Peak</option>' +
    '<option value="LSC">Low shelf</option>' +
    '<option value="HSC">High shelf</option>' +
    '</select>' + CHEV +
    '</span>' +
    '<span class="f95"><input class="inp" data-f="fc" type="number" step="1" min="20" max="20000" aria-label="Frequency in hertz"><i class="u">Hz</i>' + ARROWS + '</span>' +
    '<div class="r2">' +
    '<span class="f95"><input class="inp" data-f="gain" type="number" step="0.5" aria-label="Gain in decibels"><i class="u">dB</i>' + ARROWS + '</span>' +
    '<span class="f95"><i class="u">Q</i><input class="inp" data-f="q" type="number" step="0.1" aria-label="Q">' + ARROWS + '</span>' +
    '<button type="button" class="cb" data-f="enabled" role="switch" aria-label="Enable band"><i></i>On</button>' +
    '<span class="sp"></span>' +
    '<button type="button" class="b95 x del" aria-label="Remove band">×</button>' +
    '</div>';
  return row;
}

function emptyRow(n) {
  const row = document.createElement('div');
  row.className = 'bcard empty';
  row.innerHTML = `<span class="n">${n}</span><span>Mark three points to add the next band</span>`;
  return row;
}

// The drawn arrows replace the native spinners: step the input in the same
// field and let the normal input/change listeners pick the value up.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.f95 .spin button');
  if (!btn) return;
  const input = btn.closest('.f95') && btn.closest('.f95').querySelector('input');
  if (!input || input.disabled) return;
  if (btn.dataset.step === 'up') input.stepUp();
  else input.stepDown();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

function renderBands(s) {
  const key = s.bands.map((b) => b.id).join('|') + `#${s.bands.length}`;
  if (key !== rowKey) {
    rowKey = key;
    rows.clear();
    el.bandList.textContent = '';
    for (const b of s.bands) {
      const row = bandRow(b);
      rows.set(b.id, row);
      el.bandList.appendChild(row);
    }
    if (s.bands.length < MAX_BANDS) el.bandList.appendChild(emptyRow(s.bands.length + 1));
  }

  s.bands.forEach((b, i) => {
    const row = rows.get(b.id);
    if (!row) return;
    row.classList.toggle('active', b.id === s.selectedId);
    row.classList.toggle('off', b.enabled === false);
    row.querySelector('.n').textContent = String(i + 1);
    setValue(row.querySelector('[data-f="type"]'), b.type);
    setValue(row.querySelector('[data-f="fc"]'), String(b.fc));
    setValue(row.querySelector('[data-f="gain"]'), trimNum(b.gain, 1));
    setValue(row.querySelector('[data-f="q"]'), trimNum(b.q, 2));
    const sw = row.querySelector('[data-f="enabled"]');
    sw.setAttribute('aria-checked', b.enabled === false ? 'false' : 'true');
    sw.title = TYPE_LABEL[b.type];
  });

  el.bandCount.textContent =
    s.bands.length >= MAX_BANDS ? '8 of 8 · remove one to add' : `${s.bands.length} of ${MAX_BANDS}`;
}

function patchField(id, field, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  store.updateBand(id, { [field]: v });
}

el.bandList.addEventListener('focusin', (e) => {
  const row = e.target.closest('.bcard[data-id]');
  if (row) store.selectBand(row.dataset.id);
});

el.bandList.addEventListener('input', (e) => {
  const row = e.target.closest('.bcard[data-id]');
  const f = e.target.dataset && e.target.dataset.f;
  if (!row || !f || f === 'type' || f === 'enabled') return;
  const id = row.dataset.id;
  const key = `${id}:${f}`;
  clearTimeout(patchTimers.get(key));
  const raw = e.target.value;
  patchTimers.set(key, setTimeout(() => patchField(id, f, raw), 120));
});

el.bandList.addEventListener('change', (e) => {
  const row = e.target.closest('.bcard[data-id]');
  const f = e.target.dataset && e.target.dataset.f;
  if (!row || !f) return;
  const id = row.dataset.id;
  clearTimeout(patchTimers.get(`${id}:${f}`));
  if (f === 'type') store.updateBand(id, { type: e.target.value });
  else patchField(id, f, e.target.value);
});

el.bandList.addEventListener('click', (e) => {
  const row = e.target.closest('.bcard[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.closest('.del')) {
    store.removeBand(id);
    return;
  }
  const sw = e.target.closest('[data-f="enabled"]');
  if (sw) {
    const band = store.get().bands.find((b) => b.id === id);
    if (band) store.updateBand(id, { enabled: band.enabled === false });
  }
});

// ------------------------------------------------------------ mark panel ---

function renderMarks(s) {
  const d = s.draft;
  const order = ['start', 'top', 'end'];
  const next = order.find((k) => d[k] == null) || null;
  for (const k of order) {
    const btn = el.marks[k];
    const set = d[k] != null;
    btn.classList.toggle('set', set);
    btn.classList.toggle('on', k === next);
    btn.innerHTML = set
      ? `${MARK_LABEL[k]} <span class="tech">${dsp.fmtK(Math.round(d[k]))}</span>`
      : `${MARK_LABEL[k]}<kbd>${MARK_KEY[k]}</kbd>`;
  }
  el.kindSw.setAttribute('aria-checked', d.kind === 'dip' ? 'true' : 'false');
}

for (const k of ['start', 'top', 'end']) {
  el.marks[k].addEventListener('click', () => store.mark(k));
}
el.kindSw.addEventListener('click', () => {
  store.setDraftKind(store.get().draft.kind === 'dip' ? 'peak' : 'dip');
});
el.addBand.addEventListener('click', () => store.commitDraft());

// ------------------------------------------------------------ tone width ---

function renderWidth(s) {
  for (const btn of el.widthSeg.querySelectorAll('button[data-width]')) {
    const on = btn.dataset.width === s.toneWidth;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

function cycleWidth() {
  const all = dsp.TONE_WIDTHS;
  store.setToneWidth(all[(all.indexOf(store.get().toneWidth) + 1) % all.length]);
}

el.widthSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-width]');
  if (btn) store.setToneWidth(btn.dataset.width);
});
el.undoBtn.addEventListener('click', () => store.undo());
el.clearBtn.addEventListener('click', () => store.clearDraft());

// ------------------------------------------------------------------ chrome ---

el.statEq.addEventListener('click', () => store.toggleEq());
el.playBtn.addEventListener('click', () => togglePlay());
el.themeBtn.addEventListener('click', () => {
  store.setTheme(store.get().theme === 'dark' ? 'light' : 'dark');
});
el.level.addEventListener('input', () => store.setLevel(el.level.value));

el.preamp.addEventListener('change', () => store.setPreamp(el.preamp.value));
el.preamp.addEventListener('input', () => {
  const v = Number(el.preamp.value);
  if (Number.isFinite(v) && el.preamp.value !== '') store.setPreamp(v);
});
el.preampAuto.addEventListener('click', () => store.setPreampAuto());

el.txtBtn.addEventListener('click', () => downloadText(PEQ_FILENAME, toPeqText(store.get())));
el.sessionDown.addEventListener('click', () => downloadJson(SESSION_FILENAME, sessionToJson(store.get())));
el.sessionUp.addEventListener('click', () => el.sessionFile.click());
el.sessionFile.addEventListener('change', async () => {
  const file = el.sessionFile.files && el.sessionFile.files[0];
  el.sessionFile.value = '';
  if (!file) return;
  try {
    store.load(sessionFromJson(await file.text()));
  } catch (e) {
    /* malformed file — keep the current session */
  }
});

let copyTimer = null;
el.copyBtn.addEventListener('click', async () => {
  const ok = await copyText(toPeqText(store.get()));
  el.copyLabel.textContent = ok ? 'Copied' : 'Copy failed';
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    el.copyLabel.textContent = 'Copy';
  }, 1500);
});

// -------------------------------------------------------------------- gate ---

el.gateLevel.addEventListener('input', () => {
  store.setLevel(el.gateLevel.value);
  el.gateLevelOut.textContent = fmtDb(Number(el.gateLevel.value));
});

el.gateBtn.addEventListener('click', async () => {
  try {
    await engine.start();
    started = true;
  } catch (e) {
    started = false;
  }
  el.gate.hidden = true;
  pushAudio(store.get());
});

// ---------------------------------------------------------------- keyboard ---

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // never swallow browser shortcuts
  if (isTyping(e.target)) return;
  if (!el.gate.hidden) return;

  const s = store.get();
  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      store.setFreq(s.freq * (e.shiftKey ? 0.95 : 0.99));
      return;
    case 'ArrowRight':
      e.preventDefault();
      store.setFreq(s.freq * (e.shiftKey ? 1.05 : 1.01));
      return;
    case ' ':
    case 'Spacebar':
      e.preventDefault();
      togglePlay();
      return;
    case '1':
      store.mark('start');
      return;
    case '2':
      store.mark('top');
      return;
    case '3':
      store.mark('end');
      return;
    case 'Escape':
      store.clearDraft();
      return;
    case 'Enter':
      if (s.draft.top != null && s.draft.start == null && s.draft.end == null) store.commitDraft();
      return;
    default:
      break;
  }
  const k = e.key.toLowerCase();
  if (k === 'd') store.setDraftKind(s.draft.kind === 'dip' ? 'peak' : 'dip');
  else if (k === 'z') store.undo();
  else if (k === 'w') cycleWidth();
});

// ------------------------------------------------------------------ render ---

let savedTimer = null;
function pulseSaved() {
  el.saved.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.saved.classList.remove('on'), 1200);
}

function render(s) {
  el.html.dataset.theme = s.theme;
  // The button names the theme it switches to.
  el.themeBtn.textContent = s.theme === 'dark' ? 'Light' : 'Dark';

  el.readout.textContent = dsp.fmtHz(s.freq);
  sweep.update(s.freq);
  graph.render(s);

  el.statTone.classList.toggle('on', s.playing);
  el.statEq.classList.toggle('on', s.eqOn);
  el.statEq.setAttribute('aria-pressed', s.eqOn ? 'true' : 'false');
  el.playLabel.textContent = s.playing ? 'Stop' : 'Play';
  // Playing reads olive (the "stop what is running" role); stopped reads plain.
  el.playBtn.classList.toggle('warning', s.playing);

  setValue(el.level, String(s.levelDb));
  el.levelOut.textContent = fmtDb(s.levelDb);

  renderMarks(s);
  renderWidth(s);
  renderBands(s);

  el.peq.textContent = toPeqText(s);
  setValue(el.preamp, s.preampDb.toFixed(1));
  el.preampAuto.hidden = s.preampAuto;

  pushAudio(s);

  storage.save(s);
  pulseSaved();
}

store.subscribe(render);

// Fresh session: the gate slider starts at −20 dB and writes it into state.
// A restored session keeps its own level and shows it on the gate.
if (restored && Number.isFinite(Number(restored.levelDb))) {
  el.gateLevel.value = String(store.get().levelDb);
} else {
  store.setLevel(-20);
  el.gateLevel.value = '-20';
}
el.gateLevelOut.textContent = fmtDb(Number(el.gateLevel.value));

render(store.get());

window.addEventListener('pagehide', () => storage.flush());
