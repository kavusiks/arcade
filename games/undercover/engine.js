// Undercover rules engine. Runs only on the host; players receive the public view plus their own card.
//
// Each round everyone except one player (the spy) gets the same secret location and a role there.
// Players ask each other questions out loud. Phases:
//   play  – the timer runs. Any player may accuse someone once per round (pauses the timer), and
//           the spy may stop the game at any time to guess the location.
//   vote  – everyone except the accused votes. Unanimous "yes" convicts; any "no" fails it.
//   final – time is up: starting with the dealer, each player in turn may accuse someone (or pass).
//   over  – the round result is shown; the host starts the next round.
// Scoring: agents win → every agent +1, and the accuser of the spy +1 extra.
//          spy wins → +2 (time ran out or an innocent was convicted), +4 for guessing the location.
import { LOCATIONS } from './locations.js?v=1795029127';

export const MIN_PLAYERS = 3, MAX_PLAYERS = 8;
export const DURATIONS = [5, 8, 10]; // minutes

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 8);
}

export function createGame(names, minutes = 8) {
  return {
    players: names.map(name => ({ name, score: 0, gone: false })),
    minutes: DURATIONS.includes(minutes) ? minutes : 8,
    round: 0, log: [], phase: 'over', dealer: -1,
    location: -1, roles: [], spy: -1,
    endsAt: 0, remaining: 0, // endsAt while the timer runs; remaining while paused
    accused: [],             // seats that have used their accusation this round
    vote: null,              // { accuser, target, votes: { seat: true|false } }
    finalOrder: [], finalIdx: 0,
    result: null,            // { winner: 'spy'|'agents'|'void', reason, location, spy, guess }
  };
}

export const activeSeats = G => G.players.map((p, i) => i).filter(i => !G.players[i].gone);
const name = (G, i) => G.players[i].name;

export function canStart(G) { return activeSeats(G).length >= MIN_PLAYERS; }

export function newRound(G, now) {
  const seats = activeSeats(G);
  if (seats.length < MIN_PLAYERS) return { ok: false, err: 'Need at least ' + MIN_PLAYERS + ' players' };
  G.round++;
  G.location = Math.floor(Math.random() * LOCATIONS.length);
  G.spy = seats[Math.floor(Math.random() * seats.length)];
  const roles = LOCATIONS[G.location].roles.slice().sort(() => Math.random() - 0.5);
  G.roles = G.players.map(() => '');
  let k = 0;
  seats.forEach(i => { if (i !== G.spy) G.roles[i] = roles[k++ % roles.length]; });
  // The dealer (asks the first question) rotates through the active players.
  const after = seats.filter(i => i > G.dealer);
  G.dealer = after.length ? after[0] : seats[0];
  Object.assign(G, { phase: 'play', endsAt: now + G.minutes * 60000, remaining: 0, accused: [], vote: null, finalOrder: [], finalIdx: 0, result: null });
  log(G, '--- Round ' + G.round + ' ---');
  log(G, name(G, G.dealer) + ' asks the first question.');
  return { ok: true };
}

export function timeLeft(G, now) {
  if (G.phase === 'play') return Math.max(0, G.endsAt - now);
  if (G.phase === 'vote') return G.remaining;
  return 0;
}

// Call regularly on the host: moves to the final phase when time runs out. Returns true if state changed.
export function tick(G, now) {
  if (G.phase === 'play' && now >= G.endsAt) { startFinal(G); return true; }
  return false;
}

function startFinal(G) {
  const seats = activeSeats(G);
  const d = seats.indexOf(G.dealer);
  G.finalOrder = d < 0 ? seats : [...seats.slice(d), ...seats.slice(0, d)];
  G.finalIdx = 0;
  G.phase = 'final';
  log(G, "Time's up! Each player in turn may accuse someone.");
  skipGoneFinal(G);
}

function skipGoneFinal(G) {
  while (G.finalIdx < G.finalOrder.length && G.players[G.finalOrder[G.finalIdx]].gone) G.finalIdx++;
  if (G.phase === 'final' && G.finalIdx >= G.finalOrder.length) end(G, 'spy', 'Nobody caught the spy in time.', 2);
}

function end(G, winner, reason, spyPoints, accuser = -1) {
  G.phase = 'over';
  G.vote = null;
  G.result = { winner, reason, location: G.location, spy: G.spy, guess: G.result?.guess ?? -1 };
  if (winner === 'spy') G.players[G.spy].score += spyPoints;
  if (winner === 'agents') {
    activeSeats(G).forEach(i => { if (i !== G.spy) G.players[i].score += 1; });
    if (accuser >= 0 && !G.players[accuser].gone) G.players[accuser].score += 1;
  }
  log(G, reason);
}

function voters(G) {
  return activeSeats(G).filter(i => i !== G.vote.target);
}

function resolveVote(G, now) {
  const v = G.vote;
  const list = voters(G);
  if (list.some(i => v.votes[i] === false)) {
    const by = list.filter(i => v.votes[i] === false).map(i => name(G, i)).join(', ');
    log(G, 'The accusation against ' + name(G, v.target) + ' failed (' + by + ' voted no).');
    G.vote = null;
    if (G.phase === 'vote') { G.phase = 'play'; G.endsAt = now + G.remaining; G.remaining = 0; }
    else { G.finalIdx++; skipGoneFinal(G); }
    return;
  }
  if (list.every(i => v.votes[i] === true)) {
    if (v.target === G.spy) end(G, 'agents', name(G, v.target) + ' was the spy! The agents win.', 0, v.accuser);
    else end(G, 'spy', name(G, v.target) + ' was not the spy. The spy (' + name(G, G.spy) + ') wins!', 2);
  }
}

