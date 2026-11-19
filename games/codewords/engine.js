// Code Words rules engine. Runs only on the host.
//
// Two teams, Red and Blue, each with one spymaster. 25 words lie on the table. A secret key says which
// words belong to Red, which to Blue, which are bystanders, and which one is the trap.
// The starting team has 9 words, the other 8; there are 7 bystanders and 1 trap.
// On a turn, the spymaster gives a one-word clue and a number. Teammates guess words one at a time:
//   - their own word: they may keep guessing, up to exactly the clue's number (unlimited if the number is 0, shown as ∞)
//   - a bystander or the other team's word: the turn ends
//   - the trap: their team loses at once
// A team can stop guessing after at least one guess. The first team to reveal all its words wins.
import { WORDS } from './words.js?v=1795129607';

export const TEAMS = ['red', 'blue'];
export const MIN_PLAYERS = 4, MAX_PLAYERS = 16;

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 12);
}
const nm = (G, i) => G.players[i].name;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const other = t => (t === 'red' ? 'blue' : 'red');
const teamName = t => (t === 'red' ? 'Red' : 'Blue');

export function createGame(names, lang = 'en') {
  const G = {
    players: names.map(name => ({ name, team: '', spy: false, left: false })),
    lang: WORDS[lang] ? lang : 'en',
    phase: 'teams', round: 0, log: [], scores: { red: 0, blue: 0 },
    words: [], key: [], revealed: [], starter: Math.random() < 0.5 ? 'red' : 'blue',
    turn: 'red', clue: null, guesses: 0, winner: '', reason: '',
  };
  // Start with alternating teams; players can switch before the round starts.
  G.players.forEach((p, i) => { p.team = TEAMS[i % 2]; });
  return G;
}

export const members = (G, t) => G.players.map((p, i) => i).filter(i => !G.players[i].left && G.players[i].team === t);
export const spymaster = (G, t) => members(G, t).find(i => G.players[i].spy) ?? -1;

export function readyProblem(G) {
  for (const t of TEAMS) {
    if (members(G, t).length < 2) return teamName(t) + ' needs at least 2 players';
    if (spymaster(G, t) < 0) return teamName(t) + ' needs a spymaster';
  }
  return '';
}

// Before a round: pick a team, or volunteer as spymaster (one per team).
export function setTeam(G, i, team, spy) {
  if (G.phase !== 'teams' && G.phase !== 'over') return { ok: false, err: 'Teams are locked during a round' };
  const p = G.players[i];
  if (!p || p.left || !TEAMS.includes(team)) return { ok: false, err: 'Pick Red or Blue' };
  p.team = team;
  if (spy) members(G, team).forEach(k => { G.players[k].spy = false; });
  p.spy = !!spy;
  return { ok: true };
}

export function newRound(G) {
  const problem = readyProblem(G);
  if (problem) return { ok: false, err: problem };
  G.round++;
  if (G.round > 1) G.starter = other(G.starter); // the starting team alternates
  const list = shuffle(WORDS[G.lang].slice()).slice(0, 25);
  const key = [...Array(9).fill(G.starter), ...Array(8).fill(other(G.starter)), ...Array(7).fill('none'), 'trap'];
  Object.assign(G, { words: list, key: shuffle(key), revealed: Array(25).fill(false), turn: G.starter, phase: 'clue', clue: null, guesses: 0, winner: '', reason: '' });
  log(G, '--- Round ' + G.round + ' --- ' + teamName(G.starter) + ' starts and has 9 words to find.');
  return { ok: true };
}

export const left = (G, t) => G.key.filter((k, n) => k === t && !G.revealed[n]).length;

function end(G, winner, reason) {
  G.winner = winner; G.reason = reason; G.phase = 'over'; G.clue = null;
  G.scores[winner]++;
  G.revealed = G.revealed.map(() => true);
  log(G, reason);
}

function passTurn(G) {
  G.turn = other(G.turn); G.phase = 'clue'; G.clue = null; G.guesses = 0;
}

