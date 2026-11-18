// Undercover UI and networking. The host runs the engine; players send actions and render what the host sends.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newRound, act, tick, leave, addPlayer, view, secretFor, activeSeats, MIN_PLAYERS, MAX_PLAYERS, DURATIONS } from './engine.js?v=1795037834';
import { pictureSVG } from './pictures.js?v=1795037834';
import { LOCATIONS } from './locations.js?v=1795037834';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795037834')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const MAX_SEAT_INDEX = 63; // players who leave keep their index, so indexes can exceed MAX_PLAYERS

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
  if (!a || typeof a !== 'object') return null;
  if (a.t === 'accuse') { const target = int(a.target, 0, MAX_SEAT_INDEX); return target === null ? null : { t: 'accuse', target }; }
  if (a.t === 'vote') return { t: 'vote', yes: a.yes === true };
  if (a.t === 'pass') return { t: 'pass' };
  if (a.t === 'guess') { const location = int(a.location, 0, LOCATIONS.length - 1); return location === null ? null : { t: 'guess', location }; }
  return null;
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-undercover-session';
function saveSession(o) { try { sessionStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
function clearSession() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

// ---------- state ----------
let lobby = null, isHost = false, myName = '', myKey = '', pin = '', secret = '';
// host
let G = null, roster = new Map(), seatKey = [], seatPeer = [], ticker = null;
// player
let hostId = null, hostAway = false, seat = -1, V = null, V_at = 0, mySecret = null, lobbyNames = [];
let err = '';
let cardVisible = false;           // not saved: after a reload the card starts hidden
let crossed = new Set(), crossedRound = 0; // locations crossed out on this phone (local only)

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'undercover', pin, secret, info: { name: myName, key: myKey, host: isHost } });
  lobby.on('message', onMessage);
  lobby.on('join', onPeerInfo);
  lobby.on('leave', onPeerLeave);
}

// The timer is drawn every second on every phone; the host also checks for time running out.
setInterval(() => {
  if (isHost && G && tick(G, Date.now())) update();
  else if ((isHost && G) || V) renderTimer();
}, 1000);

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
  try { if (lobby) lobby.leave(); } catch (e) {}
  lobby = null; secret = ''; G = null; V = null; hostId = null; hostAway = false; seat = -1; mySecret = null;
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
    case 'lobby': lobbyNames = Array.isArray(m.names) ? m.names.slice(0, MAX_PLAYERS).map(x => String(x).slice(0, 30)) : []; break;
    case 'you': { const s = int(m.seat, 0, MAX_SEAT_INDEX); if (s !== null) seat = s; break; }
    case 'state': { const v = cleanView(m.v); if (v) { V = v; V_at = Date.now(); err = ''; } break; }
    case 'secret': mySecret = cleanSecret(m.s); break;
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
      if (!roster.has(key) && roster.size >= MAX_PLAYERS - 1) { lobby.send({ t: 'full' }, from); return; }
      roster.set(key, { peerId: from, name });
      broadcastLobby(); render();
    } else {
      let i = seatKey.indexOf(key);
      if (i < 0) {
        if (G.phase !== 'over') { lobby.send({ t: 'busy' }, from); return; } // newcomers join between rounds
        i = addPlayer(G, name);
        if (i < 0) { lobby.send({ t: 'full' }, from); return; }
        seatKey[i] = key;
      }
      seatPeer[i] = from;
      lobby.send({ t: 'you', seat: i }, from);
      update();
    }
  } else if (m.t === 'leave') {
    if (!G) {
      if (roster.get(key)?.peerId === from) { roster.delete(key); broadcastLobby(); render(); }
    } else {
      const i = seatPeer.indexOf(from);
      if (i > 0) { leave(G, i, Date.now()); seatKey[i] = null; seatPeer[i] = null; update(); }
    }
  } else if (m.t === 'move' && G) {
    const i = seatPeer.indexOf(from);
    const a = cleanAction(m.a);
    if (i <= 0 || !a) return;
    const r = act(G, i, a, Date.now());
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
  const entries = [...roster.entries()].slice(0, MAX_PLAYERS - 1);
  if (entries.length + 1 < MIN_PLAYERS) { err = 'You need at least ' + MIN_PLAYERS + ' players (including you).'; render(); return; }
  const names = [myName, ...entries.map(e => e[1].name)];
  seatKey = [myKey, ...entries.map(e => e[0])];
  seatPeer = [null, ...entries.map(e => e[1].peerId)];
  G = createGame(names, Number($('minutes').value));
  newRound(G, Date.now());
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
  update();
}

function nextRound() {
  if (!G || G.phase !== 'over') return;
  G.minutes = DURATIONS.includes(Number($('minutes2').value)) ? Number($('minutes2').value) : G.minutes;
  const r = newRound(G, Date.now());
  if (!r.ok) { err = r.err; render(); return; }
  update();
}

