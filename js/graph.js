// Graph — the SVG frequency-response plot.
// Ported from design/build_mocks.py `graph_svg` with the "Quiet" m_st() style.
// Colours are CSS custom properties so the theme toggle repaints without a redraw.

import {
  MAJOR_TICKS, freqToX, magnitudeDb, responseDb, sampleFreqs, fmtK,
} from './dsp.js';

const NS = 'http://www.w3.org/2000/svg';
const RANGE_DB = 12;              // ±12 dB, values beyond are clipped to the edge
const DB_LINES = [-12, -6, 0, 6, 12];
const MARK_Y = 30;                // mock's mark_y
const FREQS = sampleFreqs(320);
const MARK_KEYS = ['start', 'top', 'end'];

function el(name, attrs, text) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
}

// Same anchoring rule as the tape: 20 hugs the left edge, 20k the right.
function anchorFor(f) {
  if (f === MAJOR_TICKS[0]) return ['start', 4];
  if (f === MAJOR_TICKS[MAJOR_TICKS.length - 1]) return ['end', -4];
  return ['middle', 0];
}

export class Graph {
  /** @param {SVGSVGElement} svg  existing <svg>; needs display:block and a CSS height */
  constructor(svg) {
    this.svg = svg;
    this.w = 0;
    this.h = 0;
    this.state = null;
    this.raf = 0;

    this.grid = el('g', {});     // static, rebuilt on resize only
    this.layer = el('g', {});    // dynamic, rebuilt every render
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.appendChild(this.grid);
    svg.appendChild(this.layer);

    this.ro = new ResizeObserver(() => this._measure());
    this.ro.observe(svg);
    this._measure();
  }

  // --- public ---------------------------------------------------------------

