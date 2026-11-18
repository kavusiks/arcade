// Scum UI and networking. The host runs the engine; clients send moves and render what the host sends.
import { createGame, newRound, act, botChoice, view, RANKS, SUITS } from './engine.js?v=1794964133';

const $ = id => document.getElementById(id);
// Load networking separately so the buttons still work (and show errors) if it fails.
let libs = null;
function showErr(t) { $('err').textContent = t; }
import('../../lib/lobby.js?v=1794964133')
  .then(m => { libs = m; })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));
const BOT_NAMES = ['Ada', 'Ben', 'Cy'];
const key = c => c.r + ',' + c.s;
// Everything from the network is untrusted: escape text, coerce cards to small integers.
const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const int = (x, lo, hi) => { const n = Number(x); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const cleanCard = c => { const r = int(c && c.r, 0, 12), s = int(c && c.s, 0, 3); return r === null || s === null ? null : { r, s }; };
const cleanCards = (a, max) => Array.isArray(a) ? a.slice(0, max).map(cleanCard).filter(Boolean) : [];
// Simple flood protection: at most 10 messages per second per peer.
const rate = new Map();
function tooFast(peer) {
  const now = Date.now(), r = rate.get(peer) || { t: now, n: 0 };
  if (now - r.t > 1000) { r.t = now; r.n = 0; }
  r.n++; rate.set(peer, r);
  return r.n > 10;
}
const same = (a, b) => a.r === b.r && a.s === b.s;

let lobby = null, isHost = false, myName = '', seat = -1, hostId = null;
let G = null, seatPeer = [], nextTimer = null, rosterTimer = null;   // host
let V = null, myHand = [];                                           // client
let sel = new Set(), err = '';

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}

function playerName() {
  return ($('name').value.trim() || 'Player').slice(0, 20);
}

// ---------- lobby ----------
function hostGame() {
  if (!libs) { showErr('Still loading networking, try again in a moment.'); return; }
  myName = playerName(); isHost = true; seat = 0;
  const pin = libs.makePin();
  lobby = libs.openLobby({ game: 'scum', pin, isHost: true, name: myName });
  lobby.onMessage(onMessage);
  $('pinShow').textContent = pin;
  show('lobby');
  renderRoster();
  rosterTimer = setInterval(renderRoster, 1000);
}

function joinGame() {
  const pin = $('pinIn').value.trim();
  if (!/^\d{4}$/.test(pin)) { $('pinIn').value = ''; $('pinIn').placeholder = 'Enter the 4-digit PIN'; return; }
  if (!libs) { showErr('Still loading networking, try again in a moment.'); return; }
  myName = playerName(); isHost = false;
  lobby = libs.openLobby({ game: 'scum', pin, isHost: false, name: myName });
  lobby.onMessage(onMessage);
  show('waiting');
  renderRoster();
  rosterTimer = setInterval(renderRoster, 1000);
}

function renderRoster() {
  if (!lobby) return;
  const others = [...lobby.peers.values()];
  if (isHost) {
    const names = [myName + ' (host)', ...others];
    $('roster').innerHTML = '<b>Players (' + names.length + '/4):</b> ' + names.map(esc).join(', ');
  } else {
    $('roster2').innerHTML = others.length
      ? '<b>Connected to:</b> ' + others.map(esc).join(', ') + '. Waiting for the host to start…'
      : 'Searching for the host… this can take up to 30 seconds. Check the PIN if it never connects.';
  }
}

function startGame() {
  clearInterval(rosterTimer);
  const peerIds = [...lobby.peers.keys()].slice(0, 3);
  const names = [myName, ...peerIds.map(id => lobby.peers.get(id))];
  const bots = names.map(() => false);
  seatPeer = [null, ...peerIds];
  while (names.length < 4) {
    names.push(BOT_NAMES[names.length - 1] + ' (bot)');
    bots.push(true);
    seatPeer.push(null);
  }
  G = createGame(names, bots);
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
  newRound(G);
  update();
}

// ---------- host ----------
function update() {
  renderAll();
  lobby.broadcast({ t: 'state', v: view(G) });
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'hand', hand: G.players[i].hand }, id); });
  if (G.roundOver) {
    if (!nextTimer) nextTimer = setTimeout(() => { nextTimer = null; newRound(G); update(); }, 3000);
    return;
  }
  if (G.players[G.turn].bot) {
    setTimeout(() => {
      if (G.roundOver || !G.players[G.turn].bot) return;
      const m = botChoice(G, G.turn);
      act(G, G.turn, m.kind, m.cards);
      update();
    }, 700);
  }
}

