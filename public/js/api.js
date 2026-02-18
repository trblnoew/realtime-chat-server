export async function apiRequest(path, method, body) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const message = payload.message || response.statusText || 'Request failed';
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return payload;
}

export async function signup(userId) {
  const data = await apiRequest('/auth/signup', 'POST', { userId });
  return data.userId;
}

export async function login(userId) {
  const data = await apiRequest('/auth/login', 'POST', { userId });
  return data.userId;
}

export async function getRooms() {
  return apiRequest('/social/rooms', 'GET');
}

export async function getRoomMessages(roomId, limit = 100) {
  return apiRequest(
    `/social/rooms/${encodeURIComponent(roomId)}/messages?limit=${limit}`,
    'GET',
  );
}

export async function createRoom(roomId, ownerUserId) {
  return apiRequest('/social/rooms', 'POST', { roomId, ownerUserId });
}

export async function inviteToRoom(roomId, fromUserId, toUserId) {
  return apiRequest('/social/rooms/invite', 'POST', { roomId, fromUserId, toUserId });
}

export async function acceptInvite(inviteId, userId) {
  return apiRequest('/social/rooms/invite/accept', 'POST', { inviteId, userId });
}

export async function rejectInvite(inviteId, userId) {
  return apiRequest('/social/rooms/invite/reject', 'POST', { inviteId, userId });
}

export async function getInvites(userId) {
  return apiRequest(`/social/invites/${encodeURIComponent(userId)}`, 'GET');
}

export async function getFriends(userId) {
  return apiRequest(`/social/friends/${encodeURIComponent(userId)}`, 'GET');
}

export async function addFriend(userId, friendId) {
  return apiRequest('/social/friends', 'POST', { userId, friendId });
}

export async function startDirectMessage(toUserId) {
  return apiRequest('/social/dm/start', 'POST', { toUserId });
}

export async function getDirectRooms() {
  return apiRequest('/social/dm/rooms', 'GET');
}

export async function markDirectRoomRead(roomId) {
  return apiRequest(`/social/dm/rooms/${encodeURIComponent(roomId)}/read`, 'POST');
}
