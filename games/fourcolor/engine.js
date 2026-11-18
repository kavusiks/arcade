// 4Color rules engine. Runs only on the host; players receive the public view plus their own hand.
//
// Deck (108 cards): four colours (r, y, g, b), each with one 0, two of 1–9, two Skip, two Reverse,
// two Draw Two; plus four Wild and four Wild Draw Four (colour 'w').
// Rules: match the top card by colour or value, or play a Wild. Wild Draw Four may only be played
// when you hold no card of the current colour. If you can't (or won't) play, draw one card; you may
// play that card if it fits, otherwise your turn ends. Draw Two / Draw Four: the next player draws
// and is skipped. Reverse with two players acts as Skip. No stacking.
// Last card: when you go down to one card you must call "Last card!" (on your turn, before or right
// after playing). Until the next player acts, anyone can catch an uncalled last card: +2 cards.
// The first player to empty their hand wins the round and scores the value of everyone else's cards.

export const COLORS = ['r', 'y', 'g', 'b'];
export const COLOR_NAMES = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue', w: 'Wild' };
export const LABELS = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', w4: '+4' };
export const MIN_SEATS = 2, MAX_SEATS = 6;

export function cardValue(c) {
  if (c.c === 'w') return 50;
  if (c.v === 'skip' || c.v === 'rev' || c.v === 'd2') return 20;
  return Number(c.v);
}
export const cardText = c => (LABELS[c.v] || c.v);
const describe = c => (c.c === 'w' ? '' : COLOR_NAMES[c.c] + ' ') + cardText(c);

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 8);
}

function buildDeck() {
  const d = [];
  let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2'])
      for (let k = 0; k < 2; k++) d.push({ id: id++, c, v });
  }
  for (let k = 0; k < 4; k++) { d.push({ id: id++, c: 'w', v: 'wild' }); d.push({ id: id++, c: 'w', v: 'w4' }); }
  return d;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function createGame(names, bots) {
  return {
    players: names.map((name, i) => ({ name, bot: bots[i], hand: [], called: false })),
    scores: names.map(() => 0),
    round: 0, log: [], deck: [], discard: [], color: 'r', dir: 1, turn: 0,
    drawnId: null,      // card drawn this turn that may still be played
    vulnerable: -1,     // seat that went down to one card without calling
    roundOver: false, winner: -1, lastPoints: 0, dealer: -1,
  };
}

const top = G => G.discard[G.discard.length - 1];
const n = G => G.players.length;
const step = (G, from, k = 1) => (((from + G.dir * k) % n(G)) + n(G)) % n(G);

function drawCards(G, i, count) {
  const got = [];
  for (let k = 0; k < count; k++) {
    if (!G.deck.length) {
      // Reshuffle the discard pile (except the top card) into a new deck.
      const t = G.discard.pop();
      G.deck = shuffle(G.discard);
      G.discard = [t];
      if (!G.deck.length) break;
      log(G, 'The deck was reshuffled.');
    }
    const c = G.deck.pop();
    G.players[i].hand.push(c);
    got.push(c);
  }
  if (G.players[i].hand.length > 1) G.players[i].called = false;
  return got;
}

export function newRound(G) {
  G.round++;
  G.dealer = (G.dealer + 1) % n(G);
  G.deck = shuffle(buildDeck());
  G.discard = [];
  G.players.forEach(p => { p.hand = []; p.called = false; });
  for (let k = 0; k < 7; k++) G.players.forEach((p, i) => drawCards(G, i, 1));
  // Start the discard pile with a number card (action and wild cards go back into the deck).
  let first;
  for (;;) {
    first = G.deck.pop();
    if (/^\d$/.test(first.v)) break;
    G.deck.unshift(first);
  }
  G.discard = [first];
  Object.assign(G, { color: first.c, dir: 1, drawnId: null, vulnerable: -1, roundOver: false, winner: -1, lastPoints: 0 });
  G.turn = step(G, G.dealer);
  log(G, '--- Round ' + G.round + ' ---');
  log(G, G.players[G.turn].name + ' starts. Top card: ' + describe(first) + '.');
}

export function canPlay(G, hand, c) {
  if (c.v === 'wild') return true;
  if (c.v === 'w4') return !hand.some(h => h.id !== c.id && h.c === G.color);
  return c.c === G.color || c.v === top(G).v;
}

function endTurn(G, i, skip = false) {
  G.drawnId = null;
  G.turn = step(G, i, skip ? 2 : 1);
}

