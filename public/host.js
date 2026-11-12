'use strict';
// Big-screen client: lobby, board, reveal, die, ranking.
// The server sends the full room state after every change; this file animates from the
// state on screen (S) to the new one, one transition at a time.
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || '').toUpperCase();
const token = localStorage.getItem('airace-host-' + room);
const SPEED = Number(params.get('speed')) || 1; // ?speed=0.2 for quick testing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SPEED));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { cooperate: 'Cooperate', race: 'Race', release: 'Release', exposeLeft: 'Expose Left', exposeRight: 'Expose Right' };
const START_SAFETY = [12, 11, 10];
const SAFETY_COLORS = ['#6e0a0a', '#b01212', '#c41818', '#d42a17', '#e04a16', '#ea6a14', '#f08c12', '#e8b70f', '#c9c41a', '#9cc21f', '#5faa22', '#2f8f27', '#0f6a2b'];

if (!room || !token) location.replace('/');

let S = null;              // state currently shown
let chain = Promise.resolve();
let boardKey = '';

// ---------- sound (synthesised, no files) ----------
const Sfx = (() => {
  let ctx = null;
  let muted = localStorage.getItem('airace-mute') === '1';
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(f, d, { f2, type = 'sine', t = 0, v = 0.18 } = {}) {
    const c = ac(); if (!c || muted) return;
    const o = c.createOscillator(), g = c.createGain(), s = c.currentTime + t * SPEED;
    o.type = type; o.frequency.setValueAtTime(f, s);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + d);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
    o.connect(g).connect(c.destination); o.start(s); o.stop(s + d + 0.05);
  }
  function noise(d, { t = 0, v = 0.2, f = 1200, f2, q = 0.8 } = {}) {
    const c = ac(); if (!c || muted) return;
    const n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain(), s = c.currentTime + t * SPEED;
    src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f, s);
    if (f2) bp.frequency.exponentialRampToValueAtTime(f2, s + d);
    g.gain.setValueAtTime(v, s); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
    src.connect(bp).connect(g).connect(c.destination); src.start(s);
  }
  return {
    unlock: ac,
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.setItem('airace-mute', muted ? '1' : '0'); return muted; },
    join() { tone(520, 0.12, { type: 'triangle' }); tone(780, 0.18, { type: 'triangle', t: 0.09 }); },
    lock() { tone(300, 0.09, { f2: 620, type: 'triangle', v: 0.15 }); },
    banner() { noise(0.5, { f: 300, f2: 3000, v: 0.16 }); tone(110, 0.7, { type: 'sawtooth', t: 0.25, v: 0.14 }); tone(220, 0.7, { type: 'triangle', t: 0.25, v: 0.14 }); },
    deal() { noise(0.25, { f: 2500, f2: 600, v: 0.12 }); },
    flip() { noise(0.18, { f: 800, f2: 4000, v: 0.25 }); tone(196, 0.5, { type: 'triangle', t: 0.1, v: 0.2 }); tone(392, 0.5, { type: 'triangle', t: 0.1, v: 0.12 }); },
    whistle() { for (let i = 0; i < 5; i++) tone(2300, 0.09, { f2: 2650, t: i * 0.085, v: 0.1 }); tone(2400, 0.35, { f2: 2000, t: 0.45, v: 0.1 }); },
    tick() { tone(700, 0.07, { f2: 950, type: 'square', v: 0.07 }); },
    arrive() { tone(1046, 0.5, { type: 'triangle', v: 0.2 }); tone(1568, 0.6, { type: 'sine', t: 0.07, v: 0.16 }); noise(0.25, { f: 6000, v: 0.06 }); },
    coin() { tone(988, 0.09, { type: 'square', v: 0.1 }); tone(1319, 0.45, { type: 'square', t: 0.09, v: 0.1 }); },
    up() { tone(523, 0.14, { f2: 784, type: 'triangle' }); },
    down() { tone(330, 0.2, { f2: 165, type: 'sawtooth', v: 0.13 }); },
    same() { tone(440, 0.1, { type: 'triangle', v: 0.1 }); },
    dice() { for (let i = 0; i < 9; i++) noise(0.05, { t: 0.1 + i * i * 0.022 + i * 0.06, f: 1800 + Math.random() * 1500, q: 3, v: 0.3 }); },
    safe() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, { type: 'triangle', t: i * 0.09, v: 0.15 })); },
    collapse() { noise(1.8, { f: 900, f2: 50, v: 0.5, q: 0.4 }); tone(220, 1.6, { f2: 35, type: 'sawtooth', v: 0.3 }); tone(90, 1.8, { f2: 30, type: 'square', v: 0.2 }); },
    rank() { tone(392, 0.2, { type: 'triangle' }); noise(0.15, { f: 3000, v: 0.08 }); },
    fanfare() { [523, 523, 523, 659, 784, 1046].forEach((f, i) => tone(f, i === 5 ? 1 : 0.16, { type: 'square', t: [0, 0.15, 0.3, 0.45, 0.65, 0.85][i], v: 0.1 })); [262, 330, 392].forEach((f) => tone(f, 1.2, { type: 'triangle', t: 0.85, v: 0.12 })); },
  };
})();
document.addEventListener('pointerdown', Sfx.unlock);

