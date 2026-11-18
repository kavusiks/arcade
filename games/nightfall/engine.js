// Nightfall rules engine (a Mafia-style party game). Runs only on the host; the app is the narrator.
//
// Roles: Mafia (know each other), Doctor (protects one player each night, not the same one twice in a row),
// Detective (learns each night whether one player is Mafia), Villagers.
// Night: every living player picks someone on their phone, so nobody can tell who has a role.
//   Mafia picks decide the victim (most picks; a tie is decided at random). The Doctor's pick is saved.
//   The Detective learns the answer privately. Villager picks ("who do you suspect?") have no effect.
// Morning: the victim (if any) dies and their role is revealed.
// Day: everyone alive votes to eliminate someone, or skips. More than half of the living players must
//   agree; the eliminated player's role is revealed. The host can close the vote early.
// The town wins when all Mafia are gone; the Mafia win when they are at least as many as everyone else.

export const MIN_PLAYERS = 4, MAX_PLAYERS = 12;
export const ROLES = {
  mafia:     { name: 'Mafia',     team: 'mafia', goal: 'Eliminate the town without being caught. At night, pick someone to take out together with the rest of the Mafia.' },
  doctor:    { name: 'Doctor',    team: 'town',  goal: 'Find the Mafia. At night, pick someone to protect. You can protect yourself, but not the same person two nights in a row.' },
  detective: { name: 'Detective', team: 'town',  goal: 'Find the Mafia. At night, pick someone to investigate and learn if they are Mafia.' },
  villager:  { name: 'Villager',  team: 'town',  goal: 'Find the Mafia and vote them out during the day.' },
};

export function mafiaCount(n) { return n >= 9 ? 3 : n >= 6 ? 2 : 1; }

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 12);
}
const nm = (G, i) => G.players[i].name;
export const living = G => G.players.map((p, i) => i).filter(i => G.players[i].alive);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createGame(names) {
  return {
    players: names.map(name => ({ name, role: '', alive: true, revealed: false, left: false })),
    phase: 'lobby', round: 0, games: 0, log: [],
    night: {},          // seat -> chosen seat, for the current night
    votes: {},          // seat -> chosen seat, or -1 to skip
    doctorLast: -1,     // who the Doctor protected last night
    checks: {},         // detective seat -> [{ target, mafia }]
    news: '',           // what happened last night / at the last vote
    winner: '',         // 'town' | 'mafia'
  };
}

export function newGame(G) {
  const seats = G.players.map((p, i) => i).filter(i => !G.players[i].left);
  if (seats.length < MIN_PLAYERS) return { ok: false, err: 'Need at least ' + MIN_PLAYERS + ' players' };
  const roles = Array(mafiaCount(seats.length)).fill('mafia');
  roles.push('doctor');
  if (seats.length >= 5) roles.push('detective');
  while (roles.length < seats.length) roles.push('villager');
  shuffle(roles);
  G.players.forEach(p => { Object.assign(p, { role: '', alive: false, revealed: false }); });
  seats.forEach((i, k) => Object.assign(G.players[i], { role: roles[k], alive: true }));
  Object.assign(G, { phase: 'night', round: 1, night: {}, votes: {}, doctorLast: -1, checks: {}, news: '', winner: '', log: [] });
  G.games++;
  log(G, 'Night 1 falls. Everyone picks someone on their phone.');
  return { ok: true };
}

export const isMafia = (G, i) => G.players[i] && G.players[i].role === 'mafia';
const mafiaAlive = G => living(G).filter(i => isMafia(G, i)).length;

function checkWin(G) {
  const m = mafiaAlive(G), others = living(G).length - m;
  if (m === 0) G.winner = 'town';
  else if (m >= others) G.winner = 'mafia';
  if (!G.winner) return false;
  G.phase = 'over';
  G.players.forEach(p => { if (p.role) p.revealed = true; });
  log(G, G.winner === 'town' ? 'The town found every member of the Mafia. Town wins!' : 'The Mafia have taken over the town. Mafia wins!');
  return true;
}

function kill(G, i, how) {
  const p = G.players[i];
  p.alive = false; p.revealed = true;
  return nm(G, i) + ' ' + how + '. They were ' + (p.role === 'mafia' ? 'Mafia' : 'a ' + ROLES[p.role].name) + '.';
}

// Who still has to choose tonight / vote today.
export function waitingFor(G) {
  if (G.phase === 'night') return living(G).filter(i => !(i in G.night));
  if (G.phase === 'day') return living(G).filter(i => !(i in G.votes));
  return [];
}

function resolveNight(G) {
  const alive = living(G);
  // Mafia: most picks wins, ties at random.
  const tally = {};
  alive.filter(i => isMafia(G, i)).forEach(i => { const t = G.night[i]; if (t >= 0) tally[t] = (tally[t] || 0) + 1; });
  const top = Math.max(0, ...Object.values(tally));
  const options = Object.keys(tally).map(Number).filter(t => tally[t] === top);
  const victim = options.length ? options[Math.floor(Math.random() * options.length)] : -1;
  const doc = alive.find(i => G.players[i].role === 'doctor');
  const saved = doc !== undefined ? G.night[doc] : -1;
  G.doctorLast = doc !== undefined ? saved : -1;
  alive.filter(i => G.players[i].role === 'detective').forEach(d => {
    const t = G.night[d];
    (G.checks[d] = G.checks[d] || []).push({ target: t, mafia: isMafia(G, t) });
  });
  if (victim >= 0 && victim !== saved) G.news = kill(G, victim, 'was taken out during the night');
  else G.news = 'Nobody died last night.';
  log(G, 'Morning ' + G.round + ': ' + G.news);
  G.night = {};
  if (checkWin(G)) return;
  G.phase = 'day';
  G.votes = {};
  log(G, 'Day ' + G.round + ': talk it over, then vote.');
}

