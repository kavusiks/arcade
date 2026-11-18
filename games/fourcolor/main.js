// 4Color UI and networking. The host runs the engine; players send actions and render what the host sends.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newRound, act, botMove, view, canPlay, COLORS, COLOR_NAMES, cardText, MAX_SEATS } from './engine.js?v=1795027734';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795027734')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const BOT_NAMES = ['Ada', 'Ben', 'Cy', 'Dot', 'Eli'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2', 'wild', 'w4'];

// ---------- helpers: everything from the network is untrusted ----------
const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const int = (x, lo, hi) => { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const cleanCard = c => {
  const id = int(c && c.id, 0, 107);
  if (id === null || !['r', 'y', 'g', 'b', 'w'].includes(c.c) || !VALUES.includes(c.v)) return null;
  return { id, c: c.c, v: c.v };
};
const cleanCards = (a, max) => Array.isArray(a) ? a.slice(0, max).map(cleanCard).filter(Boolean) : [];
const rate = new Map(); // flood protection: at most 10 messages per second per peer
function tooFast(peer) {
  const now = Date.now(), r = rate.get(peer) || { t: now, n: 0 };
  if (now - r.t > 1000) { r.t = now; r.n = 0; }
  r.n++; rate.set(peer, r);
  return r.n > 10;
}
// Only these action shapes are accepted from players.
function cleanAction(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.t === 'play') { const id = int(a.id, 0, 107); return id === null ? null : { t: 'play', id, color: COLORS.includes(a.color) ? a.color : undefined }; }
  if (a.t === 'draw' || a.t === 'pass' || a.t === 'call') return { t: a.t };
  if (a.t === 'catch') { const target = int(a.target, 0, MAX_SEATS - 1); return target === null ? null : { t: 'catch', target }; }
  return null;
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-fourcolor-session';
function saveSession(o) { try { sessionStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
function clearSession() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

// ---------- state ----------
let lobby = null, isHost = false, myName = '', myKey = '', pin = '', secret = '';
// host
let G = null, roster = new Map(), seatKey = [], seatPeer = [], botTimer = null;
// player
let hostId = null, hostAway = false, seat = -1, V = null, myHand = [], myDrawn = null, lobbyNames = [];
let err = '', pendingWild = null;
let handVisible = false; // not saved: after a reload the hand starts hidden

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'fourcolor', pin, secret, info: { name: myName, key: myKey, host: isHost } });
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
  lobby = null; secret = ''; G = null; V = null; hostId = null; hostAway = false; seat = -1; myHand = []; myDrawn = null;
  roster = new Map(); seatKey = []; seatPeer = []; lobbyNames = []; err = ''; pendingWild = null;
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
    case 'lobby': lobbyNames = Array.isArray(m.names) ? m.names.slice(0, MAX_SEATS).map(x => String(x).slice(0, 30)) : []; break;
    case 'you': { const s = int(m.seat, 0, MAX_SEATS - 1); if (s !== null) seat = s; break; }
    case 'state': { const v = cleanView(m.v); if (v) { V = v; err = ''; } break; }
    case 'hand': myHand = cleanCards(m.hand, 108); myDrawn = m.drawn == null ? null : int(m.drawn, 0, 107); break; // Number(null) is 0, so check null first
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
      if (!roster.has(key) && roster.size >= MAX_SEATS - 1) { lobby.send({ t: 'full' }, from); return; }
      roster.set(key, { peerId: from, name });
      broadcastLobby(); render();
    } else {
      let i = seatKey.indexOf(key);
      if (i < 0 && G.roundOver) i = takeBotSeat(key, name); // newcomers can join between rounds
      if (i <= 0) { lobby.send({ t: G.roundOver ? 'full' : 'busy' }, from); return; }
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
    const r = act(G, i, a);
    if (!r.ok) lobby.send({ t: 'error', err: r.err }, from);
    else update();
  }
}

function broadcastLobby() {
  const names = [myName + ' (host)', ...[...roster.values()].map(r => r.name)];
  lobby.broadcast({ t: 'lobby', names });
}

// Between rounds a newcomer replaces a bot; their score starts at 0.
function takeBotSeat(key, name) {
  const i = G.players.findIndex((p, k) => k > 0 && p.bot);
  if (i < 0) return -1;
  G.players[i].bot = false;
  G.players[i].name = name;
  G.scores[i] = 0;
  seatKey[i] = key;
  G.log.unshift(name + ' joined and takes over a seat.');
  return i;
}

// The host starts each new round when everyone is ready.
function nextRound() {
  if (!G || !G.roundOver) return;
  newRound(G);
  update();
}

