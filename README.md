# EQ by ear

A browser tool for EQing headphones and IEMs by ear, live at https://eqbyear.com.
Play a sine tone, sweep it slowly, mark the peaks and dips you hear, and turn the marks
into an 8-band parametric EQ you can paste into any PEQ app. Static site, no backend,
no dependencies.

Tutorial video: https://youtu.be/WIWHINQ5lV8

## About this fork

This fork of [DMS3tv/eqbyear](https://github.com/DMS3tv/eqbyear) adds a few features to the EQ by ear tool. It currently adds a tone width control and a per-ear mode.

- **Tone width** (Sweep box, `W` cycles): the test signal can be a pure **sine**, a
  **warble** (±5 % at 5 Hz) or a **noise band** one critical band wide. All three are
  level-matched.
- **Per ear** (Sweep box, keys `B` `L` `R`): play the tone to both ears, left or right.
  Bands marked on one ear apply to that ear only (L+R / L / R per band, up to 8 per
  ear, one shared preamp). The graph shows one curve per ear, and the PEQ text
  switches to Equalizer APO `Channel: L` / `Channel: R` blocks.

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