function hostMove(from, kind, cards) {
  const i = seatPeer.indexOf(from);
  if (i < 0) return;
  const r = act(G, i, kind, cards);
  if (!r.ok) lobby.send({ t: 'error', err: r.err }, from);
  else update();
}

// ---------- messages ----------
function onMessage(m, from) {
  if (!m || typeof m !== 'object' || tooFast(from)) return;
  if (isHost) {
    if (m.t === 'move' && G && (m.kind === 'play' || m.kind === 'pass'))
      hostMove(from, m.kind, cleanCards(m.cards, 4));
    return;
  }
  if (hostId && from !== hostId) return; // only listen to the host once known
  if (m.t === 'you') { const s = int(m.seat, 0, 3); if (s !== null) { seat = s; hostId = from; } }
  else if (m.t === 'state') { const v = cleanView(m.v); if (v) { hostId = hostId || from; V = v; } }
  else if (m.t === 'hand') { myHand = cleanCards(m.hand, 52); }
  else if (m.t === 'error') { err = String(m.err).slice(0, 100); }
  renderAll();
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length !== 4) return null;
  return {
    turn: int(v.turn, 0, 3) ?? 0,
    roundOver: !!v.roundOver,
    topCount: int(v.topCount, 0, 4) ?? 0,
    pile: cleanCards(v.pile, 4),
    log: Array.isArray(v.log) ? v.log.slice(0, 8).map(x => String(x).slice(0, 120)) : [],
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30),
      bot: !!(p && p.bot),
      count: int(p && p.count, 0, 52) ?? 0,
      place: int(p && p.place, -1, 3) ?? -1,
    })),
  };
}

// ---------- player actions ----------
function pick(k) {
  err = '';
  sel.has(k) ? sel.delete(k) : sel.add(k);
  renderAll();
}

function selectedCards(hand) {
  return hand.filter(c => sel.has(key(c)));
}

function sendMove(kind) {
  const hand = isHost ? G.players[0].hand : myHand;
  const cards = kind === 'play' ? selectedCards(hand).map(c => ({ r: c.r, s: c.s })) : [];
  sel = new Set();
  if (isHost) {
    const r = act(G, 0, kind, cards);
    if (!r.ok) { err = r.err; renderAll(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', kind, cards }, hostId);
  }
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(joinGame);
window.startGame = safe(startGame);
window.playSel = safe(() => sendMove('play'));
window.passTurn = safe(() => sendMove('pass'));
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));
window.pick = pick;

// ---------- rendering ----------
function cardHTML(c, clickable) {
  const red = c.s === 1 || c.s === 2;
  const k = key(c);
  const cls = 'card' + (red ? ' red' : '') + (sel.has(k) ? ' sel' : '');
  const click = clickable ? ` onclick="pick('${k}')"` : '';
  return `<span class="${cls}"${click}>${RANKS[c.r]}<br>${SUITS[c.s]}</span>`;
}

function renderAll() {
  if (isHost && G) renderGame(view(G), G.players[0].hand, 0);
  else if (!isHost && V) renderGame(V, myHand, seat);
}

function renderGame(v, hand, me) {
  if (!isHost) clearInterval(rosterTimer);
  show('game');
  const myTurn = v.turn === me && !v.roundOver;
  $('seats').innerHTML = v.players.map((p, i) =>
    '<div class="muted">' + (!v.roundOver && i === v.turn ? '▶ ' : '') +
    (i === me ? 'You' : esc(p.name)) + (p.bot ? ' 🤖' : '') + ': ' +
    (p.place >= 0 ? 'out #' + (p.place + 1) : p.count + ' cards') + '</div>'
  ).join('');
  $('pile').innerHTML = v.pile.map(c => cardHTML(c, false)).join('') || '<span class="muted">empty</span>';
  $('hand').innerHTML = hand.map(c => cardHTML(c, myTurn)).join('');
  $('msg').textContent = err || (v.roundOver ? 'Round over. Next round starts shortly…'
    : myTurn ? 'Your turn: select cards and press Play, or Pass.'
    : v.players[v.turn].name + ' is playing…');
  $('play').disabled = !myTurn;
  $('pass').disabled = !myTurn || v.topCount === 0;
  $('log').innerHTML = v.log.map(esc).join('<br>');
  if (isHost && $('start')) $('start').disabled = true;
}
