# EQ by ear

A browser tool for EQing headphones and IEMs by ear, live at https://eqbyear.com.
Play a sine tone, sweep it slowly, mark the peaks and dips you hear, and turn the marks
into an 8-band parametric EQ you can paste into any PEQ app. Static site, no backend,
no dependencies.

Tutorial video: https://youtu.be/WIWHINQ5lV8

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

## License

Apache License 2.0. See `LICENSE`. "DMS" and "EQ by ear" names and logo are not
licensed for use on derived works.
