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

export function emitMessageSend(payload) {
  socket.emit('message_send', payload);
}

export function emitMessageResync(payload) {
  socket.emit('message_resync', payload);
}

export function bindSocketHandlers(handlers) {
  socket.on('connect', () => {
    handlers.onConnect();
  });

  socket.on('disconnect', () => {
    handlers.onDisconnect();
  });

  socket.on('message', (payload) => {
    handlers.onLegacyMessage(payload);
  });

  socket.on('message_new', (payload) => {
    handlers.onMessageNew(payload);
  });

  socket.on('message_ack', (payload) => {
    handlers.onMessageAck(payload);
  });

  socket.on('message_resync_result', (payload) => {
    handlers.onMessageResyncResult(payload);
  });

  socket.on('online_users', (users) => {
    handlers.onOnlineUsers(users);
  });

  socket.on('invite_alarm', (alarm) => {
    handlers.onInviteAlarm(alarm);
  });
}