// A player who leaves mid-game is replaced by a bot so the game can continue.
function toBot(i) {
  const p = G.players[i];
  p.bot = true;
  p.name = BOT_NAMES[(i - 1) % BOT_NAMES.length] + ' (bot)';
  G.log.unshift('A player left; a bot took their seat.');
  seatKey[i] = null; seatPeer[i] = null;
  update();
}

// ---------- host game flow ----------
function startGame() {
  const entries = [...roster.entries()].slice(0, MAX_SEATS - 1);
  const names = [myName, ...entries.map(e => e[1].name)];
  const bots = names.map(() => false);
  seatKey = [myKey, ...entries.map(e => e[0])];
  seatPeer = [null, ...entries.map(e => e[1].peerId)];
  const target = Math.max(2, $('fillBots').checked ? 4 : 0); // at least 2 seats; optionally fill to 4 with bots
  while (names.length < target) {
    names.push(BOT_NAMES[names.length - 1] + ' (bot)');
    bots.push(true); seatKey.push(null); seatPeer.push(null);
  }
  G = createGame(names, bots);
  newRound(G);
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
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
  seatPeer.forEach((id, i) => {
    if (id) lobby.send({ t: 'hand', hand: G.players[i].hand, drawn: G.turn === i ? G.drawnId : null }, id);
  });
  if (G.roundOver) return; // host starts the next round with the button
  if (G.players[G.turn].bot) {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      if (!G || G.roundOver || !G.players[G.turn].bot) return;
      act(G, G.turn, botMove(G, G.turn));
      update();
    }, 800);
  }
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length < 2 || v.players.length > MAX_SEATS) return null;
  const n = v.players.length;
  return {
    turn: int(v.turn, 0, n - 1) ?? 0,
    dir: v.dir === -1 ? -1 : 1,
    color: COLORS.includes(v.color) ? v.color : 'r',
    top: cleanCard(v.top),
    deckCount: int(v.deckCount, 0, 108) ?? 0,
    roundOver: !!v.roundOver,
    winner: int(v.winner, -1, n - 1) ?? -1,
    lastPoints: int(v.lastPoints, 0, 99999) ?? 0,
    vulnerable: int(v.vulnerable, -1, n - 1) ?? -1,
    scores: Array.isArray(v.scores) ? v.scores.slice(0, n).map(x => int(x, 0, 999999) ?? 0) : [],
    log: Array.isArray(v.log) ? v.log.slice(0, 8).map(x => String(x).slice(0, 120)) : [],
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30),
      bot: !!(p && p.bot),
      away: !!(p && p.away),
      called: !!(p && p.called),
      count: int(p && p.count, 0, 108) ?? 0,
    })),
  };
}

// ---------- player actions ----------
function myHandNow() { return isHost ? G.players[0].hand : myHand; }
function myDrawnNow() { return isHost ? G.drawnId : myDrawn; }

