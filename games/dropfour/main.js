// Drop Four UI and networking. The host runs the engine; the other player sends moves.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newRound, act, botMove, view, COLS, ROWS } from './engine.js?v=1795041974';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795041974')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const BOT_NAMES = { easy: 'Easy bot', hard: 'Hard bot' };

// ---------- helpers: everything from the network is untrusted ----------
const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const int = (x, lo, hi) => { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const rate = new Map(); // flood protection: at most 10 messages per second per peer
function tooFast(peer) {
  const now = Date.now(), r = rate.get(peer) || { t: now, n: 0 };
  if (now - r.t > 1000) { r.t = now; r.n = 0; }
  r.n++; rate.set(peer, r);
  return r.n > 10;
}
function cleanAction(a) {
  const cell = int(a && a.cell, 0, 6); // column
  return a && a.t === 'cell' && cell !== null ? { t: 'cell', cell } : null;
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-dropfour-session';
function saveSession(o) { try { sessionStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
function clearSession() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

// ---------- state ----------
let lobby = null, isHost = false, myName = '', myKey = '', pin = '', secret = '';
// host
let G = null, roster = new Map(), seatKey = [], seatPeer = [], botTimer = null;
// player
let hostId = null, hostAway = false, seat = -1, V = null, lobbyNames = [];
let err = '';

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'dropfour', pin, secret, info: { name: myName, key: myKey, host: isHost } });
  lobby.on('message', onMessage);
  lobby.on('join', onPeerInfo);
  lobby.on('leave', onPeerLeave);
}

// ---------- entering and leaving ----------
function hostGame() {
  if (!libs) { showErr('Still loading networking, try again in a moment.'); return; }
  myName = playerName(); myKey = newKey(); pin = libs.makePin(); secret = libs.makeSecret(); isHost = true; G = null;
  openRoom();
  saveHost();
  render();
}

// A join code looks like 4821-<22 chars>; it can be typed, pasted alone, or pasted as the full link.
const CODE_RE = /(\d{4})-([A-Za-z0-9]{22})/;
const joinLink = () => location.origin + location.pathname + location.search + '#join=' + pin + '-' + secret;

function joinGame(code) {
  const m = String(code || $('pinIn').value).trim().match(CODE_RE);
  if (!m) { $('pinIn').value = ''; $('pinIn').placeholder = 'Scan the QR code or paste the join link'; return; }
  if (!libs) { showErr('Still loading networking, try again in a moment.'); return; }
  myName = playerName(); myKey = newKey(); pin = m[1]; secret = m[2]; isHost = false;
  saveSession({ role: 'player', pin, secret, name: myName, key: myKey });
  openRoom();
  render();
}

// Opened from a join link or QR code: fill in the code, then remove the secret from the address bar.
function joinFromHash() {
  const m = location.hash.match(/^#join=(\d{4}-[A-Za-z0-9]{22})$/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  const s = loadSession();
  if (s && s.pin + '-' + s.secret === m[1]) return false; // same game as this tab's session: just resume
  if (s && s.role === 'host') return false;                // never kick a host out of their own game
  $('pinIn').value = m[1];                                  // pre-fill; the player adds a name and presses Join
  $('joinHint').textContent = 'Game code filled in. Type your name and press Join.';
  $('name').focus();
  return true;
}

// After a refresh: rejoin the same room with the same identity.
function resume() {
  const s = loadSession();
  if (!s || !s.pin || !s.key || !s.secret) return;
  pin = s.pin; secret = s.secret; myName = s.name || 'Player'; myKey = s.key; isHost = s.role === 'host';
  if (isHost) {
    G = s.G || null;
    seatKey = Array.isArray(s.seatKey) ? s.seatKey : [];
    seatPeer = seatKey.map(() => null); // players reconnect with new peer ids
  }
  openRoom();
  if (isHost && G) update(); else render();
}

function saveHost() { saveSession({ role: 'host', pin, secret, name: myName, key: myKey, G, seatKey }); }

function cancelGame() {
  if (!confirm('Cancel the game for everyone?')) return;
  lobby.broadcast({ t: 'cancel' });
  setTimeout(() => reset('You cancelled the game.'), 300); // give the message time to go out
}

function exitGame() {
  if (!confirm('Leave the game?')) return;
  if (hostId) lobby.send({ t: 'leave', key: myKey }, hostId);
  setTimeout(() => reset('You left the game.'), 300);
}

function leaveOrCancel() { isHost ? cancelGame() : exitGame(); }

function reset(message) {
  clearSession();
  clearTimeout(botTimer); botTimer = null;
  try { if (lobby) lobby.leave(); } catch (e) {}
  lobby = null; secret = ''; G = null; V = null; hostId = null; hostAway = false; seat = -1;
  roster = new Map(); seatKey = []; seatPeer = []; lobbyNames = []; err = '';
  show('join');
  showErr(message);
}

// ---------- peer events ----------
function onPeerInfo(id, p) {
  // Players: when the host appears (also after the host refreshes), ask for our seat and the state.
  if (!isHost && p.host && !hostId) {
    hostId = id; hostAway = false;
    lobby.send({ t: 'sync', key: myKey, name: myName }, id);
    render();
  }
}

function onPeerLeave(id) {
  if (isHost) {
    if (!G) {
      for (const [k, r] of roster) if (r.peerId === id) roster.delete(k);
      broadcastLobby(); render();
    } else {
      const i = seatPeer.indexOf(id);
      if (i >= 0) { seatPeer[i] = null; update(); } // seat is kept; they can come back
    }
  } else if (id === hostId) {
    hostId = null; hostAway = true; render();
  }
}

// ---------- messages ----------
function onMessage(m, from) {
  if (!m || typeof m !== 'object') return;
  if (isHost) { if (!tooFast(from)) hostMessage(m, from); return; } // only players are rate-limited
  if (from !== hostId) return; // players only listen to the host
  switch (m.t) {
    case 'lobby': lobbyNames = Array.isArray(m.names) ? m.names.slice(0, 2).map(x => String(x).slice(0, 30)) : []; break;
    case 'you': { const s = int(m.seat, 0, 2 - 1); if (s !== null) seat = s; break; }
    case 'state': { const v = cleanView(m.v); if (v) { V = v; err = ''; } break; }
    case 'error': err = String(m.err).slice(0, 120); break;
    case 'full': reset('That game is full.'); return;
    case 'busy': reset('A round is in progress. Try joining again when it ends.'); return;
    case 'cancel': reset('The host cancelled the game.'); return;
  }
  render();
}

function hostMessage(m, from) {
  const key = String(m.key ?? '').slice(0, 40);
  if (m.t === 'sync' && key) {
    const name = String(m.name ?? '').slice(0, 20) || 'Player';
    if (!G) {
      if (!roster.has(key) && roster.size >= 2 - 1) { lobby.send({ t: 'full' }, from); return; }
      roster.set(key, { peerId: from, name });
      broadcastLobby(); render();
    } else {
      let i = seatKey.indexOf(key);
      if (i < 0 && G.over) i = takeBotSeat(key, name); // newcomers can join between rounds
      if (i <= 0) { lobby.send({ t: G.over ? 'full' : 'busy' }, from); return; }
      seatPeer[i] = from;
      lobby.send({ t: 'you', seat: i }, from);
      update();
    }
  } else if (m.t === 'leave') {
    if (!G) {
      if (roster.get(key)?.peerId === from) { roster.delete(key); broadcastLobby(); render(); }
    } else {
      const i = seatPeer.indexOf(from);
      if (i > 0) toBot(i);
    }
  } else if (m.t === 'move' && G) {
    const i = seatPeer.indexOf(from);
    const a = cleanAction(m.a);
    if (i <= 0 || !a) return;
    const r = act(G, i, a.cell);
    if (!r.ok) lobby.send({ t: 'error', err: r.err }, from);
    else update();
  }
}

function broadcastLobby() {
  const names = [myName + ' (host)', ...[...roster.values()].map(r => r.name)];
  lobby.broadcast({ t: 'lobby', names });
}

// ---------- host game flow ----------
function startGame() {
  const entries = [...roster.entries()].slice(0, 1);
  const level = $('level').value === 'easy' ? 'easy' : 'hard';
  const names = [myName, entries.length ? entries[0][1].name : BOT_NAMES[level]];
  const bots = [false, !entries.length];
  seatKey = [myKey, entries.length ? entries[0][0] : null];
  seatPeer = [null, entries.length ? entries[0][1].peerId : null];
  G = createGame(names, bots, level);
  newRound(G);
  if (seatPeer[1]) lobby.send({ t: 'you', seat: 1 }, seatPeer[1]);
  update();
}

function nextRound() {
  if (!G || !G.over) return;
  newRound(G);
  update();
}

// Between rounds a newcomer replaces the bot.
function takeBotSeat(key, name) {
  if (!G.players[1].bot || !G.over) return -1;
  G.players[1] = { name, bot: false };
  G.scores[1] = 0;
  seatKey[1] = key;
  return 1;
}

// A player who leaves is replaced by a bot so the host can keep playing.
function toBot(i) {
  G.players[i] = { name: BOT_NAMES[G.level], bot: true };
  seatKey[i] = null; seatPeer[i] = null;
  update();
}

function hostView() {
  const v = view(G);
  v.players.forEach((p, i) => { p.away = i > 0 && !p.bot && !seatPeer[i]; });
  return v;
}

function update() {
  err = '';
  saveHost();
  render();
  lobby.broadcast({ t: 'state', v: hostView() });
  if (!G.over && G.players[G.turn].bot) {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      if (!G || G.over || !G.players[G.turn].bot) return;
      act(G, G.turn, botMove(G, G.turn));
      update();
    }, 600);
  }
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length !== 2 || !Array.isArray(v.board) || v.board.length !== COLS * ROWS) return null;
  return {
    players: v.players.map(p => ({ name: String(p && p.name).slice(0, 30), bot: !!(p && p.bot), away: !!(p && p.away) })),
    board: v.board.map(c => int(c, -1, 1) ?? -1),
    turn: v.turn === 1 ? 1 : 0, over: !!v.over, winner: int(v.winner, -1, 1) ?? -1,
    line: Array.isArray(v.line) ? v.line.slice(0, 7).map(x => int(x, 0, COLS * ROWS - 1)).filter(x => x !== null) : null,
    last: int(v.last, -1, COLS * ROWS - 1) ?? -1,
    scores: Array.isArray(v.scores) ? v.scores.slice(0, 2).map(x => int(x, 0, 1e6) ?? 0) : [0, 0],
    draws: int(v.draws, 0, 1e6) ?? 0, round: int(v.round, 0, 1e6) ?? 0,
  };
}

