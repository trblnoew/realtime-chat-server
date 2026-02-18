export const AUTH_COOKIE_KEY = 'rt_auth_user';

export const state = {
  userSyncTimer: null,
  currentUserId: null,
  currentMode: 'RT',
  currentRoute: { mode: 'RT' },
  activeRoomId: '',
  activeDmRoomId: '',
  unreadCount: 0,
  bUnreadCount: 0,
  pendingChannelFile: null,
  pendingDmFile: null,
  cachedChannels: [],
  cachedDmRooms: [],
  bDmSearchQuery: '',
  activeActionTab: 'friend',
  inviteAlarms: [],
  joinedRooms: new Set(),
  eventsBound: false,
  dmReadDebounceTimer: null,
};

export function isDmRoomId(roomId) {
  return String(roomId || '').startsWith('dm:');
}

export function getViewerId() {
  return (state.currentUserId || '').trim();
}

export function getInviteId(invite) {
  return String(invite?.id || invite?.inviteId || '').trim();
}

export function upsertInviteAlarm(invite) {
  const inviteId = getInviteId(invite);
  if (!inviteId) return;
  const normalized = { ...invite, id: inviteId };
  const index = state.inviteAlarms.findIndex(
    (item) => getInviteId(item) === inviteId,
  );
  if (index >= 0) {
    state.inviteAlarms[index] = normalized;
  } else {
    state.inviteAlarms.unshift(normalized);
  }
  if (state.inviteAlarms.length > 20) {
    state.inviteAlarms.length = 20;
  }
}

export function removeInviteById(inviteId) {
  const index = state.inviteAlarms.findIndex(
    (alarm) => getInviteId(alarm) === inviteId,
  );
  if (index >= 0) {
    state.inviteAlarms.splice(index, 1);
  }
}

export function clearInvites() {
  state.inviteAlarms.length = 0;
}

export function getUnreadCount(room) {
  const unreadCount = Number(room?.unreadCount ?? 0);
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) {
    return 0;
  }
  return unreadCount;
}

export function toShortPreview(textValue) {
  const clean = String(textValue || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 10) return clean || 'new';
  return `${clean.slice(0, 10)}...`;
}

export function resetJoinedRooms() {
  state.joinedRooms.clear();
}

export function resetLoggedOutState() {
  state.currentUserId = null;
  state.activeRoomId = '';
  state.activeDmRoomId = '';
  state.currentRoute = { mode: 'RT' };
  state.cachedChannels = [];
  state.cachedDmRooms = [];
  state.bDmSearchQuery = '';
  state.pendingChannelFile = null;
  state.pendingDmFile = null;
  state.unreadCount = 0;
  state.bUnreadCount = 0;
  state.dmReadDebounceTimer = null;
  resetJoinedRooms();
  clearInvites();
}
