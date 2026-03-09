import { elements } from './dom.js';
import {
  state,
  AUTH_TOKEN_KEY,
  AUTH_ERROR_KEY,
  isDmRoomId,
  getViewerId,
  toShortPreview,
  upsertInviteAlarm,
  removeInviteById,
  clearInvites,
  resetLoggedOutState,
  getOutboxForRoom,
  getRoomMessageStore,
  getMessageKey,
  getUserDisplayName,
} from './state.js';
import * as api from './api.js';
import {
  socket,
  bindSocketHandlers,
  joinRoomIfNeeded,
  clearJoinedRooms,
  emitMessageSend,
  emitMessageResync,
  setSocketAuthToken,
  connectSocket,
  disconnectSocket,
} from './socket.js';
import {
  isNearBottom,
  scrollToLatest,
  renderSimpleList,
  renderRoomMessages,
  renderOnlineUsers,
  renderInviteAlarms,
  renderDmList,
  resetDmRenderCache,
  renderFriendRequests,
} from './renderers.js';
import { parseRoute, buildPath, createRouter } from './router.js';

function getStoredAccessToken() {
  return String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
}

function storeAccessToken(token) {
  const value = String(token || '').trim();
  if (!value) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  localStorage.setItem(AUTH_TOKEN_KEY, value);
}

function rememberAuthError(message) {
  const value = String(message || '').trim();
  if (!value) return;
  sessionStorage.setItem(AUTH_ERROR_KEY, value);
}

function setAuthMessage(value) {
  if (elements.authMessage) {
    elements.authMessage.textContent = value;
  }
}

function setSocialStatus(value) {
  elements.socialStatus.textContent = value;
}

function setBStatus(value, tone = 'info') {
  const message = String(value || '').trim();
  elements.bStatus.textContent = message;
  elements.bStatus.classList.remove('warn');
  if (message && tone === 'warn') {
    elements.bStatus.classList.add('warn');
  }
}

function setAReadOnlyMode(readOnly) {
  const disabled = Boolean(readOnly);
  elements.text.disabled = disabled;
  elements.pickFileBtn.disabled = disabled;
  elements.send.disabled = disabled;
  elements.aActionBtn.disabled = disabled;
}

function isAllowedAppPath(path) {
  const value = String(path || '').trim();
  return value === '/rt' || value.startsWith('/a/') || value.startsWith('/b/');
}

function redirectToLogin(nextPath) {
  const fallbackPath = '/rt';
  const normalizedNext = isAllowedAppPath(nextPath) ? nextPath : fallbackPath;
  const query = `?next=${encodeURIComponent(normalizedNext)}`;
  location.assign(`/login${query}`);
}

const ACK_TIMEOUT_MS = 3000;
const MAX_RETRY = 3;

function createClientMsgId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildPendingStatusLabel(pending) {
  if (pending.status === 'failed') return 'failed';
  if (pending.status === 'retrying') return `retrying(${pending.attempt}/${MAX_RETRY})`;
  return 'sending';
}

function updateLastSeq(roomId, nextSeq) {
  const seq = Number(nextSeq || 0);
  if (!Number.isFinite(seq) || seq <= 0) return;
  const current = Number(state.lastSeqByRoom.get(roomId) || 0);
  if (seq > current) {
    state.lastSeqByRoom.set(roomId, seq);
  }
}

function getConfirmedMessages(roomId) {
  const store = getRoomMessageStore(roomId);
  if (!store) return [];
  return Array.from(store.values());
}

function getPendingMessages(roomId) {
  const outbox = getOutboxForRoom(roomId);
  if (!outbox) return [];
  const baseSeq = Number(state.lastSeqByRoom.get(roomId) || 0);
  let offset = 1;
  return Array.from(outbox.values()).map((pending) => {
    const normalized = {
      ...pending.payload,
      userId: getViewerId(),
      sentAt: pending.payload.sentAtClient,
      pendingStatus: buildPendingStatusLabel(pending),
      seq: baseSeq + offset,
    };
    offset += 1;
    return normalized;
  });
}

function buildRenderableMessages(roomId) {
  const deduped = new Map();
  getConfirmedMessages(roomId).forEach((message) => {
    deduped.set(getMessageKey(message), message);
  });
  getPendingMessages(roomId).forEach((message) => {
    const key = getMessageKey(message);
    if (!deduped.has(key)) {
      deduped.set(key, message);
    }
  });
  return Array.from(deduped.values());
}

function renderActiveChannelMessages() {
  if (!state.activeRoomId) {
    elements.messages.innerHTML = '';
    return;
  }
  renderRoomMessages(elements.messages, buildRenderableMessages(state.activeRoomId));
}

