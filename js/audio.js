// Web Audio engine. Nothing is created until start() runs from a user gesture.
// Chain: osc   -> oscMix ---+
//        noise -> bp x2 -> noiseMix -+-> toneGain -> preampGain -> biquad[0..7]
//        -> levelGain -> ceiling -> clipper (hard limit at the ceiling)
//        -> analyser -> destination
// lfo -> lfoDepth -> osc.detune gives the warble.

import {
  TONE_WIDTHS, WARBLE_RATE_HZ, WARBLE_CENTS, NOISE_STAGES,
  noiseStageQ, noiseNormGain,
} from './dsp.js';

const BANDS = 8;
const RAMP = 0.015;      // 15 ms play/stop fade
const GLIDE = 0.008;     // frequency glide time constant
const SMOOTH = 0.01;     // level / filter parameter smoothing
const CEILING = 0.5;     // fixed -6 dBFS output ceiling
const NOISE_SECONDS = 10; // looped noise buffer; long enough not to hear the loop

const TYPE_MAP = { PK: 'peaking', LSC: 'lowshelf', HSC: 'highshelf' };

const dbToGain = (db) => Math.pow(10, db / 20);

export class AudioEngine {
  constructor() {
    this.state = 'idle';      // 'idle' until start() resolves, then 'running'
    this.ctx = null;
    this.analyser = null;
    this._buf = null;
    // Desired settings kept while idle so start() can apply them.
    this._freq = 1000;
    this._levelDb = -18;
    this._playing = false;
    this._width = 'sine';
  }

  // Build the graph. Must be called from a user gesture.
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.state = 'running';
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;

    this.osc = ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.setValueAtTime(this._freq, now);

    // Warble: a slow sine on the oscillator's detune, depth set by width.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.setValueAtTime(WARBLE_RATE_HZ, now);
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.setValueAtTime(0, now);
    this.lfo.connect(this.lfoDepth).connect(this.osc.detune);

    // Narrowband noise: looped Gaussian white noise through a band-pass
    // cascade that follows the needle.
    const len = Math.round(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 2) {
      // Box-Muller: two unit-variance normals per pair of uniforms.
      const u = 1 - Math.random();
      const r = Math.sqrt(-2 * Math.log(u));
      const t = 2 * Math.PI * Math.random();
      data[i] = r * Math.cos(t);
      if (i + 1 < len) data[i + 1] = r * Math.sin(t);
    }
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.bandpass = [];
    const q = noiseStageQ(this._freq, ctx.sampleRate);
    for (let i = 0; i < NOISE_STAGES; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(this._freq, now);
      bp.Q.setValueAtTime(q, now);
      this.bandpass.push(bp);
    }
    this.noiseNorm = ctx.createGain();
    this.noiseNorm.gain.setValueAtTime(noiseNormGain(this._freq, ctx.sampleRate), now);

    // Crossfade between the oscillator and the noise band.
    this.oscMix = ctx.createGain();
    this.oscMix.gain.setValueAtTime(1, now);
    this.noiseMix = ctx.createGain();
    this.noiseMix.gain.setValueAtTime(0, now);

    this.toneGain = ctx.createGain();
    this.toneGain.gain.setValueAtTime(0, now);

    this.preampGain = ctx.createGain();
    this.preampGain.gain.setValueAtTime(1, now);

