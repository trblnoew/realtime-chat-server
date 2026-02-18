import { elements } from './dom.js';
import {
  state,
  AUTH_COOKIE_KEY,
  isDmRoomId,
  getViewerId,
  toShortPreview,
  upsertInviteAlarm,
  removeInviteById,
  clearInvites,
  resetLoggedOutState,
} from './state.js';
import * as api from './api.js';
import {
  socket,
  bindSocketHandlers,
  joinRoomIfNeeded,
  clearJoinedRooms,
} from './socket.js';
import {
  isNearBottom,
  scrollToLatest,
  createMessageNode,
  renderSimpleList,
  renderRoomMessages,
  renderOnlineUsers,
  renderInviteAlarms,
  renderDmList,
  resetDmRenderCache,
} from './renderers.js';
import { parseRoute, createRouter } from './router.js';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}

function clearCookie(name) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function setAuthMessage(value) {
  elements.authMessage.textContent = value;
}

function setSocialStatus(value) {
  elements.socialStatus.textContent = value;
}

function setBStatus(value) {
  elements.bStatus.textContent = value;
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

function syncUserName() {
  socket.emit('set_user', { userId: state.currentUserId || undefined });
}

function getActorId() {
  const value = (state.currentUserId || '').trim();
  if (!value) {
    setSocialStatus('Login first.');
    return null;
  }
  return value;
}

function applyLoggedInState(userIdValue) {
  state.currentUserId = userIdValue;
  elements.userId.value = userIdValue;
  elements.userId.readOnly = true;
  elements.authCard.classList.add('hidden');
  elements.sessionUserLabel.textContent = `Logged in as ${userIdValue}`;
  setAuthMessage('');
  syncUserName();
}

function applyLoggedOutState() {
  resetLoggedOutState();
  elements.userId.value = '';
  elements.userId.readOnly = true;
  elements.authCard.classList.remove('hidden');
  elements.sessionUserLabel.textContent = 'Not logged in';
  setAuthMessage('Login required to enter chat.');

  elements.roomList.innerHTML = '';
  elements.bFriendList.innerHTML = '';
  elements.bDmList.innerHTML = '';
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

function redirectToRtWithMessage(message) {
  setAuthMessage(message || 'Login required.');
  return router.navigateTo({ mode: 'RT' }, { replace: true });
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
  if (!actor) return [];

  const data = await api.getFriends(actor);
  const friends = data.friends || [];

  elements.bFriendList.innerHTML = '';
  if (!friends.length) {
    renderSimpleList(elements.bFriendList, [], 'No friends');
    return [];
  }

  friends.forEach((friendId) => {
    const li = document.createElement('li');
    li.className = 'friend-row';

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = friendId;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tiny-btn';
    btn.textContent = 'DM';
    btn.addEventListener('click', async () => {
      await router.navigateTo({ mode: 'B', peerUserId: friendId });
    });

    li.appendChild(name);
    li.appendChild(btn);
    elements.bFriendList.appendChild(li);
  });

  return friends;
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
  elements.currentRoom.textContent = `Current room: ${roomId}`;
  elements.chatRoomTitle.textContent = `# ${roomId}`;
  elements.text.placeholder = `Message #${roomId}`;
  joinRoomIfNeeded(roomId);

  const logs = await loadRoomLogs(roomId);
  renderRoomMessages(elements.messages, logs);
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
  elements.bChatTitle.textContent = `@ ${peerUserId}`;
  elements.bText.placeholder = `Message @${peerUserId}`;
  joinRoomIfNeeded(roomId);

  const logs = await loadRoomLogs(roomId);
  renderRoomMessages(elements.bMessages, logs);
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
      const friendId = elements.actionFriendIdInput.value.trim();
      if (!friendId) {
        setActionError('friend userId is required');
        return;
      }
      await api.addFriend(actor, friendId);
      elements.actionFriendIdInput.value = '';
      await refreshFriends();
      setBStatus(`Friend added: ${friendId}`);
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
      const toUserId = elements.actionInviteToInput.value.trim();
      if (!toUserId) {
        setActionError('to userId is required');
        return;
      }
      const data = await api.inviteToRoom(roomIdValue, actor, toUserId);
      elements.actionInviteToInput.value = '';
      setSocialStatus(`Invite sent: ${data.invite.id.slice(0, 8)}`);
    }

    closeActionModal();
  } catch (error) {
    setActionError(error.message);
  }
}