function renderActiveDmMessages() {
  if (!state.activeDmRoomId) {
    elements.bMessages.innerHTML = '';
    return;
  }
  renderRoomMessages(elements.bMessages, buildRenderableMessages(state.activeDmRoomId));
}

function clearPendingTimer(pending) {
  if (!pending?.timerId) return;
  clearTimeout(pending.timerId);
  pending.timerId = null;
}

function clearAllPendingTimers() {
  for (const outbox of state.pendingOutboxByRoom.values()) {
    outbox.forEach((pending) => clearPendingTimer(pending));
  }
}

function removePendingByClientMsgId(roomId, clientMsgId) {
  const outbox = getOutboxForRoom(roomId);
  if (!outbox) return;
  const pending = outbox.get(clientMsgId);
  if (!pending) return;
  clearPendingTimer(pending);
  outbox.delete(clientMsgId);
}

function mergeConfirmedMessage(payload) {
  if (!payload?.roomId) return;
  const store = getRoomMessageStore(payload.roomId);
  if (!store) return;
  store.set(getMessageKey(payload), payload);
  updateLastSeq(payload.roomId, payload.seq);
  removePendingByClientMsgId(payload.roomId, payload.clientMsgId);
}

function replaceRoomMessages(roomId, messages) {
  const store = getRoomMessageStore(roomId);
  if (!store) return;
  store.clear();
  (messages || []).forEach((message) => {
    store.set(getMessageKey(message), message);
    updateLastSeq(roomId, message.seq);
  });
}

function requestResync(roomId) {
  const normalizedRoomId = String(roomId || '').trim();
  if (!normalizedRoomId) return;
  emitMessageResync({
    roomId: normalizedRoomId,
    afterSeq: Number(state.lastSeqByRoom.get(normalizedRoomId) || 0),
  });
}

function scheduleMarkActiveDmRead() {
  if (!state.activeDmRoomId) return;
  if (state.dmReadDebounceTimer) {
    clearTimeout(state.dmReadDebounceTimer);
  }
  state.dmReadDebounceTimer = setTimeout(async () => {
    try {
      await api.markDirectRoomRead(state.activeDmRoomId);
      await refreshDmRooms();
    } catch {
      // noop
    }
  }, 300);
}

function setMode(mode) {
  state.currentMode = mode;
  elements.rtBtn.classList.toggle('active', mode === 'RT');
  elements.aBtn.classList.toggle('active', mode === 'A');
  elements.bBtn.classList.toggle('active', mode === 'B');

  elements.shell.classList.remove('mode-rt', 'mode-a', 'mode-b');
  elements.shell.classList.remove('b-drawer-open');
  if (mode === 'RT') {
    elements.shell.classList.add('mode-rt');
    elements.rtBadge.classList.add('hidden');
    return;
  }
  elements.shell.classList.add(mode === 'A' ? 'mode-a' : 'mode-b');
}

function setBDrawerOpen(open) {
  elements.shell.classList.toggle('b-drawer-open', Boolean(open));
}

function openActionModal(defaultTab = 'friend') {
  state.activeActionTab = defaultTab;
  elements.actionModal.classList.add('open');
  syncActionDefaultValues();
  renderActionTab();
  setActionError('');
}

function closeActionModal() {
  elements.actionModal.classList.remove('open');
  setActionError('');
}

function setActionError(message) {
  elements.actionError.textContent = message || '';
}

function syncActionDefaultValues() {
  elements.actionInviteRoomInput.value =
    state.activeRoomId || elements.actionInviteRoomInput.value || '';
}

function renderActionTab() {
  const tabButtons = Array.from(elements.actionTabs.querySelectorAll('[data-tab]'));
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeActionTab);
  });
  elements.actionPanelFriend.classList.toggle(
    'active',
    state.activeActionTab === 'friend',
  );
  elements.actionPanelRoom.classList.toggle('active', state.activeActionTab === 'room');
  elements.actionPanelInvite.classList.toggle(
    'active',
    state.activeActionTab === 'invite',
  );
}

function syncSocketAuthToken() {
  const token = getStoredAccessToken();
  api.setAccessToken(token);
  setSocketAuthToken(token);
}

function getActorId() {
  const value = (state.currentUserId || '').trim();
  if (!value) {
    setSocialStatus('Login first.');
    return null;
  }
  return value;
}

function applyLoggedInState(user) {
  const userIdValue = String(user?.id || '').trim();
  if (!userIdValue) return;
  state.currentUserId = userIdValue;
  const nickname = String(user?.nickname || '').trim();
  const email = String(user?.email || '').trim();
  const label = nickname || email || userIdValue;
  elements.sessionUserLabel.textContent = `Logged in as ${label}`;
  setAuthMessage('');
  syncSocketAuthToken();
}

