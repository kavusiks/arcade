// Investor board: 40 spaces, original street names and card texts.
// Groups: 8 colour groups of streets, 4 stations, 2 utilities.

export const GROUPS = {
  brown:  { color: '#8d5524', house: 50 },
  sky:    { color: '#81d4fa', house: 50 },
  pink:   { color: '#ec407a', house: 100 },
  orange: { color: '#ff9800', house: 100 },
  red:    { color: '#e53935', house: 150 },
  yellow: { color: '#fdd835', house: 150 },
  green:  { color: '#43a047', house: 200 },
  navy:   { color: '#283593', house: 200 },
};

// Rent for 0–4 houses and a hotel, scaled from the base rent.
const MULT = [1, 5, 15, 40, 52, 65];
const street = (name, short, group, price) => {
  const base = Math.ceil(price / 24) * 2;
  return { type: 'street', name, short, group, price, rents: MULT.map(m => base * m) };
};
const station = (name, short) => ({ type: 'station', name, short, price: 200 });
const utility = (name, short) => ({ type: 'utility', name, short, price: 150 });

export const BOARD = [
  { type: 'start', name: 'Start', short: 'START' },
  street('Pebble Lane', 'Pebble', 'brown', 60),
  { type: 'bonus', name: 'Bonus', short: 'Bonus' },
  street('Cobble Row', 'Cobble', 'brown', 60),
  { type: 'tax', name: 'Income Tax', short: 'Tax', amount: 200 },
  station('North Station', 'N Stn'),
  street('Harbour View', 'Harbour', 'sky', 100),
  { type: 'luck', name: 'Luck', short: 'Luck' },
  street('Pier Road', 'Pier', 'sky', 100),
  street('Lighthouse Lane', 'Lighths', 'sky', 120),
  { type: 'jail', name: 'Jail / Just visiting', short: 'Jail' },
  street('Market Square', 'Market', 'pink', 140),
  utility('Power Plant', 'Power'),
  street("Baker's Row", 'Baker', 'pink', 140),
  street('Clocktower Street', 'Clock', 'pink', 160),
  station('East Station', 'E Stn'),
  street('Riverside', 'River', 'orange', 180),
  { type: 'bonus', name: 'Bonus', short: 'Bonus' },
  street('Willow Avenue', 'Willow', 'orange', 180),
  street('Maple Drive', 'Maple', 'orange', 200),
  { type: 'rest', name: 'Rest area', short: 'Rest' },
  street('Theatre Row', 'Theatre', 'red', 220),
  { type: 'luck', name: 'Luck', short: 'Luck' },
  street('Gallery Street', 'Gallery', 'red', 220),
  street('Opera Square', 'Opera', 'red', 240),
  station('South Station', 'S Stn'),
  street('Golden Mile', 'Golden', 'yellow', 260),
  street('Sunrise Avenue', 'Sunrise', 'yellow', 260),
  utility('Water Works', 'Water'),
  street('Crescent Park', 'Crescnt', 'yellow', 280),
  { type: 'gotojail', name: 'Go to jail', short: 'To jail' },
  street('Garden Terrace', 'Garden', 'green', 300),
  street('Orchard Hill', 'Orchard', 'green', 300),
  { type: 'bonus', name: 'Bonus', short: 'Bonus' },
  street('Ivy Gardens', 'Ivy', 'green', 320),
  station('West Station', 'W Stn'),
  { type: 'luck', name: 'Luck', short: 'Luck' },
  street('Skyline Heights', 'Skyline', 'navy', 350),
  { type: 'tax', name: 'Luxury Tax', short: 'Lux tax', amount: 100 },
  street('Summit Plaza', 'Summit', 'navy', 400),
];

export const START_CASH = 1500, PASS_START = 200, JAIL = 10, JAIL_FINE = 50;
export const isOwnable = sp => sp.type === 'street' || sp.type === 'station' || sp.type === 'utility';
export const groupOf = g => BOARD.map((s, i) => i).filter(i => BOARD[i].group === g);
export const STATIONS = BOARD.map((s, i) => i).filter(i => BOARD[i].type === 'station');
export const UTILITIES = BOARD.map((s, i) => i).filter(i => BOARD[i].type === 'utility');

// Card effects: money (+/-), move to a space, move back, jail, keep-out-of-jail card,
// repairs per house/hotel, collect from every other player.
export const LUCK = [
  { text: 'Advance to Start.', to: 0 },
  { text: 'Take a trip to Opera Square.', to: 24 },
  { text: 'Treat yourself to a stroll on Summit Plaza.', to: 39 },
  { text: 'Catch a train from North Station.', to: 5 },
  { text: 'Visit Market Square.', to: 11 },
  { text: 'You took a wrong turn. Go back 3 spaces.', back: 3 },
  { text: 'Caught speeding. Go to jail.', jail: true },
  { text: 'Keep this card: get out of jail free.', jailCard: true },
  { text: 'Your shares paid a dividend. Collect 50.', money: 50 },
  { text: 'Parking ticket. Pay 15.', money: -15 },
  { text: 'Your building loan matures. Collect 150.', money: 150 },
  { text: 'Roof repairs: pay 25 per house and 100 per hotel.', repairs: [25, 100] },
  { text: 'You won a crossword competition. Collect 100.', money: 100 },
  { text: 'Pay for a weekend course: 50.', money: -50 },
];
export const BONUS = [
  { text: 'Advance to Start.', to: 0 },
  { text: 'Your app went viral. Collect 200.', money: 200 },
  { text: 'Phone screen repair. Pay 50.', money: -50 },
  { text: 'Sold your old bike. Collect 50.', money: 50 },
  { text: 'Keep this card: get out of jail free.', jailCard: true },
  { text: 'Forgot to pay a fine. Go to jail.', jail: true },
  { text: 'Holiday savings pay out. Collect 100.', money: 100 },
  { text: 'Tax refund. Collect 20.', money: 20 },
  { text: "It's your birthday! Collect 10 from every player.", fromEach: 10 },
  { text: 'Freelance job done. Collect 100.', money: 100 },
  { text: 'Car service. Pay 100.', money: -100 },
  { text: 'Course fees. Pay 50.', money: -50 },
  { text: 'You gave some advice. Collect 25.', money: 25 },
  { text: 'Street works: pay 40 per house and 115 per hotel.', repairs: [40, 115] },
  { text: 'You won second prize in a quiz. Collect 10.', money: 10 },
  { text: 'A distant relative left you 100.', money: 100 },
];
