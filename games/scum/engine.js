// Scum rules engine. Runs only on the host; clients receive state and hands from the host.
export const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
export const SUITS = ['♣','♦','♥','♠'];
export const TITLES = ['President','Vice-President','Vice-Scum','Scum'];
export const POINTS = [3, 2, 1, 0]; // points per finishing place

const sortHand = h => h.sort((a, b) => a.r - b.r || a.s - b.s);
const same = (a, b) => a.r === b.r && a.s === b.s;

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 8);
}

export function createGame(names, bots) {
  return {
    players: names.map((name, i) => ({ name, bot: bots[i], hand: [], done: false })),
    scores: names.map(() => 0),
    round: 0, ranking: null, log: [],
    pile: [], topRank: -1, topCount: 0, lastPlayer: -1, passes: 0,
    order: [], turn: 0, roundOver: false,
  };
}

function exchange(G) {
  const [P, VP, VS, S] = G.ranking;
  const move = (from, to, n, best) => {
    sortHand(G.players[from].hand);
    const h = G.players[from].hand;
    const g = best ? h.splice(-n, n) : h.splice(0, n);
    G.players[to].hand.push(...g);
  };
  move(S, P, 2, true);  move(VS, VP, 1, true);   // Scum and Vice-Scum give their best cards
  move(P, S, 2, false); move(VP, VS, 1, false);  // Presidents return their worst cards
  G.players.forEach(p => sortHand(p.hand));
  log(G, 'Exchange: Scum gives 2 best cards to President, who returns 2 worst; Vice-Scum does the same with 1.');
}

export function newRound(G) {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  G.players.forEach(p => { p.hand = []; p.done = false; });
  d.forEach((c, i) => G.players[i % G.players.length].hand.push(c));
  G.players.forEach(p => sortHand(p.hand));
  Object.assign(G, { pile: [], topRank: -1, topCount: 0, lastPlayer: -1, passes: 0, order: [], roundOver: false });
  G.round++;
  if (G.ranking) { exchange(G); G.turn = G.ranking[0]; }
  else { G.turn = G.players.findIndex(p => p.hand.some(c => c.r === 0 && c.s === 0)); log(G, 'Holder of 3♣ leads.'); }
  log(G, '--- Round ' + G.round + ' ---');
}

const active = G => G.players.map((p, i) => i).filter(i => G.players[i].hand.length > 0);
function nextTurn(G, from) {
  let i = from;
  do { i = (i + 1) % G.players.length; } while (!G.players[i].hand.length);
  return i;
}

export function legalPlays(G, hand) {
  const out = [], by = {};
  hand.forEach(c => (by[c.r] = by[c.r] || []).push(c));
  for (const r in by) {
    for (let k = 1; k <= by[r].length; k++)
      if (G.topCount === 0 || (k === G.topCount && +r >= G.topRank)) out.push(by[r].slice(0, k));
  }
  return out;
}

function isLegal(G, cs) {
  if (!cs.length || cs.some(c => c.r !== cs[0].r)) return false;
  return G.topCount === 0 || (cs.length === G.topCount && cs[0].r >= G.topRank); // same rank is allowed
}

// Apply a move for seat i. kind: 'play' | 'pass'. Returns { ok, err }.
export function act(G, i, kind, cards = []) {
  if (G.roundOver) return { ok: false, err: 'Round is over' };
  if (G.turn !== i) return { ok: false, err: 'Not your turn' };
  const p = G.players[i];
  if (kind === 'pass') {
    if (G.topCount === 0) return { ok: false, err: 'You must play when leading' };
    G.passes++;
    log(G, p.name + ' passes');
  } else {
    const cs = [];
    for (const c of cards) {
      const h = p.hand.find(x => same(x, c) && !cs.includes(x));
      if (!h) return { ok: false, err: 'Card not in hand' };
      cs.push(h);
    }
    if (!isLegal(G, cs)) return { ok: false, err: 'Not a legal play' };
    p.hand = p.hand.filter(h => !cs.includes(h));
    Object.assign(G, { pile: cs, topRank: cs[0].r, topCount: cs.length, lastPlayer: i, passes: 0 });
    log(G, p.name + ' plays ' + cs.length + ' × ' + RANKS[cs[0].r]);
    if (!p.hand.length) { p.done = true; G.order.push(i); log(G, p.name + ' is out!'); }
  }
  afterMove(G, i);
  return { ok: true };
}

function afterMove(G, i) {
  if (G.order.length === G.players.length - 1) {
    const last = G.players.findIndex(p => p.hand.length);
    G.order.push(last);
    G.players[last].done = true;
    G.ranking = G.order.slice();
    G.roundOver = true;
    if (!G.scores) G.scores = G.players.map(() => 0);
    G.ranking.forEach((seat, place) => { G.scores[seat] += POINTS[place]; });
    log(G, 'Round over. President: ' + G.players[G.order[0]].name + '. Scum: ' + G.players[last].name + '.');
    return;
  }
  const need = active(G).filter(k => k !== G.lastPlayer).length;
  if (G.lastPlayer >= 0 && G.passes >= need) {
    log(G, 'Trick taken by ' + G.players[G.lastPlayer].name + '.');
    const lp = G.lastPlayer;
    Object.assign(G, { pile: [], topRank: -1, topCount: 0, passes: 0, lastPlayer: -1 });
    G.turn = G.players[lp].hand.length ? lp : nextTurn(G, lp);
  } else {
    G.turn = nextTurn(G, i);
  }
}

// Simple bot: play the lowest legal option, otherwise pass.
export function botChoice(G, i) {
  const opts = legalPlays(G, G.players[i].hand).sort((a, b) => a[0].r - b[0].r);
  return opts.length ? { kind: 'play', cards: opts[0] } : { kind: 'pass', cards: [] };
}

// What every player is allowed to see (no hands).
export function view(G) {
  return {
    round: G.round, turn: G.turn, roundOver: G.roundOver, log: G.log,
    scores: G.scores || G.players.map(() => 0), ranking: G.ranking || null,
    pile: G.pile, topCount: G.topCount,
    players: G.players.map((p, i) => ({
      name: p.name, bot: p.bot, count: p.hand.length,
      place: G.order.includes(i) ? G.order.indexOf(i) : (G.roundOver && p.done ? G.order.length - 1 : -1),
    })),
  };
}
