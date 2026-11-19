// Secret Hitler rules engine. Runs only on the host.
// Based on "Secret Hitler" by Goat, Wolf, & Cabbage (secrethitler.com), CC BY-NC-SA 4.0.
// This implementation, its texts and graphics are original and shared under the same licence.
//
// Rules summary:
// - 5–10 players: Liberals, Fascists and Hitler (on the Fascist team). Fascists know each other and Hitler.
//   With 5–6 players Hitler also knows the Fascists; with 7+ Hitler doesn't.
// - Each round the presidency moves to the next living player. The President nominates a Chancellor.
//   The last elected President and Chancellor can't be nominated (with 5 or fewer players alive only the
//   last Chancellor is excluded). Everyone alive votes yes/no at the same time; a majority of yes elects.
// - Three failed elections in a row: the top policy is enacted automatically (no power), and term limits reset.
// - Elected: the President draws 3 policies, discards 1, passes 2; the Chancellor discards 1 and enacts 1.
//   After 5 Fascist policies, the Chancellor may propose a veto; if the President agrees, both are discarded
//   and it counts as a failed election.
// - Fascist policies can give the President a power, depending on the number of players:
//   investigate a player's party, call a special election, peek at the top 3 policies, or execute a player.
// - Liberals win with 5 Liberal policies or by executing Hitler. Fascists win with 6 Fascist policies,
//   or by electing Hitler Chancellor once 3 Fascist policies are on the board.

export const MIN_PLAYERS = 5, MAX_PLAYERS = 10;

const SETUP = { 5: 1, 6: 1, 7: 2, 8: 2, 9: 3, 10: 3 }; // number of Fascists besides Hitler

// Powers for the 1st–5th Fascist policy (the 6th wins the game).
export function powersFor(n) {
  if (n <= 6) return [null, null, 'peek', 'execute', 'execute'];
  if (n <= 8) return [null, 'investigate', 'special', 'execute', 'execute'];
  return ['investigate', 'investigate', 'special', 'execute', 'execute'];
}
export const POWER_TEXT = {
  investigate: 'investigates a player',
  special: 'picks the next President',
  peek: 'looks at the top 3 policies',
  execute: 'executes a player',
};

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 14);
}
const nm = (G, i) => G.players[i].name;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const living = G => G.players.map((p, i) => i).filter(i => G.players[i].alive);

export function createGame(names) {
  return {
    players: names.map(name => ({ name, role: '', alive: false, left: false })),
    phase: 'lobby', games: 0, log: [], seats: 0,
    deck: [], discard: [], liberal: 0, fascist: 0, tracker: 0,
    president: -1, chancellor: -1, nominee: -1, lastPresident: -1, lastChancellor: -1,
    rotation: -1,         // seat whose turn it is in the normal order (a special election jumps out of it)
    votes: {}, lastVotes: null,
    hand: [],             // policies the President or Chancellor is holding
    vetoAsked: false, power: null, investigated: [], checks: {}, peek: null,
    winner: '', reason: '',
  };
}

export function newGame(G) {
  const seats = G.players.map((p, i) => i).filter(i => !G.players[i].left);
  if (seats.length < MIN_PLAYERS) return { ok: false, err: 'Need at least ' + MIN_PLAYERS + ' players' };
  if (seats.length > MAX_PLAYERS) return { ok: false, err: 'At most ' + MAX_PLAYERS + ' players' };
  const roles = ['hitler', ...Array(SETUP[seats.length]).fill('fascist')];
  while (roles.length < seats.length) roles.push('liberal');
  shuffle(roles);
  G.players.forEach(p => { p.role = ''; p.alive = false; });
  seats.forEach((i, k) => Object.assign(G.players[i], { role: roles[k], alive: true }));
  Object.assign(G, {
    seats: seats.length, deck: shuffle([...Array(6).fill('L'), ...Array(11).fill('F')]), discard: [],
    liberal: 0, fascist: 0, tracker: 0, chancellor: -1, nominee: -1, lastPresident: -1, lastChancellor: -1,
    votes: {}, lastVotes: null, hand: [], vetoAsked: false, power: null, investigated: [], checks: {}, peek: null,
    winner: '', reason: '', log: [],
  });
  G.games++;
  G.rotation = seats[Math.floor(Math.random() * seats.length)];
  G.president = G.rotation;
  G.phase = 'nominate';
  log(G, 'New game! ' + nm(G, G.president) + ' is the first President.');
  return { ok: true };
}

