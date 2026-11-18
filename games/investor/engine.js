// Investor rules engine. Runs only on the host; everyone sees the full (public) game state.
//
// Turn: roll two dice and move. Passing Start pays 200. Doubles roll again; three doubles in a row
// send you to jail. Landing on an unowned property: buy it or leave it. Owned by someone else: pay
// rent (doubled for an unbuilt street when the owner has the whole colour group). Stations: 25/50/100/200
// for 1–4 owned. Utilities: 4× the dice (10× with both). Build houses evenly on complete, unmortgaged
// groups (4 houses, then a hotel). Mortgage for half the price; lifting it costs the half price + 10%.
// Jail: pay 50 or use a card before rolling, or try for doubles; after 3 failed tries pay 50 and move.
// If you can't pay, sell buildings / mortgage until you can, or go bankrupt: your assets go to the
// player you owe (or back to the bank). The last player left wins; the host can also end the game,
// and then the highest net worth wins.
import { BOARD, GROUPS, LUCK, BONUS, START_CASH, PASS_START, JAIL, JAIL_FINE, isOwnable, groupOf, STATIONS, UTILITIES } from './board.js?v=1795037166';

export const MIN_SEATS = 2, MAX_SEATS = 6;
export const TOKEN_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#ff7043'];

function log(G, msg) {
  G.log.unshift(msg);
  G.log = G.log.slice(0, 10);
}
const nm = (G, i) => G.players[i].name;

export function createGame(names, bots) {
  return {
    players: names.map((name, i) => ({ name, bot: bots[i], cash: START_CASH, pos: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false })),
    owner: BOARD.map(() => -1), houses: BOARD.map(() => 0), mortgaged: BOARD.map(() => false),
    turn: 0, phase: 'roll', dice: [0, 0], doubles: 0, rolledDouble: false,
    debt: null,        // { to: seat or -1 for the bank, amount, then: steps to move after paying (jail fine) }
    card: null,        // last card drawn { deck, text }
    trade: null,       // { from, to, give: { cash, props }, get: { cash, props } }
    log: [], over: false, winner: -1, ranking: null, turns: 0,
  };
}

export const alive = G => G.players.map((p, i) => i).filter(i => !G.players[i].bankrupt);
const roll = () => 1 + Math.floor(Math.random() * 6);

// ---------- money ----------
export function netWorth(G, i) {
  let w = G.players[i].cash;
  BOARD.forEach((sp, k) => {
    if (G.owner[k] !== i) return;
    w += G.mortgaged[k] ? sp.price / 2 : sp.price;
    if (sp.type === 'street') w += G.houses[k] * GROUPS[sp.group].house;
  });
  return w;
}

// Pay `amount` to seat `to` (-1 = bank). If the current player can't pay, they get a debt to settle.
function charge(G, i, to, amount, then = null) {
  const p = G.players[i];
  if (p.cash >= amount) {
    p.cash -= amount;
    if (to >= 0) G.players[to].cash += amount;
    return true;
  }
  G.debt = { to, amount, then };
  G.phase = 'debt';
  log(G, nm(G, i) + ' owes ' + amount + ' but only has ' + p.cash + '. Sell or mortgage, or go bankrupt.');
  return false;
}

// For players who are not taking their turn (birthday card): raise money automatically.
function liquidate(G, i, amount) {
  const p = G.players[i];
  while (p.cash < amount) {
    const built = BOARD.map((s, k) => k).filter(k => G.owner[k] === i && G.houses[k] > 0)
      .sort((a, b) => G.houses[b] - G.houses[a]);
    if (built.length) { sellHouse(G, i, built[0]); continue; }
    const free = BOARD.map((s, k) => k).filter(k => G.owner[k] === i && !G.mortgaged[k] && canMortgage(G, i, k))
      .sort((a, b) => BOARD[a].price - BOARD[b].price);
    if (free.length) { doMortgage(G, i, free[0]); continue; }
    return false;
  }
  return true;
}

