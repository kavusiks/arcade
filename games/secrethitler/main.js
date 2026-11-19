// Secret Hitler UI and networking. The host runs the engine; players send actions and render what the host sends.
// Based on "Secret Hitler" by Goat, Wolf, & Cabbage (secrethitler.com), CC BY-NC-SA 4.0. Texts and graphics here are original.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newGame, act, leave, addPlayer, view, secretFor, MIN_PLAYERS, MAX_PLAYERS, POWER_TEXT } from './engine.js?v=1795051101';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795051101')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const MAX_SEAT_INDEX = 63; // players who leave keep their index
const ROLE_KEYS = ['liberal', 'fascist', 'hitler'];
const PHASES = ['lobby', 'nominate', 'vote', 'pres', 'chan', 'veto', 'power', 'over'];
const POWERS = ['investigate', 'special', 'peek', 'execute'];

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
  if (a.t === 'nominate' || a.t === 'power') { const target = int(a.target, 0, MAX_SEAT_INDEX); return target === null && a.t === 'nominate' ? null : { t: a.t, target: target ?? -1 }; }
  if (a.t === 'vote' || a.t === 'vetoAnswer') return { t: a.t, yes: a.yes === true };
  if (a.t === 'discard') { const index = int(a.index, 0, 2); return index === null ? null : { t: 'discard', index }; }
  if (a.t === 'enact') { const index = int(a.index, 0, 1); return index === null ? null : { t: 'enact', index }; }
  if (a.t === 'veto') return { t: 'veto' };
  return null;
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-secrethitler-session';
function saveSession(o) { try { sessionStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { return null; } }
function clearSession() { try { sessionStorage.removeItem(SKEY); } catch (e) {} }
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

// ---------- state ----------
let lobby = null, isHost = false, myName = '', myKey = '', pin = '', secret = '';
// host
let G = null, roster = new Map(), seatKey = [], seatPeer = [];
// player
let hostId = null, hostAway = false, seat = -1, V = null, mySecret = null, lobbyNames = [];
let err = '';
let inviteOpen = false;
let roleVisible = false, roleGame = 0; // not saved: after a reload (or a new game) the role card is hidden

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'secrethitler', pin, secret, info: { name: myName, key: myKey, host: isHost } });
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
  if (!confirm('Leave the game? You cannot come back into this game.')) return;
  if (hostId) lobby.send({ t: 'leave', key: myKey }, hostId);
  setTimeout(() => reset('You left the game.'), 300);
}

function leaveOrCancel() { isHost ? cancelGame() : exitGame(); }

function reset(message) {
  clearSession();
  try { if (lobby) lobby.leave(); } catch (e) {}
  lobby = null; secret = ''; G = null; V = null; hostId = null; hostAway = false; seat = -1; mySecret = null;
  roster = new Map(); seatKey = []; seatPeer = []; lobbyNames = []; err = '';
  document.body.dataset.phase = '';
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
    case 'state': { const v = cleanView(m.v); if (v) { V = v; err = ''; } break; }
    case 'secret': mySecret = cleanSecret(m.s); break;
    case 'error': err = String(m.err).slice(0, 120); break;
    case 'full': reset('That game is full.'); return;
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
      if (i < 0) { // a newcomer watches the current game and plays the next one
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
      if (i > 0) { leave(G, i); seatKey[i] = null; seatPeer[i] = null; update(); }
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

// ---------- host game flow ----------
function startGame() {
  const entries = [...roster.entries()].slice(0, MAX_PLAYERS - 1);
  if (entries.length + 1 < MIN_PLAYERS) { err = 'You need at least ' + MIN_PLAYERS + ' players (including you).'; render(); return; }
  const names = [myName, ...entries.map(e => e[1].name)];
  seatKey = [myKey, ...entries.map(e => e[0])];
  seatPeer = [null, ...entries.map(e => e[1].peerId)];
  G = createGame(names);
  newGame(G);
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
  update();
}

function playAgain() {
  if (!G || G.phase !== 'over') return;
  const r = newGame(G);
  if (!r.ok) { err = r.err; render(); return; }
  update();
}

function update() {
  err = '';
  saveHost();
  render();
  lobby.broadcast({ t: 'state', v: hostView() });
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'secret', s: secretFor(G, i) }, id); });
}

