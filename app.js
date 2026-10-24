const $ = id => document.getElementById(id);
const moves = ['Rock', 'Paper', 'Scissors'], hands = ['✊', '✋', '✌️'];
const worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
let db, profiles = [], current, snapshot, loadedPlayer, busy = true, storageOK = true, importing = null, resetArmed = false, toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-move]').forEach(b => b.disabled = value);
  for (const id of ['profileSelect', 'newPlayer', 'export', 'import', 'reset']) $(id).disabled = value;
  $('readyLabel').textContent = value ? 'LEARNING…' : 'MOVE LOCKED';
}
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pattern-rps', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('players', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Close other Pattern tabs and reload to enable saving.'));
  });
}
function readAll() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('players').objectStore('players').getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function save() {
  current.state = snapshot;
  if (!db) { $('saveStatus').textContent = 'SESSION ONLY · EXPORT TO KEEP'; return; }
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('players', 'readwrite');
      tx.objectStore('players').put(current);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    storageOK = true; $('saveStatus').textContent = 'SAVED ON DEVICE';
    try { localStorage.setItem('pattern-active', current.id); } catch {}
  } catch {
    storageOK = false; $('saveStatus').textContent = 'NOT SAVED · EXPORT BACKUP';
    toast('Device storage is unavailable or full. Export a backup to keep your learning.');
  }
}
function refreshProfiles() {
  $('profileSelect').replaceChildren(...profiles.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; return o; }));
  $('profileSelect').value = current.id; $('playerName').textContent = current.name;
}
function makeProfile(name) { return {id: Array.from(crypto.getRandomValues(new Uint32Array(4)), x => x.toString(16).padStart(8, '0')).join(''), name: (name.trim() || 'Player ' + (profiles.length + 1)).slice(0, 30), state: null}; }
function render() {
  const {stats, history, last, model, recent = []} = snapshot;
  const recentAccuracy = recent.length ? 100 * recent.filter(r => r.correct).length / recent.length : 0;
  const recentLoss = recent.length ? recent.reduce((sum, r) => sum + r.loss, 0) / recent.length : 0;
  for (const key of ['wins', 'ties', 'losses']) $(key).textContent = stats[key];
  $('roundNumber').textContent = 'ROUND ' + String(stats.rounds + 1).padStart(2, '0');
  $('updates').textContent = model.step;
  $('accuracy').textContent = recent.length ? recentAccuracy.toFixed(1) + '%' : '—';
  $('lossDetail').textContent = recent.length ? `Last ${recent.length}: loss ${recentLoss.toFixed(3)}; uniform guessing: 1.099. Measured before training on each move.` : 'Recent accuracy is measured before learning from each move. Chance is 33.3%.';
  const items = history.slice(-10).map(r => { const e = document.createElement('span'); e.textContent = hands[r.human]; e.title = moves[r.human]; return e; });
  if (items.length) $('history').replaceChildren(...items);
  else { const e = document.createElement('span'); e.className = 'emptyhistory'; e.textContent = 'Your pattern starts here.'; $('history').replaceChildren(e); }
  if (last) {
    document.body.dataset.result = last.result;
    $('yourHand').textContent = hands[last.human]; $('aiHand').textContent = hands[last.ai];
    $('matchLabel').textContent = 'ROUND ' + stats.rounds + ' · REVEALED';
    $('resultTitle').textContent = {wins: 'You win this one.', losses: 'A point for Pattern.', ties: 'Great minds think alike.'}[last.result];
    $('resultSub').textContent = `You: ${moves[last.human]} · Pattern: ${moves[last.ai]}. Next move locked.`;
    for (let i = 0; i < 3; i++) {
      const p = last.probs[i]; $('prob' + i).textContent = Math.round(p * 100) + '%'; $('bar' + i).style.width = p * 100 + '%';
    }
    $('learningNote').textContent = stats.rounds < 20 ? `${stats.rounds} ${stats.rounds === 1 ? 'round' : 'rounds'} observed · Still getting to know you.` : recent.length ? `Last ${recent.length}: ${recentAccuracy.toFixed(1)}% correct · loss ${recentLoss.toFixed(3)}` : `${model.step} updates · Play to measure recent accuracy.`;
  } else {
    delete document.body.dataset.result;
    $('yourHand').textContent = '?'; $('aiHand').textContent = '✦'; $('matchLabel').textContent = 'YOUR NEXT MOVE';
    $('resultTitle').textContent = 'Can I read your mind?'; $('resultSub').textContent = 'My move is locked. Choose yours below.';
    for (let i = 0; i < 3; i++) { $('prob' + i).textContent = '—'; $('bar' + i).style.width = '0%'; }
    $('learningNote').textContent = 'Predictions appear after the reveal.';
  }
  refreshProfiles();
}
worker.onmessage = async ({data}) => {
  if (data.type === 'error') {
    importing = null; toast(data.message); $('profileMessage').textContent = data.message;
    if (loadedPlayer) { current = loadedPlayer; refreshProfiles(); }
    setBusy(false);
    if (!snapshot) { document.querySelectorAll('[data-move]').forEach(b => b.disabled = true); $('export').disabled = true; $('readyLabel').textContent = 'RESET PLAYER TO RETRY'; }
    return;
  }
  if (!['ready', 'round'].includes(data.type)) return;
  snapshot = data.state;
  if (importing) { current = makeProfile(importing); profiles.push(current); importing = null; toast('Backup imported as a separate player.'); }
  loadedPlayer = current;
  render();
  await save();
  setBusy(false);
};
worker.onerror = () => { setBusy(true); $('readyLabel').textContent = 'RELOAD TO RETRY'; toast('The learning engine could not start. Open the hosted HTTPS page and reload.'); };
document.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
  if (busy) return; setBusy(true); worker.postMessage({type: 'play', move: Number(b.dataset.move)});
}));
function showProfiles() { resetArmed = false; $('reset').textContent = 'Reset this player’s learning'; $('profileMessage').textContent = storageOK ? 'Keep a backup before clearing Safari website data.' : 'Saving is unavailable. Export a backup before closing.'; $('profileDialog').showModal(); }
$('settings').onclick = showProfiles; $('profileButton').onclick = showProfiles;
$('about').onclick = () => $('aboutDialog').showModal();
document.querySelectorAll('.close').forEach(b => b.onclick = () => b.closest('dialog').close());
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
$('profileSelect').onchange = () => {
  const selected = profiles.find(p => p.id === $('profileSelect').value);
  if (!selected || busy) return;
  current = selected; resetArmed = false; $('reset').textContent = 'Reset this player’s learning';
  setBusy(true); worker.postMessage({type: 'load', saved: current.state});
};
$('newPlayer').onclick = () => {
  if (busy) return;
  if (profiles.length >= 20) { toast('Up to 20 players are supported. Reuse an existing profile.'); return; }
  current = makeProfile($('newName').value); profiles.push(current); $('newName').value = '';
  setBusy(true); worker.postMessage({type: 'load', saved: null}); $('profileDialog').close();
};
$('reset').onclick = () => {
  if (busy) return;
  if (!resetArmed) { resetArmed = true; $('reset').textContent = 'Tap again to erase this player’s learning'; return; }
  resetArmed = false; setBusy(true); worker.postMessage({type: 'load', saved: null}); $('profileDialog').close();
};
$('export').onclick = () => {
  if (!snapshot || busy) return;
  const blob = new Blob([JSON.stringify({app: 'pattern-rps', version: 1, name: current.name, state: snapshot})], {type: 'application/json'});
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = `pattern-${current.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 30)}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
};
$('import').onclick = () => { if (!busy) $('importFile').click(); };
$('importFile').onchange = async () => {
  const file = $('importFile').files[0]; $('importFile').value = '';
  if (!file || busy) return;
  try {
    if (profiles.length >= 20) throw Error('Player limit reached. Reuse an existing profile.');
    if (file.size > 2000000) throw Error('This file is too large for a Pattern backup.');
    const data = JSON.parse(await file.text());
    if (data.app !== 'pattern-rps' || data.version !== 1 || typeof data.name !== 'string' || !data.state) throw Error('Choose a Pattern JSON backup.');
    importing = data.name.slice(0, 30) + ' copy';
    setBusy(true); worker.postMessage({type: 'load', saved: data.state});
  } catch(e) { importing = null; toast(e.message); }
};
async function offlineSetup() {
  const label = $('offlineStatus');
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { label.textContent = 'HTTPS needed for offline mode'; return; }
  try {
    let registration = await navigator.serviceWorker.getRegistration('./');
    if (!registration?.active) {
      let timeout;
      const deadline = new Promise((_, reject) => timeout = setTimeout(() => reject(Error('Offline installation timed out')), 20000));
      try {
        registration = await Promise.race([(async () => {
          await navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'});
          return navigator.serviceWorker.ready;
        })(), deadline]);
      } finally { clearTimeout(timeout); }
    } else {
      navigator.serviceWorker.register('./sw.js', {scope: './', updateViaCache: 'none'}).catch(() => {});
    }
    const channel = new MessageChannel();
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Cache not ready')), 15000);
      channel.port1.onmessage = e => { clearTimeout(timeout); channel.port1.close(); resolve(e.data.ready); };
      registration.active.postMessage({type: 'CHECK_OFFLINE'}, [channel.port2]);
    });
    if (!ready) throw Error('Cache incomplete');
    const update = () => label.textContent = navigator.onLine ? '● Offline ready' : '● Offline · ready';
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    navigator.storage?.persist?.().catch(() => {});
  } catch { label.textContent = 'Offline not ready · reload online'; }
}
async function start() {
  setBusy(true);
  try { db = await openDB(); profiles = await readAll(); }
  catch { storageOK = false; toast('Device saving is unavailable. You can play and export a backup.'); }
  let active; try { active = localStorage.getItem('pattern-active'); } catch {}
  current = profiles.find(p => p.id === active) || profiles[0];
  if (!current) { current = makeProfile('Player 1'); profiles.push(current); }
  refreshProfiles(); worker.postMessage({type: 'load', saved: current.state});
}
start(); offlineSetup();
