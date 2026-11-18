// Shared lobby: host creates a room with a PIN, players join with it.
// Uses Trystero (serverless signaling via public relays); the PIN is the room name.
// Written for trystero 0.25.x: makeAction returns an object, handlers are properties.
// Signaling network is chosen with ?s=mqtt | nostr | torrent (default mqtt). All players must use the same one.
const STRATEGIES = {
  mqtt: 'https://esm.run/@trystero-p2p/mqtt@0.25',
  nostr: 'https://esm.run/trystero@0.25',
  torrent: 'https://esm.run/@trystero-p2p/torrent@0.25',
};
const wanted = new URLSearchParams(location.search).get('s');
export const strategy = STRATEGIES[wanted] ? wanted : 'mqtt';
const mod = await import(STRATEGIES[strategy]);
const { joinRoom } = mod;

const APP_ID = 'kavusiks-arcade-v3';

export function makePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// info: { name, key, host } is sent to every peer that connects.
// Events (set with on()): join(peerId, info), leave(peerId, info), message(data, peerId).
export function openLobby({ game, pin, info }) {
  const room = joinRoom({ appId: `${APP_ID}-${game}` }, pin);
  const msg = room.makeAction('msg');
  const hello = room.makeAction('hello');
  const peers = new Map(); // peerId -> { name, key, host }
  const handlers = { join() {}, leave() {}, message() {} };

  room.onPeerJoin = id => hello.send(info, { target: id });
  room.onPeerLeave = id => {
    const p = peers.get(id);
    peers.delete(id);
    handlers.leave(id, p);
  };
  hello.onMessage = (data, { peerId }) => {
    if (!data || typeof data !== 'object') return;
    const p = {
      name: String(data.name ?? '').slice(0, 20) || 'Player',
      key: String(data.key ?? '').slice(0, 40),
      host: !!data.host,
    };
    peers.set(peerId, p);
    handlers.join(peerId, p);
  };
  msg.onMessage = (data, { peerId }) => handlers.message(data, peerId);

  return {
    pin,
    peers,
    on: (event, fn) => { handlers[event] = fn; },
    send: (data, peerId) => msg.send(data, { target: peerId }),
    broadcast: data => msg.send(data),
    leave: () => room.leave(),
  };
}
