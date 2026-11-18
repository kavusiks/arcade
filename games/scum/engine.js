// Scum rules engine. Runs only on the host; clients receive state and hands from the host.
export const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
export const SUITS = ['♣','♦','♥','♠'];
export const TITLES = ['President','Vice-President','Vice-Scum','Scum'];
export const POINTS = [3, 2, 1, 0]; // points per finishing place

// The 3 of clubs is special: it beats everything, is always played alone, clears the pile,
// and a player whose only remaining card is the 3♣ loses the round (becomes Scum).
const is3C = c => c.r === 0 && c.s === 0;
const is3S = c => c.r === 0 && c.s === 3; // 3♠: its holder starts every round and must play it first
const strength = c => (is3C(c) ? 13 : c.r);                 // 3♣ ranks above 2s
const sortHand = h => h.sort((a, b) => strength(a) - strength(b) || a.s - b.s);
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
    runRank: -1, runCount: 0, // cards of the same rank stacked in a row this trick
    order: [], loser: -1, turn: 0, roundOver: false,
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
  move(S, P, 2, true);  move(VS, VP, 1, true);   // Scum and Vice-Scum give their best cards (3♣ counts as best)
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
  Object.assign(G, { pile: [], topRank: -1, topCount: 0, lastPlayer: -1, passes: 0, runRank: -1, runCount: 0, order: [], loser: -1, roundOver: false });
  G.round++;
  if (G.ranking) exchange(G);
  G.turn = G.players.findIndex(p => p.hand.some(is3S));
  G.mustOpen = true;
  log(G, '--- Round ' + G.round + ' ---');
  log(G, G.players[G.turn].name + ' has the 3♠ and starts. The opening play must include it.');
}

const active = G => G.players.map((p, i) => i).filter(i => G.players[i].hand.length > 0);
function nextTurn(G, from) {
  let i = from;
  do { i = (i + 1) % G.players.length; } while (!G.players[i].hand.length);
  return i;
}

export function legalPlays(G, hand) {
  if (G.mustOpen) {
    // Opening play: the 3♠ alone, or with other 3s (not the 3♣, which is always played alone).
    const threes = hand.filter(c => c.r === 0 && !is3C(c)).sort((a, b) => is3S(b) - is3S(a));
    return threes.some(is3S) ? threes.map((_, k) => threes.slice(0, k + 1)) : [];
  }
  const out = [], by = {};
  hand.filter(c => !is3C(c)).forEach(c => (by[c.r] = by[c.r] || []).push(c));
  for (const r in by) {
    for (let k = 1; k <= by[r].length; k++)
      if (G.topCount === 0 || (k === G.topCount && +r >= G.topRank)) out.push(by[r].slice(0, k));
  }
  const three = hand.find(is3C);
  if (three) out.push([three]); // 3♣ can always be played, on anything
  return out;
}

function checkPlay(G, cs) {
  if (!cs.length) return 'Select at least one card';
  if (G.mustOpen && !cs.some(is3S)) return 'The opening play must include the 3♠';
  if (cs.some(is3C)) return cs.length === 1 ? '' : 'The 3♣ must be played on its own';
  if (cs.some(c => c.r !== cs[0].r)) return 'All cards must have the same rank';
  if (G.topCount && cs.length !== G.topCount) return 'Play ' + G.topCount + ' card' + (G.topCount > 1 ? 's' : '');
  if (G.topCount && cs[0].r < G.topRank) return 'Play the same rank or higher';
  return '';
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
    afterMove(G, i);
    return { ok: true };
  }
  const cs = [];
  for (const c of cards) {
    const h = p.hand.find(x => same(x, c) && !cs.includes(x));
    if (!h) return { ok: false, err: 'Card not in hand' };
    cs.push(h);
  }
  const bad = checkPlay(G, cs);
  if (bad) return { ok: false, err: bad };
  G.mustOpen = false;
  p.hand = p.hand.filter(h => !cs.includes(h));

  if (is3C(cs[0])) {
    // 3♣: the pile is cleared at once and this player leads the next trick.
    Object.assign(G, { pile: [], topRank: -1, topCount: 0, passes: 0, lastPlayer: -1, runRank: -1, runCount: 0 });
    log(G, p.name + ' plays the 3♣ and clears the pile!');
    if (!p.hand.length) finishPlayer(G, i); // cannot normally happen (see penalty), kept for safety
    if (!endIfDone(G)) G.turn = p.hand.length ? i : nextTurn(G, i);
    return { ok: true };
  }

  // Four of a kind (at once, or stacked across consecutive plays) clears the pile.
  const r = cs[0].r;
  const run = (G.runRank === r ? G.runCount : 0) + cs.length;
  Object.assign(G, { pile: cs, topRank: r, topCount: cs.length, lastPlayer: i, passes: 0, runRank: r, runCount: run });
  log(G, p.name + ' plays ' + cs.length + ' × ' + RANKS[r]);
  if (!p.hand.length) finishPlayer(G, i);
  else if (p.hand.length === 1 && is3C(p.hand[0])) {
    // House rule: stuck with only the 3♣ means you lose the round and become Scum.
    p.hand = []; p.done = true; G.loser = i;
    log(G, p.name + ' is left with only the 3♣ and becomes Scum!');
  }
  if (run === 4) {
    Object.assign(G, { pile: [], topRank: -1, topCount: 0, passes: 0, lastPlayer: -1, runRank: -1, runCount: 0 });
    log(G, 'Four ' + RANKS[r] + 's! ' + p.name + ' clears the pile and leads.');
    if (!endIfDone(G)) G.turn = G.players[i].hand.length ? i : nextTurn(G, i);
    return { ok: true };
  }
  afterMove(G, i);
  return { ok: true };
}