// Apply an action for seat i. a = { t: 'play', id, color } | { t: 'draw' } | { t: 'pass' }
// | { t: 'call' } | { t: 'catch', target }. Returns { ok, err }.
export function act(G, i, a) {
  if (G.roundOver) return { ok: false, err: 'The round is over' };
  const p = G.players[i];

  if (a.t === 'call') {
    if (G.vulnerable === i) { G.vulnerable = -1; p.called = true; log(G, p.name + ': "Last card!"'); return { ok: true }; }
    if (G.turn === i && p.hand.length === 2) { p.called = true; log(G, p.name + ': "Last card!"'); return { ok: true }; }
    return { ok: false, err: 'You can call "Last card!" when you have 2 cards on your turn, or right after going down to 1' };
  }
  if (a.t === 'catch') {
    const t = a.target;
    if (t === i || t !== G.vulnerable) return { ok: false, err: 'Nobody to catch' };
    G.vulnerable = -1;
    drawCards(G, t, 2);
    log(G, p.name + ' caught ' + G.players[t].name + ' without "Last card!": +2 cards.');
    return { ok: true };
  }

  if (G.turn !== i) return { ok: false, err: 'Not your turn' };
  if (G.vulnerable >= 0 && G.vulnerable !== i) G.vulnerable = -1; // the catch window closes when the next player acts

  if (a.t === 'draw') {
    if (G.drawnId !== null) return { ok: false, err: 'You already drew a card. Play it or pass' };
    const [c] = drawCards(G, i, 1);
    if (!c) { log(G, p.name + ' cannot draw (no cards left) and passes.'); endTurn(G, i); return { ok: true }; }
    if (canPlay(G, p.hand, c)) { G.drawnId = c.id; log(G, p.name + ' draws a card.'); }
    else { log(G, p.name + ' draws a card and passes.'); endTurn(G, i); }
    return { ok: true };
  }
  if (a.t === 'pass') {
    if (G.drawnId === null) return { ok: false, err: 'Draw a card first' };
    log(G, p.name + ' passes.');
    endTurn(G, i);
    return { ok: true };
  }
  if (a.t !== 'play') return { ok: false, err: 'Unknown action' };

  const c = p.hand.find(h => h.id === a.id);
  if (!c) return { ok: false, err: 'Card not in hand' };
  if (G.drawnId !== null && c.id !== G.drawnId) return { ok: false, err: 'After drawing you may only play the drawn card' };
  if (!canPlay(G, p.hand, c)) {
    return { ok: false, err: c.v === 'w4' ? 'You can only play +4 when you have no ' + COLOR_NAMES[G.color] + ' cards' : 'That card does not match' };
  }
  if (c.c === 'w' && !COLORS.includes(a.color)) return { ok: false, err: 'Choose a colour' };

  p.hand = p.hand.filter(h => h !== c);
  G.discard.push(c);
  G.color = c.c === 'w' ? a.color : c.c;
  log(G, p.name + ' plays ' + describe(c) + (c.c === 'w' ? ' and picks ' + COLOR_NAMES[G.color] : '') + '.');

  if (p.hand.length === 1 && !p.called) G.vulnerable = i;
  if (p.hand.length !== 1) p.called = false;

  if (!p.hand.length) {
    // Round won. The last card's effect still applies (the next player draws), as in the official rules.
    if (c.v === 'd2') drawCards(G, step(G, i), 2);
    if (c.v === 'w4') drawCards(G, step(G, i), 4);
    const pts = G.players.reduce((sum, q, k) => sum + (k === i ? 0 : q.hand.reduce((s, h) => s + cardValue(h), 0)), 0);
    G.scores[i] += pts;
    Object.assign(G, { roundOver: true, winner: i, lastPoints: pts, drawnId: null, vulnerable: -1 });
    log(G, p.name + ' wins the round and scores ' + pts + ' points!');
    return { ok: true };
  }

  if (c.v === 'rev') {
    G.dir = -G.dir;
    if (n(G) === 2) { endTurn(G, i, true); return { ok: true }; } // acts as Skip with two players
    endTurn(G, i);
  } else if (c.v === 'skip') {
    log(G, G.players[step(G, i)].name + ' is skipped.');
    endTurn(G, i, true);
  } else if (c.v === 'd2' || c.v === 'w4') {
    const victim = step(G, i), k = c.v === 'd2' ? 2 : 4;
    drawCards(G, victim, k);
    log(G, G.players[victim].name + ' draws ' + k + ' and is skipped.');
    endTurn(G, i, true);
  } else {
    endTurn(G, i);
  }
  return { ok: true };
}

// Bot: catch an uncalled last card, otherwise play a matching coloured card (actions first),
// then a same-value card, then Wild, then +4; else draw. Bots always call "Last card!".
export function botMove(G, i) {
  if (G.vulnerable >= 0 && G.vulnerable !== i) return { t: 'catch', target: G.vulnerable };
  const hand = G.players[i].hand;
  if (G.turn === i && hand.length === 2 && !G.players[i].called) return { t: 'call' };
  const pickColor = () => {
    const counts = { r: 0, y: 0, g: 0, b: 0 };
    hand.forEach(h => { if (h.c !== 'w') counts[h.c]++; });
    return COLORS.reduce((a, b) => (counts[b] > counts[a] ? b : a), 'r');
  };
  if (G.drawnId !== null) {
    const c = hand.find(h => h.id === G.drawnId);
    return c && canPlay(G, hand, c) ? { t: 'play', id: c.id, color: pickColor() } : { t: 'pass' };
  }
  const playable = hand.filter(h => canPlay(G, hand, h));
  const rank = h => (h.v === 'w4' ? 4 : h.v === 'wild' ? 3 : h.c === G.color ? (/^\d$/.test(h.v) ? 1 : 0) : 2);
  playable.sort((a, b) => rank(a) - rank(b));
  if (playable.length) return { t: 'play', id: playable[0].id, color: pickColor() };
  return { t: 'draw' };
}

// What every player may see (no hands).
export function view(G) {
  return {
    round: G.round, turn: G.turn, dir: G.dir, color: G.color, top: top(G) || null,
    deckCount: G.deck.length, roundOver: G.roundOver, winner: G.winner, lastPoints: G.lastPoints,
    vulnerable: G.vulnerable, scores: G.scores, log: G.log,
    players: G.players.map(p => ({ name: p.name, bot: p.bot, count: p.hand.length, called: p.called })),
  };
}
