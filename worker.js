import {LSTM} from './model.js';
let net, state, committed;
const rand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const best = values => {
  const m = Math.max(...values), choices = values.map((v, i) => v === m ? i : -1).filter(i => i >= 0);
  return choices[Math.floor(rand() * choices.length)];
};
function prepare() {
  const p = net.predict(state.history);
  const values = [p[2] - p[1], p[0] - p[2], p[1] - p[0]];
  committed = {ai: best(values), probs: p, guess: best(p)};
}
function snapshot() { return {...state, model: net.serialize()}; }
function validLast(last) {
  return last === null || (last && [last.human, last.ai].every(x => Number.isInteger(x) && x >= 0 && x < 3) && ['wins', 'ties', 'losses'].includes(last.result) && Array.isArray(last.probs) && last.probs.length === 3 && last.probs.every(x => Number.isFinite(x) && x >= 0 && x <= 1) && Math.abs(last.probs.reduce((a, b) => a + b, 0) - 1) < 1e-6 && (last.loss === null || Number.isFinite(last.loss)) && Number.isFinite(last.ms));
}
function load(saved) {
  if (saved) {
    if (saved.version !== 1 || !Array.isArray(saved.history) || saved.history.length > 512 || !saved.history.every(r => [r.human, r.ai].every(x => Number.isInteger(x) && x >= 0 && x < 3)) || !saved.stats || !['rounds', 'wins', 'ties', 'losses', 'correct'].every(k => Number.isSafeInteger(saved.stats[k]) && saved.stats[k] >= 0) || saved.stats.wins + saved.stats.ties + saved.stats.losses !== saved.stats.rounds || saved.stats.correct > saved.stats.rounds || !Number.isFinite(saved.stats.logLoss) || saved.stats.logLoss < 0) throw Error('This backup is not a valid RPS model.');
    if (!validLast(saved.last) || saved.history.length !== Math.min(512, saved.stats.rounds) || (saved.stats.rounds > 0 && !saved.last) || (saved.stats.rounds === 0 && saved.last)) throw Error('Invalid round history in backup.');
    if (saved.recent !== undefined && (!Array.isArray(saved.recent) || saved.recent.length > 100 || !saved.recent.every(r => r && Number.isFinite(r.loss) && r.loss >= 0 && typeof r.correct === 'boolean'))) throw Error('Invalid recent prediction metrics.');
    net = LSTM.restore(saved.model);
    state = {version: 1, history: saved.history.slice(), stats: {...saved.stats}, last: saved.last, recent: (saved.recent || []).map(r => ({...r}))};
  } else {
    net = new LSTM(crypto.getRandomValues(new Uint32Array(1))[0]);
    state = {version: 1, history: [], stats: {rounds: 0, wins: 0, ties: 0, losses: 0, correct: 0, logLoss: 0}, last: null, recent: []};
  }
  prepare();
}
self.onmessage = ({data}) => {
  try {
    if (data.type === 'load') {
      load(data.saved); postMessage({type: 'ready', state: snapshot()});
    } else if (data.type === 'play') {
      const human = data.move;
      if (!committed || !Number.isInteger(human) || human < 0 || human > 2) throw Error('Choose a move.');
      const {ai, probs, guess} = committed;
      const result = human === ai ? 'ties' : (human - ai + 3) % 3 === 1 ? 'wins' : 'losses';
      state.stats.rounds++; state.stats[result]++; state.stats.correct += human === guess ? 1 : 0;
      const predictionLoss = -Math.log(Math.max(1e-15, probs[human]));
      state.stats.logLoss += predictionLoss;
      state.recent.push({loss: predictionLoss, correct: human === guess}); state.recent = state.recent.slice(-100);
      state.history.push({human, ai}); state.history = state.history.slice(-512);
      const start = performance.now(), loss = net.train(state.history);
      state.last = {human, ai, probs, result, loss, ms: performance.now() - start};
      prepare(); postMessage({type: 'round', state: snapshot()});
    }
  } catch (e) { postMessage({type: 'error', message: e.message}); }
};