  /** Coalesced: many calls in one frame produce a single draw. */
  render(state) {
    this.state = state;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this._draw();
    });
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }

  // --- geometry -------------------------------------------------------------

  _y(db) {
    const c = this.h / 2;
    const v = Math.max(-RANGE_DB, Math.min(RANGE_DB, db));
    return c - (v / RANGE_DB) * c;
  }

  _path(fn) {
    let d = '';
    for (let i = 0; i < FREQS.length; i++) {
      const f = FREQS[i];
      d += (i ? ' L' : 'M') + freqToX(f, this.w).toFixed(1) + ',' + this._y(fn(f)).toFixed(1);
    }
    return d;
  }

  _measure() {
    const r = this.svg.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this._drawGrid();
    if (this.state) this._draw();
  }

  // --- static grid ----------------------------------------------------------

  _drawGrid() {
    const { w, h } = this;
    const g = this.grid;
    while (g.firstChild) g.removeChild(g.firstChild);

    // Vertical hairlines + frequency labels along the bottom.
    for (const f of MAJOR_TICKS) {
      const x = freqToX(f, w);
      g.appendChild(el('line', {
        x1: x.toFixed(1), y1: 0, x2: x.toFixed(1), y2: h,
        stroke: 'var(--hair)', 'stroke-width': '1',
      }));
      const [anchor, dx] = anchorFor(f);
      g.appendChild(el('text', {
        x: (x + dx).toFixed(1), y: h - 6, 'text-anchor': anchor,
        'font-family': 'var(--sans)', 'font-size': '11', fill: 'var(--mute)',
      }, fmtK(f)));
    }

    // Horizontal dB lines, solid; 0 dB slightly stronger. Labels sit above a positive
    // line and below a negative one, exactly as in the mock (which puts the ±12
    // labels just outside the box, where they clip away).
    for (const db of DB_LINES) {
      const y = this._y(db);
      const line = el('line', {
        x1: 0, y1: y.toFixed(1), x2: w, y2: y.toFixed(1),
        stroke: db === 0 ? 'var(--hair2)' : 'var(--hair)',
        'stroke-width': db === 0 ? '1.5' : '1',
      });
      g.appendChild(line);
      if (db === 0) continue;
      const label = (db > 0 ? '+' : '−') + Math.abs(db) + ' dB';
      g.appendChild(el('text', {
        x: 6, y: (db > 0 ? y - 4 : y + 12).toFixed(1),
        'font-family': 'var(--sans)', 'font-size': '11', fill: 'var(--mute)',
      }, label));
    }
  }

  // --- dynamic layer --------------------------------------------------------

  _draw() {
    const st = this.state;
    if (!st || !this.w) return;
    const { w, h } = this;
    const g = this.layer;
    while (g.firstChild) g.removeChild(g.firstChild);

    const bands = st.bands || [];
    const on = bands.filter((b) => b.enabled !== false);

    // One dashed ghost per enabled band.
    for (const b of on) {
      g.appendChild(el('path', {
        d: this._path((f) => magnitudeDb(b, f)),
        fill: 'none', stroke: 'var(--ghost)', 'stroke-width': '1',
        'stroke-dasharray': '1 2',
      }));
    }

    // The summed curve. With per-ear bands, one curve per ear in the audiogram
    // colours (left blue = accent, right red = danger); the ear not being
    // listened to is drawn faint.
    const perEar = bands.some((b) => b.channel === 'L' || b.channel === 'R');
    const earSum = (ch) => {
      const list = on.filter((b) => b.channel !== (ch === 'L' ? 'R' : 'L'));
      return (f) => responseDb(list, f);
    };
    let sum;
    if (!perEar) {
      sum = (f) => responseDb(on, f);
      g.appendChild(el('path', {
        d: this._path(sum),
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': '2',
        'stroke-linejoin': 'round',
      }));
    } else {
      const focus = st.ear === 'right' ? 'R' : st.ear === 'left' ? 'L' : null;
      const color = { L: 'var(--accent)', R: 'var(--danger)' };
      // Draw the focused ear last so it sits on top.
      for (const ch of focus === 'L' ? ['R', 'L'] : ['L', 'R']) {
        g.appendChild(el('path', {
          d: this._path(earSum(ch)),
          fill: 'none', stroke: color[ch], 'stroke-width': '2',
          'stroke-linejoin': 'round',
          opacity: focus && focus !== ch ? '0.35' : '1',
        }));
      }
      ['L', 'R'].forEach((ch, i) => {
        g.appendChild(el('text', {
          x: w - 8 - (1 - i) * 18, y: 16, 'text-anchor': 'end',
          'font-family': 'var(--sans)', 'font-size': '11', 'font-weight': '700',
          fill: color[ch],
        }, ch));
      });
      sum = earSum(st.ear === 'right' ? 'R' : 'L');
    }

    // Draft marks: dots on the summed curve, labelled start / top / end.
    const draft = st.draft || {};
    for (let i = 0; i < MARK_KEYS.length; i++) {
      const f = draft[MARK_KEYS[i]];
      if (f == null) continue;
      const x = freqToX(f, w);
      const y = this._y(sum(f));
      g.appendChild(el('circle', {
        cx: x.toFixed(1), cy: y.toFixed(1), r: '3.5', fill: 'var(--ink)',
      }));
      const anchor = ['end', 'middle', 'start'][i];
      const lx = x + [-6, 0, 6][i];
      const ly = i === 1 ? MARK_Y - 20 : MARK_Y - 6;
      g.appendChild(el('text', {
        x: lx.toFixed(1), y: ly, 'text-anchor': anchor,
        'font-family': 'var(--sans)', 'font-size': '11', fill: 'var(--ink)',
      }, `${MARK_KEYS[i]} ${fmtK(f)}`));
    }

    // Band numbers above the frequency labels; accent for the selected band.
    // Per-ear bands carry their ear letter ("3L").
    bands.forEach((b, i) => {
      const ch = b.channel === 'L' || b.channel === 'R' ? b.channel : '';
      g.appendChild(el('text', {
        x: freqToX(b.fc, w).toFixed(1), y: h - 22, 'text-anchor': 'middle',
        'font-family': 'var(--sans)', 'font-size': '11',
        fill: b.id === st.selectedId ? 'var(--accent)' : 'var(--mute)',
      }, String(i + 1) + ch));
    });

    // Playhead.
    const xp = freqToX(st.freq, w).toFixed(1);
    g.appendChild(el('line', {
      x1: xp, y1: 0, x2: xp, y2: h,
      stroke: 'var(--playhead)', 'stroke-width': '1',
    }));
  }
}