export const party = (G, i) => (G.players[i].role === 'liberal' ? 'liberal' : 'fascist');

function ensureDeck(G) {
  if (G.deck.length < 3) {
    G.deck = shuffle([...G.deck, ...G.discard]);
    G.discard = [];
    log(G, 'The policy deck was reshuffled.');
  }
}

function end(G, winner, reason) {
  G.winner = winner; G.reason = reason; G.phase = 'over'; G.hand = []; G.power = null;
  log(G, reason);
}

function nextPresident(G) {
  const n = G.players.length;
  let k = G.rotation;
  do { k = (k + 1) % n; } while (!G.players[k].alive);
  G.rotation = k;
  G.president = k;
  G.nominee = -1; G.votes = {}; G.hand = []; G.vetoAsked = false; G.power = null; G.peek = null;
  G.phase = 'nominate';
  log(G, nm(G, k) + ' is the next President.');
}

export function eligible(G, i) {
  if (!G.players[i] || !G.players[i].alive || i === G.president) return false;
  if (i === G.lastChancellor) return false;
  if (i === G.lastPresident && living(G).length > 5) return false;
  return true;
}

function enact(G, policy, chaotic) {
  if (policy === 'L') G.liberal++; else G.fascist++;
  log(G, (chaotic ? 'The country is in chaos: a ' : 'A ') + (policy === 'L' ? 'Liberal' : 'Fascist') + ' policy is enacted.');
  if (G.liberal >= 5) return end(G, 'liberal', 'Five Liberal policies are enacted. The Liberals win!');
  if (G.fascist >= 6) return end(G, 'fascist', 'Six Fascist policies are enacted. The Fascists win!');
  G.tracker = 0;
  if (chaotic) { G.lastPresident = -1; G.lastChancellor = -1; return nextPresident(G); }
  const power = policy === 'F' ? powersFor(G.seats)[G.fascist - 1] : null;
  if (power) {
    G.power = power;
    G.phase = 'power';
    if (power === 'peek') { ensureDeck(G); G.peek = G.deck.slice(-3).reverse(); }
    log(G, 'The President ' + POWER_TEXT[power] + '.');
  } else nextPresident(G);
}

function failElection(G, why) {
  G.tracker++;
  log(G, why + ' The election tracker moves to ' + G.tracker + '.');
  if (G.tracker >= 3) {
    ensureDeck(G);
    const top = G.deck.pop();
    G.tracker = 0;
    enact(G, top, true);
  } else nextPresident(G);
}

export function waitingFor(G) {
  if (G.phase === 'vote') return living(G).filter(i => !(i in G.votes));
  if (G.phase === 'nominate' || G.phase === 'pres' || G.phase === 'power') return [G.president];
  if (G.phase === 'chan') return [G.chancellor];
  if (G.phase === 'veto') return [G.president];
  return [];
}