// a.t: clue { word, count } (count 0 means unlimited) | guess { index } | stop
export function act(G, i, a) {
  const p = G.players[i];
  if (!p || p.left) return { ok: false, err: 'You are not in this game' };
  if (G.phase === 'over' || G.phase === 'teams') return { ok: false, err: 'No round is running' };
  if (p.team !== G.turn) return { ok: false, err: "It is the other team's turn" };

  if (a.t === 'clue') {
    if (G.phase !== 'clue') return { ok: false, err: 'Your team is guessing' };
    if (!p.spy) return { ok: false, err: 'Only the spymaster gives the clue' };
    const word = String(a.word || '').trim().toLowerCase();
    if (!/^[\p{L}][\p{L}'-]{0,24}$/u.test(word)) return { ok: false, err: 'The clue must be one word' };
    if (G.words.some((w, n) => !G.revealed[n] && (w === word || w.includes(word) || word.includes(w))))
      return { ok: false, err: "The clue can't be (or contain) a word on the table" };
    const count = Number.isInteger(a.count) && a.count >= 0 && a.count <= 9 ? a.count : 1;
    G.clue = { word, count };
    G.guesses = 0;
    G.phase = 'guess';
    log(G, teamName(G.turn) + ' spymaster: "' + word + '", ' + (count === 0 ? 'unlimited' : count) + '.');
    return { ok: true };
  }

  if (a.t === 'guess') {
    if (G.phase !== 'guess') return { ok: false, err: 'Wait for the clue' };
    if (p.spy) return { ok: false, err: "The spymaster can't guess" };
    const n = a.index;
    if (!(n >= 0 && n < 25) || G.revealed[n]) return { ok: false, err: 'Pick a word that is still hidden' };
    G.revealed[n] = true;
    G.guesses++;
    const k = G.key[n], w = G.words[n];
    if (k === 'trap') { end(G, other(G.turn), nm(G, i) + ' picked "' + w + '", the trap. ' + teamName(other(G.turn)) + ' wins!'); return { ok: true }; }
    if (left(G, 'red') === 0) { end(G, 'red', 'Red found all its words and wins!'); return { ok: true }; }
    if (left(G, 'blue') === 0) { end(G, 'blue', 'Blue found all its words and wins!'); return { ok: true }; }
    if (k === G.turn) {
      log(G, nm(G, i) + ' picks "' + w + '": correct!');
      const max = G.clue.count === 0 ? Infinity : G.clue.count; // the number is the number of guesses
      if (G.guesses >= max) { log(G, 'No guesses left.'); passTurn(G); }
    } else {
      log(G, nm(G, i) + ' picks "' + w + '": ' + (k === 'none' ? 'a bystander.' : teamName(k) + "'s word.") + ' The turn passes.');
      passTurn(G);
    }
    return { ok: true };
  }

  if (a.t === 'stop') {
    if (G.phase !== 'guess' || G.guesses < 1) return { ok: false, err: 'Make at least one guess first' };
    if (p.spy) return { ok: false, err: 'The guessers decide when to stop' };
    log(G, teamName(G.turn) + ' stops guessing.');
    passTurn(G);
    return { ok: true };
  }
  return { ok: false, err: 'Unknown action' };
}

// Swap spymasters to someone else on each team (for the next round).
export function rotateSpymasters(G) {
  for (const t of TEAMS) {
    const m = members(G, t);
    if (m.length < 2) continue;
    const cur = m.indexOf(spymaster(G, t));
    m.forEach(k => { G.players[k].spy = false; });
    G.players[m[(cur + 1) % m.length]].spy = true;
  }
}

export function leave(G, i) {
  const p = G.players[i];
  if (!p || p.left) return false;
  p.left = true;
  log(G, p.name + ' left the game.');
  if (G.phase === 'clue' || G.phase === 'guess') {
    for (const t of TEAMS) {
      if (members(G, t).length === 0) { end(G, other(t), teamName(t) + ' has no players left. ' + teamName(other(t)) + ' wins.'); return true; }
    }
    if (p.spy) {
      // Someone else on the team becomes spymaster so the round can go on.
      const next = members(G, p.team)[0];
      p.spy = false;
      if (next !== undefined) { G.players[next].spy = true; log(G, nm(G, next) + ' is now ' + teamName(p.team) + "'s spymaster."); }
    }
  }
  p.spy = false;
  return true;
}

export function addPlayer(G, name) {
  if (G.players.filter(p => !p.left).length >= MAX_PLAYERS) return -1;
  const team = members(G, 'red').length <= members(G, 'blue').length ? 'red' : 'blue';
  G.players.push({ name, team, spy: false, left: false });
  log(G, name + ' joined ' + teamName(team) + '.');
  return G.players.length - 1;
}

// Public view: colours only for revealed words.
export function view(G) {
  return {
    phase: G.phase, round: G.round, lang: G.lang, turn: G.turn, starter: G.starter,
    words: G.words, revealed: G.revealed, colors: G.key.map((k, n) => (G.revealed[n] ? k : '')),
    clue: G.clue, guesses: G.guesses, scores: G.scores, winner: G.winner, reason: G.reason, log: G.log,
    left: G.words.length ? { red: left(G, 'red'), blue: left(G, 'blue') } : { red: 0, blue: 0 },
    problem: G.phase === 'teams' || G.phase === 'over' ? readyProblem(G) : '',
    players: G.players.map(p => ({ name: p.name, team: p.team, spy: p.spy, left: p.left })),
  };
}

// Spymasters see the key.
export function secretFor(G, i) {
  const p = G.players[i];
  if (!p || p.left || !p.spy || !G.key.length || G.phase === 'teams') return null;
  return { key: G.key };
}
