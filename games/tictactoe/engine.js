// Tic Tac Toe rules engine. Runs only on the host.
// Two seats: seat 0 plays X in odd rounds and O in even rounds, so the starting player alternates
// (X always moves first). Three in a row wins; a full board is a draw. Scores add up over rounds.

export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export function createGame(names, bots, level = 'hard') {
  return {
    players: names.map((name, i) => ({ name, bot: bots[i] })),
    level: level === 'easy' ? 'easy' : 'hard',
    scores: [0, 0], draws: 0, round: 0,
    board: Array(9).fill(''), turn: 0, over: true, winner: -1, line: null,
  };
}

// Which mark a seat plays this round.
export const markOf = (G, seat) => ((G.round % 2 === 1) === (seat === 0) ? 'X' : 'O');

export function newRound(G) {
  G.round++;
  Object.assign(G, { board: Array(9).fill(''), over: false, winner: -1, line: null });
  G.turn = markOf(G, 0) === 'X' ? 0 : 1;
}

export function winnerOf(board) {
  for (const l of LINES) if (board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]) return { mark: board[l[0]], line: l };
  return board.every(c => c) ? { mark: '', line: null } : null;
}

export function act(G, i, cell) {
  if (G.over) return { ok: false, err: 'The round is over' };
  if (G.turn !== i) return { ok: false, err: 'Not your turn' };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || G.board[cell]) return { ok: false, err: 'Pick an empty square' };
  G.board[cell] = markOf(G, i);
  const w = winnerOf(G.board);
  if (w) {
    G.over = true;
    G.line = w.line;
    if (w.mark) { G.winner = i; G.scores[i]++; } else { G.winner = -1; G.draws++; }
  } else G.turn = 1 - i;
  return { ok: true };
}

// Minimax over the whole tree (tiny for 3×3). Prefers faster wins and slower losses.
function best(board, me, them) {
  let bestScore = -Infinity, moves = [];
  board.forEach((c, k) => {
    if (c) return;
    board[k] = me;
    const s = -score(board, them, me, 1);
    board[k] = '';
    if (s > bestScore) { bestScore = s; moves = [k]; } else if (s === bestScore) moves.push(k);
  });
  return moves[Math.floor(Math.random() * moves.length)];
}
function score(board, toMove, other, depth) {
  const w = winnerOf(board);
  if (w) return w.mark === '' ? 0 : -(10 - depth); // the player who just moved (other) has won
  let bestS = -Infinity;
  board.forEach((c, k) => {
    if (c) return;
    board[k] = toMove;
    bestS = Math.max(bestS, -score(board, other, toMove, depth + 1));
    board[k] = '';
  });
  return bestS;
}

export function botMove(G, i) {
  const me = markOf(G, i), them = me === 'X' ? 'O' : 'X';
  const empty = G.board.map((c, k) => (c ? -1 : k)).filter(k => k >= 0);
  // Easy: takes a win or blocks a loss, otherwise plays at random.
  if (G.level === 'easy') {
    for (const m of [me, them]) for (const k of empty) {
      const b = G.board.slice(); b[k] = m;
      if (winnerOf(b)?.mark === m) return k;
    }
    return empty[Math.floor(Math.random() * empty.length)];
  }
  return best(G.board.slice(), me, them);
}

export function view(G) {
  return {
    players: G.players.map((p, i) => ({ name: p.name, bot: p.bot, mark: markOf(G, i) })),
    board: G.board, turn: G.turn, over: G.over, winner: G.winner, line: G.line,
    scores: G.scores, draws: G.draws, round: G.round, level: G.level,
  };
}