// ---------- rent ----------
const ownsGroup = (G, i, g) => groupOf(g).every(k => G.owner[k] === i);

export function rentFor(G, k, diceTotal) {
  const sp = BOARD[k], o = G.owner[k];
  if (o < 0 || G.mortgaged[k]) return 0;
  if (sp.type === 'street') {
    if (G.houses[k] > 0) return sp.rents[G.houses[k]];
    return sp.rents[0] * (ownsGroup(G, o, sp.group) ? 2 : 1);
  }
  if (sp.type === 'station') {
    const n = STATIONS.filter(s => G.owner[s] === o).length;
    return 25 * 2 ** (n - 1);
  }
  if (sp.type === 'utility') {
    const n = UTILITIES.filter(s => G.owner[s] === o).length;
    return diceTotal * (n === 2 ? 10 : 4);
  }
  return 0;
}

// ---------- movement ----------
function moveTo(G, i, target, collect = true) {
  const p = G.players[i];
  if (collect && target < p.pos) { p.cash += PASS_START; log(G, nm(G, i) + ' passes Start and collects ' + PASS_START + '.'); }
  p.pos = target;
}

function moveBy(G, i, steps) {
  const p = G.players[i];
  moveTo(G, i, (p.pos + steps) % BOARD.length, true);
}

function toJail(G, i) {
  const p = G.players[i];
  Object.assign(p, { pos: JAIL, inJail: true, jailTurns: 0 });
  G.rolledDouble = false;
  log(G, nm(G, i) + ' goes to jail.');
}

// What happens on the space the player landed on.
function land(G, i) {
  const p = G.players[i], k = p.pos, sp = BOARD[k];
  log(G, nm(G, i) + ' lands on ' + sp.name + '.');
  if (isOwnable(sp)) {
    const o = G.owner[k];
    if (o < 0) { G.phase = 'buy'; return; }
    if (o !== i && !G.players[o].bankrupt) {
      const rent = rentFor(G, k, G.dice[0] + G.dice[1]);
      if (G.mortgaged[k]) log(G, sp.name + ' is mortgaged: no rent.');
      else if (rent > 0) {
        log(G, nm(G, i) + ' pays ' + rent + ' rent to ' + nm(G, o) + '.');
        if (!charge(G, i, o, rent)) return;
      }
    }
  } else if (sp.type === 'tax') {
    log(G, nm(G, i) + ' pays ' + sp.amount + ' tax.');
    if (!charge(G, i, -1, sp.amount)) return;
  } else if (sp.type === 'luck' || sp.type === 'bonus') {
    if (!drawCard(G, i, sp.type)) return;
  } else if (sp.type === 'gotojail') {
    toJail(G, i);
  }
  finishLanding(G, i);
}

function finishLanding(G, i) {
  if (G.phase === 'buy' || G.phase === 'debt' || G.players[i].bankrupt || G.over) return;
  G.phase = G.rolledDouble && !G.players[i].inJail ? 'roll' : 'end';
}

function drawCard(G, i, deck) {
  const cards = deck === 'luck' ? LUCK : BONUS;
  const c = cards[Math.floor(Math.random() * cards.length)];
  G.card = { deck, text: c.text };
  log(G, (deck === 'luck' ? 'Luck' : 'Bonus') + ': ' + c.text);
  const p = G.players[i];
  if (c.money > 0) p.cash += c.money;
  else if (c.money < 0) return charge(G, i, -1, -c.money);
  else if (c.jailCard) p.jailCards++;
  else if (c.jail) toJail(G, i);
  else if (c.repairs) {
    let cost = 0;
    BOARD.forEach((s, k) => { if (G.owner[k] === i) cost += G.houses[k] === 5 ? c.repairs[1] : G.houses[k] * c.repairs[0]; });
    if (cost > 0) { log(G, nm(G, i) + ' pays ' + cost + ' for repairs.'); return charge(G, i, -1, cost); }
  } else if (c.fromEach) {
    alive(G).filter(j => j !== i).forEach(j => {
      if (G.players[j].cash < c.fromEach && !liquidate(G, j, c.fromEach)) { bankrupt(G, j, i); return; }
      G.players[j].cash -= c.fromEach; p.cash += c.fromEach;
    });
  } else if (c.back) {
    p.pos = (p.pos - c.back + BOARD.length) % BOARD.length;
    land(G, i);
    return false; // land() already finished the landing
  } else if (c.to !== undefined) {
    moveTo(G, i, c.to, true);
    land(G, i);
    return false;
  }
  return true;
}

