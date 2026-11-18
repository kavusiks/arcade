// Investor UI and networking. The host runs the engine; players send actions and render what the host sends.
// Sessions are kept in sessionStorage so a refresh rejoins the same game in the same tab.
import { createGame, act, botMove, view, endGame, canDo, tradeable, rentFor, MAX_SEATS, TOKEN_COLORS } from './engine.js?v=1795037834';
import { BOARD, GROUPS, JAIL_FINE, isOwnable } from './board.js?v=1795037834';

const $ = id => document.getElementById(id);
let libs = null;
function showErr(t) { $('err').textContent = t || ''; }
// Load networking separately so the buttons still work (and show errors) if it fails.
import('../../lib/lobby.js?v=1795037834')
  .then(m => { libs = m; if (!joinFromHash()) resume(); })
  .catch(e => showErr('Networking failed to load: ' + e.message + '. Check your connection and reload.'));

const BOT_NAMES = ['Ada', 'Ben', 'Cy', 'Dot', 'Eli'];
const ACTIONS = ['roll', 'buy', 'skip', 'end', 'build', 'sell', 'mortgage', 'unmortgage', 'payJail', 'useCard', 'payDebt', 'bankrupt', 'propose', 'accept', 'decline', 'cancel'];

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
const cleanProps = a => Array.isArray(a) ? [...new Set(a.slice(0, 28).map(x => int(x, 0, 39)).filter(x => x !== null))] : [];
const cleanSide = s => ({ cash: int(s && s.cash, 0, 1e6) ?? 0, props: cleanProps(s && s.props) });
function cleanAction(a) {
  if (!a || typeof a !== 'object' || !ACTIONS.includes(a.t)) return null;
  if (['build', 'sell', 'mortgage', 'unmortgage'].includes(a.t)) { const k = int(a.k, 0, 39); return k === null ? null : { t: a.t, k }; }
  if (a.t === 'propose') { const to = int(a.to, 0, MAX_SEATS - 1); return to === null ? null : { t: 'propose', to, give: cleanSide(a.give), get: cleanSide(a.get) }; }
  return { t: a.t };
}

// ---------- session (survives refresh in the same tab) ----------
const SKEY = 'arcade-investor-session';
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
let err = '', selected = -1, tradeOpen = false, inviteOpen = false;

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}
function playerName() { return ($('name').value.trim() || 'Player').slice(0, 20); }

function openRoom() {
  lobby = libs.openLobby({ game: 'investor', pin, secret, info: { name: myName, key: myKey, host: isHost } });
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
  if (!confirm('Leave the game? A bot will take over your money and properties.')) return;
  if (hostId) lobby.send({ t: 'leave', key: myKey }, hostId);
  setTimeout(() => reset('You left the game.'), 300);
}

function leaveOrCancel() { isHost ? cancelGame() : exitGame(); }

function reset(message) {
  clearSession();
  clearTimeout(botTimer); botTimer = null;
  try { if (lobby) lobby.leave(); } catch (e) {}
  lobby = null; secret = ''; G = null; V = null; hostId = null; hostAway = false; seat = -1;
  roster = new Map(); seatKey = []; seatPeer = []; lobbyNames = []; err = ''; selected = -1; tradeOpen = false;
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
    case 'error': err = String(m.err).slice(0, 160); break;
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
      if (!roster.has(key) && roster.size >= MAX_SEATS - 1) { lobby.send({ t: 'full' }, from); return; }
      roster.set(key, { peerId: from, name });
      broadcastLobby(); render();
    } else {
      let i = seatKey.indexOf(key);
      if (i < 0) i = takeBotSeat(key, name); // a newcomer can take over a bot at any time
      if (i <= 0) { lobby.send({ t: 'full' }, from); return; }
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

// A newcomer takes over a bot's seat, with its money and properties.
function takeBotSeat(key, name) {
  const i = G.players.findIndex((p, k) => k > 0 && p.bot && !p.bankrupt);
  if (i < 0) return -1;
  G.players[i].bot = false;
  G.log.unshift(name + ' takes over from ' + G.players[i].name + '.');
  G.players[i].name = name;
  seatKey[i] = key;
  return i;
}

// A player who leaves is replaced by a bot so the game can continue.
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
  const target = Math.max(2, Number($('botFill').value) || 0);
  while (names.length < target) {
    names.push(BOT_NAMES[names.length - 1] + ' (bot)');
    bots.push(true); seatKey.push(null); seatPeer.push(null);
  }
  G = createGame(names, bots);
  G.log.unshift('Everyone starts with 1500. ' + names[0] + ' goes first.');
  seatPeer.forEach((id, i) => { if (id) lobby.send({ t: 'you', seat: i }, id); });
  update();
}