// ---------- player actions ----------
function play(cell) {
  err = '';
  if (isHost) {
    const r = act(G, 0, cell);
    if (!r.ok) { err = r.err; render(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', a: { t: 'cell', cell } }, hostId);
  }
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(() => joinGame());
window.copyLink = safe(copyLink);
window.startGame = safe(startGame);
window.nextRound = safe(nextRound);
window.cancelGame = safe(cancelGame);
window.exitGame = safe(exitGame);
window.leaveOrCancel = safe(leaveOrCancel);
window.play = safe(play);
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));

// ---------- rendering ----------
function render() {
  if (isHost) {
    if (G) renderGame(hostView(), 0); else renderLobby();
  } else if (lobby) {
    if (V && seat >= 0) renderGame(V, seat); else renderWaiting();
  }
}

const qrFor = {};
function renderInvite(qrId, linkId) {
  const link = joinLink();
  $(linkId).textContent = link;
  if (qrFor[qrId] !== link) { // draw once per game; the link still works if the QR library failed to load
    $(qrId).innerHTML = '';
    try { new window.QRCode($(qrId), { text: link, width: 200, height: 200 }); qrFor[qrId] = link; }
    catch (e) { $(qrId).textContent = 'QR code unavailable. Share the link instead.'; }
  }
}

function renderLobby() {
  show('lobby');
  $('pinShow').textContent = pin;
  renderInvite('qr', 'joinLink');
  const other = [...roster.values()][0];
  $('roster').innerHTML = '<div class="label">Players</div><div class="vs"><span class="disc p0"></span> ' + esc(myName) + ' <span class="muted">vs</span> ' +
    (other ? esc(other.name) : '<span class="muted">waiting for a friend…</span>') + ' <span class="disc p1"></span></div>';
  $('levelBox').style.display = other ? 'none' : '';
}

async function copyLink() {
  const btns = [$('copyBtn'), $('copyBtn2')];
  try { await navigator.clipboard.writeText(joinLink()); btns.forEach(b => { b.textContent = 'Copied!'; }); }
  catch (e) { btns.forEach(b => { b.textContent = 'Copy failed: select the link and copy it'; }); }
  setTimeout(() => btns.forEach(b => { b.textContent = 'Copy link'; }), 2000);
}

function renderWaiting() {
  show('waiting');
  $('pinWait').textContent = pin;
  $('roster2').innerHTML = hostId
    ? (lobbyNames.length ? '<b>In the lobby:</b> ' + lobbyNames.map(esc).join(', ') + '.<br>Waiting for the host to start…' : 'Connected. Waiting for the host…')
    : hostAway ? 'The host disconnected. Waiting for them to come back…'
    : 'Searching for the host… this can take up to 30 seconds.';
}

let lastSig = '';

function renderGame(v, me) {
  show('game');
  const connected = isHost || !hostAway;
  const myTurn = connected && !v.over && v.turn === me;
  const name = i => (i === me ? 'You' : v.players[i].name);

  $('players').innerHTML = [0, 1].map(i =>
    `<div class="side${!v.over && v.turn === i ? ' now' : ''}${v.over && v.winner === i ? ' won' : ''}"><span class="disc p${i}"></span>` +
    `<div><div class="pn">${esc(name(i))}${v.players[i].away ? ' <span class="muted">(disconnected)</span>' : ''}</div><div class="score">${v.scores[i]}</div></div></div>`).join('<div class="mid"><div class="muted">draws</div><div class="score">' + v.draws + '</div></div>');

  // Columns are the buttons. Only the newest disc gets the falling animation.
  const sig = v.board.join(',') + '|' + (v.line || []).join(',') + '|' + myTurn;
  if (sig !== lastSig) {
    $('board').innerHTML = Array.from({ length: COLS }, (_, c) => {
      const open = v.board[c] === -1;
      const cells = Array.from({ length: ROWS }, (_, r) => {
        const k = r * COLS + c, p = v.board[k];
        const cls = 'cell' + (p >= 0 ? ' p' + p : '') + (v.line && v.line.includes(k) ? ' win' : '') + (k === v.last ? ' drop' : '');
        return `<span class="${cls}" style="--r:${r + 1}"></span>`;
      }).join('');
      return `<button class="col" ${myTurn && open ? `onclick="play(${c})"` : 'disabled'} aria-label="Column ${c + 1}">${cells}</button>`;
    }).join('');
    lastSig = sig;
  }
  $('board').classList.toggle('mine', myTurn);

  $('msg').textContent = !connected ? 'The host disconnected. Waiting for them to come back…'
    : err || (v.over ? (v.winner === -1 ? "It's a draw." : v.winner === me ? 'You win!' : name(v.winner) + ' wins.')
    : myTurn ? 'Your turn: tap a column.' : name(v.turn) + ' is thinking…');
  $('nextBtn').style.display = isHost && v.over ? '' : 'none';
  $('waitNext').style.display = !isHost && v.over ? '' : 'none';
  const inviting = isHost && v.over && v.players[1].bot;
  $('invite').style.display = inviting ? '' : 'none';
  if (inviting) renderInvite('qr2', 'joinLink2');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}