function send(a) {
  err = '';
  if (isHost) {
    const r = act(G, 0, a);
    if (!r.ok) { err = r.err; render(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', a }, hostId);
  }
}

function playCard(id) {
  const c = myHandNow().find(h => h.id === id);
  if (!c) return;
  if (c.c === 'w') { pendingWild = id; render(); return; } // ask for a colour first
  send({ t: 'play', id });
}

function chooseColor(color) {
  if (pendingWild === null) return;
  const id = pendingWild;
  pendingWild = null;
  if (COLORS.includes(color)) send({ t: 'play', id, color }); else render();
}

function toggleHand() {
  handVisible = !handVisible;
  pendingWild = null;
  render();
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
window.playCard = safe(playCard);
window.chooseColor = safe(chooseColor);
window.drawCard = safe(() => send({ t: 'draw' }));
window.passTurn = safe(() => send({ t: 'pass' }));
window.callLast = safe(() => send({ t: 'call' }));
window.catchPlayer = safe(() => { const v = isHost ? hostView() : V; if (v && v.vulnerable >= 0) send({ t: 'catch', target: v.vulnerable }); });
window.toggleHand = safe(toggleHand);
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));

// ---------- rendering ----------
function render() {
  if (isHost) {
    if (G) renderGame(hostView(), G.players[0].hand, 0); else renderLobby();
  } else if (lobby) {
    if (V && seat >= 0) renderGame(V, myHand, seat); else renderWaiting();
  }
}

// Invite block (QR + link). Shown in the lobby, and on the host's game screen between rounds.
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
  const names = [myName + ' (host)', ...[...roster.values()].map(r => r.name)];
  $('roster').innerHTML = '<b>Players (' + names.length + '/' + MAX_SEATS + '):</b> ' + names.map(esc).join(', ');
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

// Card values and ids are cleaned before rendering, so they are safe to put in HTML.
function cardHTML(c, { playable = false, drawn = false } = {}) {
  const cls = 'fc fc-' + c.c + (playable ? ' playable' : '') + (drawn ? ' drawn' : '');
  const click = playable ? ` onclick="playCard(${c.id})"` : '';
  return `<span class="${cls}"${click}>${esc(cardText(c))}</span>`;
}

function renderGame(v, hand, me) {
  show('game');
  const connected = isHost || !hostAway;
  const myTurn = v.turn === me && !v.roundOver && connected;
  const drawn = myDrawnNow();

  $('seats').innerHTML = v.players.map((p, i) =>
    '<div class="muted' + (i === v.turn && !v.roundOver ? ' turn' : '') + '">' + (!v.roundOver && i === v.turn ? '▶ ' : '') +
    (i === me ? 'You' : esc(p.name)) + (p.bot ? ' 🤖' : '') + (p.away ? ' (disconnected)' : '') + ': ' +
    p.count + (p.count === 1 ? ' card' : ' cards') + (p.count === 1 && p.called ? ' · "Last card!"' : '') + '</div>'
  ).join('') + '<div class="muted">Direction: ' + (v.dir === 1 ? '↓ down the list' : '↑ up the list') + ' · Deck: ' + v.deckCount + '</div>';

  $('top').innerHTML = v.top ? cardHTML(v.top) : '';
  $('colorNow').innerHTML = 'Colour: <span class="dot fc-' + v.color + '"></span> ' + COLOR_NAMES[v.color];

  const fake = { color: v.color, discard: [v.top] }; // enough of the game state to check playability locally
  $('hand').innerHTML = handVisible
    ? hand.map(c => cardHTML(c, {
        playable: myTurn && (drawn === null || drawn === undefined || c.id === drawn) && v.top && canPlay(fake, hand, c),
        drawn: c.id === drawn,
      })).join('')
    : hand.map(() => '<span class="fc back"></span>').join('');
  $('handBtn').textContent = handVisible ? 'Hide cards' : 'Show cards';

  $('wildPick').style.display = pendingWild !== null && myTurn ? '' : 'none';
  const hasDrawn = drawn !== null && drawn !== undefined;
  $('drawBtn').disabled = !myTurn || hasDrawn;
  $('passBtn').style.display = myTurn && hasDrawn ? '' : 'none';
  const canCall = connected && !v.roundOver && ((myTurn && hand.length === 2 && !v.players[me].called) || v.vulnerable === me);
  $('callBtn').style.display = canCall ? '' : 'none';
  const canCatch = connected && !v.roundOver && v.vulnerable >= 0 && v.vulnerable !== me;
  $('catchBtn').style.display = canCatch ? '' : 'none';
  if (canCatch) $('catchBtn').textContent = 'Catch ' + (v.players[v.vulnerable].name) + '! (+2)';

  $('msg').textContent = !connected ? 'The host disconnected. Waiting for them to come back…'
    : err || (v.roundOver ? (isHost ? 'Round over. Start the next round when everyone is ready.' : 'Round over. Waiting for the host to start the next round…')
    : myTurn ? (!handVisible ? 'Your turn: press Show cards to see your hand.'
      : hasDrawn ? 'You drew a card. Play it (highlighted) or pass.'
      : 'Your turn: tap a highlighted card to play it, or draw.')
    : v.players[v.turn].name + ' is playing…');
  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
  $('nextBtn').style.display = isHost && v.roundOver ? '' : 'none';
  const inviting = isHost && v.roundOver && G.players.some((p, i) => i > 0 && p.bot);
  $('invite').style.display = inviting ? '' : 'none';
  if (inviting) renderInvite('qr2', 'joinLink2');
  renderScores(v, me);
}

function renderScores(v, me) {
  const box = $('scores');
  if (!v.roundOver) { box.style.display = 'none'; return; }
  box.style.display = '';
  const rows = v.players.map((p, i) => ({ i, name: i === me ? 'You' : p.name, score: v.scores[i] || 0 }))
    .sort((a, b) => b.score - a.score);
  box.innerHTML = '<b>Scoreboard</b> <span class="muted">(the winner scores the cards left in everyone else\'s hands)</span><table>' +
    '<tr><th>Player</th><th>This round</th><th>Points</th></tr>' +
    rows.map(r => '<tr><td>' + esc(r.name) + '</td><td>' + (r.i === v.winner ? 'Winner, +' + v.lastPoints : '') + '</td><td>' + r.score + '</td></tr>').join('') +
    '</table>';
}