// Same players (and bots) start a fresh game.
function playAgain() {
  if (!G || !G.over) return;
  const names = G.players.map(p => p.name), bots = G.players.map(p => p.bot);
  G = createGame(names, bots);
  G.log.unshift('New game! Everyone starts with 1500.');
  update();
}

function hostEndGame() {
  if (!G || G.over || !confirm('End the game now? The player with the highest net worth wins.')) return;
  endGame(G, 'host');
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
  if (G.over) return;
  // Bots answer offers made to them, and play their own turns.
  const actor = G.trade && G.players[G.trade.to].bot ? G.trade.to : G.players[G.turn].bot ? G.turn : -1;
  if (actor >= 0) {
    clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      if (!G || G.over) return;
      const m = botMove(G, actor);
      if (m && act(G, actor, m).ok) update();
    }, 700);
  }
}

function cleanView(v) {
  if (!v || !Array.isArray(v.players) || v.players.length < 2 || v.players.length > MAX_SEATS) return null;
  const n = v.players.length;
  const arr40 = (a, f) => Array.isArray(a) && a.length === 40 ? a.map(f) : BOARD.map(() => f(null));
  const T = v.trade;
  return {
    players: v.players.map(p => ({
      name: String(p && p.name).slice(0, 30), bot: !!(p && p.bot), away: !!(p && p.away),
      cash: int(p && p.cash, -1e7, 1e7) ?? 0, pos: int(p && p.pos, 0, 39) ?? 0, inJail: !!(p && p.inJail),
      jailTurns: int(p && p.jailTurns, 0, 3) ?? 0, jailCards: int(p && p.jailCards, 0, 99) ?? 0,
      bankrupt: !!(p && p.bankrupt), worth: int(p && p.worth, -1e7, 1e8) ?? 0,
    })),
    owner: arr40(v.owner, x => int(x, -1, n - 1) ?? -1),
    houses: arr40(v.houses, x => int(x, 0, 5) ?? 0),
    mortgaged: arr40(v.mortgaged, x => !!x),
    turn: int(v.turn, 0, n - 1) ?? 0,
    phase: ['roll', 'buy', 'end', 'debt', 'landed', 'over'].includes(v.phase) ? v.phase : 'roll',
    dice: Array.isArray(v.dice) ? v.dice.slice(0, 2).map(x => int(x, 0, 6) ?? 0) : [0, 0],
    debt: v.debt ? { to: int(v.debt.to, -1, n - 1) ?? -1, amount: int(v.debt.amount, 0, 1e7) ?? 0 } : null,
    card: v.card ? { deck: v.card.deck === 'luck' ? 'luck' : 'bonus', text: String(v.card.text ?? '').slice(0, 120) } : null,
    trade: T ? { from: int(T.from, 0, n - 1) ?? 0, to: int(T.to, 0, n - 1) ?? 0, give: cleanSide(T.give), get: cleanSide(T.get) } : null,
    log: Array.isArray(v.log) ? v.log.slice(0, 10).map(x => String(x).slice(0, 160)) : [],
    over: !!v.over, winner: int(v.winner, -1, n - 1) ?? -1,
    ranking: Array.isArray(v.ranking) ? v.ranking.map(x => int(x, 0, n - 1)).filter(x => x !== null) : null,
  };
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

function selectSpace(k) { selected = selected === k ? -1 : k; render(); }

function openTrade() { tradeOpen = !tradeOpen; render(); }

function proposeTrade() {
  const to = $('tradeTo') ? int($('tradeTo').value, 0, MAX_SEATS - 1) : null;
  if (to === null) { err = 'Pick who to trade with.'; render(); return; }
  const picked = cls => [...document.querySelectorAll('.' + cls + ':checked')].map(e => int(e.value, 0, 39)).filter(x => x !== null);
  const give = { cash: int($('giveCash').value || 0, 0, 1e6) ?? 0, props: picked('giveProp') };
  const get = { cash: int($('getCash').value || 0, 0, 1e6) ?? 0, props: picked('getProp') };
  tradeOpen = false;
  send({ t: 'propose', to, give, get });
}

const safe = fn => (...a) => { try { showErr(''); return fn(...a); } catch (e) { showErr('Error: ' + (e && e.message || e)); console.error(e); } };
window.hostGame = safe(hostGame);
window.joinGame = safe(() => joinGame());
window.copyLink = safe(copyLink);
window.startGame = safe(startGame);
window.playAgain = safe(playAgain);
window.hostEndGame = safe(hostEndGame);
window.cancelGame = safe(cancelGame);
window.exitGame = safe(exitGame);
window.leaveOrCancel = safe(leaveOrCancel);
window.doAct = safe((t, k) => send(k === undefined ? { t } : { t, k }));
window.selectSpace = safe(selectSpace);
window.openTrade = safe(openTrade);
window.toggleInvite = safe(() => { inviteOpen = !inviteOpen; render(); });
window.proposeTrade = safe(proposeTrade);
window.tradeTarget = safe(() => render());
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

// Invite block (QR + link) for the lobby.
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
  $('roster').innerHTML = '<div class="label">Players (' + names.length + '/' + MAX_SEATS + ')</div><div class="avatars">' +
    names.map((n, i) => `<div class="av"><div class="face" style="--c:${TOKEN_COLORS[i % TOKEN_COLORS.length]}">${esc((String(n).trim()[0] || '?').toUpperCase())}</div><div>${esc(n)}</div></div>`).join('') + '</div>';
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

// Board position → grid cell (11×11, Start in the bottom-right corner, moving clockwise from the player's view).
function cell(k) {
  if (k <= 10) return [11, 11 - k];
  if (k <= 20) return [11 - (k - 10), 1];
  if (k <= 30) return [1, k - 19];
  return [k - 29, 11];
}
const ICON = { start: '➜', luck: '?', bonus: '★', tax: '$', jail: '▦', rest: '☕', gotojail: '⚑', station: '🚉', utility: '⚡' };

function renderBoard(v, me) {
  $('board').innerHTML = BOARD.map((sp, k) => {
    const [r, c] = cell(k);
    const o = v.owner[k];
    const band = sp.type === 'street' ? `<div class="band" style="background:${GROUPS[sp.group].color}"></div>` : '';
    const icon = ICON[sp.type] ? `<div class="icon">${sp.type === 'utility' && k === 28 ? '💧' : ICON[sp.type]}</div>` : '';
    const h = v.houses[k];
    const built = h === 5 ? '<div class="hs"><span class="hotel"></span></div>' : h ? '<div class="hs">' + '<span class="house"></span>'.repeat(h) + '</div>' : '';
    const tokens = v.players.map((p, i) => (!p.bankrupt && p.pos === k ? `<span class="tok${i === v.turn ? ' now' : ''}" style="background:${TOKEN_COLORS[i]}"></span>` : '')).join('');
    const style = `grid-row:${r};grid-column:${c};` + (o >= 0 ? `box-shadow:inset 0 0 0 2px ${TOKEN_COLORS[o]}` : '');
    return `<div class="sq${v.mortgaged[k] ? ' mort' : ''}${k === selected ? ' sel' : ''}${[0, 10, 20, 30].includes(k) ? ' corner' : ''}" style="${style}" onclick="selectSpace(${k})">` +
      band + icon + `<div class="nm">${esc(sp.short)}</div>` + built + `<div class="toks">${tokens}</div></div>`;
  }).join('') +
  `<div class="center"><div class="title">INVESTOR</div>` +
  `<div class="dice">${v.dice[0] ? dieFace(v.dice[0]) + dieFace(v.dice[1]) : ''}</div>` +
  `<div class="whose">${v.over ? 'Game over' : (v.turn === me ? 'Your turn' : esc(v.players[v.turn].name) + "'s turn")}</div>` +
  (v.card ? `<div class="cardbox ${v.card.deck}"><b>${v.card.deck === 'luck' ? 'Luck' : 'Bonus'}</b><br>${esc(v.card.text)}</div>` : '') + `</div>`;
}
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const dieFace = n => '<span class="die">' + Array.from({ length: 9 }, (_, i) => `<i${PIPS[n].includes(i) ? ' class="p"' : ''}></i>`).join('') + '</span>';

function spaceInfo(v, k) {
  const sp = BOARD[k], o = v.owner[k];
  let h = `<b>${esc(sp.name)}</b>`;
  if (sp.type === 'street') {
    const hc = GROUPS[sp.group].house;
    h += ` <span class="chip" style="background:${GROUPS[sp.group].color}"></span><br>Price ${sp.price} · house ${hc}<br>` +
      `Rent ${sp.rents[0]} (×2 with the whole group) · 1 house ${sp.rents[1]} · 2: ${sp.rents[2]} · 3: ${sp.rents[3]} · 4: ${sp.rents[4]} · hotel ${sp.rents[5]}`;
  } else if (sp.type === 'station') h += '<br>Price 200 · rent 25 / 50 / 100 / 200 for 1–4 stations';
  else if (sp.type === 'utility') h += '<br>Price 150 · rent 4× the dice, 10× with both utilities';
  else if (sp.type === 'tax') h += '<br>Pay ' + sp.amount;
  else if (sp.type === 'luck' || sp.type === 'bonus') h += '<br>Draw a card';
  else if (sp.type === 'gotojail') h += '<br>Go straight to jail';
  else if (sp.type === 'start') h += '<br>Collect 200 when you pass';
  else if (sp.type === 'jail') h += '<br>In jail: pay ' + JAIL_FINE + ', use a card, or roll doubles (3 tries)';
  if (isOwnable(sp)) h += '<br>' + (o < 0 ? 'Not owned' : 'Owner: ' + esc(v.players[o].name) + (v.mortgaged[k] ? ' (mortgaged)' : '') +
    (v.houses[k] ? ' · ' + (v.houses[k] === 5 ? 'hotel' : v.houses[k] + ' house' + (v.houses[k] > 1 ? 's' : '')) : '') +
    ' · rent now ' + (sp.type === 'utility' ? (rentFor(fakeG(v), k, 1)) + '× dice' : rentFor(fakeG(v), k, 0)));
  return h;
}
// Enough of a game object for the rule helpers to run on a received view.
const fakeG = v => ({ players: v.players.map(p => ({ cash: p.cash, bankrupt: p.bankrupt })), owner: v.owner, houses: v.houses, mortgaged: v.mortgaged });

function renderGame(v, me) {
  show('game');
  renderBoard(v, me);
  const connected = isHost || !hostAway;
  const meP = v.players[me];
  const myTurn = connected && !v.over && v.turn === me && !meP.bankrupt;
  const ph = v.phase;

  $('spaceInfo').style.display = selected >= 0 ? '' : 'none';
  if (selected >= 0) $('spaceInfo').innerHTML = spaceInfo(v, selected);

  // Players
  $('players').innerHTML = v.players.map((p, i) => '<div class="pl' + (i === v.turn && !v.over ? ' now' : '') + (p.bankrupt ? ' out' : '') + '">' +
    `<span class="tok" style="background:${TOKEN_COLORS[i]}"></span> ` + esc(i === me ? 'You' : p.name) + (p.bot ? ' 🤖' : '') + (p.away ? ' (disconnected)' : '') +
    (p.bankrupt ? ' · bankrupt' : ' · <b>' + p.cash + '</b>' + (p.inJail ? ' · in jail' : '') + (p.jailCards ? ' · ' + p.jailCards + ' jail card' : '')) +
    '<span class="muted"> · worth ' + p.worth + '</span></div>').join('');

  // Main actions
  const B = [];
  const btn = (label, t, extra = '') => B.push(`<button onclick="doAct('${t}')" ${extra}>${label}</button>`);
  if (myTurn) {
    if (ph === 'roll') {
      if (meP.inJail) {
        if (meP.jailCards) btn('Use jail card', 'useCard');
        btn('Pay ' + JAIL_FINE + ' to leave jail', 'payJail', meP.cash < JAIL_FINE ? 'disabled' : '');
        btn('Roll for doubles (try ' + (meP.jailTurns + 1) + '/3)', 'roll');
      } else btn('Roll the dice', 'roll');
    } else if (ph === 'buy') {
      const sp = BOARD[meP.pos];
      btn('Buy ' + esc(sp.name) + ' for ' + sp.price, 'buy', meP.cash < sp.price ? 'disabled' : '');
      btn("Don't buy", 'skip');
    } else if (ph === 'end') btn('End turn', 'end');
    else if (ph === 'debt') {
      btn('Pay ' + v.debt.amount, 'payDebt', meP.cash < v.debt.amount ? 'disabled' : '');
      B.push(`<button class="no" onclick="if(confirm('Go bankrupt? You are out of the game.'))doAct('bankrupt')">Go bankrupt</button>`);
    }
  }
  $('actions').innerHTML = B.join('');

  $('msg').textContent = !connected ? 'The host disconnected. Waiting for them to come back…'
    : err || (v.over ? (v.winner === me ? 'You win!' : esc(v.players[v.winner].name) + ' wins!')
    : !myTurn ? v.players[v.turn].name + ' is playing…'
    : ph === 'roll' ? (meP.inJail ? 'You are in jail.' : 'Your turn: roll the dice.')
    : ph === 'buy' ? 'Buy this property, or leave it?'
    : ph === 'debt' ? 'You owe ' + v.debt.amount + ' but have ' + meP.cash + '. Sell buildings or mortgage properties below, then pay. Or go bankrupt.'
    : v.rolledDouble ? 'Doubles! Roll again.' : 'Build, trade, or end your turn.');

  // Incoming / outgoing trade
  const T = v.trade;
  $('offer').style.display = T && (T.to === me || T.from === me) ? '' : 'none';
  if (T && (T.to === me || T.from === me)) {
    const side = s => [...s.props.map(k => esc(BOARD[k].name)), s.cash ? s.cash + ' cash' : ''].filter(Boolean).join(', ') || 'nothing';
    $('offer').innerHTML = T.to === me
      ? `<b>${esc(v.players[T.from].name)}</b> offers you <b>${side(T.give)}</b> for your <b>${side(T.get)}</b>.<br>` +
        `<button onclick="doAct('accept')">Accept</button><button class="no" onclick="doAct('decline')">Decline</button>`
      : `Your offer to <b>${esc(v.players[T.to].name)}</b>: ${side(T.give)} for ${side(T.get)}. Waiting for an answer…<br><button class="ghost" onclick="doAct('cancel')">Withdraw</button>`;
  }

  // Trade builder
  const canTrade = myTurn && (ph === 'roll' || ph === 'end') && !T;
  $('tradeBtn').style.display = canTrade ? '' : 'none';
  $('tradeBtn').textContent = tradeOpen ? 'Close trade' : 'Make a trade offer';
  $('tradeBox').style.display = canTrade && tradeOpen ? '' : 'none';
  if (canTrade && tradeOpen) renderTradeBox(v, me);

  // My properties
  const mine = BOARD.map((s, k) => k).filter(k => v.owner[k] === me);
  const FG = fakeG(v);
  const manage = myTurn && ['roll', 'end', 'debt', 'buy'].includes(ph);
  $('mine').innerHTML = mine.length ? mine.map(k => {
    const sp = BOARD[k];
    const can = t => manage && (t === 'build' || t === 'unmortgage' ? ph !== 'debt' : true) && canDo[t](FG, me, k);
    const b = (t, label) => can(t) ? `<button class="small" onclick="doAct('${t}', ${k})">${label}</button>` : '';
    const chip = sp.type === 'street' ? `<span class="chip" style="background:${GROUPS[sp.group].color}"></span>` : (ICON[sp.type] || '') + ' ';
    const st = v.mortgaged[k] ? ' <span class="muted">(mortgaged)</span>' : v.houses[k] ? ' · ' + (v.houses[k] === 5 ? 'hotel' : v.houses[k] + '🏠') : '';
    return `<div class="prop">${chip}${esc(sp.name)}${st}<br>` +
      b('build', 'Build ' + (sp.type === 'street' ? GROUPS[sp.group].house : '')) + b('sell', 'Sell building +' + (sp.type === 'street' ? GROUPS[sp.group].house / 2 : '')) +
      b('mortgage', 'Mortgage +' + sp.price / 2) + b('unmortgage', 'Lift mortgage −' + Math.ceil(sp.price / 2 * 1.1)) + '</div>';
  }).join('') : '<span class="muted">You don\'t own anything yet.</span>';

  // Game over
  $('overBox').style.display = v.over ? '' : 'none';
  if (v.over && v.ranking) {
    $('overBox').innerHTML = '<div class="big">' + esc(v.players[v.winner].name) + ' wins!</div><table><tr><th>#</th><th>Player</th><th>Net worth</th></tr>' +
      v.ranking.map((i, n) => '<tr><td>' + (n + 1) + '</td><td>' + esc(i === me ? 'You' : v.players[i].name) + '</td><td>' + (v.players[i].bankrupt ? 'bankrupt' : v.players[i].worth) + '</td></tr>').join('') + '</table>' +
      (isHost ? '<button onclick="playAgain()">Play again</button>' : '<div class="muted">Waiting for the host to start a new game…</div>');
  }
  $('endBtn').style.display = isHost && !v.over ? '' : 'none';
  // Host: invite newcomers to take over a bot at any time.
  const botSeat = isHost && !v.over && v.players.some((p, i) => i > 0 && p.bot && !p.bankrupt);
  $('inviteBtn').style.display = botSeat ? '' : 'none';
  $('inviteBtn').textContent = inviteOpen ? 'Hide invite' : 'Invite a player to take over a bot';
  $('inviteBox').style.display = botSeat && inviteOpen ? '' : 'none';
  if (botSeat && inviteOpen) renderInvite('qr2', 'joinLink2');

  $('log').innerHTML = v.log.map(esc).join('<br>');
  $('leaveBtn').textContent = isHost ? 'Cancel game' : 'Leave game';
}

function renderTradeBox(v, me) {
  const others = v.players.map((p, i) => [i, p]).filter(([i, p]) => i !== me && !p.bankrupt);
  const cur = $('tradeTo') ? int($('tradeTo').value, 0, MAX_SEATS - 1) : null; // not there the first time
  const sig = JSON.stringify([others.map(o => o[0]), v.owner, v.houses]);
  if ($('tradeBox').dataset.sig === sig + cur) return; // keep the player's ticks while they fill it in
  const FG = fakeG(v);
  const to = cur !== null && others.some(o => o[0] === cur) ? cur : null;
  const list = (who, cls) => BOARD.map((s, k) => k).filter(k => tradeable(FG, who, k))
    .map(k => `<label class="tp"><input type="checkbox" class="${cls}" value="${k}"> ${esc(BOARD[k].name)}${v.mortgaged[k] ? ' (mortgaged)' : ''}</label>`).join('') || '<span class="muted">Nothing tradeable</span>';
  $('tradeBox').innerHTML =
    `<label class="muted">Trade with</label><select id="tradeTo" onchange="tradeTarget()"><option value="">Pick a player</option>` +
    others.map(([i, p]) => `<option value="${i}"${i === to ? ' selected' : ''}>${esc(p.name)}</option>`).join('') + `</select>` +
    `<div class="cols"><div><b>You give</b><br>${list(me, 'giveProp')}<label class="muted">Cash</label><input id="giveCash" type="number" min="0" value="0"></div>` +
    `<div><b>You get</b><br>${to === null ? '<span class="muted">Pick a player first</span>' : list(to, 'getProp')}<label class="muted">Cash</label><input id="getCash" type="number" min="0" value="0"></div></div>` +
    `<button onclick="proposeTrade()">Send offer</button>`;
  $('tradeBox').dataset.sig = sig + (to === null ? 'null' : to);
}