function resolveDay(G) {
  const alive = living(G);
  const tally = {};
  Object.entries(G.votes).forEach(([v, t]) => { if (G.players[v].alive && t >= 0) tally[t] = (tally[t] || 0) + 1; });
  const top = Math.max(0, ...Object.values(tally));
  const leaders = Object.keys(tally).map(Number).filter(t => tally[t] === top);
  if (top > alive.length / 2 && leaders.length === 1) G.news = kill(G, leaders[0], 'was voted out by the town');
  else G.news = 'No majority, so nobody was voted out.';
  log(G, 'Vote: ' + G.news);
  G.votes = {};
  if (checkWin(G)) return;
  G.round++;
  G.phase = 'night';
  G.night = {};
  log(G, 'Night ' + G.round + ' falls.');
}

// a = { t: 'pick', target } at night | { t: 'vote', target } by day (target -1 = skip) | { t: 'close' } (host only)
export function act(G, i, a) {
  const p = G.players[i];
  if (!p || !p.alive) return { ok: false, err: 'You are out of the game' };
  if (a.t === 'pick') {
    if (G.phase !== 'night') return { ok: false, err: 'It is not night' };
    const t = a.target, q = G.players[t];
    if (!q || !q.alive) return { ok: false, err: 'Pick someone who is still in the game' };
    if (p.role === 'mafia' && q.role === 'mafia') return { ok: false, err: 'Pick someone outside the Mafia' };
    if (p.role === 'doctor' && t === G.doctorLast) return { ok: false, err: 'You protected them last night. Pick someone else' };
    if ((p.role === 'detective' || p.role === 'villager') && t === i) return { ok: false, err: 'Pick someone else' };
    G.night[i] = t;
    if (!waitingFor(G).length) resolveNight(G);
    return { ok: true };
  }
  if (a.t === 'vote') {
    if (G.phase !== 'day') return { ok: false, err: 'Voting happens during the day' };
    const t = a.target;
    if (t !== -1 && (!G.players[t] || !G.players[t].alive)) return { ok: false, err: 'Vote for someone who is still in the game' };
    G.votes[i] = t;
    if (!waitingFor(G).length) resolveDay(G);
    return { ok: true };
  }
  if (a.t === 'close') {
    if (G.phase !== 'day') return { ok: false, err: 'There is no vote to close' };
    resolveDay(G);
    return { ok: true };
  }
  return { ok: false, err: 'Unknown action' };
}

// A player leaves for good: they are out, and their role is shown.
export function leave(G, i) {
  const p = G.players[i];
  if (!p || p.left) return false;
  p.left = true;
  if (p.alive && G.phase !== 'lobby' && G.phase !== 'over') {
    const msg = kill(G, i, 'left the game');
    log(G, msg);
    delete G.night[i]; delete G.votes[i];
    if (checkWin(G)) return true;
    if (G.phase === 'night' && !waitingFor(G).length) resolveNight(G);
    else if (G.phase === 'day' && !waitingFor(G).length) resolveDay(G);
  } else { p.alive = false; log(G, p.name + ' left.'); }
  return true;
}

export function addPlayer(G, name) {
  if (G.players.filter(p => !p.left).length >= MAX_PLAYERS) return -1;
  G.players.push({ name, role: '', alive: false, revealed: false, left: false });
  log(G, name + ' joined. They play from the next game.');
  return G.players.length - 1;
}

// Public view: roles only for players who are out (or everyone at the end).
export function view(G) {
  const voteCounts = {};
  Object.values(G.votes).forEach(t => { voteCounts[t] = (voteCounts[t] || 0) + 1; });
  return {
    phase: G.phase, round: G.round, games: G.games, news: G.news, winner: G.winner, log: G.log,
    waiting: waitingFor(G),
    votes: G.phase === 'day' ? G.votes : {},     // day votes are public, like raising hands
    players: G.players.map(p => ({ name: p.name, alive: p.alive, left: p.left, playing: !!p.role, role: p.revealed ? p.role : '' })),
  };
}

// What one player is allowed to know.
export function secretFor(G, i) {
  const p = G.players[i];
  if (!p || !p.role || G.phase === 'lobby') return null;
  const s = { role: p.role, pick: i in G.night ? G.night[i] : -1 };
  if (p.role === 'mafia') {
    s.team = G.players.map((q, k) => k).filter(k => isMafia(G, k) && k !== i);
    s.teamPicks = {};
    s.team.forEach(k => { if (k in G.night) s.teamPicks[k] = G.night[k]; });
  }
  if (p.role === 'detective') s.checks = G.checks[i] || [];
  if (p.role === 'doctor') s.doctorLast = G.doctorLast;
  return s;
}