// a.t: nominate {target} | vote {yes} | discard {index} | enact {index} | veto | vetoAnswer {yes} | power {target} | ok (after a peek)
export function act(G, i, a) {
  const p = G.players[i];
  if (!p || !p.alive) return { ok: false, err: 'You are not in this game' };
  switch (a.t) {
    case 'nominate': {
      if (G.phase !== 'nominate' || i !== G.president) return { ok: false, err: 'Only the President nominates' };
      if (!eligible(G, a.target)) return { ok: false, err: 'That player cannot be Chancellor this round' };
      G.nominee = a.target; G.votes = {}; G.phase = 'vote';
      log(G, nm(G, i) + ' nominates ' + nm(G, a.target) + ' for Chancellor. Everyone votes.');
      return { ok: true };
    }
    case 'vote': {
      if (G.phase !== 'vote') return { ok: false, err: 'There is no vote right now' };
      if (i in G.votes) return { ok: false, err: 'You have already voted' };
      G.votes[i] = !!a.yes;
      if (living(G).some(k => !(k in G.votes))) return { ok: true };
      const yes = living(G).filter(k => G.votes[k]).length;
      G.lastVotes = { ...G.votes };
      if (yes > living(G).length / 2) {
        G.chancellor = G.nominee;
        G.lastPresident = G.president; G.lastChancellor = G.chancellor;
        log(G, 'The vote passes (' + yes + ' yes). ' + nm(G, G.chancellor) + ' is Chancellor.');
        if (G.fascist >= 3 && G.players[G.chancellor].role === 'hitler')
          return end(G, 'fascist', 'Hitler was elected Chancellor after three Fascist policies. The Fascists win!'), { ok: true };
        ensureDeck(G);
        G.hand = [G.deck.pop(), G.deck.pop(), G.deck.pop()];
        G.phase = 'pres';
      } else {
        G.chancellor = -1;
        failElection(G, 'The vote fails (' + yes + ' yes).');
      }
      return { ok: true };
    }
    case 'discard': {
      if (G.phase !== 'pres' || i !== G.president) return { ok: false, err: 'Only the President discards now' };
      if (!(a.index >= 0 && a.index < 3)) return { ok: false, err: 'Pick a policy to discard' };
      G.discard.push(G.hand.splice(a.index, 1)[0]);
      G.phase = 'chan'; G.vetoAsked = false;
      log(G, 'The President passes two policies to the Chancellor.');
      return { ok: true };
    }
    case 'enact': {
      if (G.phase !== 'chan' || i !== G.chancellor) return { ok: false, err: 'Only the Chancellor enacts now' };
      if (!(a.index >= 0 && a.index < 2)) return { ok: false, err: 'Pick a policy to enact' };
      const [kept] = G.hand.splice(a.index, 1);
      G.discard.push(...G.hand); G.hand = [];
      enact(G, kept, false);
      return { ok: true };
    }
    case 'veto': {
      if (G.phase !== 'chan' || i !== G.chancellor) return { ok: false, err: 'Only the Chancellor can ask for a veto' };
      if (G.fascist < 5) return { ok: false, err: 'Veto is unlocked after five Fascist policies' };
      if (G.vetoAsked) return { ok: false, err: 'The President already refused the veto' };
      G.phase = 'veto';
      log(G, nm(G, i) + ' asks to veto this agenda.');
      return { ok: true };
    }
    case 'vetoAnswer': {
      if (G.phase !== 'veto' || i !== G.president) return { ok: false, err: 'Only the President answers the veto' };
      if (a.yes) {
        G.discard.push(...G.hand); G.hand = [];
        log(G, 'The President agrees. Both policies are discarded.');
        failElection(G, 'The agenda was vetoed.');
      } else {
        G.vetoAsked = true; G.phase = 'chan';
        log(G, 'The President refuses the veto. The Chancellor must enact a policy.');
      }
      return { ok: true };
    }
    case 'power': {
      if (G.phase !== 'power' || i !== G.president) return { ok: false, err: 'Only the President uses the power' };
      const t = a.target, q = G.players[t];
      if (G.power === 'peek') { G.peek = null; nextPresident(G); return { ok: true }; }
      if (!q || !q.alive || t === i) return { ok: false, err: 'Pick another living player' };
      if (G.power === 'investigate') {
        if (G.investigated.includes(t)) return { ok: false, err: 'That player has already been investigated' };
        G.investigated.push(t);
        (G.checks[i] = G.checks[i] || []).push({ target: t, party: party(G, t) });
        log(G, nm(G, i) + ' investigates ' + nm(G, t) + '.');
        nextPresident(G);
      } else if (G.power === 'special') {
        log(G, nm(G, i) + ' picks ' + nm(G, t) + ' as the next President.');
        G.president = t; G.nominee = -1; G.votes = {}; G.hand = []; G.power = null; G.phase = 'nominate';
        // G.rotation stays, so the normal order continues after this special presidency.
      } else if (G.power === 'execute') {
        q.alive = false;
        log(G, nm(G, i) + ' executes ' + nm(G, t) + '.');
        if (q.role === 'hitler') return end(G, 'liberal', nm(G, t) + ' was Hitler. The Liberals win!'), { ok: true };
        nextPresident(G);
      }
      return { ok: true };
    }
  }
  return { ok: false, err: 'Unknown action' };
}

