# EQ by ear

A browser tool for EQing headphones and IEMs by ear, live at https://eqbyear.com.
Play a sine tone, sweep it slowly, mark the peaks and dips you hear, and turn the marks
into an 8-band parametric EQ you can paste into any PEQ app. Static site, no backend,
no dependencies.

Tutorial video: https://youtu.be/WIWHINQ5lV8

## About this fork

This fork of [DMS3tv/eqbyear](https://github.com/DMS3tv/eqbyear) aims to make the
method sounder from a hearing-science point of view. It focuses on narrow
high-frequency peaks and dips, where ear tips, seal and ears differ most. Bass and broad
tonal balance are better served by a published AutoEQ profile; low frequencies stay
selectable but are not the target. Work is on the `tone-width` branch.

### Tone width

A **Width** control in the Sweep box sets the test signal around the needle (`W` cycles):

- **Sine**: the original pure tone. Best for finding sharp resonances, such as an IEM's
  sealed-canal resonance or cup modes.
- **Warble**: the sine's pitch swings ±5 % at 5 Hz. It smooths very narrow notches that
  music barely excites and that move with fit, and it smooths the ear's own threshold
  ripple.
- **Noise band**: Gaussian noise filtered to one critical band around the needle
  (Zwicker & Terhardt; about 1/3 octave above 500 Hz, capped at one octave below).
  Loudness adds up over about a critical band, so this weights a resonance roughly
  the way music does. The filters are pre-warped so the band keeps its width near
  Nyquist.

All three are level-matched (the noise band's RMS equals the sine's, tested to ±0.5 dB).
Switching width at one frequency therefore doesn't change the level, which would
otherwise look like a peak or dip.

### Per ear

An **Ear** control (Both / Left / Right, keys `B` `L` `R`) plays the tone to one ear.
Ear canals and IEM fit differ between ears more than drivers do.

- Bands marked while listening with one ear apply only to that ear. Each band card has
  an L+R / L / R selector.
- The signal runs through two 8-filter chains, one per ear, so each ear holds up to 8
  bands.
- Both ears share one preamp so the L/R balance never shifts.
- The graph shows one curve per ear (left blue, right red, as on an audiogram).
- With per-ear bands, the PEQ text uses Equalizer APO `Channel: L` / `Channel: R`
  blocks. Apps without channel support take each block separately.

### Planned

- Local loudness matching: adaptive A/B staircases against references ±1/3–1/2 octave
  away, to set each band's gain instead of the fixed ±3 dB. This also covers L/R balance.
- Pink noise and music A/B, blind, to keep only audible bands.

## Run locally

```
python3 -m http.server 8080
```

then open http://localhost:8080. Any static file server works.

## Layout

- `index.html`, `css/`, `js/` — the site. ES modules, no build step.
- `js/dsp.js` — filter math (RBJ biquads), log axis, three-point mark to band.
- `tests/dsp.test.mjs` — `node tests/dsp.test.mjs`
- `tests/store.test.mjs` — per-ear bands and export: `node tests/store.test.mjs`
- `design/` — mock generator and artboards the theme was ported from.
- `docs/SPEC.md` — build contract.

## Deploy

Cloudflare Workers static assets: `npx wrangler deploy` (see `wrangler.jsonc`).
In this fork, don't deploy as-is: `wrangler.jsonc` routes to the upstream eqbyear.com
domain, and the DMS names and logo would first need replacing (see License).

## License

Apache License 2.0. See `LICENSE`. "DMS" and "EQ by ear" names and logo are not
licensed for use on derived works.

Fork changes (2026, Francisco Wilhelm) are under the same license. Each modified file
carries a notice saying so, as section 4(b) requires.
