// Modified 2026 by Francisco Wilhelm (fork github.com/franciscowilhelm/eqbyear): tone width and ear state, per-ear band channels and capacity.
// Store: state, actions, subscribe. No DOM. Every change produces a new state object.

import * as dsp from './dsp.js';

export const MAX_BANDS = 8;        // filters per ear (the engine has 8 per channel)
export const TYPES = ['PK', 'LSC', 'HSC'];
export const CHANNELS = ['both', 'L', 'R'];
export const EARS = ['both', 'left', 'right'];

// The band channel a new mark lands on while listening with this ear.
export function channelForEar(ear) {
  return ear === 'left' ? 'L' : ear === 'right' ? 'R' : 'both';
}

// Filters each ear would run, counting L+R bands on both sides.
export function earLoad(bands) {
  let L = 0, R = 0;
  for (const b of bands) {
    if (b.channel !== 'R') L++;
    if (b.channel !== 'L') R++;
  }
  return { L, R };
}

// True when one more band on `channel` still fits in both ears' chains.
export function canAdd(bands, channel) {
  const { L, R } = earLoad(bands);
  if (channel === 'L') return L < MAX_BANDS;
  if (channel === 'R') return R < MAX_BANDS;
  return L < MAX_BANDS && R < MAX_BANDS;
}

export function hasPerEar(bands) {
  return bands.some((b) => b.channel === 'L' || b.channel === 'R');
}

const LEVEL_MIN = -60;
const LEVEL_MAX = -6;
const GAIN_LIMIT = 24;
const Q_MIN = 0.1;
const Q_MAX = 20;
const PREAMP_LIMIT = 24;

let seq = 0;
function nextId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  seq += 1;
  return `b${seq}-${Date.now().toString(36)}`;
}

function num(v, min, max, fallback) {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function round(v, step) {
  return Math.round(v / step) * step;
}

function markHz(v) {
  return v == null ? null : num(v, dsp.FMIN, dsp.FMAX, null);
}

export function emptyDraft(kind = 'peak') {
  return { kind: kind === 'dip' ? 'dip' : 'peak', start: null, top: null, end: null };
}

export function defaultState() {
  return {
    version: 1,
    freq: 1000,
    playing: false,
    levelDb: -18,
    eqOn: true,
    preampDb: 0,
    preampAuto: true,
    bands: [],
    selectedId: null,
    draft: emptyDraft('peak'),
    toneWidth: 'sine',       // 'sine' | 'warble' | 'noise'
    ear: 'both',             // 'both' | 'left' | 'right': where the tone plays
    theme: 'light',
  };
}

function cleanBand(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = TYPES.includes(raw.type) ? raw.type : 'PK';
  const fc = num(raw.fc, dsp.FMIN, dsp.FMAX, null);
  if (fc == null) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nextId(),
    type,
    fc: Math.round(fc),
    gain: round(num(raw.gain, -GAIN_LIMIT, GAIN_LIMIT, 0), 0.1),
    q: round(num(raw.q, Q_MIN, Q_MAX, 1), 0.01),
    enabled: raw.enabled !== false,
    channel: CHANNELS.includes(raw.channel) ? raw.channel : 'both',
  };
}

// Validate an arbitrary object into a full, in-range state. Never throws.
export function validate(raw) {
  const d = defaultState();
  const s = raw && typeof raw === 'object' ? raw : {};

  const bands = [];
  if (Array.isArray(s.bands)) {
    for (const b of s.bands) {
      const cb = cleanBand(b);
      if (cb && canAdd(bands, cb.channel)) bands.push(cb);
    }
  }

  const rawDraft = s.draft && typeof s.draft === 'object' ? s.draft : {};
  const draft = {
    kind: rawDraft.kind === 'dip' ? 'dip' : 'peak',
    start: markHz(rawDraft.start),
    top: markHz(rawDraft.top),
    end: markHz(rawDraft.end),
  };

  const selectedId = bands.some((b) => b.id === s.selectedId) ? s.selectedId : null;

  return normalize({
    version: 1,
    freq: num(s.freq, dsp.FMIN, dsp.FMAX, d.freq),
    playing: false,
    levelDb: num(s.levelDb, LEVEL_MIN, LEVEL_MAX, d.levelDb),
    eqOn: s.eqOn !== false,
    preampDb: num(s.preampDb, -PREAMP_LIMIT, PREAMP_LIMIT, 0),
    preampAuto: s.preampAuto !== false,
    bands,
    selectedId,
    draft,
    toneWidth: dsp.TONE_WIDTHS.includes(s.toneWidth) ? s.toneWidth : d.toneWidth,
    ear: EARS.includes(s.ear) ? s.ear : d.ear,
    theme: s.theme === 'dark' ? 'dark' : 'light',
  });
}

// Keeps derived fields consistent (auto preamp follows the enabled bands).
function normalize(s) {
  if (s.preampAuto) {
    const auto = dsp.autoPreamp(s.bands);
    if (auto !== s.preampDb) return { ...s, preampDb: auto };
  }
  return s;
}

