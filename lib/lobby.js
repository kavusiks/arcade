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
const { joinRoom, selfId } = mod;
const getRelaySockets = mod.getRelaySockets || (() => ({}));

const APP_ID = 'kavusiks-arcade-v3';

export function makePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function openLobby({ game, pin, isHost, name }) {
  const room = joinRoom({ appId: `${APP_ID}-${game}` }, pin);
  const msg = room.makeAction('msg');
  const nameAction = room.makeAction('name');

  const peers = new Map(); // peerId -> display name
  room.onPeerJoin = id => {
    peers.set(id, '?');
    nameAction.send({ name }, { target: id });
  };
  room.onPeerLeave = id => peers.delete(id);
  nameAction.onMessage = (data, { peerId }) => peers.set(peerId, String(data && data.name).slice(0, 20));

  return {
    room,
    pin,
    isHost,
    peers,
    send: (data, peerId) => msg.send(data, { target: peerId }),
    broadcast: data => msg.send(data),
    onMessage: fn => { msg.onMessage = (data, { peerId }) => fn(data, peerId); },
    leave: () => room.leave(),
    // Diagnostics: how many signaling relays are connected.
    relayStatus: () => {
      try {
        const socks = Object.values(getRelaySockets() || {});
        const open = socks.filter(w => w && w.readyState === 1).length;
        return strategy + ': ' + open + '/' + socks.length + ' relays connected';
      } catch (e) { return 'relay status unavailable'; }
    },
    selfId,
  };
}