function applyLoggedOutState() {
  clearAllPendingTimers();
  resetLoggedOutState();
  setAReadOnlyMode(true);
  elements.sessionUserLabel.textContent = 'Not logged in';
  setAuthMessage('Login required.');

  elements.roomList.innerHTML = '';
  elements.bFriendList.innerHTML = '';
  elements.bDmList.innerHTML = '';
  elements.bIncomingFriendRequestList.innerHTML = '';
  elements.bOutgoingFriendRequestList.innerHTML = '';
  elements.bRequestBadge.classList.add('hidden');
  elements.bDmSearchInput.value = '';
  elements.messages.innerHTML = '';
  elements.bMessages.innerHTML = '';
  elements.selectedFileLabel.textContent = '';
  elements.bSelectedFileLabel.textContent = '';
  elements.jumpLatest.classList.add('hidden');
  elements.bJumpLatest.classList.add('hidden');
  renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
  resetDmRenderCache();
}

async function hydrateUserProfiles() {
  try {
    const data = await api.getUsers();
    state.userProfileById.clear();
    (data.users || []).forEach((user) => {
      const id = String(user?.id || '').trim();
      if (!id) return;
      state.userProfileById.set(id, {
        nickname: String(user?.nickname || '').trim(),
        email: String(user?.email || '').trim(),
      });
    });
  } catch {
    // noop
  }
}

function hasMissingUserProfiles(users) {
  return (users || []).some((entry) => {
    const id = String(entry?.userId || '').trim();
    return id && !state.userProfileById.has(id);
  });
}

function showAEmptyState(message = 'No channel available') {
  state.activeRoomId = '';
  elements.currentRoom.textContent = 'Current room: -';
  elements.chatRoomTitle.textContent = '# no-channel';
  elements.text.value = '';
  elements.text.placeholder = 'No channel available';
  elements.messages.innerHTML = '';
  elements.selectedFileLabel.textContent = '';
  elements.jumpLatest.classList.add('hidden');
  setAReadOnlyMode(true);
  setSocialStatus(message);
}

function normalizeRooms(rooms) {
  return (rooms || []).map((room) => {
    if (typeof room === 'string') {
      return { roomId: room, type: isDmRoomId(room) ? 'dm' : 'channel' };
    }
    return room;
  });
}

async function loadRoomLogs(roomId, limit = 100) {
  const data = await api.getRoomMessages(roomId, limit);
  return data.messages || [];
}

async function refreshRooms() {
  const actor = getActorId();
  if (!actor) {
    state.cachedChannels = [];
    renderSimpleList(elements.roomList, [], 'Login required');
    return [];
  }

  const data = await api.getRooms();
  const rooms = normalizeRooms(data.rooms);
  const channels = rooms.filter((room) => room.type === 'channel');
  state.cachedChannels = channels;

  elements.roomList.innerHTML = '';
  if (!channels.length) {
    renderSimpleList(elements.roomList, [], 'No channels');
    return [];
  }

  channels.forEach((room) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `channel-button${room.roomId === state.activeRoomId ? ' active' : ''}`;
    btn.textContent = `# ${room.roomId}`;
    btn.addEventListener('click', async () => {
      await router.navigateTo({ mode: 'A', roomId: room.roomId });
    });
    li.appendChild(btn);
    elements.roomList.appendChild(li);
  });

  return channels;
}

async function refreshFriends() {
  const actor = getActorId();
  if (!actor) {
    state.cachedFriendIds.clear();
    return [];
  }

  const data = await api.getFriends(actor);
  const friends = data.friends || [];
  state.cachedFriendIds = new Set(friends);

  elements.bFriendList.innerHTML = '';
  if (!friends.length) {
    renderSimpleList(elements.bFriendList, [], 'No friends');
    return [];
  }

  friends.forEach((friendId) => {
    const li = document.createElement('li');
    li.className = 'friend-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'friend-item-btn';
    button.title = 'Click to open DM';
    button.textContent = `@ ${getUserDisplayName(friendId)}`;
    button.addEventListener('click', async () => {
      await router.navigateTo({ mode: 'B', peerUserId: friendId });
    });

    li.appendChild(button);
    elements.bFriendList.appendChild(li);
  });

  return friends;
}

async function refreshFriendRequests() {
  const actor = getActorId();
  if (!actor) {
    state.incomingFriendRequests = [];
    state.outgoingFriendRequests = [];
    renderFriendRequests({
      incoming: [],
      outgoing: [],
      onAccept: acceptFriendRequestAction,
      onReject: rejectFriendRequestAction,
    });
    return;
  }

  const [incomingData, outgoingData] = await Promise.all([
    api.getIncomingFriendRequests(),
    api.getOutgoingFriendRequests(),
  ]);
  state.incomingFriendRequests = incomingData.requests || [];
  state.outgoingFriendRequests = outgoingData.requests || [];
  state.friendRequestBadgeCount = state.incomingFriendRequests.length;
  renderFriendRequests({
    incoming: state.incomingFriendRequests,
    outgoing: state.outgoingFriendRequests,
    onAccept: acceptFriendRequestAction,
    onReject: rejectFriendRequestAction,
  });
}