    // Eight filters live in the chain for the life of the engine; unused ones
    // sit flat (peaking, 0 dB) so the node graph never has to be rebuilt.
    this.biquads = [];
    for (let i = 0; i < BANDS; i++) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'peaking';
      bq.frequency.setValueAtTime(1000, now);
      bq.Q.setValueAtTime(1, now);
      bq.gain.setValueAtTime(0, now);
      this.biquads.push(bq);
    }

    this.levelGain = ctx.createGain();
    this.levelGain.gain.setValueAtTime(dbToGain(this._levelDb), now);

    this.ceiling = ctx.createGain();
    this.ceiling.gain.setValueAtTime(CEILING, now);

    // Hard clipper: identity up to +/- CEILING, flat beyond. A WaveShaper clamps
    // inputs outside [-1, 1] to the curve's end points, so no boost stacking or
    // manual preamp can push the output past the ceiling. Unlike a compressor
    // it adds no makeup gain, so quiet levels stay exactly as set.
    this.clipper = ctx.createWaveShaper();
    const N = 4097;
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      curve[i] = Math.max(-CEILING, Math.min(CEILING, x));
    }
    this.clipper.curve = curve;
    this.clipper.oversample = 'none';

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this._buf = new Float32Array(this.analyser.fftSize);

    this.osc.connect(this.oscMix).connect(this.toneGain);
    let nn = this.noise;
    for (const bp of this.bandpass) nn = nn.connect(bp);
    nn.connect(this.noiseNorm).connect(this.noiseMix).connect(this.toneGain);
    this.toneGain.connect(this.preampGain);
    let node = this.preampGain;
    for (const bq of this.biquads) node = node.connect(bq);
    node.connect(this.levelGain).connect(this.ceiling)
      .connect(this.clipper).connect(this.analyser).connect(ctx.destination);

    this.osc.start();
    this.lfo.start();
    this.noise.start();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    this.state = 'running';
    this._applyWidth();
    if (this._playing) this.play();
  }

  setFrequency(hz) {
    this._freq = hz;
    if (this.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(hz, now, GLIDE);
    const q = noiseStageQ(hz, this.ctx.sampleRate);
    for (const bp of this.bandpass) {
      bp.frequency.setTargetAtTime(hz, now, GLIDE);
      bp.Q.setTargetAtTime(q, now, GLIDE);
    }
    this.noiseNorm.gain.setTargetAtTime(noiseNormGain(hz, this.ctx.sampleRate), now, GLIDE);
  }

  // 'sine' | 'warble' | 'noise'. Crossfades over the play/stop ramp time.
  setWidth(width) {
    const w = TONE_WIDTHS.includes(width) ? width : 'sine';
    if (w === this._width) return;
    this._width = w;
    this._applyWidth();
  }

  _applyWidth() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const noise = this._width === 'noise';
    const ramp = (param, target) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(target, now + RAMP);
    };
    ramp(this.oscMix.gain, noise ? 0 : 1);
    ramp(this.noiseMix.gain, noise ? 1 : 0);
    ramp(this.lfoDepth.gain, this._width === 'warble' ? WARBLE_CENTS : 0);
  }

  play() {
    this._playing = true;
    this._fade(1);
  }

  stop() {
    this._playing = false;
    this._fade(0);
  }

  // Linear fade of the tone gain, cancelling anything already scheduled so
  // repeated play/stop calls never step the value and click.
  _fade(target) {
    if (this.state !== 'running') return;
    const g = this.toneGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + RAMP);
  }

  setLevel(db) {
    this._levelDb = db;
    if (this.state !== 'running') return;
    this.levelGain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, SMOOTH);
  }

  // bands: up to 8 {type, fc, gain, q, enabled}. Filters beyond the list, and
  // disabled ones, are set flat. eqOn === false flattens everything and drops
  // the preamp to unity. Preamp sits before the biquads so boosts cannot push
  // the signal past the ceiling.
  setBands(bands, eqOn = true, preampDb = 0) {
    if (this.state !== 'running') return;
    const now = this.ctx.currentTime;
    const list = Array.isArray(bands) ? bands : [];
    this.preampGain.gain.setTargetAtTime(eqOn ? dbToGain(preampDb) : 1, now, SMOOTH);
    for (let i = 0; i < BANDS; i++) {
      const bq = this.biquads[i];
      const b = list[i];
      const live = eqOn && b && b.enabled !== false;
      if (live) {
        // Web Audio's peaking Q is RBJ Q, so fc/Q/gain pass through unchanged.
        // For shelves Web Audio ignores Q while the graph draws RBJ
        // shelf-with-Q, so shelf curves can differ slightly from the plot.
        bq.type = TYPE_MAP[b.type] || 'peaking';
        bq.frequency.setTargetAtTime(b.fc, now, SMOOTH);
        bq.Q.setTargetAtTime(b.q, now, SMOOTH);
        bq.gain.setTargetAtTime(b.gain, now, SMOOTH);
      } else {
        bq.type = 'peaking';
        bq.gain.setTargetAtTime(0, now, SMOOTH);
      }
    }
  }

  // RMS of the time-domain buffer, in dBFS. -Infinity for digital silence.
  analyserDb() {
    if (this.state !== 'running') return -Infinity;
    this.analyser.getFloatTimeDomainData(this._buf);
    let sum = 0;
    for (let i = 0; i < this._buf.length; i++) sum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(sum / this._buf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }
}