// ---------- server ----------
async function act(type, extra) {
  try {
    const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: room, token, type, ...extra }) });
    if (!r.ok) throw new Error((await r.json()).error);
  } catch (e) { console.warn(e.message); const le = $('#lerr'); if (le) le.textContent = e.message || ''; }
}
const es = new EventSource(`/api/events?room=${room}&token=${token}`);
es.onmessage = (m) => {
  const d = JSON.parse(m.data);
  $('#offline').style.display = 'none';
  if (d.error) { es.close(); localStorage.removeItem('airace-host-' + room); location.replace('/'); return; }
  chain = chain.then(() => transition(d)).catch((e) => { console.error(e); S = d; try { renderStatic(d); } catch (x) { console.error(x); } });
};
es.onerror = () => { $('#offline').style.display = 'block'; };
(function keepAwake() {
  const req = () => navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {});
  req();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') req(); });
})();

// ---------- transitions ----------
async function transition(n) {
  const p = S;
  if (n.phase === 'lobby') {
    $('#game').hidden = true; $('#final').hidden = true; $('#lobby').hidden = false;
    if (p && p.phase === 'lobby' && n.players.length > p.players.length) Sfx.join();
    renderLobby(n); S = n; return;
  }
  $('#lobby').hidden = true; $('#game').hidden = false;
  buildBoard(n);
  if (!p) { // page (re)loaded mid-game: show the state as it is
    renderStatic(n);
    if (n.phase === 'final') await showFinal(n, false);
  } else if (n.phase === 'choose') {
    $('#final').hidden = true;
    const newRound = p.phase !== 'choose' || p.gen !== n.gen || p.round !== n.round;
    if (!newRound && n.players.filter((x) => x.locked).length > p.players.filter((x) => x.locked).length) Sfx.lock();
    renderStatic(n);
    if (newRound) {
      if (n.round === 1) await banner(`Generation ${n.gen}`, `Safety starts at ${START_SAFETY[n.gen - 1]}`, 2400);
      await banner(`Round ${n.round}`, n.round === 6 ? 'Last round of this generation' : 'Discuss, then choose your card', 1700);
    }
  } else if (n.phase === 'revealed' && p.phase === 'choose') {
    await animReveal(n); renderStatic(n);
  } else if (n.phase === 'rolled' && p.phase === 'choose') { // everybody released: no roll
    await animReveal(n); await animRoll(n); renderStatic(n);
  } else if (n.phase === 'rolled' && p.phase === 'revealed') {
    await animRoll(n); renderStatic(n);
  } else if (n.phase === 'final' && p.phase !== 'final') {
    renderStatic(n); await showFinal(n, true);
  } else renderStatic(n);
  S = n;
}