function hostView() {
  const v = view(G);
  v.players.forEach((p, i) => { p.away = i > 0 && !p.left && !seatPeer[i]; });
  return v;
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length < 1 || v.players.length > MAX_SEAT_INDEX + 1) return null;
  const n = v.players.length;
  const seatOr = x => int(x, -1, n - 1) ?? -1;
  const votes = x => {
    if (!x || typeof x !== 'object') return null;
    const o = {};
    Object.entries(x).forEach(([k, b]) => { const s = int(k, 0, n - 1); if (s !== null) o[s] = b === true; });
    return o;
  };
  return {
    phase: PHASES.includes(v.phase) ? v.phase : 'lobby',
    games: int(v.games, 0, 9999) ?? 0, seats: int(v.seats, 0, 10) ?? 0,
    liberal: int(v.liberal, 0, 5) ?? 0, fascist: int(v.fascist, 0, 6) ?? 0, tracker: int(v.tracker, 0, 3) ?? 0,
    deck: int(v.deck, 0, 17) ?? 0, discard: int(v.discard, 0, 17) ?? 0,
    president: seatOr(v.president), chancellor: seatOr(v.chancellor), nominee: seatOr(v.nominee),
    lastPresident: seatOr(v.lastPresident), lastChancellor: seatOr(v.lastChancellor),
    voted: Array.isArray(v.voted) ? v.voted.map(x => int(x, 0, n - 1)).filter(x => x !== null) : [],
    lastVotes: votes(v.lastVotes),
    power: POWERS.includes(v.power) ? v.power : null,
    veto: !!v.veto, vetoAsked: !!v.vetoAsked,
    powers: Array.isArray(v.powers) ? v.powers.slice(0, 5).map(p => (POWERS.includes(p) ? p : null)) : [],
    eligible: Array.isArray(v.eligible) ? v.eligible.slice(0, n).map(x => !!x) : [],
    investigated: Array.isArray(v.investigated) ? v.investigated.map(x => int(x, 0, n - 1)).filter(x => x !== null) : [],
    winner: v.winner === 'liberal' || v.winner === 'fascist' ? v.winner : '',
    reason: String(v.reason ?? '').slice(0, 160),
    log: Array.isArray(v.log) ? v.log.slice(0, 14).map(x => String(x).slice(0, 160)) : [],
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30), alive: !!(p && p.alive), left: !!(p && p.left),
      playing: !!(p && p.playing), away: !!(p && p.away), role: ROLE_KEYS.includes(p && p.role) ? p.role : '',
    })),
  };
}

function cleanSecret(s) {
  if (!s || typeof s !== 'object' || !ROLE_KEYS.includes(s.role)) return null;
  const cards = a => (Array.isArray(a) ? a.slice(0, 3).map(c => (c === 'L' ? 'L' : 'F')) : undefined);
  const out = { role: s.role, team: [] };
  if (Array.isArray(s.team)) out.team = s.team.slice(0, 10).map(t => ({ seat: int(t && t.seat, 0, MAX_SEAT_INDEX) ?? 0, hitler: !!(t && t.hitler) }));
  if (s.hand) out.hand = cards(s.hand);
  if (s.peek) out.peek = cards(s.peek);
  if (Array.isArray(s.checks)) out.checks = s.checks.slice(0, 10).map(c => ({ target: int(c && c.target, 0, MAX_SEAT_INDEX) ?? 0, party: c && c.party === 'liberal' ? 'liberal' : 'fascist' }));
  if (typeof s.myVote === 'boolean') out.myVote = s.myVote;
  return out;
}