// ---------- property management ----------
function canBuild(G, i, k) {
  const sp = BOARD[k];
  if (sp.type !== 'street' || G.owner[k] !== i || G.houses[k] >= 5) return false;
  const grp = groupOf(sp.group);
  if (!grp.every(x => G.owner[x] === i && !G.mortgaged[x])) return false;
  return G.houses[k] === Math.min(...grp.map(x => G.houses[x])) && G.players[i].cash >= GROUPS[sp.group].house;
}
function canSell(G, i, k) {
  const sp = BOARD[k];
  if (sp.type !== 'street' || G.owner[k] !== i || G.houses[k] === 0) return false;
  return G.houses[k] === Math.max(...groupOf(sp.group).map(x => G.houses[x]));
}
function canMortgage(G, i, k) {
  const sp = BOARD[k];
  if (!isOwnable(sp) || G.owner[k] !== i || G.mortgaged[k]) return false;
  return sp.type !== 'street' || groupOf(sp.group).every(x => G.houses[x] === 0);
}
const unmortgageCost = k => Math.ceil(BOARD[k].price / 2 * 1.1);
function sellHouse(G, i, k) {
  G.houses[k]--;
  G.players[i].cash += GROUPS[BOARD[k].group].house / 2;
}
function doMortgage(G, i, k) {
  G.mortgaged[k] = true;
  G.players[i].cash += BOARD[k].price / 2;
}
export const canDo = { build: canBuild, sell: canSell, mortgage: canMortgage,
  unmortgage: (G, i, k) => G.owner[k] === i && G.mortgaged[k] && G.players[i].cash >= unmortgageCost(k) };

// Properties that can change hands in a trade: no buildings anywhere in their group.
export const tradeable = (G, i, k) => G.owner[k] === i && isOwnable(BOARD[k]) &&
  (BOARD[k].type !== 'street' || groupOf(BOARD[k].group).every(x => G.houses[x] === 0));

// ---------- bankruptcy and the end ----------
function bankrupt(G, i, creditor) {
  const p = G.players[i];
  BOARD.forEach((s, k) => {
    if (G.owner[k] !== i) return;
    if (G.houses[k] > 0) { p.cash += G.houses[k] * GROUPS[s.group].house / 2; G.houses[k] = 0; }
    if (creditor >= 0) G.owner[k] = creditor;
    else { G.owner[k] = -1; G.mortgaged[k] = false; }
  });
  if (creditor >= 0) { G.players[creditor].cash += p.cash; G.players[creditor].jailCards += p.jailCards; }
  Object.assign(p, { cash: 0, jailCards: 0, bankrupt: true, inJail: false });
  log(G, nm(G, i) + ' is bankrupt' + (creditor >= 0 ? '; everything goes to ' + nm(G, creditor) : '') + '.');
  if (G.trade && (G.trade.from === i || G.trade.to === i)) G.trade = null;
  const left = alive(G);
  if (left.length === 1) endGame(G, 'last');
}

export function endGame(G, why = 'host') {
  G.over = true;
  G.phase = 'over';
  G.trade = null;
  G.ranking = alive(G).sort((a, b) => netWorth(G, b) - netWorth(G, a))
    .concat(G.players.map((p, i) => i).filter(i => G.players[i].bankrupt));
  G.winner = G.ranking[0];
  log(G, (why === 'last' ? nm(G, G.winner) + ' is the last investor standing and wins!' : 'Game ended. ' + nm(G, G.winner) + ' wins with the highest net worth!'));
}