// ---------- lobby ----------
let qrFor = '';
async function renderLobby(n) {
  $('#lcode').textContent = n.code;
  $('#count').textContent = `${n.players.length} / 5`;
  const list = $('#seats');
  list.innerHTML = '';
  n.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = `seat${p.seat}` + (p.connected ? '' : ' off');
    li.innerHTML = `<span class="hex pc">${p.seat}</span><span class="nm">${esc(p.name)}${p.connected ? '' : ' 📵'}</span>
      <button data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}><svg class="tri" viewBox="0 0 12 10" aria-hidden="true"><path d="M6 1 11 9H1z" fill="currentColor"/></svg></button><button data-a="down" title="Move down" ${i === n.players.length - 1 ? 'disabled' : ''}><svg class="tri" viewBox="0 0 12 10" aria-hidden="true"><path d="M6 9 1 1h10z" fill="currentColor"/></svg></button><button data-a="kick">✕</button>`;
    li.querySelector('[data-a=up]').onclick = () => act('move', { id: p.id, dir: -1 });
    li.querySelector('[data-a=down]').onclick = () => act('move', { id: p.id, dir: 1 });
    li.querySelector('[data-a=kick]').onclick = () => act('kick', { id: p.id });
    if (S && S.phase === 'lobby' && S.players.some((x) => x.id === p.id)) li.style.animation = 'none';
    list.appendChild(li);
  });
  for (let i = n.players.length; i < 5; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = i < 4 || n.players.length < 4 ? `Seat ${i + 1} — waiting…` : 'Seat 5 — optional';
    list.appendChild(li);
  }
  $('#start').disabled = n.players.length < 2;
  if (qrFor !== n.code) {
    qrFor = n.code;
    let origin = location.origin;
    if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
      try { const info = await (await fetch('/api/info')).json(); if (info.lan[0]) origin = info.lan[0]; } catch { /* keep localhost */ }
    }
    const url = `${origin}/play?room=${n.code}`;
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    $('#qr').innerHTML = q.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
    $('#joinurl').textContent = url.replace(/^https?:\/\//, '');
  }
}
$('#start').onclick = () => { Sfx.unlock(); act('start'); };

// ---------- board ----------
function buildBoard(n) {
  const key = n.players.map((p) => p.id + p.name).join('|');
  if (key === boardKey) return;
  boardKey = key;
  $('#gcode').textContent = n.code;
  $('#gens').querySelectorAll('.chip').forEach((e) => e.remove());
  $('#rounds').querySelectorAll('.chip').forEach((e) => e.remove());
  for (let i = 1; i <= 3; i++) $('#gens').insertAdjacentHTML('beforeend', `<span class="chip" data-g="${i}">${i}</span>`);
  for (let i = 1; i <= 6; i++) $('#rounds').insertAdjacentHTML('beforeend', `<span class="chip" data-r="${i}">${i}</span>`);
  $('#rows').innerHTML = n.players.map((p) => `
    <div class="row seat${p.seat}" id="row-${p.id}">
      <div class="who"><span class="hex pc">${p.seat}</span><span class="txt"><span class="nm">${esc(p.name)}</span><span class="tag"></span></span></div>
      <div class="slot" data-k=""></div>
      <div class="track" style="--cap:0">
        ${Array.from({ length: 13 }, (_, i) => `<span class="cell${i === 0 ? ' zero' : ''}${[1, 4, 7, 9, 11].includes(i) ? ' b' : ''}">${i}</span>`).join('')}
        <span class="dot">${p.seat}</span>
      </div>
      <div class="saved"><span class="sv"></span><span class="sv"></span><span class="sv"></span><span class="sv sum"></span></div>
    </div>`).join('');
  $('#strack').innerHTML = SAFETY_COLORS.map((c, i) => `<span class="sc" style="background:${c}">${i}</span>`).join('');
}
const row = (id) => document.getElementById('row-' + id);
const nameOf = (st, id) => (st.players.find((p) => p.id === id) || {}).name || '?';

