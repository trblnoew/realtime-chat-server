let accessToken = '';
let unauthorizedHandler = null;

export function setAccessToken(token) {
  accessToken = String(token || '').trim();
}

export function clearAccessToken() {
  accessToken = '';
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

export async function apiRequest(path, method, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const message = payload.message || payload.msg || payload.error_description || response.statusText || 'Request failed';

  if (response.status === 401 && unauthorizedHandler) {
    unauthorizedHandler(Array.isArray(message) ? message.join(', ') : String(message));
  }

  if (!response.ok) {
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return payload;
}

export async function signup(email, password, nickname) {
  const data = await apiRequest('/auth/signup', 'POST', { email, password, nickname });
  return data.user;
}

export async function login(email, password) {
  return apiRequest('/auth/login', 'POST', { email, password });
}

export async function me() {
  return apiRequest('/auth/me', 'GET');
}

export async function getUsers() {
  return apiRequest('/auth/users', 'GET');
}

export async function getRooms() {
  return apiRequest('/social/rooms', 'GET');
}

export async function getRoomMessages(roomId, limit = 100, afterSeq) {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (Number.isFinite(afterSeq) && afterSeq >= 0) {
    query.set('afterSeq', String(Math.floor(afterSeq)));
  }
  return apiRequest(
    `/social/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`,
    'GET',
  );
}

export async function createRoom(roomId, ownerUserId) {
  return apiRequest('/social/rooms', 'POST', { roomId, ownerUserId });
}

export async function inviteToRoom(roomId, toNickname) {
  return apiRequest('/social/rooms/invite', 'POST', { roomId, toNickname });
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

export async function addFriend(friendNickname) {
  return createFriendRequest(friendNickname);
}

export async function createFriendRequest(toNickname) {
  return apiRequest('/social/friend-requests', 'POST', { toNickname });
}

export async function getIncomingFriendRequests() {
  return apiRequest('/social/friend-requests/incoming', 'GET');
}

export async function getOutgoingFriendRequests() {
  return apiRequest('/social/friend-requests/outgoing', 'GET');
}

export async function acceptFriendRequest(requestId) {
  return apiRequest(
    `/social/friend-requests/${encodeURIComponent(requestId)}/accept`,
    'POST',
  );
}

export async function rejectFriendRequest(requestId) {
  return apiRequest(
    `/social/friend-requests/${encodeURIComponent(requestId)}/reject`,
    'POST',
  );
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
