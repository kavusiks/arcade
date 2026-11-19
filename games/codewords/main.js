// Code Words UI and networking. The host runs the engine; players send actions and render what the host sends.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newRound, act, setTeam, rotateSpymasters, leave, addPlayer, view, secretFor, TEAMS, MIN_PLAYERS, MAX_PLAYERS } from './engine.js?v=1795051616';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795051616')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const MAX_SEAT_INDEX = 63; // players who leave keep their index
const KEYS = ['red', 'blue', 'none', 'trap'];
const TEAM_NAME = { red: 'Red', blue: 'Blue' };

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
  if (a.t === 'team') return TEAMS.includes(a.team) ? { t: 'team', team: a.team, spy: a.spy === true } : null;
  if (a.t === 'clue') { const count = int(a.count, 0, 9); return typeof a.word === 'string' && count !== null ? { t: 'clue', word: a.word.slice(0, 25), count } : null; }
  if (a.t === 'guess') { const index = int(a.index, 0, 24); return index === null ? null : { t: 'guess', index }; }
  if (a.t === 'stop') return { t: 'stop' };
  return null;
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-codewords-session';
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
let keyVisible = false, keyRound = 0; // not saved: after a reload (or a new round) the key is hidden
let pending = -1;                    // word tapped once; a second tap confirms the guess

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'codewords', pin, secret, info: { name: myName, key: myKey, host: isHost } });
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
      if (i < 0) { // a newcomer joins the smaller team straight away
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
    const r = hostAct(i, a);
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
  G = createGame(names, $('lang').value);
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
  update();
}

function startRound() {
  if (!G) return;
  G.lang = $('lang2').value === 'no' ? 'no' : 'en';
  const r = newRound(G);
  if (!r.ok) { err = r.err; render(); return; }
  update();
}

function rotate() { if (G && (G.phase === 'over' || G.phase === 'teams')) { rotateSpymasters(G); update(); } }

function update() {
  err = '';
  saveHost();
  render();
  lobby.broadcast({ t: 'state', v: view(G) });
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'secret', s: secretFor(G, i) }, id); });
}

// The host also handles team changes coming from players.
const hostAct = (i, a) => (a.t === 'team' ? setTeam(G, i, a.team, a.spy) : act(G, i, a));

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length < 1 || v.players.length > MAX_SEAT_INDEX + 1) return null;
  const words = Array.isArray(v.words) ? v.words.slice(0, 25).map(w => String(w).slice(0, 20)) : [];
  return {
    phase: ['teams', 'clue', 'guess', 'over'].includes(v.phase) ? v.phase : 'teams',
    round: int(v.round, 0, 1e6) ?? 0, lang: v.lang === 'no' ? 'no' : 'en',
    turn: TEAMS.includes(v.turn) ? v.turn : 'red', starter: TEAMS.includes(v.starter) ? v.starter : 'red',
    words,
    revealed: Array.isArray(v.revealed) ? v.revealed.slice(0, 25).map(Boolean) : [],
    colors: Array.isArray(v.colors) ? v.colors.slice(0, 25).map(c => (KEYS.includes(c) ? c : '')) : [],
    clue: v.clue && typeof v.clue === 'object' ? { word: String(v.clue.word ?? '').slice(0, 25), count: int(v.clue.count, 0, 9) ?? 1 } : null,
    guesses: int(v.guesses, 0, 25) ?? 0,
    scores: { red: int(v.scores && v.scores.red, 0, 1e6) ?? 0, blue: int(v.scores && v.scores.blue, 0, 1e6) ?? 0 },
    left: { red: int(v.left && v.left.red, 0, 9) ?? 0, blue: int(v.left && v.left.blue, 0, 9) ?? 0 },
    winner: TEAMS.includes(v.winner) ? v.winner : '', reason: String(v.reason ?? '').slice(0, 160), problem: String(v.problem ?? '').slice(0, 80),
    log: Array.isArray(v.log) ? v.log.slice(0, 12).map(x => String(x).slice(0, 160)) : [],
    players: v.players.map(p => ({ name: String(p && p.name).slice(0, 30), team: TEAMS.includes(p && p.team) ? p.team : 'red', spy: !!(p && p.spy), left: !!(p && p.left) })),
  };
}

