// Nightfall UI and networking. The host runs the engine; players send actions and render what the host sends.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, newGame, act, leave, addPlayer, view, secretFor, ROLES, MIN_PLAYERS, MAX_PLAYERS } from './engine.js?v=1795041321';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795041321')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const MAX_SEAT_INDEX = 63; // players who leave keep their index
const ROLE_KEYS = Object.keys(ROLES);

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
  if (a.t === 'pick') { const target = int(a.target, 0, MAX_SEAT_INDEX); return target === null ? null : { t: 'pick', target }; }
  if (a.t === 'vote') { const target = int(a.target, -1, MAX_SEAT_INDEX); return target === null ? null : { t: 'vote', target }; }
  return null; // 'close' is for the host only
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-nightfall-session';
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
  lobby = libs.openLobby({ game: 'nightfall', pin, secret, info: { name: myName, key: myKey, host: isHost } });
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
  if (!confirm('Leave the game? If you are still in, your role will be revealed.')) return;
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

function closeVote() {
  if (!G || !confirm('Close the vote now? Votes cast so far are counted.')) return;
  const r = act(G, 0, { t: 'close' });
  if (!r.ok) { err = r.err; render(); } else update();
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
  const votes = {};
  if (v.votes && typeof v.votes === 'object') Object.entries(v.votes).forEach(([k, t]) => {
    const a = int(k, 0, n - 1), b = int(t, -1, n - 1);
    if (a !== null && b !== null) votes[a] = b;
  });
  return {
    phase: ['lobby', 'night', 'day', 'over'].includes(v.phase) ? v.phase : 'lobby',
    round: int(v.round, 0, 999) ?? 0,
    games: int(v.games, 0, 9999) ?? 0,
    news: String(v.news ?? '').slice(0, 160),
    winner: v.winner === 'town' || v.winner === 'mafia' ? v.winner : '',
    log: Array.isArray(v.log) ? v.log.slice(0, 12).map(x => String(x).slice(0, 160)) : [],
    waiting: Array.isArray(v.waiting) ? v.waiting.map(x => int(x, 0, n - 1)).filter(x => x !== null) : [],
    votes,
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30), alive: !!(p && p.alive), left: !!(p && p.left),
      playing: !!(p && p.playing), away: !!(p && p.away),
      role: ROLE_KEYS.includes(p && p.role) ? p.role : '',
    })),
  };
}

