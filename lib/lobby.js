// Shared lobby: host creates a room with a PIN, players join with it.
// Uses Trystero (serverless signaling via public relays); the PIN is the room name.
import { joinRoom } from 'https://esm.sh/trystero/torrent';

const APP_ID = 'kavusiks-arcade-v1';

export function makePin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Returns { room, pin, isHost, send, on } where send/on are typed channels.
export function openLobby({ game, pin, isHost, name }) {
  const room = joinRoom({ appId: `${APP_ID}-${game}` }, pin);
  const [sendMsg, onMsg] = room.makeAction('msg');
  const [sendName, onName] = room.makeAction('name');

  const peers = new Map(); // peerId -> display name
  room.onPeerJoin(id => {
    peers.set(id, '?');
    sendName({ name }, id);
  });
  room.onPeerLeave(id => peers.delete(id));
  onName((data, id) => peers.set(id, String(data.name).slice(0, 20)));

  return {
    room,
    pin,
    isHost,
    peers,
    send: (data, peerId) => sendMsg(data, peerId),
    broadcast: data => sendMsg(data),
    onMessage: fn => onMsg(fn),
    leave: () => room.leave(),
  };
}