function setSlot(el, key, html) { if (el.dataset.k !== key) { el.dataset.k = key; el.innerHTML = html; } }
function setSafety(v) {
  // cells above the current Safety are the rolls that cause a collapse
  document.querySelectorAll('.sc').forEach((e, i) => { e.classList.toggle('on', i === v); e.classList.toggle('danger', i > v); });
  const z = $('#czone');
  z.classList.toggle('none', v >= 12);
  z.textContent = v >= 12 ? 'No roll can cause a collapse' : `Collapse on a roll of ${v === 11 ? '12' : (v + 1) + '–12'} · ${12 - v} in 12`;
}
/** Marker on the Safety track showing where the die landed (null removes it). */
function setRollMark(roll, animate) {
  const track = $('#strack');
  const old = track.querySelector('.rollmark');
  if (roll === null || roll === undefined) { if (old) old.remove(); return; }
  if (old && +old.dataset.roll === roll) return;
  if (old) old.remove();
  const m = document.createElement('span');
  m.className = 'rollmark' + (animate ? ' drop' : '');
  m.dataset.roll = roll;
  m.style.left = `calc(${roll} * (100% + .35vw) / 13 + (100% - 12 * .35vw) / 26)`;
  m.innerHTML = `<i>${roll}</i>`;
  track.appendChild(m);
}
function setSaved(r, p, gen) {
  const cells = r.querySelectorAll('.sv');
  p.saved.forEach((v, i) => { cells[i].textContent = v === null ? '' : v; cells[i].classList.toggle('cur', i === gen - 1); });
  cells[3].textContent = p.total;
}

function renderStatic(n) {
  document.querySelectorAll('#gens .chip').forEach((e) => { const g = +e.dataset.g; e.className = 'chip' + (g === n.gen && n.phase !== 'final' ? ' on' : g < n.gen || n.phase === 'final' ? ' done' : ''); });
  document.querySelectorAll('#rounds .chip').forEach((e) => { const r = +e.dataset.r; e.className = 'chip' + (r === n.round && n.phase !== 'final' ? ' on' : r < n.round ? ' done' : ''); });
  const shown = n.phase === 'revealed' || n.phase === 'rolled';
  const R = shown ? n.resolution : null;
  for (const p of n.players) {
    const r = row(p.id); if (!r) continue;
    const res = R && R.players[p.id];
    const lost = n.rollResult ? n.rollResult.lost[p.id] : undefined;
    r.classList.toggle('released', p.released);
    r.classList.toggle('skipping', p.skipping);
    r.classList.toggle('off', !p.connected);
    const track = r.querySelector('.track');
    const dot = r.querySelector('.dot');
    dot.classList.remove('fall');
    track.style.setProperty('--cap', p.capability);
    dot.classList.toggle('gone', p.released || n.phase === 'final');
    const tag = r.querySelector('.tag');
    tag.className = 'tag';
    if (p.released) { tag.textContent = 'Released'; tag.classList.add('rel'); }
    else if (lost !== undefined) { tag.textContent = `Lost ${lost}`; tag.classList.add('skip'); }
    else if (res && res.skipNext && !n.genOver) { tag.textContent = 'Skips next round'; tag.classList.add('skip'); }
    else if (p.skipping) { tag.textContent = 'Sits out'; tag.classList.add('skip'); }
    else if (n.phase === 'choose' && p.active && !p.locked && !p.connected) {
      tag.innerHTML = '<button class="auto">Phone offline – play Cooperate</button>';
      tag.firstChild.onclick = () => act('autoplay', { id: p.id });
    } else tag.textContent = '';
    const slot = r.querySelector('.slot');
    if (res) setSlot(slot, 'f' + res.card, `<img src="/img/${res.card}.jpg" alt="${LABEL[res.card]}">`);
    else if (n.phase === 'choose' && p.active) setSlot(slot, p.locked ? 'back' : 'empty', p.locked ? '<div class="cardback"></div>' : '<div class="ph"></div>');
    else setSlot(slot, p.skipping ? 'skip' : 'rel', `<div class="ph">${p.skipping ? '⏸' : p.released ? '🏛' : ''}</div>`);
    setSaved(r, p, n.gen);
  }
  setSafety(n.safety);
  setRollMark(n.phase === 'rolled' && n.rollResult ? n.rollResult.roll : null, false);
  renderStage(n);
}