function update() {
  err = '';
  saveHost();
  render();
  const now = Date.now();
  lobby.broadcast({ t: 'state', v: hostViewAt(now) });
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'secret', s: secretFor(G, i) }, id); });
}

function hostViewAt(now) {
  const v = view(G, now);
  v.players.forEach((p, i) => { p.away = i > 0 && !p.gone && !seatPeer[i]; });
  return v;
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length < 1 || v.players.length > MAX_SEAT_INDEX + 1) return null;
  const n = v.players.length;
  const seatOr = (x, d) => int(x, -1, n - 1) ?? d;
  const r = v.result && typeof v.result === 'object' ? v.result : null;
  return {
    round: int(v.round, 0, 1e6) ?? 0,
    phase: ['play', 'vote', 'final', 'over'].includes(v.phase) ? v.phase : 'over',
    minutes: DURATIONS.includes(v.minutes) ? v.minutes : 8,
    dealer: seatOr(v.dealer, -1),
    timeLeft: int(v.timeLeft, 0, 3600000) ?? 0,
    accused: Array.isArray(v.accused) ? v.accused.map(x => seatOr(x, -1)).filter(x => x >= 0) : [],
    vote: v.vote ? { accuser: seatOr(v.vote.accuser, -1), target: seatOr(v.vote.target, -1),
      voted: Array.isArray(v.vote.voted) ? v.vote.voted.map(x => seatOr(x, -1)).filter(x => x >= 0) : [] } : null,
    finalTurn: seatOr(v.finalTurn, -1),
    result: r ? {
      winner: ['spy', 'agents', 'void'].includes(r.winner) ? r.winner : 'void',
      reason: String(r.reason ?? '').slice(0, 160),
      location: int(r.location, 0, LOCATIONS.length - 1) ?? -1,
      spy: seatOr(r.spy, -1),
      guess: int(r.guess, 0, LOCATIONS.length - 1) ?? -1,
    } : null,
    log: Array.isArray(v.log) ? v.log.slice(0, 8).map(x => String(x).slice(0, 160)) : [],
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30),
      score: int(p && p.score, 0, 1e6) ?? 0,
      gone: !!(p && p.gone),
      away: !!(p && p.away),
    })),
  };
}

function cleanSecret(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.spy === true) return { spy: true };
  if (s.joinedLate === true) return { joinedLate: true };
  const location = int(s.location, 0, LOCATIONS.length - 1);
  return location === null ? null : { location, role: String(s.role ?? '').slice(0, 40) };
}