export function createStore(initial) {
  let state = validate(initial || defaultState());
  const subs = new Set();

  function emit() {
    for (const fn of subs) fn(state);
  }

  function set(next) {
    state = normalize(next);
    emit();
    return state;
  }

  function commitWith(draft) {
    const spec = dsp.bandFromMarks(draft);
    if (!spec) {
      set({ ...state, draft });
      return null;
    }
    const channel = channelForEar(state.ear);
    if (!canAdd(state.bands, channel)) {
      // refused: drop the draft so the panel does not stay half-marked
      set({ ...state, draft: emptyDraft(draft.kind) });
      return null;
    }
    const band = {
      id: nextId(),
      type: spec.type,
      fc: spec.fc,
      gain: spec.gain,
      q: spec.q,
      enabled: true,
      channel,
    };
    set({
      ...state,
      bands: [...state.bands, band],
      selectedId: band.id,
      draft: emptyDraft(draft.kind),
    });
    return band;
  }

  return {
    get: () => state,

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    setFreq(hz) {
      const f = dsp.clampFreq(typeof hz === 'string' ? Number(hz) : hz);
      if (f === state.freq) return state;
      return set({ ...state, freq: f });
    },

    setPlaying(on) {
      const v = !!on;
      if (v === state.playing) return state;
      return set({ ...state, playing: v });
    },

    setLevel(db) {
      const v = Math.round(num(db, LEVEL_MIN, LEVEL_MAX, state.levelDb));
      if (v === state.levelDb) return state;
      return set({ ...state, levelDb: v });
    },

    toggleEq() {
      return set({ ...state, eqOn: !state.eqOn });
    },

    setPreamp(db) {
      const v = round(num(db, -PREAMP_LIMIT, PREAMP_LIMIT, state.preampDb), 0.1);
      return set({ ...state, preampDb: v, preampAuto: false });
    },

    setPreampAuto() {
      return set({ ...state, preampAuto: true });
    },

    setToneWidth(w) {
      if (!dsp.TONE_WIDTHS.includes(w) || w === state.toneWidth) return state;
      return set({ ...state, toneWidth: w });
    },

    setEar(ear) {
      if (!EARS.includes(ear) || ear === state.ear) return state;
      return set({ ...state, ear });
    },

    setTheme(t) {
      const v = t === 'dark' ? 'dark' : 'light';
      if (v === state.theme) return state;
      return set({ ...state, theme: v });
    },

    setDraftKind(kind) {
      const v = kind === 'dip' ? 'dip' : 'peak';
      if (v === state.draft.kind) return state;
      return set({ ...state, draft: { ...state.draft, kind: v } });
    },

    // Records the current frequency into the draft. Commits automatically
    // once all three marks exist.
    mark(which) {
      if (which !== 'start' && which !== 'top' && which !== 'end') return state;
      const draft = { ...state.draft, [which]: state.freq };
      if (draft.start != null && draft.top != null && draft.end != null) {
        commitWith(draft);
        return state;
      }
      return set({ ...state, draft });
    },

    commitDraft() {
      return commitWith(state.draft);
    },

    clearDraft() {
      const d = state.draft;
      if (d.start == null && d.top == null && d.end == null) return state;
      return set({ ...state, draft: emptyDraft(d.kind) });
    },

    // Removes the last draft mark; with an empty draft, the newest band.
    undo() {
      const d = state.draft;
      for (const key of ['end', 'top', 'start']) {
        if (d[key] != null) {
          return set({ ...state, draft: { ...d, [key]: null } });
        }
      }
      if (!state.bands.length) return state;
      const bands = state.bands.slice(0, -1);
      const gone = state.bands[state.bands.length - 1];
      return set({
        ...state,
        bands,
        selectedId: state.selectedId === gone.id ? null : state.selectedId,
      });
    },

    updateBand(id, patch) {
      const i = state.bands.findIndex((b) => b.id === id);
      if (i < 0 || !patch || typeof patch !== 'object') return state;
      const prev = state.bands[i];
      const next = { ...prev };
      if ('type' in patch && TYPES.includes(patch.type)) next.type = patch.type;
      if ('fc' in patch) next.fc = Math.round(num(patch.fc, dsp.FMIN, dsp.FMAX, prev.fc));
      if ('gain' in patch) next.gain = round(num(patch.gain, -GAIN_LIMIT, GAIN_LIMIT, prev.gain), 0.1);
      if ('q' in patch) next.q = round(num(patch.q, Q_MIN, Q_MAX, prev.q), 0.01);
      if ('enabled' in patch) next.enabled = !!patch.enabled;
      if ('channel' in patch && CHANNELS.includes(patch.channel) && patch.channel !== prev.channel) {
        // Refused when the ear it moves onto already runs MAX_BANDS filters.
        const others = state.bands.filter((b) => b.id !== id);
        if (canAdd(others, patch.channel)) next.channel = patch.channel;
      }
      const bands = state.bands.slice();
      bands[i] = next;
      return set({ ...state, bands });
    },

    removeBand(id) {
      if (!state.bands.some((b) => b.id === id)) return state;
      return set({
        ...state,
        bands: state.bands.filter((b) => b.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      });
    },

    selectBand(id) {
      const v = state.bands.some((b) => b.id === id) ? id : null;
      if (v === state.selectedId) return state;
      return set({ ...state, selectedId: v });
    },

    // Replace the whole state, validating shape and clamping ranges.
    load(next) {
      state = validate(next);
      emit();
      return state;
    },
  };
}