// ---------- stage (right-hand panel) ----------
function setStep(indices, label) {
  document.querySelectorAll('#steps i').forEach((e, i) => e.classList.toggle('on', indices.includes(i)));
  $('#steplabel').textContent = label;
}
function mathHtml(n) {
  const s = n.resolution.safety;
  return `<div class="math">
    <span class="${s.majority ? 'plus' : 'nil'}">${s.majority ? '+1' : '±0'} · ${s.coop} of ${s.active} cooperative${s.majority ? ' (majority)' : ' (no majority)'}</span>
    <span class="${s.races ? 'minus' : 'nil'}">${s.races ? '−' + s.races : '±0'} · ${s.races} × Race</span>
    <span class="tot">Safety ${s.before}<svg class="arrow" viewBox="0 0 20 14" aria-label="to"><path d="M1 7h15M11 2l6 5-6 5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${s.after}</span></div>`;
}
function genSummary(n) {
  return `<div class="genpts">${n.players.map((p) => `<div class="seat${p.seat}"><span>${esc(p.name)}</span><span>${p.saved[n.gen - 1] || 0} P</span></div>`).join('')}</div>`;
}
function renderStage(n) {
  const body = $('#stagebody'), btn = $('#stagebtn'), wrap = $('#diewrap'), verdict = $('#verdict'), note = $('#stagenote');
  btn.hidden = true; btn.className = 'btn go'; btn.disabled = false; wrap.hidden = true; wrap.classList.remove('ready', 'throw');
  verdict.textContent = ''; verdict.className = 'verdict display'; note.textContent = '';
  body.classList.toggle('fill', n.phase === 'choose');
  if (n.phase === 'choose') {
    const act_ = n.players.filter((p) => p.active), locked = act_.filter((p) => p.locked).length;
    setStep([0, 1], 'Discussion · Action selection');
    body.innerHTML = `<div class="q">Who needs to be kept in check?</div><div class="q">Is everybody on board with cooperating to lower the risk for everyone?</div>
      <div class="count">${locked} / ${act_.length}<small>cards locked in</small></div>`;
    note.textContent = n.allLocked ? 'Everybody is ready.' : 'Choose your card on your phone.';
    btn.hidden = false; btn.textContent = 'Reveal'; btn.disabled = !n.allLocked; btn.classList.toggle('ready', n.allLocked);
    btn.onclick = () => { btn.disabled = true; act('reveal'); };
  } else if (n.phase === 'revealed') {
    setStep([3], 'Collapse roll');
    body.innerHTML = mathHtml(n);
    wrap.hidden = false; wrap.classList.add('ready');
    note.textContent = `Tap the die. Collapse if the roll is higher than ${n.safety}.`;
    wrap.onclick = () => { wrap.onclick = null; Sfx.unlock(); act('roll'); };
  } else if (n.phase === 'rolled') {
    const rr = n.rollResult;
    setStep([3], n.genOver ? `Generation ${n.gen} is over` : 'Collapse roll');
    body.innerHTML = n.genOver ? genSummary(n) : mathHtml(n);
    if (rr.roll !== null) {
      wrap.hidden = false; wrap.onclick = null; Die.show(rr.roll);
      verdict.textContent = rr.collapse ? 'Collapse!' : 'Safe';
      verdict.classList.add(rr.collapse ? 'collapse' : 'safe');
      note.textContent = rr.collapse ? `Roll ${rr.roll} is higher than Safety ${n.safety}.` : `Roll ${rr.roll} is not higher than Safety ${n.safety}.`;
    } else { verdict.textContent = 'All released'; verdict.classList.add('safe'); note.textContent = 'Nobody is at risk – no collapse roll.'; }
    btn.hidden = false;
    btn.textContent = !n.genOver ? 'Next round' : n.gen < 3 ? `Start Generation ${n.gen + 1}` : 'Final ranking';
    btn.onclick = () => { btn.disabled = true; act('next'); };
  } else { setStep([], 'Game over'); body.innerHTML = ''; }
}