// ---------- player actions ----------
function send(a) {
  err = '';
  if (isHost) {
    const r = act(G, 0, a);
    if (!r.ok) { err = r.err; render(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', a }, hostId);
  }
}

function tapPlayer(i) {
  const v = currentView();
  if (v.phase === 'nominate') send({ t: 'nominate', target: i });
  else if (v.phase === 'power') {
    const who = v.players[i] ? v.players[i].name : '';
    if (v.power === 'execute' && !confirm('Execute ' + who + '? They are out of the game.')) return;
    send({ t: 'power', target: i });
  }
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(() => joinGame());
window.copyLink = safe(copyLink);
window.startGame = safe(startGame);
window.playAgain = safe(playAgain);
window.cancelGame = safe(cancelGame);
window.exitGame = safe(exitGame);
window.leaveOrCancel = safe(leaveOrCancel);
window.tapPlayer = safe(tapPlayer);
window.vote = safe(yes => send({ t: 'vote', yes }));
window.discardCard = safe(index => send({ t: 'discard', index }));
window.enactCard = safe(index => send({ t: 'enact', index }));
window.askVeto = safe(() => send({ t: 'veto' }));
window.answerVeto = safe(yes => send({ t: 'vetoAnswer', yes }));
window.peekDone = safe(() => send({ t: 'power', target: -1 }));
window.toggleRole = safe(() => { roleVisible = !roleVisible; render(); });
window.toggleInvite = safe(() => { inviteOpen = !inviteOpen; render(); });
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));

// ---------- rendering ----------
function currentView() { return isHost ? (G ? hostView() : null) : V; }
function currentSecret() { return isHost ? (G ? secretFor(G, 0) : null) : mySecret; }
function mySeat() { return isHost ? 0 : seat; }

function render() {
  if (isHost) {
    if (G) renderGame(); else renderLobby();
  } else if (lobby) {
    if (V && seat >= 0) renderGame(); else renderWaiting();
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

const SEAT_COLORS = ['#ff7a59', '#4f8cff', '#c77dff', '#ffb648', '#36c2d6', '#ff5c7a', '#9ccc65', '#f06292', '#7e8cff', '#4dd0a7'];
const initial = n => esc((String(n).trim()[0] || '?').toUpperCase());

function renderLobby() {
  show('lobby');
  $('pinShow').textContent = pin;
  renderInvite('qr', 'joinLink');
  const names = [myName + ' (host)', ...[...roster.values()].map(r => r.name)];
  $('roster').innerHTML = '<div class="label">Players (' + names.length + '/' + MAX_PLAYERS + ')</div><div class="avatars">' +
    names.map((n, i) => `<div class="av"><div class="face" style="--c:${SEAT_COLORS[i % SEAT_COLORS.length]}">${initial(n)}</div><div>${esc(n)}</div></div>`).join('') + '</div>' +
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

const ROLE_NAME = { liberal: 'Liberal', fascist: 'Fascist', hitler: 'Hitler' };
const POWER_ICON = { investigate: '🔍', special: '★', peek: '👁', execute: '✕' };
const POWER_SHORT = { investigate: 'Investigate', special: 'Pick next President', peek: 'Peek at 3 policies', execute: 'Execute' };
const policy = (c, extra = '') => `<span class="policy ${c === 'L' ? 'lib' : 'fas'}"${extra}><span class="sym"></span><span class="pw">${c === 'L' ? 'Liberal' : 'Fascist'}</span></span>`;

function renderGame() {
  show('game');
  const v = currentView(), s = currentSecret(), me = mySeat();
  const connected = isHost || !hostAway;
  const meP = v.players[me] || { alive: false, playing: false };
  const name = i => (i === me ? 'You' : v.players[i] ? v.players[i].name : '?');
  if (roleGame !== v.games) { roleGame = v.games; roleVisible = false; }

  // Boards
  $('libTrack').innerHTML = Array.from({ length: 5 }, (_, k) => `<span class="slot${k < v.liberal ? ' on lib' : ''}">${k < v.liberal ? '<span class="sym"></span>' : k === 4 ? '<small>Win</small>' : ''}</span>`).join('');
  $('fasTrack').innerHTML = Array.from({ length: 6 }, (_, k) => {
    const pw = v.powers[k];
    const hint = k === 5 ? '<small>Win</small>' : pw ? `<small title="${POWER_SHORT[pw]}">${POWER_ICON[pw]}</small>` : k >= 2 ? '<small class="danger">!</small>' : '';
    return `<span class="slot${k < v.fascist ? ' on fas' : ''}${k === 4 ? ' veto' : ''}">${k < v.fascist ? '<span class="sym"></span>' : hint}</span>`;
  }).join('');
  $('tracker').innerHTML = 'Failed votes ' + [0, 1, 2].map(k => `<span class="dot${k < v.tracker ? ' on' : ''}"></span>`).join('') +
    `<span class="muted"> Deck ${v.deck} · Discards ${v.discard}</span>`;
  $('boardNote').textContent = v.fascist >= 3 ? 'Danger: if Hitler is elected Chancellor now, the Fascists win.' : v.veto ? 'Veto is unlocked.' : '';

  // Role card
  let card;
  if (!s) card = meP.playing ? 'Waiting…' : '<div><b>You are watching this game.</b></div><div class="muted">You get a role when the next game starts.</div>';
  else if (!roleVisible) card = '<div class="seal">?</div><div><b>Hidden</b></div><div class="muted">Make sure nobody is looking, then show your role.</div>';
  else {
    const partyName = s.role === 'liberal' ? 'Liberal' : 'Fascist';
    card = `<div class="muted">Your secret role</div><div class="big">${ROLE_NAME[s.role]}</div><div class="muted">Party: ${partyName}</div>`;
    card += '<div class="goal">' + (s.role === 'liberal' ? 'Enact 5 Liberal policies, or find and execute Hitler.'
      : s.role === 'hitler' ? 'Stay hidden. The Fascists win with 6 Fascist policies, or if you are elected Chancellor once 3 are enacted.'
      : 'Help the Fascists enact 6 policies, or get Hitler elected Chancellor once 3 are enacted. Keep Hitler hidden.') + '</div>';
    if (s.team && s.team.length) card += '<div class="extra">' + s.team.map(t => (t.hitler ? 'Hitler: ' : 'Fascist: ') + '<b>' + esc(name(t.seat)) + '</b>').join('<br>') + '</div>';
    else if (s.role === 'hitler') card += '<div class="extra">You don\'t know who the Fascists are. They know you.</div>';
    if (s.checks && s.checks.length) card += '<div class="extra">' + s.checks.map(c => 'You investigated ' + esc(name(c.target)) + ': <b>' + (c.party === 'liberal' ? 'Liberal' : 'Fascist') + '</b>').join('<br>') + '</div>';
  }
  $('role').innerHTML = card;
  $('roleCard').className = 'rolecard' + (s && roleVisible ? ' open ' + s.role : ' sealed');
  $('roleBtn').style.display = s ? '' : 'none';
  $('roleBtn').textContent = roleVisible ? 'Hide my role' : 'Show my role';

  // What's happening, and what I can do
  const amPres = v.president === me, amChan = v.chancellor === me;
  const alive = meP.alive && s && connected;
  let prompt = '', panel = '';
  if (!connected) prompt = 'The host disconnected. Waiting for them to come back…';
  else if (v.phase === 'over') prompt = v.reason;
  else if (v.phase === 'nominate') prompt = amPres && alive ? 'You are President. Tap a player to nominate them for Chancellor.' : name(v.president) + ' (President) is choosing a Chancellor.';
  else if (v.phase === 'vote') {
    const alreadyVoted = v.voted.includes(me);
    prompt = 'Vote: ' + name(v.president) + ' as President, ' + name(v.nominee) + ' as Chancellor. ' + v.voted.length + ' of ' + v.players.filter(p => p.alive).length + ' have voted.';
    if (alive && !alreadyVoted) panel = '<div class="votebtns"><button class="yes" onclick="vote(true)">Yes</button><button class="no" onclick="vote(false)">No</button></div>';
    else if (alive) panel = '<div class="muted center">You voted ' + (s.myVote ? 'yes' : 'no') + '. Waiting for the others…</div>';
  } else if (v.phase === 'pres') {
    prompt = amPres ? 'Discard one policy. The other two go to the Chancellor.' : 'The President is looking at three policies.';
    if (amPres && s.hand) panel = '<div class="hand">' + s.hand.map((c, k) => `<button class="pick" onclick="discardCard(${k})">${policy(c)}<span class="act">Discard</span></button>`).join('') + '</div>';
  } else if (v.phase === 'chan') {
    prompt = amChan ? 'Enact one policy. The other is discarded.' : 'The Chancellor is choosing a policy to enact.';
    if (amChan && s.hand) panel = '<div class="hand">' + s.hand.map((c, k) => `<button class="pick" onclick="enactCard(${k})">${policy(c)}<span class="act">Enact</span></button>`).join('') + '</div>' +
      (v.veto && !v.vetoAsked ? '<button class="ghost wide" onclick="askVeto()">Ask the President to veto both</button>' : '');
  } else if (v.phase === 'veto') {
    prompt = amPres ? 'The Chancellor wants to veto both policies. Do you agree?' : 'The Chancellor asked for a veto. The President is deciding.';
    if (amPres) panel = '<div class="votebtns"><button class="yes" onclick="answerVeto(true)">Agree to veto</button><button class="no" onclick="answerVeto(false)">Refuse</button></div>';
  } else if (v.phase === 'power') {
    prompt = amPres ? { investigate: 'Tap a player to see their party.', special: 'Tap the player who will be the next President.', peek: 'These are the next three policies, top first.', execute: 'Tap the player to execute.' }[v.power]
      : 'The President ' + POWER_TEXT[v.power] + '.';
    if (amPres && v.power === 'peek' && s.peek) panel = '<div class="hand">' + s.peek.map(c => policy(c)).join('') + '</div><button class="wide" onclick="peekDone()">Done</button>';
  }
  $('msg').textContent = err || prompt;
  $('panel').innerHTML = panel;

  // Players
  const tappable = i => alive && amPres && v.players[i].alive && i !== me && (
    (v.phase === 'nominate' && v.eligible[i]) ||
    (v.phase === 'power' && v.power !== 'peek' && !(v.power === 'investigate' && v.investigated.includes(i))));
  const showLast = v.phase === 'nominate' && v.lastVotes;
  $('players').innerHTML = v.players.map((p, i) => {
    if (!p.playing && !p.role) return '';
    const tags = [];
    if (v.phase !== 'over') {
      if (i === v.president) tags.push('President');
      if (i === v.chancellor && ['pres', 'chan', 'veto', 'power'].includes(v.phase)) tags.push('Chancellor');
      if (i === v.nominee && v.phase === 'vote') tags.push('Nominee');
      if (v.phase === 'nominate' && p.alive && !v.eligible[i] && i !== v.president && (i === v.lastChancellor || i === v.lastPresident)) tags.push('Term-limited');
      if (v.phase === 'vote' && v.voted.includes(i)) tags.push('Voted');
    } else if (p.role) tags.push(ROLE_NAME[p.role]);
    if (!p.alive && p.playing && v.phase !== 'over') tags.push('Executed');
    if (p.left) tags.push('Left');
    if (p.away) tags.push('disconnected');
    const lv = showLast && i in v.lastVotes ? `<span class="lv ${v.lastVotes[i] ? 'y' : 'n'}">${v.lastVotes[i] ? 'Yes' : 'No'}</span>` : '';
    const can = tappable(i);
    const cls = 'pc' + (p.alive ? '' : ' dead') + (can ? ' can' : '') + (i === v.president && v.phase !== 'over' ? ' pres' : '') +
      (v.phase === 'over' && p.role ? ' ' + p.role : '');
    return `<button class="${cls}" ${can ? `onclick="tapPlayer(${i})"` : 'disabled'} aria-label="${esc(name(i))}">${lv}` +
      `<span class="face" style="--c:${SEAT_COLORS[i % SEAT_COLORS.length]}">${p.alive ? initial(name(i)) : '✕'}</span>` +
      `<span class="pn">${esc(name(i))}</span><span class="pt">${tags.map(esc).join(', ')}</span></button>`;
  }).join('');

  $('againBtn').style.display = isHost && v.phase === 'over' ? '' : 'none';
  const inviting = isHost && (v.phase === 'over' || inviteOpen);
  $('inviteBox').style.display = inviting ? '' : 'none';
  if (inviting) renderInvite('qr2', 'joinLink2');
  $('inviteBtn').style.display = isHost && v.phase !== 'over' ? '' : 'none';
  $('inviteBtn').textContent = inviteOpen ? 'Hide invite' : 'Invite more players';
  $('banner').style.display = v.phase === 'over' ? '' : 'none';
  $('banner').className = 'banner ' + v.winner;
  $('banner').innerHTML = v.phase === 'over' ? `<div class="big">${v.winner === 'liberal' ? 'The Liberals win' : 'The Fascists win'}</div><div>${esc(v.reason)}</div>` : '';

  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}