async function acceptFriendRequestAction(requestId) {
  if (!requestId) return;
  try {
    await api.acceptFriendRequest(requestId);
    await hydrateUserProfiles();
    await refreshFriendRequests();
    await refreshFriends();
    await refreshDmRooms();
    setBStatus('Friend request accepted.');
  } catch (error) {
    setBStatus(error.message, 'warn');
  }
}

async function rejectFriendRequestAction(requestId) {
  if (!requestId) return;
  try {
    await api.rejectFriendRequest(requestId);
    await refreshFriendRequests();
    setBStatus('Friend request rejected.');
  } catch (error) {
    setBStatus(error.message, 'warn');
  }
}

function joinAllDmRooms(dmRooms) {
  dmRooms.forEach((room) => {
    if (room?.roomId) {
      joinRoomIfNeeded(room.roomId);
    }
  });
}

async function refreshDmRooms() {
  const actor = getActorId();
  if (!actor) {
    state.cachedDmRooms = [];
    elements.bDmList.innerHTML = '';
    return [];
  }

  const data = await api.getDirectRooms();
  const dmRooms = data.rooms || [];
  state.cachedDmRooms = dmRooms;
  joinAllDmRooms(dmRooms);

  renderDmList(dmRooms, async (peerUserId) => {
    await router.navigateTo({ mode: 'B', peerUserId });
    setBDrawerOpen(false);
  });

  return dmRooms;
}

async function refreshInvites() {
  const actor = (state.currentUserId || '').trim();
  if (!actor) {
    clearInvites();
    renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
    return [];
  }

  const data = await api.getInvites(actor);
  clearInvites();
  (data.invites || []).forEach((invite) => upsertInviteAlarm(invite));
  renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
  return state.inviteAlarms;
}