// A player leaves for good. If Hitler leaves, the Liberals win; otherwise the game goes on without them.
export function leave(G, i) {
  const p = G.players[i];
  if (!p || p.left) return false;
  p.left = true;
  const wasAlive = p.alive;
  p.alive = false;
  log(G, p.name + ' left the game.');
  if (!wasAlive || G.phase === 'lobby' || G.phase === 'over') return true;
  if (p.role === 'hitler') { end(G, 'liberal', 'Hitler left the game. The Liberals win!'); return true; }
  if (living(G).length < 3) { end(G, 'fascist', 'Too few players are left to continue.'); return true; }
  if (G.phase === 'vote') {
    delete G.votes[i];
    if (i === G.nominee) nextPresident(G);
    else if (living(G).every(k => k in G.votes)) { const pick = Object.keys(G.votes)[0]; const v = G.votes[pick]; delete G.votes[pick]; act(G, +pick, { t: 'vote', yes: v }); }
  } else if (i === G.president || (i === G.chancellor && (G.phase === 'chan' || G.phase === 'veto'))) {
    G.discard.push(...G.hand); G.hand = [];
    nextPresident(G);
  }
  return true;
}

export function addPlayer(G, name) {
  if (G.players.filter(p => !p.left).length >= MAX_PLAYERS) return -1;
  G.players.push({ name, role: '', alive: false, left: false });
  log(G, name + ' joined. They play from the next game.');
  return G.players.length - 1;
}

// Public view. Roles are only shown at the end.
export function view(G) {
  const reveal = G.phase === 'over';
  return {
    phase: G.phase, games: G.games, log: G.log, seats: G.seats,
    liberal: G.liberal, fascist: G.fascist, tracker: G.tracker, deck: G.deck.length, discard: G.discard.length,
    president: G.president, chancellor: G.chancellor, nominee: G.nominee,
    lastPresident: G.lastPresident, lastChancellor: G.lastChancellor,
    voted: Object.keys(G.votes).map(Number), lastVotes: G.lastVotes,
    power: G.power, veto: G.fascist >= 5, vetoAsked: G.vetoAsked,
    powers: G.seats ? powersFor(G.seats) : [],
    eligible: G.players.map((p, i) => G.phase === 'nominate' && eligible(G, i)),
    investigated: G.investigated,
    winner: G.winner, reason: G.reason,
    players: G.players.map(p => ({ name: p.name, alive: p.alive, left: p.left, playing: !!p.role, role: reveal ? p.role : '' })),
  };
}

// What one player is allowed to know.
export function secretFor(G, i) {
  const p = G.players[i];
  if (!p || !p.role || G.phase === 'lobby') return null;
  const s = { role: p.role, team: [] };
  const fascists = G.players.map((q, k) => k).filter(k => G.players[k].role === 'fascist' || G.players[k].role === 'hitler');
  if (p.role === 'fascist' || (p.role === 'hitler' && G.seats <= 6))
    s.team = fascists.filter(k => k !== i).map(k => ({ seat: k, hitler: G.players[k].role === 'hitler' }));
  if (G.phase === 'pres' && i === G.president) s.hand = G.hand.slice();
  if ((G.phase === 'chan' || G.phase === 'veto') && i === G.chancellor) s.hand = G.hand.slice();
  if (G.phase === 'power' && i === G.president && G.power === 'peek') s.peek = G.peek;
  if (G.checks[i]) s.checks = G.checks[i];
  if (G.phase === 'vote' && i in G.votes) s.myVote = G.votes[i];
  return s;
}