function cleanSecret(s) {
  if (!s || !Array.isArray(s.key) || s.key.length !== 25) return null;
  return { key: s.key.map(k => (KEYS.includes(k) ? k : 'none')) };
}

// ---------- player actions ----------
function send(a) {
  err = '';
  if (isHost) {
    const r = hostAct(0, a);
    if (!r.ok) { err = r.err; render(); } else update();
  } else if (hostId) {
    lobby.send({ t: 'move', a }, hostId);
  }
}

function tapWord(n) {
  if (pending !== n) { pending = n; render(); return; } // first tap marks it
  pending = -1;
  send({ t: 'guess', index: n });
}

function giveClue() {
  const word = $('clueWord').value.trim();
  const count = int($('clueCount').value, 0, 9) ?? 1;
  if (!word) { err = 'Type a one-word clue.'; render(); return; }
  $('clueWord').value = '';
  send({ t: 'clue', word, count });
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(() => joinGame());
window.copyLink = safe(copyLink);
window.startGame = safe(startGame);
window.startRound = safe(startRound);
window.rotate = safe(rotate);
window.cancelGame = safe(cancelGame);
window.exitGame = safe(exitGame);
window.leaveOrCancel = safe(leaveOrCancel);
window.pickTeam = safe((team, spy) => send({ t: 'team', team, spy: !!spy }));
window.tapWord = safe(tapWord);
window.giveClue = safe(giveClue);
window.stopGuessing = safe(() => send({ t: 'stop' }));
window.toggleKey = safe(() => { keyVisible = !keyVisible; render(); });
window.toggleInvite = safe(() => { inviteOpen = !inviteOpen; render(); });
window.addEventListener('error', e => showErr('Error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Error: ' + (e.reason && e.reason.message || e.reason)));

// ---------- rendering ----------
function currentView() { return isHost ? (G ? view(G) : null) : V; }
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

const initial = n => esc((String(n).trim()[0] || '?').toUpperCase());

function renderLobby() {
  show('lobby');
  $('pinShow').textContent = pin;
  renderInvite('qr', 'joinLink');
  const names = [myName + ' (host)', ...[...roster.values()].map(r => r.name)];
  $('roster').innerHTML = '<div class="label">Players (' + names.length + '/' + MAX_PLAYERS + ')</div><div class="avatars">' +
    names.map((n, i) => `<div class="av"><div class="face" style="--c:${i % 2 ? '#3f7fe0' : '#e0473f'}">${initial(n)}</div><div>${esc(n)}</div></div>`).join('') + '</div>' +
    (names.length < MIN_PLAYERS ? '<div class="muted">You need at least ' + MIN_PLAYERS + ' players: two teams of two.</div>' : '');
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

function renderGame() {
  show('game');
  const v = currentView(), s = currentSecret(), me = mySeat();
  const connected = isHost || !hostAway;
  const meP = v.players[me] || { team: 'red', spy: false };
  const name = i => (i === me ? 'You' : v.players[i] ? v.players[i].name : '?');
  const between = v.phase === 'teams' || v.phase === 'over';
  if (keyRound !== v.round) { keyRound = v.round; keyVisible = false; pending = -1; }
  document.body.dataset.turn = between ? '' : v.turn;

  // Score and teams
  $('score').innerHTML = TEAMS.map(t =>
    `<div class="tm ${t}${!between && v.turn === t ? ' now' : ''}"><div class="tn">${TEAM_NAME[t]}</div><div class="big">${v.scores[t]}</div>` +
    (v.words.length && v.phase !== 'teams' ? `<div class="muted">${v.left[t]} word${v.left[t] === 1 ? '' : 's'} left</div>` : '<div class="muted">wins</div>') + '</div>').join('');
  $('teams').innerHTML = TEAMS.map(t => `<div class="col ${t}"><div class="tn">${TEAM_NAME[t]}</div>` +
    v.players.map((p, i) => (p.left || p.team !== t ? '' : `<div class="mem${p.spy ? ' spy' : ''}">${p.spy ? '<span class="crown">◆</span> ' : ''}${esc(name(i))}${p.spy ? ' <span class="muted">spymaster</span>' : ''}</div>`)).join('') + '</div>').join('');

  // Team picking (before and between rounds)
  $('setup').style.display = between ? '' : 'none';
  if (between) {
    $('myTeam').innerHTML = TEAMS.map(t =>
      `<button class="${meP.team === t && !meP.spy ? '' : 'ghost'} ${t}b" onclick="pickTeam('${t}', false)">Join ${TEAM_NAME[t]}</button>` +
      `<button class="${meP.team === t && meP.spy ? '' : 'ghost'} ${t}b" onclick="pickTeam('${t}', true)">${TEAM_NAME[t]} spymaster</button>`).join('');
    $('hostSetup').style.display = isHost ? '' : 'none';
    if (isHost) { $('lang2').value = v.lang; $('startBtn').disabled = !!v.problem; $('startBtn').textContent = v.round ? 'Start next round' : 'Start round'; }
    $('problem').textContent = v.problem ? v.problem + '.' : isHost ? 'Ready when you are.' : 'Waiting for the host to start the round…';
  }

  // Clue area
  const myTurn = connected && !between && meP.team === v.turn;
  const giving = myTurn && meP.spy && v.phase === 'clue';
  $('clueBox').style.display = giving ? '' : 'none';
  $('clueShow').style.display = !between && v.clue ? '' : 'none';
  if (v.clue) $('clueShow').innerHTML = `<span class="cw">${esc(v.clue.word)}</span><span class="cn">${v.clue.count === 0 ? '∞' : v.clue.count}</span>`;
  const guessing = myTurn && !meP.spy && v.phase === 'guess';
  $('stopBtn').style.display = guessing && v.guesses > 0 ? '' : 'none';

  // Status line
  let msg = '';
  if (!connected) msg = 'The host disconnected. Waiting for them to come back…';
  else if (v.phase === 'over') msg = v.reason;
  else if (v.phase === 'teams') msg = 'Pick a team. Each team needs a spymaster and at least one guesser.';
  else if (v.phase === 'clue') msg = giving ? 'Your turn: give your team a one-word clue and a number.' : TEAM_NAME[v.turn] + "'s spymaster is thinking of a clue…";
  else msg = guessing ? (pending >= 0 ? 'Tap "' + v.words[pending] + '" again to confirm, or tap another word.' : 'Tap a word your spymaster means. Tap twice to confirm.')
    : meP.spy && myTurn ? 'Your team is guessing. No hints!' : TEAM_NAME[v.turn] + ' is guessing.';
  $('msg').textContent = err || msg;

  // Board
  const key = s && keyVisible ? s.key : null;
  $('board').style.display = v.words.length ? '' : 'none';
  $('board').innerHTML = v.words.map((w, n) => {
    const shown = v.colors[n];
    const tint = shown || (key ? key[n] : '');
    const can = guessing && !v.revealed[n];
    const cls = 'w' + (tint ? ' k-' + tint : '') + (v.revealed[n] ? ' rev' : '') + (key && !v.revealed[n] ? ' hint' : '') + (pending === n ? ' pend' : '') + (w.length > 7 ? ' long' : '');
    return `<button class="${cls}" ${can ? `onclick="tapWord(${n})"` : 'disabled'}>${esc(w)}</button>`;
  }).join('');
  $('keyBtn').style.display = s && !between ? '' : 'none';
  $('keyBtn').textContent = keyVisible ? 'Hide the key' : 'Show the key (spymasters only)';

  const inviting = isHost && (between || inviteOpen);
  $('inviteBox').style.display = inviting ? '' : 'none';
  if (inviting) renderInvite('qr2', 'joinLink2');
  $('inviteBtn').style.display = isHost && !between ? '' : 'none';
  $('inviteBtn').textContent = inviteOpen ? 'Hide invite' : 'Invite more players';
  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}
