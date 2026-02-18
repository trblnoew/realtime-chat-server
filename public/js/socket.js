import { state } from './state.js';

export const socket = io();

export function joinRoomIfNeeded(roomId) {
  const normalizedRoomId = String(roomId || '').trim();
  if (!normalizedRoomId) return;
  if (state.joinedRooms.has(normalizedRoomId)) return;
  socket.emit('join_room', { roomId: normalizedRoomId });
  state.joinedRooms.add(normalizedRoomId);
}

export function clearJoinedRooms() {
  state.joinedRooms.clear();
}

export function bindSocketHandlers(handlers) {
  socket.on('connect', () => {
    handlers.onConnect();
  });

  socket.on('disconnect', () => {
    handlers.onDisconnect();
  });

  socket.on('message', (payload) => {
    handlers.onMessage(payload);
  });

  socket.on('online_users', (users) => {
    handlers.onOnlineUsers(users);
  });

  socket.on('invite_alarm', (alarm) => {
    handlers.onInviteAlarm(alarm);
  });
}