function nextTurn(G) {
  const n = G.players.length;
  let k = G.turn;
  do { k = (k + 1) % n; } while (G.players[k].bankrupt);
  Object.assign(G, { turn: k, phase: 'roll', doubles: 0, rolledDouble: false, card: null, turns: G.turns + 1 });
}

// ---------- actions ----------
// a.t: roll | buy | skip | end | build | sell | mortgage | unmortgage | payJail | useCard | payDebt | bankrupt
//      | propose { to, give, get } | accept | decline | cancel
export function act(G, i, a) {
  if (G.over) return { ok: false, err: 'The game is over' };
  const p = G.players[i];
  if (!p || p.bankrupt) return { ok: false, err: 'You are out of the game' };

  // Trade responses can come from the other player at any time.
  if (a.t === 'accept' || a.t === 'decline') {
    const T = G.trade;
    if (!T || T.to !== i) return { ok: false, err: 'No offer for you' };
    if (a.t === 'decline') { G.trade = null; log(G, nm(G, i) + ' declines the offer.'); return { ok: true }; }
    const valid = T.give.props.every(k => tradeable(G, T.from, k)) && T.get.props.every(k => tradeable(G, T.to, k));
    if (!valid || G.players[T.from].cash < T.give.cash || G.players[T.to].cash < T.get.cash) {
      G.trade = null; return { ok: false, err: 'The offer is no longer valid' };
    }
    T.give.props.forEach(k => { G.owner[k] = T.to; });
    T.get.props.forEach(k => { G.owner[k] = T.from; });
    G.players[T.from].cash += T.get.cash - T.give.cash;
    G.players[T.to].cash += T.give.cash - T.get.cash;
    log(G, nm(G, T.to) + ' accepts the trade with ' + nm(G, T.from) + '.');
    G.trade = null;
    return { ok: true };
  }

  if (G.turn !== i) return { ok: false, err: 'Not your turn' };

  switch (a.t) {
    case 'roll': {
      if (G.phase !== 'roll') return { ok: false, err: 'You cannot roll now' };
      if (G.trade) G.trade = null;
      const d = [roll(), roll()], dbl = d[0] === d[1], total = d[0] + d[1];
      G.dice = d; G.card = null;
      log(G, nm(G, i) + ' rolls ' + d[0] + ' + ' + d[1] + (dbl ? ' (doubles)' : '') + '.');
      if (p.inJail) {
        if (dbl) { p.inJail = false; log(G, nm(G, i) + ' rolls out of jail.'); G.rolledDouble = false; moveBy(G, i, total); land(G, i); return { ok: true }; }
        p.jailTurns++;
        if (p.jailTurns < 3) { G.phase = 'end'; return { ok: true }; }
        p.inJail = false;
        log(G, nm(G, i) + ' must pay ' + JAIL_FINE + ' to leave jail.');
        G.rolledDouble = false;
        if (!charge(G, i, -1, JAIL_FINE, total)) return { ok: true };
        moveBy(G, i, total); land(G, i);
        return { ok: true };
      }
      G.rolledDouble = dbl;
      G.doubles = dbl ? G.doubles + 1 : 0;
      if (G.doubles === 3) { log(G, 'Three doubles in a row!'); toJail(G, i); G.phase = 'end'; return { ok: true }; }
      moveBy(G, i, total);
      land(G, i);
      return { ok: true };
    }
    case 'buy': {
      if (G.phase !== 'buy') return { ok: false, err: 'Nothing to buy' };
      const k = p.pos, sp = BOARD[k];
      if (p.cash < sp.price) return { ok: false, err: 'Not enough money' };
      p.cash -= sp.price; G.owner[k] = i;
      log(G, nm(G, i) + ' buys ' + sp.name + ' for ' + sp.price + '.');
      G.phase = 'landed'; finishLanding(G, i);
      return { ok: true };
    }
    case 'skip': {
      if (G.phase !== 'buy') return { ok: false, err: 'Nothing to skip' };
      log(G, nm(G, i) + ' does not buy ' + BOARD[p.pos].name + '.');
      G.phase = 'landed'; finishLanding(G, i);
      return { ok: true };
    }
    case 'end': {
      if (G.phase !== 'end') return { ok: false, err: G.phase === 'roll' ? 'Roll first' : 'Finish your move first' };
      nextTurn(G);
      return { ok: true };
    }
    case 'build': case 'sell': case 'mortgage': case 'unmortgage': {
      const k = a.k;
      if (!BOARD[k]) return { ok: false, err: 'Unknown property' };
      const allowed = a.t === 'sell' || a.t === 'mortgage' ? ['roll', 'end', 'debt', 'buy'] : ['roll', 'end', 'buy'];
      if (!allowed.includes(G.phase)) return { ok: false, err: 'Not now' };
      if (!canDo[a.t](G, i, k)) return { ok: false, err: {
        build: 'You can build here only with the whole colour group, unmortgaged, evenly, and enough money',
        sell: 'Sell evenly: start with the street that has the most buildings',
        mortgage: 'Sell the buildings in this colour group first',
        unmortgage: 'Not enough money to lift the mortgage' }[a.t] };
      const sp = BOARD[k];
      if (a.t === 'build') { p.cash -= GROUPS[sp.group].house; G.houses[k]++; log(G, nm(G, i) + ' builds ' + (G.houses[k] === 5 ? 'a hotel' : 'a house') + ' on ' + sp.name + '.'); }
      if (a.t === 'sell') { sellHouse(G, i, k); log(G, nm(G, i) + ' sells a building on ' + sp.name + '.'); }
      if (a.t === 'mortgage') { doMortgage(G, i, k); log(G, nm(G, i) + ' mortgages ' + sp.name + '.'); }
      if (a.t === 'unmortgage') { p.cash -= unmortgageCost(k); G.mortgaged[k] = false; log(G, nm(G, i) + ' lifts the mortgage on ' + sp.name + '.'); }
      return { ok: true };
    }
    case 'payJail': case 'useCard': {
      if (G.phase !== 'roll' || !p.inJail) return { ok: false, err: 'You are not in jail' };
      if (a.t === 'useCard') { if (!p.jailCards) return { ok: false, err: 'You have no card' }; p.jailCards--; }
      else { if (p.cash < JAIL_FINE) return { ok: false, err: 'Not enough money' }; p.cash -= JAIL_FINE; }
      p.inJail = false; p.jailTurns = 0;
      log(G, nm(G, i) + (a.t === 'useCard' ? ' uses a card' : ' pays ' + JAIL_FINE) + ' and leaves jail.');
      return { ok: true };
    }
    case 'payDebt': {
      if (G.phase !== 'debt') return { ok: false, err: 'You owe nothing' };
      const D = G.debt;
      if (p.cash < D.amount) return { ok: false, err: 'Still not enough money' };
      p.cash -= D.amount;
      if (D.to >= 0) G.players[D.to].cash += D.amount;
      G.debt = null;
      log(G, nm(G, i) + ' pays the debt of ' + D.amount + '.');
      if (D.then !== null && D.then !== undefined) { G.phase = 'landed'; moveBy(G, i, D.then); land(G, i); }
      else { G.phase = 'landed'; finishLanding(G, i); }
      return { ok: true };
    }
    case 'bankrupt': {
      if (G.phase !== 'debt') return { ok: false, err: 'You can only go bankrupt when you cannot pay' };
      const D = G.debt; G.debt = null;
      bankrupt(G, i, D.to);
      if (!G.over) nextTurn(G);
      return { ok: true };
    }
    case 'propose': {
      if (!['roll', 'end'].includes(G.phase)) return { ok: false, err: 'You can trade before rolling or at the end of your turn' };
      if (G.trade) return { ok: false, err: 'An offer is already waiting for an answer' };
      const to = a.to;
      if (to === i || !G.players[to] || G.players[to].bankrupt) return { ok: false, err: 'Pick another player' };
      const give = a.give, get = a.get;
      if (!give.props.every(k => tradeable(G, i, k)) || !get.props.every(k => tradeable(G, to, k)))
        return { ok: false, err: 'Only properties without buildings in their colour group can be traded' };
      if (give.cash > p.cash) return { ok: false, err: 'You do not have that much money' };
      if (!give.props.length && !get.props.length) return { ok: false, err: 'Include at least one property' };
      G.trade = { from: i, to, give, get };
      log(G, nm(G, i) + ' makes an offer to ' + nm(G, to) + '.');
      return { ok: true };
    }
    case 'cancel': {
      if (!G.trade || G.trade.from !== i) return { ok: false, err: 'No offer to cancel' };
      G.trade = null; log(G, nm(G, i) + ' withdraws the offer.');
      return { ok: true };
    }
  }
  return { ok: false, err: 'Unknown action' };
}