async function acceptInviteAction(inviteId) {
  if (!inviteId) return;
  try {
    await api.acceptInvite(inviteId, state.currentUserId);
    removeInviteById(inviteId);
    renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
    await refreshRooms();
    setAuthMessage('Invite accepted.');
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function rejectInviteAction(inviteId) {
  if (!inviteId) return;
  try {
    await api.rejectInvite(inviteId, state.currentUserId);
    removeInviteById(inviteId);
    renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
    setAuthMessage('Invite rejected.');
  } catch (error) {
    setAuthMessage(error.message);
  }
}

async function startDirectMessage(toUserId) {
  const target = String(toUserId || '').trim();
  if (!target) {
    throw new Error('peer user is required');
  }
  const data = await api.startDirectMessage(target);
  await refreshDmRooms();
  return {
    roomId: data.room.roomId,
    peerUserId: data.room.peerUserId || target,
  };
}

async function enterRoom(roomIdValue, options = {}) {
  const roomId = String(roomIdValue || '').trim();
  if (!roomId) return;

  state.activeRoomId = roomId;
  setAReadOnlyMode(false);
  elements.currentRoom.textContent = `Current room: ${roomId}`;
  elements.chatRoomTitle.textContent = `# ${roomId}`;
  elements.text.placeholder = `Message #${roomId}`;
  joinRoomIfNeeded(roomId);

  const logs = await loadRoomLogs(roomId);
  replaceRoomMessages(roomId, logs);
  renderActiveChannelMessages();
  requestResync(roomId);
  state.unreadCount = 0;
  elements.jumpLatest.classList.add('hidden');
  await refreshRooms();

  if (!options.silentRoute) {
    await router.navigateTo({ mode: 'A', roomId }, { silent: true });
  }
}

async function enterDmRoom(roomIdValue, peerUserId, options = {}) {
  const roomId = String(roomIdValue || '').trim();
  if (!roomId) return;

  state.activeDmRoomId = roomId;
  const normalizedPeerUserId = String(peerUserId || '').trim();
  const isFriend = state.cachedFriendIds.has(normalizedPeerUserId);
  const peerLabel = getUserDisplayName(normalizedPeerUserId);
  elements.bChatTitle.textContent = `@ ${getUserDisplayName(normalizedPeerUserId)}`;
  elements.bText.placeholder = `Message @${peerLabel}`;
  setBStatus(
    isFriend ? '' : 'You have not added this user as a friend yet.',
    isFriend ? 'info' : 'warn',
  );
  joinRoomIfNeeded(roomId);

  const logs = await loadRoomLogs(roomId);
  replaceRoomMessages(roomId, logs);
  renderActiveDmMessages();
  requestResync(roomId);
  try {
    await api.markDirectRoomRead(roomId);
  } catch {
    // noop
  }
  state.bUnreadCount = 0;
  elements.bJumpLatest.classList.add('hidden');
  await refreshDmRooms();

  if (!options.silentRoute) {
    await router.navigateTo({ mode: 'B', peerUserId }, { silent: true });
  }
}

async function submitActionTab() {
  const actor = getActorId();
  if (!actor) {
    setActionError('Login first.');
    return;
  }

  try {
    if (state.activeActionTab === 'friend') {
      const friendNickname = elements.actionFriendNicknameInput.value.trim();
      if (!friendNickname) {
        setActionError('friend nickname is required');
        return;
      }
      await api.createFriendRequest(friendNickname);
      elements.actionFriendNicknameInput.value = '';
      await hydrateUserProfiles();
      await refreshFriendRequests();
      setBStatus(`Request sent to @${friendNickname}`);
    }

    if (state.activeActionTab === 'room') {
      const roomIdValue = elements.actionRoomIdInput.value.trim();
      if (!roomIdValue) {
        setActionError('roomId is required');
        return;
      }
      await api.createRoom(roomIdValue, actor);
      elements.actionRoomIdInput.value = '';
      await router.navigateTo({ mode: 'A', roomId: roomIdValue });
      setSocialStatus(`Room created: ${roomIdValue}`);
    }

    if (state.activeActionTab === 'invite') {
      const roomIdValue =
        elements.actionInviteRoomInput.value.trim() || state.activeRoomId || 'lobby';
      const toNickname = elements.actionInviteToNicknameInput.value.trim();
      if (!toNickname) {
        setActionError('to nickname is required');
        return;
      }
      const data = await api.inviteToRoom(roomIdValue, toNickname);
      elements.actionInviteToNicknameInput.value = '';
      setSocialStatus(`Invite sent: ${data.invite.id.slice(0, 8)}`);
    }

    closeActionModal();
  } catch (error) {
    setActionError(error.message);
  }
}

function addChannelMessage(payload) {
  mergeConfirmedMessage(payload);
  if (payload.roomId !== state.activeRoomId) return;
  const shouldStickToBottom = isNearBottom(elements.messages);
  const mine = payload.userId === getViewerId();
  renderActiveChannelMessages();
  if (shouldStickToBottom) {
    scrollToLatest(elements.messages);
    state.unreadCount = 0;
    elements.jumpLatest.classList.add('hidden');
    return;
  }
  if (!mine) {
    state.unreadCount += 1;
    elements.jumpLatest.textContent = `${toShortPreview(payload.text)} (${state.unreadCount})`;
    elements.jumpLatest.classList.remove('hidden');
  }
}

function addDmMessage(payload) {
  mergeConfirmedMessage(payload);
  if (payload.roomId !== state.activeDmRoomId) return;
  const shouldStickToBottom = isNearBottom(elements.bMessages);
  const mine = payload.userId === getViewerId();
  renderActiveDmMessages();
  if (shouldStickToBottom) {
    scheduleMarkActiveDmRead();
    scrollToLatest(elements.bMessages);
    state.bUnreadCount = 0;
    elements.bJumpLatest.classList.add('hidden');
    return;
  }
  if (!mine) {
    state.bUnreadCount += 1;
    elements.bJumpLatest.textContent = `${toShortPreview(payload.text)} (${state.bUnreadCount})`;
    elements.bJumpLatest.classList.remove('hidden');
  }
}

async function handleRoute(route) {
  if (!state.currentUserId) {
    redirectToLogin(buildPath(route));
    return;
  }

  if (route.mode === 'RT') {
    setMode('RT');
    await refreshInvites();
    return;
  }

  if (route.mode === 'A') {
    setMode('A');
    const channels = await refreshRooms();
    const requested = route.roomId || channels[0]?.roomId;

    if (!requested) {
      showAEmptyState('No channel available');
      return;
    }

    const exists = channels.some((room) => room.roomId === requested);
    const fallbackRoomId = exists ? requested : channels[0]?.roomId;
    if (!fallbackRoomId) {
      showAEmptyState('No channel available');
      return;
    }

    if (!exists) {
      await router.navigateTo(
        { mode: 'A', roomId: fallbackRoomId },
        { replace: true, silent: true },
      );
    }

    await enterRoom(fallbackRoomId, { silentRoute: true });
    return;
  }

  if (route.mode === 'B') {
    setMode('B');
    setBDrawerOpen(false);
    await refreshFriendRequests();
    await refreshFriends();
    let dmRooms = await refreshDmRooms();

    let target = dmRooms.find((room) => room.peerUserId === route.peerUserId);
    if (!target && route.peerUserId) {
      try {
        const created = await startDirectMessage(route.peerUserId);
        dmRooms = await refreshDmRooms();
        target = dmRooms.find((room) => room.roomId === created.roomId);
      } catch {
        target = null;
      }
    }

    if (!target && dmRooms.length) {
      target = dmRooms[0];
      await router.navigateTo(
        { mode: 'B', peerUserId: target.peerUserId },
        { replace: true, silent: true },
      );
    }

    if (!target) {
      elements.bMessages.innerHTML = '';
      elements.bChatTitle.textContent = '@ select-friend';
      setBStatus('No DM room available. Add a friend first.', 'warn');
      return;
    }

    await enterDmRoom(target.roomId, target.peerUserId, { silentRoute: true });
    return;
  }

  setMode('RT');
}

const router = createRouter({
  handleRoute,
  setCurrentRoute: (route) => {
    state.currentRoute = route;
  },
});

async function bootstrapAuth() {
  const saved = getStoredAccessToken();
  if (!saved) {
    api.clearAccessToken();
    setSocketAuthToken('');
    applyLoggedOutState();
    return false;
  }

  try {
    api.setAccessToken(saved);
    setSocketAuthToken(saved);
    const data = await api.me();
    applyLoggedInState(data.user);
    await refreshInvites();
    return true;
  } catch (error) {
    rememberAuthError(error?.message || 'Session validation failed');
    api.clearAccessToken();
    setSocketAuthToken('');
    storeAccessToken('');
    applyLoggedOutState();
    return false;
  }
}

async function readSelectedFile(inputElement) {
  const file = inputElement.files && inputElement.files[0];
  if (!file) return null;

  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('File exceeds 5MB limit');
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  return {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
  };
}

function clearPendingFile(mode) {
  if (mode === 'A') {
    state.pendingChannelFile = null;
    elements.fileInput.value = '';
    elements.selectedFileLabel.textContent = '';
    return;
  }
  state.pendingDmFile = null;
  elements.bFileInput.value = '';
  elements.bSelectedFileLabel.textContent = '';
}

function schedulePendingRetry(roomId, clientMsgId) {
  const outbox = getOutboxForRoom(roomId);
  if (!outbox) return;
  const pending = outbox.get(clientMsgId);
  if (!pending) return;
  clearPendingTimer(pending);
  pending.timerId = setTimeout(() => {
    const currentOutbox = getOutboxForRoom(roomId);
    const currentPending = currentOutbox?.get(clientMsgId);
    if (!currentPending) return;
    if (currentPending.attempt >= MAX_RETRY) {
      currentPending.status = 'failed';
      currentPending.timerId = null;
      if (roomId === state.activeRoomId) renderActiveChannelMessages();
      if (roomId === state.activeDmRoomId) renderActiveDmMessages();
      return;
    }
    currentPending.attempt += 1;
    currentPending.status = 'retrying';
    emitMessageSend(currentPending.payload);
    schedulePendingRetry(roomId, clientMsgId);
    if (roomId === state.activeRoomId) renderActiveChannelMessages();
    if (roomId === state.activeDmRoomId) renderActiveDmMessages();
  }, ACK_TIMEOUT_MS);
}

function enqueueAndSendMessage(roomId, textValue, filePayload) {
  const normalizedRoomId = String(roomId || '').trim();
  if (!normalizedRoomId) return;
  const payload = {
    clientMsgId: createClientMsgId(),
    roomId: normalizedRoomId,
    text: String(textValue || '').trim(),
    sentAtClient: new Date().toISOString(),
    file: filePayload || undefined,
  };
  const outbox = getOutboxForRoom(normalizedRoomId);
  if (!outbox) return;
  outbox.set(payload.clientMsgId, {
    payload,
    status: 'sending',
    attempt: 1,
    createdAt: Date.now(),
    timerId: null,
  });
  emitMessageSend(payload);
  schedulePendingRetry(normalizedRoomId, payload.clientMsgId);
}

function resendAllPendingMessages() {
  for (const [roomId, outbox] of state.pendingOutboxByRoom.entries()) {
    outbox.forEach((pending, clientMsgId) => {
      if (pending.status === 'failed') return;
      pending.status = pending.attempt > 1 ? 'retrying' : 'sending';
      emitMessageSend(pending.payload);
      schedulePendingRetry(roomId, clientMsgId);
    });
  }
}

function bindEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;

  elements.send.addEventListener('click', () => {
    if (state.currentMode !== 'A' || !state.activeRoomId) return;
    const value = elements.text.value.trim();
    if (!value && !state.pendingChannelFile) return;

    enqueueAndSendMessage(
      state.activeRoomId,
      value,
      state.pendingChannelFile || undefined,
    );

    elements.text.value = '';
    clearPendingFile('A');
    renderActiveChannelMessages();
    elements.text.focus();
  });

  elements.bSend.addEventListener('click', () => {
    if (state.currentMode !== 'B' || !state.activeDmRoomId) return;
    const value = elements.bText.value.trim();
    if (!value && !state.pendingDmFile) return;

    enqueueAndSendMessage(
      state.activeDmRoomId,
      value,
      state.pendingDmFile || undefined,
    );

    elements.bText.value = '';
    clearPendingFile('B');
    renderActiveDmMessages();
    elements.bText.focus();
  });

  elements.text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.send.click();
  });

  elements.bText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.bSend.click();
  });

  elements.messages.addEventListener('scroll', () => {
    if (isNearBottom(elements.messages)) {
      state.unreadCount = 0;
      elements.jumpLatest.classList.add('hidden');
    }
  });

  elements.jumpLatest.addEventListener('click', () => {
    scrollToLatest(elements.messages);
    state.unreadCount = 0;
    elements.jumpLatest.classList.add('hidden');
  });

  elements.bMessages.addEventListener('scroll', () => {
    if (isNearBottom(elements.bMessages)) {
      state.bUnreadCount = 0;
      elements.bJumpLatest.classList.add('hidden');
      scheduleMarkActiveDmRead();
    }
  });

  elements.bJumpLatest.addEventListener('click', () => {
    scrollToLatest(elements.bMessages);
    state.bUnreadCount = 0;
    elements.bJumpLatest.classList.add('hidden');
    scheduleMarkActiveDmRead();
  });

  elements.refreshRoomsBtn.addEventListener('click', async () => {
    try {
      await refreshRooms();
      setSocialStatus('Rooms refreshed');
    } catch (error) {
      setSocialStatus(error.message);
    }
  });

  elements.aActionBtn.addEventListener('click', () => {
    openActionModal(state.activeRoomId ? 'invite' : 'room');
  });

  elements.bActionBtn.addEventListener('click', () => {
    openActionModal('friend');
  });

  elements.actionTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    state.activeActionTab = button.dataset.tab;
    renderActionTab();
    syncActionDefaultValues();
    setActionError('');
  });

  elements.actionSubmitBtn.addEventListener('click', async () => {
    await submitActionTab();
  });

  elements.actionCancelBtn.addEventListener('click', () => {
    closeActionModal();
  });

  elements.actionCloseBtn.addEventListener('click', () => {
    closeActionModal();
  });

  elements.actionModal.addEventListener('click', (event) => {
    if (event.target === elements.actionModal) {
      closeActionModal();
    }
  });

  elements.bDmSearchInput.addEventListener('input', () => {
    state.bDmSearchQuery = elements.bDmSearchInput.value || '';
    renderDmList(state.cachedDmRooms, async (peerUserId) => {
      await router.navigateTo({ mode: 'B', peerUserId });
      setBDrawerOpen(false);
    });
  });

  elements.bDrawerToggle.addEventListener('click', () => {
    const isOpen = elements.shell.classList.contains('b-drawer-open');
    setBDrawerOpen(!isOpen);
  });

  elements.bDrawerBackdrop.addEventListener('click', () => {
    setBDrawerOpen(false);
  });

  elements.logoutBtn.addEventListener('click', async () => {
    storeAccessToken('');
    api.clearAccessToken();
    setSocketAuthToken('');
    clearJoinedRooms();
    disconnectSocket();
    applyLoggedOutState();
    redirectToLogin('/rt');
  });

  elements.rtBtn.addEventListener('click', async () => {
    await router.navigateTo({ mode: 'RT' });
  });

  elements.aBtn.addEventListener('click', async () => {
    if (!state.currentUserId) {
      redirectToLogin('/rt');
      return;
    }

    const channels = await refreshRooms();
    if (channels.length) {
      await router.navigateTo({ mode: 'A', roomId: channels[0].roomId });
      return;
    }
    setMode('A');
    showAEmptyState('No channel available');
  });

  elements.bBtn.addEventListener('click', async () => {
    if (!state.currentUserId) {
      redirectToLogin('/rt');
      return;
    }

    const dmRooms = await refreshDmRooms();
    if (dmRooms.length) {
      await router.navigateTo({ mode: 'B', peerUserId: dmRooms[0].peerUserId });
      return;
    }

    await router.navigateTo({ mode: 'B' });
  });

  elements.pickFileBtn.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.bPickFileBtn.addEventListener('click', () => {
    elements.bFileInput.click();
  });

  elements.fileInput.addEventListener('change', async () => {
    try {
      state.pendingChannelFile = await readSelectedFile(elements.fileInput);
      elements.selectedFileLabel.textContent = state.pendingChannelFile
        ? `Selected: ${state.pendingChannelFile.name} (${Math.ceil(state.pendingChannelFile.size / 1024)} KB)`
        : '';
    } catch (error) {
      setSocialStatus(error.message);
      clearPendingFile('A');
    }
  });

  elements.bFileInput.addEventListener('change', async () => {
    try {
      state.pendingDmFile = await readSelectedFile(elements.bFileInput);
      elements.bSelectedFileLabel.textContent = state.pendingDmFile
        ? `Selected: ${state.pendingDmFile.name} (${Math.ceil(state.pendingDmFile.size / 1024)} KB)`
        : '';
    } catch (error) {
      setBStatus(error.message, 'warn');
      clearPendingFile('B');
    }
  });

  window.addEventListener('popstate', async () => {
    await router.navigateTo(parseRoute(location.pathname), {
      replace: true,
      silent: true,
    });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (elements.actionModal.classList.contains('open')) {
        closeActionModal();
        return;
      }
      setBDrawerOpen(false);
    }
  });
}