function cleanSecret(s) {
  if (!s || typeof s !== 'object' || !ROLE_KEYS.includes(s.role)) return null;
  const out = { role: s.role, pick: int(s.pick, -1, MAX_SEAT_INDEX) ?? -1 };
  if (Array.isArray(s.team)) out.team = s.team.map(x => int(x, 0, MAX_SEAT_INDEX)).filter(x => x !== null);
  if (s.teamPicks && typeof s.teamPicks === 'object') {
    out.teamPicks = {};
    Object.entries(s.teamPicks).forEach(([k, t]) => { const a = int(k, 0, MAX_SEAT_INDEX), b = int(t, 0, MAX_SEAT_INDEX); if (a !== null && b !== null) out.teamPicks[a] = b; });
  }
  if (Array.isArray(s.checks)) out.checks = s.checks.slice(0, 50).map(c => ({ target: int(c && c.target, 0, MAX_SEAT_INDEX) ?? 0, mafia: !!(c && c.mafia) }));
  if (s.doctorLast !== undefined) out.doctorLast = int(s.doctorLast, -1, MAX_SEAT_INDEX) ?? -1;
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

function choose(i) {
  const v = currentView();
  if (!v) return;
  if (v.phase === 'night') send({ t: 'pick', target: i });
  else if (v.phase === 'day') send({ t: 'vote', target: i });
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(() => joinGame());
window.copyLink = safe(copyLink);
window.startGame = safe(startGame);
window.playAgain = safe(playAgain);
window.closeVote = safe(closeVote);
window.cancelGame = safe(cancelGame);
window.exitGame = safe(exitGame);
window.leaveOrCancel = safe(leaveOrCancel);
window.choose = safe(choose);
window.skipVote = safe(() => send({ t: 'vote', target: -1 }));
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

// Invite block (QR + link): in the lobby, and for the host during the game.
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

const SEAT_COLORS = ['#ff7a59', '#4f8cff', '#c77dff', '#ffb648', '#36c2d6', '#ff5c7a', '#9ccc65', '#f06292', '#7e8cff', '#4dd0a7', '#ffa07a', '#b39ddb'];
const initial = n => esc((String(n).trim()[0] || '?').toUpperCase());

function renderLobby() {
  show('lobby');
  document.body.dataset.phase = '';
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
  document.body.dataset.phase = '';
  $('pinWait').textContent = pin;
  $('roster2').innerHTML = hostId
    ? (lobbyNames.length ? '<b>In the lobby:</b> ' + lobbyNames.map(esc).join(', ') + '.<br>Waiting for the host to start…' : 'Connected. Waiting for the host…')
    : hostAway ? 'The host disconnected. Waiting for them to come back…'
    : 'Searching for the host… this can take up to 30 seconds.';
}

const ROLE_ICON = { mafia: '🗡', doctor: '✚', detective: '🔍', villager: '⌂' };
const roleLabel = r => (r === 'mafia' ? 'Mafia' : ROLES[r].name);

function renderGame() {
  show('game');
  const v = currentView(), s = currentSecret(), me = mySeat();
  const connected = isHost || !hostAway;
  const meP = v.players[me] || { alive: false, playing: false };
  const name = i => (i === me ? 'You' : v.players[i] ? v.players[i].name : '?');
  document.body.dataset.phase = v.phase;
  if (roleGame !== v.games) { roleGame = v.games; roleVisible = false; }

  // Phase banner
  $('phase').innerHTML = v.phase === 'night' ? `<span class="icon">☾</span><div><div class="big">Night ${v.round}</div><div class="muted">Everyone picks someone on their phone.</div></div>`
    : v.phase === 'day' ? `<span class="icon">☀</span><div><div class="big">Day ${v.round}</div><div class="muted">Talk it over, then vote. More than half must agree.</div></div>`
    : v.phase === 'over' ? `<span class="icon">${v.winner === 'town' ? '☀' : '☾'}</span><div><div class="big">${v.winner === 'town' ? 'The town wins' : 'The Mafia wins'}</div><div class="muted">Every role is revealed below.</div></div>` : '';
  $('news').style.display = v.news && v.phase !== 'over' ? '' : 'none';
  $('news').textContent = v.news;

  // Role card
  let card;
  if (!s) card = meP.playing ? 'Waiting…' : '<div><b>You are watching this game.</b></div><div class="muted">You get a role when the next game starts.</div>';
  else if (!roleVisible) card = '<div class="seal">?</div><div><b>Hidden</b></div><div class="muted">Make sure nobody is looking, then show your role.</div>';
  else {
    card = `<div class="roleicon">${ROLE_ICON[s.role]}</div><div class="muted">Your role</div><div class="big">${roleLabel(s.role)}</div><div class="goal">${esc(ROLES[s.role].goal)}</div>`;
    if (s.role === 'mafia') card += '<div class="extra">' + (s.team && s.team.length ? 'Your partners: <b>' + s.team.map(k => esc(name(k))).join(', ') + '</b>' : 'You are the only Mafia.') + '</div>';
    if (s.role === 'detective' && s.checks && s.checks.length) card += '<div class="extra">' + s.checks.map(c => esc(name(c.target)) + ' is ' + (c.mafia ? '<b class="bad">Mafia</b>' : '<b class="good">not Mafia</b>')).join('<br>') + '</div>';
  }
  $('role').innerHTML = card;
  $('roleCard').className = 'rolecard' + (s && roleVisible ? ' open ' + s.role : ' sealed');
  $('roleBtn').style.display = s ? '' : 'none';
  $('roleBtn').textContent = roleVisible ? 'Hide my role' : 'Show my role';

  // What to do now
  const inGame = connected && s && meP.alive;
  let prompt = '';
  if (!connected) prompt = 'The host disconnected. Waiting for them to come back…';
  else if (v.phase === 'over') prompt = isHost ? 'Start a new game when everyone is ready.' : 'Waiting for the host to start a new game…';
  else if (s && !meP.alive) prompt = "You're out. Stay quiet and don't give anything away.";
  else if (!s) prompt = 'You will play in the next game.';
  else if (v.phase === 'night') {
    const done = !v.waiting.includes(me);
    if (!roleVisible) prompt = 'Show your role to see what to do tonight.';
    else prompt = done ? 'Done. Waiting for the others… (' + (v.players.filter(p => p.alive).length - v.waiting.length) + ' of ' + v.players.filter(p => p.alive).length + ')'
      : { mafia: 'Tap the player you want to take out tonight.', doctor: 'Tap the player you want to protect tonight.',
          detective: 'Tap the player you want to investigate.', villager: 'Tap the player you suspect most. (Everyone taps, so nobody can tell who has a role.)' }[s.role];
  } else if (v.phase === 'day') {
    prompt = me in v.votes ? 'You voted. You can change your vote until everyone has voted.' : 'Tap the player you want to vote out, or skip.';
  }
  $('msg').textContent = err || prompt;

  // Players: tap to choose
  const tally = {};
  Object.values(v.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const myPick = v.phase === 'night' ? (s ? s.pick : -1) : v.phase === 'day' ? (me in v.votes ? v.votes[me] : -2) : -2;
  const canPick = i => inGame && roleVisible && v.players[i].alive && (
    v.phase === 'day' ||
    (v.phase === 'night' && !(s.role === 'mafia' && (i === me || (s.team && s.team.includes(i)))) && !(s.role === 'doctor' && i === s.doctorLast) &&
      !((s.role === 'detective' || s.role === 'villager') && i === me)));
  const teamPicks = s && s.teamPicks ? s.teamPicks : {};
  $('players').innerHTML = v.players.map((p, i) => {
    if (!p.playing && !p.alive && !p.role && v.phase !== 'over' && !p.left) return ''; // watching this game
    if (p.left && !p.role) return '';
    const pick = canPick(i);
    const tags = [];
    if (p.role) tags.push(roleLabel(p.role));
    if (!p.alive && p.playing) tags.push('out');
    if (p.away) tags.push('disconnected');
    if (v.phase === 'day' && tally[i]) tags.push(tally[i] + (tally[i] === 1 ? ' vote' : ' votes'));
    const partnerPicks = Object.entries(teamPicks).filter(([k, t]) => t === i).map(([k]) => name(+k));
    if (v.phase === 'night' && partnerPicks.length && roleVisible) tags.push('picked by ' + partnerPicks.join(', '));
    if (s && s.role === 'mafia' && roleVisible && s.team && s.team.includes(i) && v.phase !== 'over') tags.push('Mafia partner');
    const cls = 'pc' + (p.alive ? '' : ' dead') + (i === myPick ? ' chosen' : '') + (pick ? ' can' : '') + (p.role === 'mafia' ? ' mafia' : '');
    return `<button class="${cls}" ${pick ? `onclick="choose(${i})"` : 'disabled'} aria-label="${esc(name(i))}">` +
      `<span class="face" style="--c:${SEAT_COLORS[i % SEAT_COLORS.length]}">${p.alive ? initial(name(i)) : '✕'}</span>` +
      `<span class="pn">${esc(name(i))}</span><span class="pt">${tags.map(esc).join(', ')}</span></button>`;
  }).join('');

  $('skipBtn').style.display = inGame && roleVisible && v.phase === 'day' ? '' : 'none';
  $('skipBtn').classList.toggle('chosen', myPick === -1);
  const skips = tally[-1] || 0;
  $('skipBtn').textContent = 'Skip the vote' + (skips ? ' (' + skips + ')' : '');
  $('closeBtn').style.display = isHost && v.phase === 'day' ? '' : 'none';
  $('againBtn').style.display = isHost && v.phase === 'over' ? '' : 'none';

  // Host: invite more people (they play from the next game)
  const inviting = isHost && (v.phase === 'over' || inviteOpen);
  $('inviteBox').style.display = inviting ? '' : 'none';
  if (inviting) renderInvite('qr2', 'joinLink2');
  $('inviteBtn').style.display = isHost && v.phase !== 'over' ? '' : 'none';
  $('inviteBtn').textContent = inviteOpen ? 'Hide invite' : 'Invite more players';

  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}