function addChannelMessage(payload) {
  if (payload.roomId !== state.activeRoomId) return;

  const shouldStickToBottom = isNearBottom(elements.messages);
  const mine = payload.userId === getViewerId();
  elements.messages.appendChild(createMessageNode(payload));

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
  if (payload.roomId !== state.activeDmRoomId) return;
  const shouldStickToBottom = isNearBottom(elements.bMessages);
  const mine = payload.userId === getViewerId();
  elements.bMessages.appendChild(createMessageNode(payload));
  if (shouldStickToBottom) {
    scheduleMarkActiveDmRead();
  }
  if (shouldStickToBottom) {
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
  if (!state.currentUserId && route.mode !== 'RT') {
    await redirectToRtWithMessage('Login required before entering chat.');
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
      elements.currentRoom.textContent = 'Current room: -';
      elements.chatRoomTitle.textContent = '# no-channel';
      elements.messages.innerHTML = '';
      setSocialStatus('No channel available. Create one first.');
      await router.navigateTo({ mode: 'RT' }, { replace: true, silent: true });
      setMode('RT');
      return;
    }

    const exists = channels.some((room) => room.roomId === requested);
    const fallbackRoomId = exists ? requested : channels[0]?.roomId;
    if (!fallbackRoomId) {
      await router.navigateTo({ mode: 'RT' }, { replace: true, silent: true });
      setMode('RT');
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
      setBStatus('No DM room available. Add a friend first.');
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
  const saved = decodeURIComponent(getCookie(AUTH_COOKIE_KEY) || '');
  if (!saved) {
    applyLoggedOutState();
    return false;
  }

  try {
    const userIdValue = await api.login(saved);
    applyLoggedInState(userIdValue);
    setCookie(AUTH_COOKIE_KEY, userIdValue);
    await refreshInvites();
    return true;
  } catch {
    clearCookie(AUTH_COOKIE_KEY);
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

function bindEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;

  elements.send.addEventListener('click', () => {
    if (state.currentMode !== 'A' || !state.activeRoomId) return;
    const value = elements.text.value.trim();
    if (!value && !state.pendingChannelFile) return;

    socket.emit('message', {
      text: value,
      roomId: state.activeRoomId,
      file: state.pendingChannelFile || undefined,
    });

    elements.text.value = '';
    clearPendingFile('A');
    elements.text.focus();
  });

  elements.bSend.addEventListener('click', () => {
    if (state.currentMode !== 'B' || !state.activeDmRoomId) return;
    const value = elements.bText.value.trim();
    if (!value && !state.pendingDmFile) return;

    socket.emit('message', {
      text: value,
      roomId: state.activeDmRoomId,
      file: state.pendingDmFile || undefined,
    });

    elements.bText.value = '';
    clearPendingFile('B');
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

  elements.signupBtn.addEventListener('click', async () => {
    const candidate = elements.authUserIdInput.value.trim();
    if (!candidate) {
      setAuthMessage('Enter an ID first.');
      return;
    }

    try {
      const userIdValue = await api.signup(candidate);
      setCookie(AUTH_COOKIE_KEY, userIdValue);
      applyLoggedInState(userIdValue);
      setAuthMessage('Signup complete.');
      await refreshInvites();
      await router.navigateTo(parseRoute(location.pathname), { replace: true });
    } catch (error) {
      setAuthMessage(error.message);
    }
  });

  elements.loginBtn.addEventListener('click', async () => {
    const candidate = elements.authUserIdInput.value.trim();
    if (!candidate) {
      setAuthMessage('Enter an ID first.');
      return;
    }

    try {
      const userIdValue = await api.login(candidate);
      setCookie(AUTH_COOKIE_KEY, userIdValue);
      applyLoggedInState(userIdValue);
      setAuthMessage('Login success.');
      await refreshInvites();
      await router.navigateTo(parseRoute(location.pathname), { replace: true });
    } catch (error) {
      setAuthMessage(error.message);
    }
  });

  elements.logoutBtn.addEventListener('click', async () => {
    clearCookie(AUTH_COOKIE_KEY);
    socket.emit('set_user', { userId: '' });
    clearJoinedRooms();
    applyLoggedOutState();
    await router.navigateTo({ mode: 'RT' }, { replace: true });
  });

  elements.rtBtn.addEventListener('click', async () => {
    await router.navigateTo({ mode: 'RT' });
  });

  elements.aBtn.addEventListener('click', async () => {
    if (!state.currentUserId) {
      await redirectToRtWithMessage('Login required before entering chat.');
      return;
    }

    const channels = await refreshRooms();
    if (!channels.length) {
      setSocialStatus('No channel available. Create one first.');
      await router.navigateTo({ mode: 'RT' });
      return;
    }
    await router.navigateTo({ mode: 'A', roomId: channels[0].roomId });
  });

  elements.bBtn.addEventListener('click', async () => {
    if (!state.currentUserId) {
      await redirectToRtWithMessage('Login required before entering DM.');
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
      setBStatus(error.message);
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
      elements.status.textContent = `Connected as ${socket.id.slice(0, 8)}`;
      clearJoinedRooms();
      if (state.currentUserId) {
        syncUserName();
        if (state.activeRoomId) {
          joinRoomIfNeeded(state.activeRoomId);
        }
        if (state.activeDmRoomId) {
          joinRoomIfNeeded(state.activeDmRoomId);
        }
        joinAllDmRooms(state.cachedDmRooms);
      }
    },
    onDisconnect: () => {
      elements.status.textContent = 'Disconnected';
    },
    onMessage: (payload) => {
      if (isDmRoomId(payload.roomId)) {
        addDmMessage(payload);
        refreshDmRooms().catch(() => {
          // noop
        });
        return;
      }
      addChannelMessage(payload);
    },
    onOnlineUsers: (users) => {
      renderOnlineUsers(users);
    },
    onInviteAlarm: (alarm) => {
      upsertInviteAlarm(alarm);
      renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
    },
  });
}

export async function bootstrapApp() {
  bindEvents();
  bindSocket();
  renderInviteAlarms({ onAccept: acceptInviteAction, onReject: rejectInviteAction });
  applyLoggedOutState();
  setMode('RT');

  try {
    const ok = await bootstrapAuth();
    if (ok) {
      await router.navigateTo(parseRoute(location.pathname), {
        replace: true,
        silent: true,
      });
    } else {
      await router.navigateTo({ mode: 'RT' }, { replace: true, silent: true });
    }
  } catch {
    applyLoggedOutState();
    await router.navigateTo({ mode: 'RT' }, { replace: true, silent: true });
  }
}
