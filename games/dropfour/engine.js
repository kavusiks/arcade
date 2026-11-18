// Drop Four rules engine. Runs only on the host.
// 7 columns × 6 rows. Players take turns dropping a disc into a column; it falls to the lowest free cell.
// Four in a row (across, down or diagonally) wins; a full board is a draw. The starting player alternates.
export const COLS = 7, ROWS = 6;

export function createGame(names, bots, level = 'hard') {
  return {
    players: names.map(name => ({ name, bot: false })).map((p, i) => ({ ...p, bot: bots[i] })),
    level: level === 'easy' ? 'easy' : 'hard',
    scores: [0, 0], draws: 0, round: 0,
    board: Array(COLS * ROWS).fill(-1), turn: 0, over: true, winner: -1, line: null, last: -1,
  };
}

export function newRound(G) {
  G.round++;
  Object.assign(G, { board: Array(COLS * ROWS).fill(-1), over: false, winner: -1, line: null, last: -1 });
  G.turn = G.round % 2 === 1 ? 0 : 1; // seat 0 starts odd rounds
}

const at = (b, r, c) => (r < 0 || r >= ROWS || c < 0 || c >= COLS ? -2 : b[r * COLS + c]);
export const dropRow = (b, c) => { for (let r = ROWS - 1; r >= 0; r--) if (b[r * COLS + c] === -1) return r; return -1; };

// The four (or more) cells in a line through (r, c) for its owner, or null.
export function lineThrough(b, r, c) {
  const p = at(b, r, c);
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[r, c]];
    for (const s of [1, -1]) for (let k = 1; at(b, r + dr * k * s, c + dc * k * s) === p; k++) cells.push([r + dr * k * s, c + dc * k * s]);
    if (cells.length >= 4) return cells.map(([y, x]) => y * COLS + x);
  }
  return null;
}

export function act(G, i, col) {
  if (G.over) return { ok: false, err: 'The round is over' };
  if (G.turn !== i) return { ok: false, err: 'Not your turn' };
  if (!Number.isInteger(col) || col < 0 || col >= COLS) return { ok: false, err: 'Pick a column' };
  const r = dropRow(G.board, col);
  if (r < 0) return { ok: false, err: 'That column is full' };
  G.board[r * COLS + col] = i;
  G.last = r * COLS + col;
  const line = lineThrough(G.board, r, col);
  if (line) { G.over = true; G.winner = i; G.line = line; G.scores[i]++; }
  else if (G.board.every(x => x !== -1)) { G.over = true; G.winner = -1; G.draws++; }
  else G.turn = 1 - i;
  return { ok: true };
}

// ---------- bot ----------
const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre columns first
const WINDOWS = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const w = [0, 1, 2, 3].map(k => [r + dr * k, c + dc * k]);
    if (w.every(([y, x]) => y >= 0 && y < ROWS && x >= 0 && x < COLS)) WINDOWS.push(w.map(([y, x]) => y * COLS + x));
  }

// Board score from `me`'s point of view: open windows with more of my discs are good.
function evaluate(b, me) {
  let s = 0;
  for (let r = 0; r < ROWS; r++) if (b[r * COLS + 3] === me) s += 3; else if (b[r * COLS + 3] === 1 - me) s -= 3;
  for (const w of WINDOWS) {
    let mine = 0, theirs = 0;
    for (const k of w) { if (b[k] === me) mine++; else if (b[k] === 1 - me) theirs++; }
    if (mine && theirs) continue;
    if (mine === 3) s += 5; else if (mine === 2) s += 2;
    if (theirs === 3) s -= 4; else if (theirs === 2) s -= 1;
  }
  return s;
}

function negamax(b, me, depth, alpha, beta) {
  if (b.every(x => x !== -1)) return 0;
  if (depth === 0) return evaluate(b, me);
  let best = -Infinity;
  for (const c of ORDER) {
    const r = dropRow(b, c);
    if (r < 0) continue;
    b[r * COLS + c] = me;
    const v = lineThrough(b, r, c) ? 100000 + depth : -negamax(b, 1 - me, depth - 1, -beta, -alpha);
    b[r * COLS + c] = -1;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function botMove(G, i) {
  const b = G.board.slice();
  const open = ORDER.filter(c => dropRow(b, c) >= 0);
  const wins = who => open.find(c => { const r = dropRow(b, c); b[r * COLS + c] = who; const w = !!lineThrough(b, r, c); b[r * COLS + c] = -1; return w; });
  const win = wins(i); if (win !== undefined) return win;
  const block = wins(1 - i); if (block !== undefined) return block;
  if (G.level === 'easy') {
    // Easy: wins and blocks, otherwise a random column (leaning to the middle).
    const weighted = open.flatMap(c => Array(4 - Math.abs(3 - c)).fill(c));
    return weighted[Math.floor(Math.random() * weighted.length)];
  }
  let best = -Infinity, choice = open[0];
  for (const c of open) {
    const r = dropRow(b, c);
    b[r * COLS + c] = i;
    const v = -negamax(b, 1 - i, 6, -Infinity, Infinity);
    b[r * COLS + c] = -1;
    if (v > best) { best = v; choice = c; }
  }
  return choice;
}

export function view(G) {
  return {
    players: G.players.map(p => ({ name: p.name, bot: p.bot })),
    board: G.board, turn: G.turn, over: G.over, winner: G.winner, line: G.line, last: G.last,
    scores: G.scores, draws: G.draws, round: G.round,
  };
}