// ---------- d12 ----------
const Die = (() => {
  const el = $('#die');
  const faces = {}; // number → [theta, phi, psi]
  const upper = [2, 4, 6, 8, 10];
  const add = (num, th, ph, ps) => {
    faces[num] = [th, ph, ps];
    const f = document.createElement('div');
    f.className = 'face';
    f.style.transform = `rotateY(${th}deg) rotateX(${ph}deg) translateZ(calc(var(--a) * 1.1135)) rotateZ(${ps}deg)`;
    f.innerHTML = `<span class="${num === 6 || num === 9 ? 'u' : ''}">${num}</span>`;
    el.appendChild(f);
  };
  add(12, 0, 90, 0); add(1, 0, -90, 0);
  upper.forEach((num, k) => { add(num, 72 * k, 26.565, 180); add(13 - num, 72 * k + 180, -26.565, 0); });
  let cur = [0, -20, 20];
  const apply = () => { el.style.transform = `rotateZ(${cur[0]}deg) rotateX(${cur[1]}deg) rotateY(${cur[2]}deg)`; };
  const aim = (num, turns) => {
    const [th, ph, ps] = faces[num];
    const want = [-ps, -ph, -th];
    cur = cur.map((c, i) => { let t = want[i]; while (t < c + turns[i] * 360) t += 360; return t; });
  };
  return {
    show(num) { el.classList.remove('rolling'); cur = cur.map((c) => c % 360); aim(num, [0, 0, 0]); apply(); },
    roll(num) { el.classList.add('rolling'); aim(num, [1, 3, 2]); void el.offsetWidth; apply(); },
  };
})();

// ---------- animations ----------
async function banner(big, small, ms) {
  const b = $('#banner');
  $('#b1').textContent = big; $('#b2').textContent = small;
  b.querySelector('.stripe').style.setProperty('--dur', (ms * SPEED) + 'ms');
  b.hidden = false; Sfx.banner();
  await sleep(ms);
  b.hidden = true;
}

