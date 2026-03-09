import { state } from './state.js';

export const socket = io({
  autoConnect: false,
});

export function setSocketAuthToken(token) {
  const normalized = String(token || '').trim();
  socket.auth = normalized ? { token: normalized } : {};
}

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
}

export function reconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}

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

  socket.on('friend_request_new', (payload) => {
    handlers.onFriendRequestNew(payload);
  });

  socket.on('friend_request_updated', (payload) => {
    handlers.onFriendRequestUpdated(payload);
  });
}
