export const H = 32, I = 6, D = H + I, K = H * 4, WINDOW = 32;
export const TRAINING = Object.freeze({updates: 2, rate: .003, halfLife: 8, tail: 24, beta2: .99, smoothing: .3, decay: .1});
const sigmoid = x => 1 / (1 + Math.exp(-x));
export class LSTM {
  constructor(seed = 12345) {
    this.rng = seed >>> 0 || 1;
    this.step = 0;
    this.optimizerStep = 0;
    this.p = {w: new Float64Array(K * D), b: new Float64Array(K), v: new Float64Array(3 * H), o: new Float64Array(3)};
    this.m = {}; this.s = {};
    for (const key of Object.keys(this.p)) {
      this.m[key] = new Float64Array(this.p[key].length);
      this.s[key] = new Float64Array(this.p[key].length);
    }
    for (let j = 0; j < this.p.w.length; j++) this.p.w[j] = (this.random() * 2 - 1) * Math.sqrt(6 / (D + H));
    for (let j = H; j < H * 2; j++) this.p.b[j] = 1;
    for (let j = 0; j < this.p.v.length; j++) this.p.v[j] = (this.random() * 2 - 1) * .1;
  }
  random() {
    let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0; return this.rng / 4294967296;
  }
  forward(history) {
    let h = new Float64Array(H), c = new Float64Array(H);
    const tape = [];
    const {w, b} = this.p;
    for (const round of history) {
      const z = new Float64Array(D); z[round.human] = 1; z[3 + round.ai] = 1; z.set(h, I);
      const g = new Float64Array(K);
      for (let row = 0; row < K; row++) {
        let a = b[row];
        for (let j = 0; j < D; j++) a += w[row * D + j] * z[j];
        g[row] = row < H * 3 ? sigmoid(a) : Math.tanh(a);
      }
      const nc = new Float64Array(H), nh = new Float64Array(H);
      for (let j = 0; j < H; j++) {
        nc[j] = g[H + j] * c[j] + g[j] * g[3 * H + j];
        nh[j] = g[2 * H + j] * Math.tanh(nc[j]);
      }
      tape.push({z, g, previousC: c, c: nc, h: nh}); h = nh; c = nc;
    }
    return {probs: this.head(h), tape, h};
  }
  head(h) {
    const {v, o} = this.p, logits = new Float64Array(3);
    for (let a = 0; a < 3; a++) {
      logits[a] = o[a];
      for (let j = 0; j < H; j++) logits[a] += v[a * H + j] * h[j];
    }
    const max = Math.max(...logits), probs = Array.from(logits, x => Math.exp(x - max));
    const sum = probs.reduce((a, b) => a + b, 0);
    return probs.map(x => x / sum);
  }
  predict(history) { return this.forward(history.slice(-WINDOW)).probs; }
  gradients(samples) {
    const grad = Object.fromEntries(Object.entries(this.p).map(([key, value]) => [key, new Float64Array(value.length)]));
    let loss = 0;
    for (const sample of samples) {
      const {probs, tape, h} = this.forward(sample.history);
      let dh = new Float64Array(H), dc = new Float64Array(H);
      const normalization = sample.targets ? sample.weights.reduce((a, b) => a + b, 0) : 1;
      const outputGradient = (hidden, probabilities, target, weight) => {
        const smoothing = sample.smoothing || 0;
        for (let a = 0; a < 3; a++) {
          const desired = (a === target ? 1 - smoothing : 0) + smoothing / 3;
          loss -= weight * desired * Math.log(Math.max(1e-15, probabilities[a]));
          const error = weight * (probabilities[a] - desired);
          grad.o[a] += error;
          for (let j = 0; j < H; j++) { grad.v[a * H + j] += error * hidden[j]; dh[j] += error * this.p.v[a * H + j]; }
        }
      };
      if (!sample.targets) outputGradient(h, probs, sample.target, 1 / samples.length);
      for (let t = tape.length - 1; t >= 0; t--) {
        if (sample.targets && sample.weights[t] > 0) outputGradient(tape[t].h, this.head(tape[t].h), sample.targets[t], sample.weights[t] / (normalization * samples.length));
        const {z, g, previousC, c} = tape[t], da = new Float64Array(K), nextDc = new Float64Array(H);
        for (let j = 0; j < H; j++) {
          const tc = Math.tanh(c[j]), totalC = dc[j] + dh[j] * g[2 * H + j] * (1 - tc * tc);
          da[j] = totalC * g[3 * H + j] * g[j] * (1 - g[j]);
          da[H + j] = totalC * previousC[j] * g[H + j] * (1 - g[H + j]);
          da[2 * H + j] = dh[j] * tc * g[2 * H + j] * (1 - g[2 * H + j]);
          da[3 * H + j] = totalC * g[j] * (1 - g[3 * H + j] ** 2);
          nextDc[j] = totalC * g[H + j];
        }
        const nextDh = new Float64Array(H);
        for (let row = 0; row < K; row++) {
          grad.b[row] += da[row];
          for (let j = 0; j < D; j++) {
            grad.w[row * D + j] += da[row] * z[j];
            if (j >= I) nextDh[j - I] += this.p.w[row * D + j] * da[row];
          }
        }
        dh = nextDh; dc = nextDc;
      }
    }
    return {grad, loss};
  }
  train(history, config = TRAINING) {
    if (history.length < 2) return null;
    const sequence = history.slice(-(WINDOW + 1));
    const length = sequence.length - 1;
    const sample = {history: sequence.slice(0, -1), targets: sequence.slice(1).map(r => r.human), weights: Array.from({length}, (_, t) => length - 1 - t < config.tail ? .5 ** ((length - 1 - t) / config.halfLife) : 0), smoothing: config.smoothing || 0};
    let loss = 0;
    for (let update = 0; update < config.updates; update++) {
      const result = this.gradients([sample]);
      loss = result.loss;
      this.apply(result.grad, config);
    }
    return loss;
  }
  apply(grad, config) {
    let norm = 0;
    for (const a of Object.values(grad)) for (const x of a) norm += x * x;
    const scale = Math.min(1, 1 / (Math.sqrt(norm) + 1e-12));
    this.step++;
    this.optimizerStep++;
    const bc1 = 1 - .9 ** this.optimizerStep, bc2 = 1 - config.beta2 ** this.optimizerStep;
    for (const key of Object.keys(this.p)) for (let j = 0; j < this.p[key].length; j++) {
      const g = grad[key][j] * scale;
      this.m[key][j] = .9 * this.m[key][j] + .1 * g;
      this.s[key][j] = config.beta2 * this.s[key][j] + (1 - config.beta2) * g * g;
      if (key === 'w' || key === 'v') this.p[key][j] *= 1 - config.rate * (config.decay || 0);
      this.p[key][j] -= config.rate * (this.m[key][j] / bc1) / (Math.sqrt(this.s[key][j] / bc2) + 1e-8);
    }
  }
  serialize() {
    const arrays = group => Object.fromEntries(Object.entries(group).map(([k, a]) => [k, Array.from(a)]));
    return {trainingVersion: 2, step: this.step, optimizerStep: this.optimizerStep, rng: this.rng, p: arrays(this.p), m: arrays(this.m), s: arrays(this.s)};
  }
  static restore(data) {
    const net = new LSTM(1);
    if (!data || !Number.isSafeInteger(data.step) || data.step < 0 || !Number.isInteger(data.rng)) throw Error('Invalid model');
    for (const group of ['p', 'm', 's']) for (const key of Object.keys(net[group])) {
      const a = data[group]?.[key];
      if (!Array.isArray(a) || a.length !== net[group][key].length || !a.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6) || (group === 's' && a.some(x => x < 0))) throw Error('Invalid model weights');
      net[group][key].set(a);
    }
    if (data.trainingVersion === 2) {
      if (!Number.isSafeInteger(data.optimizerStep) || data.optimizerStep < 0 || data.optimizerStep > data.step) throw Error('Invalid optimizer state');
      net.optimizerStep = data.optimizerStep;
    } else if (data.trainingVersion === undefined) {
      for (const key of Object.keys(net.p)) { net.m[key].fill(0); net.s[key].fill(0); }
    } else throw Error('Unsupported training version');
    net.step = data.step; net.rng = data.rng >>> 0 || 1; return net;
  }
}