async function animReveal(n) {
  const R = n.resolution;
  setStep([2], 'Action resolution');
  $('#stagebtn').hidden = true; $('#stagebody').innerHTML = ''; $('#stagebody').classList.remove('fill'); $('#stagenote').textContent = '';
  // 1. big cards, face down → flip together
  const ov = $('#reveal');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="rcards">${R.order.map((id, i) => {
    const p = n.players.find((x) => x.id === id), r = R.players[id];
    return `<div class="rc seat${p.seat}" data-id="${id}"><div class="nm"><span class="hex pc">${p.seat}</span><span>${esc(p.name)}</span></div>
      <div class="flip" style="animation-delay:${i * 90 * SPEED}ms"><div class="cardback"></div><img src="/img/${r.card}.jpg" alt=""></div><div class="out"></div></div>`;
  }).join('')}</div>`;
  ov.hidden = false; Sfx.deal();
  await sleep(1300);
  ov.querySelectorAll('.flip').forEach((f) => f.classList.add('open'));
  Sfx.flip();
  await sleep(1500);
  let anyHit = false;
  for (const id of R.order) {
    const r = R.players[id], el = ov.querySelector(`.rc[data-id="${id}"]`), out = el.querySelector('.out');
    if (r.card === 'cooperate') { out.textContent = '+1'; out.classList.add('g'); }
    else if (r.card === 'race') {
      if (r.exposedBy.length) { anyHit = true; out.textContent = `+${2 - r.exposedBy.length} · skips a round`; out.classList.add('b'); el.insertAdjacentHTML('beforeend', '<div class="stamp">Exposed!</div>'); }
      else { out.textContent = '+2 · Safety −1'; out.classList.add('b'); }
    } else if (r.card === 'release') { out.textContent = `Saves ${r.points} P`; out.classList.add('o'); }
    else if (r.hit) { out.textContent = `Caught ${nameOf(n, r.target)}! +2`; out.classList.add('g'); }
    else out.textContent = r.target ? `${nameOf(n, r.target)} did not race` : 'No target';
    out.classList.add('show');
  }
  if (anyHit) Sfx.whistle();
  await sleep(anyHit ? 3400 : 2600);
  ov.classList.add('out');
  await sleep(400);
  ov.hidden = true;
  // 2. cards land in the rows
  for (const id of R.order) {
    const r = R.players[id];
    setSlot(row(id).querySelector('.slot'), 'f' + r.card, `<img src="/img/${r.card}.jpg" alt="">`);
  }
  await sleep(300);
  // 3. capability dots
  for (const id of R.order) {
    const r = R.players[id];
    if (r.released) continue;
    if (r.exposedBy.length) {
      row(id).querySelector('.track').insertAdjacentHTML('beforeend', '<div class="stamp">Exposed!</div>');
      const tag = row(id).querySelector('.tag'); tag.className = 'tag skip'; tag.textContent = 'Skips next round';
      setTimeout(() => { const s = row(id).querySelector('.stamp'); if (s) s.remove(); }, 1900 * SPEED);
    }
    if (r.capAfter > r.capBefore) await moveDot(id, r.capBefore, r.capAfter);
    else if (r.exposedBy.length) await sleep(700);
  }
  // 4. releases
  for (const id of R.order) {
    const r = R.players[id];
    if (r.released) await bank(n, id, r.points);
  }
  // 5. safety
  $('#stagebody').innerHTML = mathHtml(n);
  await moveSafety(R.safety.before, R.safety.after);
  await sleep(500);
}

async function moveDot(id, from, to) {
  const track = row(id).querySelector('.track');
  for (let c = from + 1; c <= to; c++) {
    track.style.setProperty('--cap', c);
    Sfx.tick();
    await sleep(330);
  }
  Sfx.arrive();
  track.insertAdjacentHTML('beforeend', `<span class="burst"></span><span class="floater">+${to - from}</span>`);
  const added = [...track.querySelectorAll('.burst, .floater')];
  setTimeout(() => added.forEach((e) => e.remove()), 1400);
  await sleep(650);
}

async function bank(n, id, points) {
  const r = row(id), p = n.players.find((x) => x.id === id);
  r.querySelector('.dot').classList.add('gone');
  const cells = r.querySelectorAll('.sv');
  const cell = cells[n.gen - 1];
  cell.textContent = points; cell.classList.remove('bank'); void cell.offsetWidth; cell.classList.add('bank');
  cells[3].textContent = p.saved.reduce((a, b, i) => a + (i === n.gen - 1 ? points : b || 0), 0);
  r.classList.add('released');
  const tag = r.querySelector('.tag'); tag.className = 'tag rel'; tag.textContent = 'Released';
  Sfx.coin();
  await sleep(800);
}

async function moveSafety(from, to) {
  const cells = [...document.querySelectorAll('.sc')];
  const pulse = (i) => { cells[i].classList.remove('pulse'); void cells[i].offsetWidth; cells[i].classList.add('pulse'); };
  if (from === to) { pulse(to); Sfx.same(); await sleep(500); return; }
  const dir = to > from ? 1 : -1;
  for (let v = from + dir; v !== to + dir; v += dir) {
    setSafety(v); pulse(v);
    if (dir > 0) Sfx.up(); else Sfx.down();
    await sleep(450);
  }
}

async function animRoll(n) {
  const rr = n.rollResult, verdict = $('#verdict'), note = $('#stagenote'), wrap = $('#diewrap');
  setStep([3], 'Collapse roll');
  if (rr.roll === null) { await sleep(500); return; }
  wrap.hidden = false; wrap.classList.remove('ready'); void wrap.offsetWidth; wrap.classList.add('throw');
  wrap.style.animationDuration = (2300 * SPEED) + 'ms';
  note.textContent = '';
  Die.roll(rr.roll); Sfx.dice();
  await sleep(2500);
  setRollMark(rr.roll, true); Sfx.tick();
  await sleep(700);
  verdict.className = 'verdict display ' + (rr.collapse ? 'collapse' : 'safe');
  verdict.textContent = rr.collapse ? 'Collapse!' : 'Safe';
  note.textContent = rr.collapse ? `Roll ${rr.roll} is higher than Safety ${n.safety}.` : `Roll ${rr.roll} is not higher than Safety ${n.safety}.`;
  if (rr.collapse) {
    Sfx.collapse();
    const fl = $('#flash'); fl.hidden = false; setTimeout(() => { fl.hidden = true; }, 1200);
    const game = $('#game'); game.classList.remove('shake'); void game.offsetWidth; game.classList.add('shake');
    for (const id of Object.keys(rr.lost)) {
      const r = row(id);
      r.querySelector('.dot').classList.add('fall');
      r.querySelector('.track').style.setProperty('--cap', 0);
      const cell = r.querySelectorAll('.sv')[n.gen - 1]; cell.textContent = '0';
      const tag = r.querySelector('.tag'); tag.className = 'tag skip'; tag.textContent = `Lost ${rr.lost[id]}`;
    }
    await sleep(2000);
  } else {
    Sfx.safe();
    await sleep(900);
    for (const id of Object.keys(rr.autoReleased)) await bank(n, id, rr.autoReleased[id].points);
  }
}

// ---------- final ranking ----------
async function showFinal(n, animate) {
  const list = $('#rank'), ov = $('#final');
  ov.querySelectorAll('.confetti').forEach((e) => e.remove());
  $('.finalbtns').classList.remove('in');
  const place = ['', '1st', '2nd', '3rd', '4th', '5th'];
  list.innerHTML = n.ranking.map((r) => {
    const p = n.players.find((x) => x.id === r.id);
    return `<li class="seat${p.seat}${r.rank === 1 ? ' win' : ''}"><span class="pl">${place[r.rank]}</span><span>${esc(p.name)}</span><span class="gs">${r.saved.join(' + ')}</span><span class="tot">${r.total}</span></li>`;
  }).join('');
  ov.hidden = false;
  const items = [...list.children].reverse();
  if (animate) await sleep(900);
  for (const li of items) {
    const win = li.classList.contains('win');
    if (animate) { if (win) { await sleep(700); Sfx.fanfare(); } else Sfx.rank(); }
    li.classList.add('in');
    if (animate) await sleep(win ? 300 : 1000);
  }
  confetti(ov);
  $('.finalbtns').classList.add('in');
}
function confetti(parent) {
  const colors = ['#2f6bff', '#d61f8c', '#e8930c', '#0ea5a0', '#7c3aed', '#fff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};animation-duration:${2.5 + Math.random() * 3}s;animation-delay:${Math.random() * 2.5}s;transform:rotate(${Math.random() * 360}deg)`;
    parent.appendChild(c);
    c.addEventListener('animationend', () => c.remove());
  }
}
$('#again').onclick = () => act('restart');
$('#tolobby').onclick = () => act('lobby');

// ---------- tools ----------
$('#helpbtn').onclick = () => { $('#help').hidden = false; };
$('#helpclose').onclick = () => { $('#help').hidden = true; };
$('#help').onclick = (e) => { if (e.target.id === 'help') $('#help').hidden = true; };
$('#mute').textContent = Sfx.muted ? '🔇' : '🔊';
$('#mute').onclick = () => { $('#mute').textContent = Sfx.toggle() ? '🔇' : '🔊'; };
$('#fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); };