function finishPlayer(G, i) {
  G.players[i].done = true;
  G.order.push(i);
  log(G, G.players[i].name + ' is out!');
}

// Ends the round when at most one player still holds cards. Returns true if it ended.
function endIfDone(G) {
  const left = active(G);
  if (left.length > 1) return false;
  left.forEach(k => { G.players[k].done = true; });
  G.ranking = [...G.order, ...left, ...(G.loser >= 0 ? [G.loser] : [])];
  G.roundOver = true;
  if (!G.scores) G.scores = G.players.map(() => 0);
  G.ranking.forEach((seat, place) => { G.scores[seat] += POINTS[place]; });
  log(G, 'Round over. President: ' + G.players[G.ranking[0]].name + '. Scum: ' + G.players[G.ranking[G.ranking.length - 1]].name + '.');
  return true;
}

function afterMove(G, i) {
  if (endIfDone(G)) return;
  const need = active(G).filter(k => k !== G.lastPlayer).length;
  if (G.lastPlayer >= 0 && G.passes >= need) {
    log(G, 'Trick taken by ' + G.players[G.lastPlayer].name + '.');
    const lp = G.lastPlayer;
    Object.assign(G, { pile: [], topRank: -1, topCount: 0, passes: 0, lastPlayer: -1, runRank: -1, runCount: 0 });
    G.turn = G.players[lp].hand.length ? lp : nextTurn(G, lp);
  } else {
    G.turn = nextTurn(G, i);
  }
}

// Simple bot: play the lowest normal option. Uses the 3♣ before it gets stuck with it,
// or when it has nothing else to play late in the round.
export function botChoice(G, i) {
  const hand = G.players[i].hand;
  const three = hand.find(is3C);
  if (three && hand.length <= 2) return { kind: 'play', cards: [three] };
  const opts = legalPlays(G, hand).filter(o => !is3C(o[0])).sort((a, b) => a[0].r - b[0].r);
  // Never leave yourself with only the 3♣.
  const safe = opts.filter(o => !(three && hand.length - o.length === 1));
  if (safe.length) return { kind: 'play', cards: safe[0] };
  if (three && (G.topCount === 0 || hand.length <= 5)) return { kind: 'play', cards: [three] };
  if (G.topCount === 0) return { kind: 'play', cards: opts[0] || [hand[0]] };
  return { kind: 'pass', cards: [] };
}

// What every player is allowed to see (no hands).
export function view(G) {
  const placeOf = i => {
    if (G.roundOver && G.ranking) return G.ranking.indexOf(i);
    if (G.order.includes(i)) return G.order.indexOf(i);
    return -1;
  };
  return {
    round: G.round, turn: G.turn, roundOver: G.roundOver, log: G.log,
    scores: G.scores || G.players.map(() => 0), ranking: G.ranking || null,
    pile: G.pile, topCount: G.topCount,
    players: G.players.map((p, i) => ({
      name: p.name, bot: p.bot, count: p.hand.length,
      place: placeOf(i), lost: G.loser === i,
    })),
  };
}