function bindSocket() {
  bindSocketHandlers({
    onConnect: () => {
      elements.status.textContent = 'Connected';
      hydrateUserProfiles().catch(() => {
        // noop
      });
      refreshFriendRequests().catch(() => {
        // noop
      });
      clearJoinedRooms();
      if (state.currentUserId) {
        if (state.activeRoomId) {
          joinRoomIfNeeded(state.activeRoomId);
          requestResync(state.activeRoomId);
        }
        if (state.activeDmRoomId) {
          joinRoomIfNeeded(state.activeDmRoomId);
          requestResync(state.activeDmRoomId);
        }
        joinAllDmRooms(state.cachedDmRooms);
        state.cachedDmRooms.forEach((room) => {
          if (room?.roomId) {
            requestResync(room.roomId);
          }
        });
        resendAllPendingMessages();
      }
    },
    onDisconnect: () => {
      elements.status.textContent = 'Disconnected';
    },
    onLegacyMessage: (payload) => {
      if (payload?.seq) {
        if (isDmRoomId(payload.roomId)) {
          addDmMessage(payload);
          refreshDmRooms().catch(() => {
            // noop
          });
          return;
        }
        addChannelMessage(payload);
      }
    },
    onMessageNew: (payload) => {
      if (isDmRoomId(payload.roomId)) {
        addDmMessage(payload);
        refreshDmRooms().catch(() => {
          // noop
        });
        return;
      }
      addChannelMessage(payload);
    },
    onMessageAck: (payload) => {
      const roomId = String(payload?.roomId || '').trim();
      const clientMsgId = String(payload?.clientMsgId || '').trim();
      if (!roomId || !clientMsgId) return;
      const outbox = getOutboxForRoom(roomId);
      const pending = outbox?.get(clientMsgId);
      if (!pending) return;
      if (payload.status === 'rejected') {
        clearPendingTimer(pending);
        pending.status = 'failed';
      } else {
        removePendingByClientMsgId(roomId, clientMsgId);
      }
      if (roomId === state.activeRoomId) renderActiveChannelMessages();
      if (roomId === state.activeDmRoomId) renderActiveDmMessages();
    },
    onMessageResyncResult: (payload) => {
      const roomId = String(payload?.roomId || '').trim();
      if (!roomId) return;
      (payload.messages || []).forEach((message) => {
        mergeConfirmedMessage(message);
      });
      if (roomId === state.activeRoomId) renderActiveChannelMessages();
      if (roomId === state.activeDmRoomId) renderActiveDmMessages();
    },
    onOnlineUsers: (users) => {
      if (hasMissingUserProfiles(users)) {
        hydrateUserProfiles().then(() => {
          renderOnlineUsers(users);
        }).catch(() => {
          // noop
        });
        return;
      }
      renderOnlineUsers(users);
    },
    onInviteAlarm: (alarm) => {
      upsertInviteAlarm(alarm);
      renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
    },
    onFriendRequestNew: () => {
      refreshFriendRequests().catch(() => {
        // noop
      });
    },
    onFriendRequestUpdated: () => {
      Promise.all([
        refreshFriendRequests(),
        refreshFriends(),
      ]).catch(() => {
        // noop
      });
    },
  });
}

export async function bootstrapApp() {
  bindEvents();
  bindSocket();
  api.setUnauthorizedHandler((message) => {
    rememberAuthError(message || 'Unauthorized');
    storeAccessToken('');
    api.clearAccessToken();
    setSocketAuthToken('');
    disconnectSocket();
    applyLoggedOutState();
    redirectToLogin(location.pathname);
  });
  renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
  applyLoggedOutState();
  setMode('RT');

  try {
    const ok = await bootstrapAuth();
    if (ok) {
      await hydrateUserProfiles();
      await refreshFriendRequests();
      connectSocket();
      await router.navigateTo(parseRoute(location.pathname), {
        replace: true,
        silent: true,
      });
    } else {
      redirectToLogin(location.pathname);
    }
  } catch {
    applyLoggedOutState();
    redirectToLogin(location.pathname);
  }
}
