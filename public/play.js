'use strict';
// Phone client: join, pick a card, see own result.
const $ = (s) => document.querySelector(s);
const view = $('#view');
const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase();
const KEY = 'airace-player-' + room;
const CARDS = ['cooperate', 'race', 'release', 'exposeLeft', 'exposeRight'];
const LABEL = { cooperate: 'Cooperate', race: 'Race', release: 'Release', exposeLeft: 'Expose Left', exposeRight: 'Expose Right' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = localStorage.getItem(KEY);
let state = null;
let viewKey = '';
let current = 0; // index of the card in the middle of the carousel
let es = null;

if (!room) location.replace('/');
else if (token) connect();
else showJoin();

function showJoin(message) {
  $('#hdr').hidden = true;
  viewKey = 'join';
  view.innerHTML = `
    <h2>Join table ${esc(room)}</h2>
    <form id="f">
      <input id="n" maxlength="12" placeholder="Your name" autocomplete="off" enterkeyhint="go">
      <button class="btn go">Join</button>
      <div class="error" id="e">${esc(message || '')}</div>
    </form>`;
  $('#n').value = localStorage.getItem('airace-name') || '';
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#n').value.trim();
    if (!name) return;
    try {
      const d = await post('/api/join', { code: room, name });
      token = d.token;
      localStorage.setItem(KEY, token);
      localStorage.setItem('airace-name', name);
      connect();
    } catch (e) { $('#e').textContent = e.message; }
  };
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
}
const act = (type, extra) => post('/api/action', { code: room, token, type, ...extra }).catch((e) => console.warn(e.message));

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?room=${room}&token=${token}`);
  es.onmessage = (m) => {
    const d = JSON.parse(m.data);
    $('#offline').style.display = 'none';
    if (d.error) { // seat no longer exists (room closed, removed, or taken over)
      es.close(); token = null; localStorage.removeItem(KEY);
      showJoin('Please join again.');
      return;
    }
    const before = state;
    state = d;
    render(before);
  };
  es.onerror = () => { $('#offline').style.display = 'block'; };
  keepAwake();
}

function keepAwake() {
  const req = () => navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {});
  req();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') req(); });
}
const buzz = (p) => navigator.vibrate && navigator.vibrate(p);

function render(before) {
  const me = state.players.find((p) => p.id === state.you.id);
  if (!me) return;
  $('#hdr').hidden = false;
  $('#seat').textContent = me.seat;
  $('#seat').className = 'hex pc seat' + me.seat;
  $('#pname').textContent = me.name;
  $('#cap').textContent = me.capability;
  $('#pts').textContent = me.total;

  const res = state.resolution && state.resolution.players[me.id];
  let key;
  if (state.phase === 'lobby') key = 'lobby';
  else if (state.phase === 'final') key = 'final';
  else if (state.phase === 'choose') {
    key = `c${state.gen}.${state.round}.` + (me.released ? 'released' : me.skipping ? 'skip' : state.you.choice ? 'locked' : 'pick');
  } else key = `r${state.gen}.${state.round}.${state.phase}`;

  if (key !== viewKey) {
    viewKey = key;
    if (key === 'lobby') lobby(me);
    else if (key === 'final') final(me);
    else if (key.endsWith('released')) released(me);
    else if (key.endsWith('skip')) skipping();
    else if (key.endsWith('locked')) locked();
    else if (key.endsWith('pick')) pick();
    else result(me, res);
  }
  if (key.endsWith('pick')) updateTargets();
}

function lobby(me) {
  view.innerHTML = `<div class="pad pop"><h2>You're in, ${esc(me.name)}!</h2></div>
    <div class="big">Seat ${me.seat}</div>
    <p class="pad">Put your phone down and look at the board. The game starts there.</p>`;
}

function pick() {
  view.innerHTML = `
    <div class="hint">Generation ${state.gen} · Round ${state.round} — swipe to choose</div>
    <div class="carousel" id="car">${CARDS.map((c) => `
      <div class="card" data-card="${c}">
        ${c.startsWith('expose') ? '<span class="target"></span>' : ''}
        <img src="/img/${c}.jpg" alt="${LABEL[c]}" draggable="false">
      </div>`).join('')}</div>
    <div class="dots">${CARDS.map(() => '<i></i>').join('')}</div>
    <button class="btn go" id="lock"></button>`;
  const car = $('#car');
  const cards = [...car.children];
  const sync = () => {
    const mid = car.scrollLeft + car.clientWidth / 2;
    let best = 0, dist = Infinity;
    cards.forEach((el, i) => { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < dist) { dist = d; best = i; } });
    current = best;
    cards.forEach((el, i) => el.classList.toggle('cur', i === best));
    [...document.querySelectorAll('.dots i')].forEach((el, i) => el.classList.toggle('on', i === best));
    $('#lock').textContent = 'Play ' + LABEL[CARDS[best]];
  };
  car.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  cards.forEach((el, i) => el.addEventListener('click', () => el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })));
  // start on the card that was in the middle last time
  const start = cards[Math.min(current, cards.length - 1)];
  car.scrollLeft = start.offsetLeft + start.offsetWidth / 2 - car.clientWidth / 2;
  sync();
  $('#lock').onclick = () => { buzz(30); act('choose', { card: CARDS[current] }); };
}

function updateTargets() {
  const t = state.you.targets || {};
  for (const el of document.querySelectorAll('.card[data-card^="expose"]')) {
    const name = t[el.dataset.card];
    const chip = el.querySelector('.target');
    chip.textContent = name ? 'Targets ' + name : 'No target';
    chip.classList.toggle('none', !name);
  }
}

function locked() {
  view.innerHTML = `
    <div class="cardback hand"></div>
    <h2>Locked in</h2>
    <p class="pad">Phone down, eyes on the board — the reveal happens there.</p>
    <button class="btn ghost" id="undo">Change card</button>`;
  $('#undo').onclick = () => act('unchoose');
}

function skipping() {
  buzz([60, 60, 60]);
  view.innerHTML = `<div class="pad pop"><h2 class="bad">Exposed!</h2></div>
    <div class="big">⏸</div>
    <p class="pad">You sit out this round. You are back in the next one.</p>`;
}

function released(me) {
  const pts = me.saved[state.gen - 1] || 0;
  view.innerHTML = `<div class="pad pop"><h2 class="warn">AI released</h2></div>
    <div class="big">${pts}</div>
    <p class="pad">${pts === 1 ? 'point' : 'points'} saved in Generation ${state.gen}. You are safe from collapse — watch the others.</p>`;
}

function result(me, res) {
  const roll = state.rollResult;
  let html = '';
  if (res) {
    let line;
    if (res.card === 'release') line = `<h2 class="warn">Saved ${res.points} ${res.points === 1 ? 'point' : 'points'}</h2>`;
    else if (res.card === 'race' && res.exposedBy.length) line = `<h2 class="bad">Exposed! +${res.gain} Capability</h2><p>You skip the next round.</p>`;
    else if (res.card.startsWith('expose') && !res.hit) line = '<h2>Nothing to expose</h2><p>+0 Capability</p>';
    else line = `<h2 class="good">+${res.gain} Capability</h2>`;
    html += `<img class="mine pop" src="/img/${res.card}.jpg" alt="${LABEL[res.card]}"><div class="pad">${line}</div>`;
  } else if (me.skipping) html += '<div class="big">⏸</div><p class="pad">You sat out this round.</p>';
  else html += `<div class="pad"><h2 class="warn">AI released</h2><p>${me.saved[state.gen - 1] || 0} points saved this Generation.</p></div>`;

  if (state.phase === 'rolled' && roll && roll.roll !== null) {
    if (roll.collapse) {
      const lost = roll.lost[me.id];
      html += `<div class="pad pop"><h2 class="bad">Collapse!</h2><p>${lost !== undefined ? `You lost ${lost} Capability.` : 'Your saved points are safe.'}</p></div>`;
      buzz(lost !== undefined ? [200, 80, 200] : 40);
    } else {
      const auto = roll.autoReleased[me.id];
      html += `<div class="pad pop"><h2 class="good">No collapse</h2>${auto ? `<p>Auto-release: ${auto.points} ${auto.points === 1 ? 'point' : 'points'} saved.</p>` : ''}</div>`;
    }
  } else if (state.phase === 'revealed') html += '<p class="pad">Watch the board for the collapse roll.</p>';
  view.innerHTML = html;
  if (res && state.phase === 'revealed') buzz(40);
}

function final(me) {
  const row = state.ranking.find((r) => r.id === me.id);
  const place = ['', '1st', '2nd', '3rd', '4th', '5th'][row.rank];
  view.innerHTML = `<div class="pad pop"><h2>${row.rank === 1 ? 'You won the AI Race!' : 'Game over'}</h2></div>
    <div class="big">${place}</div>
    <p class="pad">${row.total} points (${row.saved.join(' + ')})</p>`;
  if (row.rank === 1) buzz([80, 60, 80, 60, 200]);
}