// ---------- player actions ----------
function send(a) {
  err = '';
  if (isHost) {
    const r = act(G, 0, a, Date.now());
    if (!r.ok) { err = r.err; render(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', a }, hostId);
  }
}

function accuse(selectId) {
  const target = int($(selectId).value, 0, MAX_SEAT_INDEX);
  if (target === null) { err = 'Pick who you want to accuse.'; render(); return; }
  send({ t: 'accuse', target });
}

function guess() {
  const loc = int($('guessSel').value, 0, LOCATIONS.length - 1);
  if (loc === null) { err = 'Pick a location to guess.'; render(); return; }
  if (!confirm('Reveal that you are the spy and guess "' + LOCATIONS[loc].name + '"? A wrong guess loses the round.')) return;
  send({ t: 'guess', location: loc });
}

function toggleCard() { cardVisible = !cardVisible; render(); }

function crossOut(i) {
  crossed.has(i) ? crossed.delete(i) : crossed.add(i);
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
window.accuse = safe(accuse);
window.voteYes = safe(() => send({ t: 'vote', yes: true }));
window.voteNo = safe(() => send({ t: 'vote', yes: false }));
window.passFinal = safe(() => send({ t: 'pass' }));
window.guess = safe(guess);
window.toggleCard = safe(toggleCard);
window.crossOut = safe(crossOut);
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));

// ---------- rendering ----------
function currentView() { return isHost ? (G ? hostViewAt(Date.now()) : null) : V; }
function currentSecret() { return isHost ? (G ? secretFor(G, 0) : null) : mySecret; }
function mySeat() { return isHost ? 0 : seat; }

function render() {
  if (isHost) {
    if (G) renderGame(); else renderLobby();
  } else if (lobby) {
    if (V && seat >= 0) renderGame(); else renderWaiting();
  }
}

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function renderTimer() {
  const v = currentView();
  if (!v) return;
  let left = v.timeLeft;
  if (!isHost && v.phase === 'play') left = Math.max(0, v.timeLeft - (Date.now() - V_at));
  $('timer').textContent = v.phase === 'play' || v.phase === 'vote' ? fmt(left) : v.phase === 'final' ? "Time's up" : '';
  $('timerSub').textContent = v.phase === 'vote' ? 'Paused for the vote' : '';
  // The ring empties as time runs out.
  const total = (v.minutes || 8) * 60000;
  const frac = v.phase === 'play' || v.phase === 'vote' ? Math.max(0, Math.min(1, left / total)) : 0;
  $('ring').setAttribute('stroke-dashoffset', String(477.5 * (1 - frac)));
  $('clock').classList.toggle('low', (v.phase === 'play' || v.phase === 'vote') && left < 60000);
  $('clock').classList.toggle('done', v.phase === 'final');
  $('clock').style.display = v.phase === 'over' ? 'none' : '';
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
  $('roster').innerHTML = '<div class="label">Players (' + names.length + '/' + MAX_PLAYERS + ')</div><div class="avatars">' +
    names.map((n, i) => avatar(n, i)).join('') + '</div>' +
    (names.length < MIN_PLAYERS ? '<div class="muted">You need at least ' + MIN_PLAYERS + ' players.</div>' : '');
  $('lobbyErr').textContent = err;
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

// Round avatar with an initial, a badge and a short status line.
const SEAT_COLORS = ['#ff7a59', '#4f8cff', '#c77dff', '#ffb648', '#36c2d6', '#ff5c7a', '#9ccc65', '#f06292'];
function avatar(name, i, { now = false, gone = false, badge = '', tag = '' } = {}) {
  const initial = esc((String(name).trim()[0] || '?').toUpperCase());
  return `<div class="av${now ? ' now' : ''}${gone ? ' gone' : ''}"><div class="face" style="--c:${SEAT_COLORS[i % SEAT_COLORS.length]}">${initial}` +
    (badge !== '' ? `<span class="badge">${badge}</span>` : '') + `</div><div>${esc(name)}</div>` + (tag ? `<div class="tag">${tag}</div>` : '') + `</div>`;
}

function options(list, placeholder) {
  return '<option value="">' + esc(placeholder) + '</option>' + list.map(([v, label]) => '<option value="' + v + '">' + esc(label) + '</option>').join('');
}

function renderGame() {
  show('game');
  const v = currentView(), s = currentSecret(), me = mySeat();
  const connected = isHost || !hostAway;
  const name = i => (i === me ? 'You' : (v.players[i] ? v.players[i].name : '?'));
  const others = v.players.map((p, i) => [i, p]).filter(([i, p]) => i !== me && !p.gone).map(([i, p]) => [i, p.name]);
  if (crossedRound !== v.round) { crossed = new Set(); crossedRound = v.round; cardVisible = false; }

  // Players
  $('seats').innerHTML = v.players.map((p, i) => p.gone ? '' : avatar(name(i), i, {
    now: i === v.dealer && v.phase !== 'over',
    badge: p.score,
    tag: p.away ? 'disconnected' : i === v.dealer && v.phase !== 'over' ? 'asks first' : v.accused.includes(i) && v.phase !== 'over' ? 'has accused' : '',
  })).join('');

  // My card
  let card = '';
  if (!s) card = 'Waiting for the next round…';
  else if (s.joinedLate) card = 'You joined during this round. You get a card next round.';
  else if (!cardVisible) card = '<div class="seal">?</div><div><b>Hidden</b></div><div class="muted">Make sure nobody is looking, then show your card.</div>';
  else if (s.spy) card = '<div class="muted">Your secret</div><div class="big">You are the SPY</div><div class="muted">Work out the location from the questions, without being found out.</div>';
  else card = '<div class="muted">Location</div><div class="big">' + esc(LOCATIONS[s.location].name) + '</div><div class="muted">Your role: ' + esc(s.role) + '</div>';
  if (s && cardVisible && !s.spy && !s.joinedLate) card = pictureSVG(LOCATIONS[s.location].name, 'pic card-pic') + card;
  setHTML('card', card);
  $('dossier').className = 'dossier' + (!s || s.joinedLate || !cardVisible ? ' sealed' : s.spy ? ' spy' : '');
  $('cardBtn').textContent = cardVisible ? 'Hide my card' : 'Show my card';
  $('cardBtn').style.display = s && !s.joinedLate ? '' : 'none';

  renderTimer();

  // Actions
  const inRound = s && !s.joinedLate && connected;
  const canAccuse = inRound && v.phase === 'play' && !v.accused.includes(me);
  $('accuseBox').style.display = canAccuse ? '' : 'none';
  if (canAccuse && $('accuseSel').dataset.sig !== JSON.stringify(others)) { $('accuseSel').innerHTML = options(others, 'Who is the spy?'); $('accuseSel').dataset.sig = JSON.stringify(others); }

  const myFinal = inRound && v.phase === 'final' && v.finalTurn === me;
  $('finalBox').style.display = myFinal ? '' : 'none';
  if (myFinal && $('finalSel').dataset.sig !== JSON.stringify(others)) { $('finalSel').innerHTML = options(others, 'Who is the spy?'); $('finalSel').dataset.sig = JSON.stringify(others); }

  const canGuess = inRound && s.spy && v.phase === 'play';
  $('guessBox').style.display = canGuess ? '' : 'none';
  if (canGuess && !$('guessSel').dataset.sig) { $('guessSel').innerHTML = options(LOCATIONS.map((l, i) => [i, l.name]), 'Pick the location'); $('guessSel').dataset.sig = '1'; }

  const vote = v.vote;
  const canVote = inRound && vote && vote.target !== me && !vote.voted.includes(me);
  $('voteBox').style.display = vote ? '' : 'none';
  if (vote) {
    const total = v.players.filter((p, i) => !p.gone && i !== vote.target).length;
    $('voteText').innerHTML = '<b>' + esc(name(vote.accuser)) + '</b> accuses <b>' + esc(name(vote.target)) + '</b>. Is ' +
      (vote.target === me ? 'you' : esc(v.players[vote.target].name)) + ' the spy? ' +
      '<span class="muted">(' + vote.voted.length + '/' + total + ' voted. Everyone must say yes)</span>';
    $('voteBtns').style.display = canVote ? '' : 'none';
  }

  // Status line
  $('msg').textContent = !connected ? 'The host disconnected. Waiting for them to come back…'
    : err || (v.phase === 'play' ? name(v.dealer) + ' asked first. Keep asking each other questions!'
    : v.phase === 'vote' ? 'Vote in progress.'
    : v.phase === 'final' ? (vote ? 'Final accusation: vote now.' : v.finalTurn === me ? 'Your turn: accuse someone or pass.' : name(v.finalTurn) + ' may accuse someone…')
    : '');

  // Result and scoreboard
  const r = v.result;
  $('resultBox').style.display = v.phase === 'over' && r ? '' : 'none';
  if (v.phase === 'over' && r) {
    const head = r.winner === 'spy' ? 'The spy wins!' : r.winner === 'agents' ? 'The agents win!' : 'Round cancelled';
    setHTML('resultBox', (LOCATIONS[r.location] ? pictureSVG(LOCATIONS[r.location].name, 'pic card-pic') : '') +
      '<div class="big">' + head + '</div><div>' + esc(r.reason) + '</div>' +
      '<div class="muted">The location was <b>' + esc(LOCATIONS[r.location] ? LOCATIONS[r.location].name : '?') + '</b>. The spy was <b>' +
      esc(r.spy >= 0 ? name(r.spy) : '?') + '</b>.</div>' + scoreTable(v, me));
  }
  $('nextBox').style.display = isHost && v.phase === 'over' ? '' : 'none';
  if (isHost && v.phase === 'over') {
    $('minutes2').value = String(G.minutes);
    const enough = activeSeats(G).length >= MIN_PLAYERS;
    $('nextBtn').disabled = !enough;
    $('nextHint').textContent = enough ? '' : 'Need at least ' + MIN_PLAYERS + ' players. Invite more with the QR code below.';
    renderInvite('qr2', 'joinLink2');
  }

  // Locations (tap to cross out; only on this phone)
  if (!$('locs').dataset.built) {
    $('locs').innerHTML = LOCATIONS.map((l, i) =>
      '<div class="loc" id="loc' + i + '" onclick="crossOut(' + i + ')">' + pictureSVG(l.name) + '<span>' + esc(l.name) + '</span></div>').join('');
    $('locs').dataset.built = '1';
    calmMotion($('locs'));
  }
  LOCATIONS.forEach((l, i) => { const e = $('loc' + i); if (e) e.classList.toggle('out', crossed.has(i)); });

  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}

// Replace an element's HTML only when it changed, so running animations are not restarted.
function setHTML(id, html) {
  const e = $(id);
  if (e.dataset.html === html) return;
  e.innerHTML = html;
  e.dataset.html = html;
  calmMotion(e);
}

// Phones set to "reduce motion" get still pictures.
function calmMotion(root) {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      root.querySelectorAll('svg').forEach(s => s.pauseAnimations && s.pauseAnimations());
  } catch (e) {}
}

function scoreTable(v, me) {
  const rows = v.players.map((p, i) => ({ i, p })).filter(x => !x.p.gone).sort((a, b) => b.p.score - a.p.score);
  return '<table><tr><th>Player</th><th>Points</th></tr>' +
    rows.map(x => '<tr' + (x.i === me ? ' class="me"' : '') + '><td>' + esc(x.i === me ? 'You' : x.p.name) + '</td><td>' + x.p.score + '</td></tr>').join('') + '</table>' +
    '<div class="muted">Agents win: +1 each, +1 extra for whoever accused the spy. Spy wins: +2, or +4 for guessing the location.</div>';
}