// ---------- bots ----------
const tradeValue = (G, side) => side.cash + side.props.reduce((s, k) => s + BOARD[k].price, 0);

export function botMove(G, i) {
  const p = G.players[i];
  // Answer an offer made to this bot.
  if (G.trade && G.trade.to === i) {
    const T = G.trade;
    const breaksSet = T.get.props.some(k => BOARD[k].type === 'street' && ownsGroup(G, i, BOARD[k].group));
    const good = !breaksSet && tradeValue(G, T.give) >= tradeValue(G, T.get) * 1.3 && p.cash >= T.get.cash;
    return { t: good ? 'accept' : 'decline' };
  }
  if (G.turn !== i) return null;
  const mine = BOARD.map((s, k) => k).filter(k => G.owner[k] === i);
  switch (G.phase) {
    case 'debt': {
      if (p.cash >= G.debt.amount) return { t: 'payDebt' };
      const sell = mine.filter(k => canSell(G, i, k)).sort((a, b) => G.houses[b] - G.houses[a]);
      if (sell.length) return { t: 'sell', k: sell[0] };
      const mort = mine.filter(k => canMortgage(G, i, k)).sort((a, b) => BOARD[a].price - BOARD[b].price);
      if (mort.length) return { t: 'mortgage', k: mort[0] };
      return { t: 'bankrupt' };
    }
    case 'buy': {
      const sp = BOARD[p.pos];
      const completes = sp.type === 'street' && groupOf(sp.group).every(k => k === p.pos || G.owner[k] === i);
      return p.cash - sp.price >= (completes ? 0 : 120) ? { t: 'buy' } : { t: 'skip' };
    }
    case 'roll':
      if (p.inJail && p.jailCards) return { t: 'useCard' };
      if (p.inJail && p.cash >= 400) return { t: 'payJail' };
      return { t: 'roll' };
    case 'end': {
      const build = mine.filter(k => canBuild(G, i, k) && p.cash - GROUPS[BOARD[k].group].house >= 250)
        .sort((a, b) => G.houses[a] - G.houses[b] || BOARD[b].price - BOARD[a].price);
      if (build.length) return { t: 'build', k: build[0] };
      const lift = mine.filter(k => G.mortgaged[k] && p.cash - unmortgageCost(k) >= 500);
      if (lift.length) return { t: 'unmortgage', k: lift[0] };
      return { t: 'end' };
    }
  }
  return null;
}

// Public state (nothing in Investor is secret).
export function view(G) {
  return {
    players: G.players.map((p, i) => ({ name: p.name, bot: p.bot, cash: p.cash, pos: p.pos, inJail: p.inJail, jailTurns: p.jailTurns,
      jailCards: p.jailCards, bankrupt: p.bankrupt, worth: netWorth(G, i) })),
    owner: G.owner, houses: G.houses, mortgaged: G.mortgaged,
    turn: G.turn, phase: G.phase, dice: G.dice, rolledDouble: G.rolledDouble, debt: G.debt, card: G.card,
    trade: G.trade, log: G.log, over: G.over, winner: G.winner, ranking: G.ranking,
  };
}
