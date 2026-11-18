// Shared lobby: host creates a room with a PIN, players join with it.
// Uses Trystero (serverless signaling via public relays); the PIN is the room name.
// Written for trystero 0.25.x (Nostr strategy): makeAction returns an object, handlers are properties.
import { joinRoom } from 'https://esm.run/trystero@0.25.4';

const APP_ID = 'kavusiks-arcade-v2';

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
  nameAction.onMessage = (data, { peerId }) => peers.set(peerId, String(data.name).slice(0, 20));

  return {
    room,
    pin,
    isHost,
    peers,
    send: (data, peerId) => msg.send(data, { target: peerId }),
    broadcast: data => msg.send(data),
    onMessage: fn => { msg.onMessage = (data, { peerId }) => fn(data, peerId); },
    leave: () => room.leave(),
  };
}