// a = { t: 'accuse', target } | { t: 'vote', yes } | { t: 'pass' } | { t: 'guess', location }
export function act(G, i, a, now) {
  const p = G.players[i];
  if (!p || p.gone) return { ok: false, err: 'You are not in this game' };

  if (a.t === 'accuse') {
    const t = a.target;
    if (t === i || !G.players[t] || G.players[t].gone) return { ok: false, err: 'Pick another player' };
    if (G.phase === 'play') {
      if (G.accused.includes(i)) return { ok: false, err: 'You have already used your accusation this round' };
      G.accused.push(i);
      G.remaining = Math.max(0, G.endsAt - now);
      G.phase = 'vote';
    } else if (G.phase === 'final') {
      if (G.vote) return { ok: false, err: 'A vote is already running' };
      if (G.finalOrder[G.finalIdx] !== i) return { ok: false, err: 'It is not your turn to accuse' };
    } else return { ok: false, err: 'You cannot accuse now' };
    G.vote = { accuser: i, target: t, votes: { [i]: true } }; // the accuser counts as a yes
    log(G, p.name + ' accuses ' + name(G, t) + '. Vote now!');
    resolveVote(G, now);
    return { ok: true };
  }

  if (a.t === 'vote') {
    if (!G.vote) return { ok: false, err: 'There is no vote right now' };
    if (i === G.vote.target) return { ok: false, err: 'You cannot vote on your own accusation' };
    if (i in G.vote.votes) return { ok: false, err: 'You have already voted' };
    G.vote.votes[i] = !!a.yes;
    resolveVote(G, now);
    return { ok: true };
  }

  if (a.t === 'pass') {
    if (G.phase !== 'final' || G.vote || G.finalOrder[G.finalIdx] !== i) return { ok: false, err: 'You cannot pass now' };
    log(G, p.name + ' does not accuse anyone.');
    G.finalIdx++;
    skipGoneFinal(G);
    return { ok: true };
  }

  if (a.t === 'guess') {
    if (i !== G.spy) return { ok: false, err: 'Only the spy can guess the location' };
    if (G.phase !== 'play') return { ok: false, err: 'You can only guess while the timer is running' };
    const g = a.location;
    if (!LOCATIONS[g]) return { ok: false, err: 'Pick a location' };
    G.result = { guess: g };
    if (g === G.location) end(G, 'spy', p.name + ' was the spy and guessed the location: ' + LOCATIONS[g].name + '!', 4);
    else end(G, 'agents', p.name + ' was the spy and guessed ' + LOCATIONS[g].name + '. Wrong! The agents win.', 0);
    return { ok: true };
  }
  return { ok: false, err: 'Unknown action' };
}

// A player leaves for good. Returns true if state changed.
export function leave(G, i, now) {
  const p = G.players[i];
  if (!p || p.gone) return false;
  p.gone = true;
  log(G, p.name + ' left the game.');
  if (G.phase === 'over') return true;
  if (i === G.spy) {
    G.phase = 'over'; G.vote = null;
    G.result = { winner: 'void', reason: 'The spy left, so this round does not count.', location: G.location, spy: G.spy, guess: -1 };
    log(G, G.result.reason);
    return true;
  }
  if (activeSeats(G).length < MIN_PLAYERS) {
    G.phase = 'over'; G.vote = null;
    G.result = { winner: 'void', reason: 'Too few players left, so this round does not count.', location: G.location, spy: G.spy, guess: -1 };
    log(G, G.result.reason);
    return true;
  }
  if (G.vote) {
    if (G.vote.target === i || G.vote.accuser === i) {
      // Cancel the vote; in the final phase the turn moves on.
      G.vote = null;
      if (G.phase === 'vote') { G.phase = 'play'; G.endsAt = now + G.remaining; G.remaining = 0; }
      else { G.finalIdx++; skipGoneFinal(G); }
    } else resolveVote(G, now);
  } else if (G.phase === 'final') skipGoneFinal(G);
  return true;
}

// A newcomer joins between rounds.
export function addPlayer(G, playerName) {
  if (activeSeats(G).length >= MAX_PLAYERS) return -1;
  G.players.push({ name: playerName, score: 0, gone: false });
  G.roles.push('');
  log(G, playerName + ' joined.');
  return G.players.length - 1;
}

export function view(G, now) {
  const over = G.phase === 'over';
  return {
    round: G.round, phase: G.phase, minutes: G.minutes, dealer: G.dealer, log: G.log,
    timeLeft: timeLeft(G, now),
    accused: G.accused,
    vote: G.vote ? { accuser: G.vote.accuser, target: G.vote.target, voted: Object.keys(G.vote.votes).map(Number) } : null,
    finalTurn: G.phase === 'final' && !G.vote ? G.finalOrder[G.finalIdx] : -1,
    result: over && G.result ? G.result : null,
    players: G.players.map(p => ({ name: p.name, score: p.score, gone: p.gone })),
  };
}

// What one player is allowed to know.
export function secretFor(G, i) {
  if (G.round === 0 || G.roles[i] === undefined || G.players[i].gone) return null;
  if (G.phase !== 'over' && G.roles[i] === '' && i !== G.spy) return { joinedLate: true };
  if (i === G.spy) return { spy: true };
  return { location: G.location, role: G.roles[i] };
}
