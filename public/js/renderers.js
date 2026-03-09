import { elements } from './dom.js';
import {
  state,
  getViewerId,
  getUserDisplayName,
  toShortPreview,
  getUnreadCount,
  getInviteId,
} from './state.js';

export function isNearBottom(container) {
  const threshold = 40;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

export function scrollToLatest(container) {
  container.scrollTop = container.scrollHeight;
}

export function createMessageNode(payload) {
  const mine = payload.userId === getViewerId();
  const role = mine ? 'me' : 'peer';
  const senderLabel = mine ? 'me' : getUserDisplayName(payload.userId);

  const wrapper = document.createElement('article');
  wrapper.className = `msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  const textNode = document.createElement('div');
  textNode.className = 'text';
  textNode.textContent = payload.text;
  bubble.appendChild(textNode);

  if (payload.file?.name && payload.file?.dataUrl) {
    const link = document.createElement('a');
    link.className = 'file-link';
    link.href = payload.file.dataUrl;
    link.download = payload.file.name;
    link.target = '_blank';
    link.textContent = `Attachment: ${payload.file.name}`;
    bubble.appendChild(link);

    if (String(payload.file.mimeType || '').startsWith('image/')) {
      const preview = document.createElement('img');
      preview.className = 'file-preview';
      preview.src = payload.file.dataUrl;
      preview.alt = payload.file.name;
      bubble.appendChild(preview);
    }
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (payload.pendingStatus) {
    meta.textContent = `${senderLabel} - ${payload.pendingStatus}`;
    wrapper.classList.add('pending');
  } else {
    meta.textContent = `${senderLabel} - ${new Date(payload.sentAt).toLocaleTimeString()}`;
  }
  bubble.appendChild(meta);
  wrapper.appendChild(bubble);
  return wrapper;
}

export function renderSimpleList(target, items, emptyText) {
  target.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = emptyText;
    target.appendChild(li);
    return;
  }
  items.forEach((itemText) => {
    const li = document.createElement('li');
    li.textContent = itemText;
    target.appendChild(li);
  });
}

export function renderRoomMessages(target, list) {
  target.innerHTML = '';
  const normalized = [...list].sort((a, b) => {
    const leftSeq = Number(a?.seq ?? 0);
    const rightSeq = Number(b?.seq ?? 0);
    if (leftSeq !== rightSeq) {
      return leftSeq - rightSeq;
    }
    return String(a?.sentAt || '').localeCompare(String(b?.sentAt || ''));
  });
  normalized.forEach((message) => {
    target.appendChild(createMessageNode(message));
  });
  scrollToLatest(target);
}

export function renderOnlineUsers(users) {
  elements.onlineUsers.innerHTML = '';
  elements.onlineCount.textContent = `${users.length} connected`;
  users.forEach((entry) => {
    const item = document.createElement('li');
    item.className = `online-item${entry.userId === state.currentUserId ? ' me' : ''}`;
    item.textContent = getUserDisplayName(entry.userId);
    elements.onlineUsers.appendChild(item);
  });
}

export function renderInviteAlarms({ onAccept, onReject }) {
  elements.inviteAlarmList.innerHTML = '';
  if (!state.inviteAlarms.length) {
    elements.inviteAlarmEmpty.classList.remove('hidden');
    elements.rtBadge.classList.add('hidden');
    return;
  }

  elements.inviteAlarmEmpty.classList.add('hidden');
  state.inviteAlarms.forEach((alarm) => {
    const li = document.createElement('li');
    li.className = 'alarm-item';

    const head = document.createElement('div');
    head.className = 'alarm-head';

    const textEl = document.createElement('span');
    textEl.textContent = `${alarm.fromUserId} invited you to #${alarm.roomId}`;

    const actions = document.createElement('div');
    actions.className = 'alarm-actions';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'alarm-btn accept';
    yesBtn.textContent = 'Y';
    yesBtn.addEventListener('click', async () => {
      await onAccept(getInviteId(alarm));
    });

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'alarm-btn reject';
    noBtn.textContent = 'N';
    noBtn.addEventListener('click', async () => {
      await onReject(getInviteId(alarm));
    });

    actions.appendChild(yesBtn);
    actions.appendChild(noBtn);
    head.appendChild(textEl);
    head.appendChild(actions);
    li.appendChild(head);

    const meta = document.createElement('div');
    meta.className = 'alarm-meta';
    meta.textContent = new Date(alarm.createdAt || Date.now()).toLocaleString();
    li.appendChild(meta);

    elements.inviteAlarmList.appendChild(li);
  });

  if (state.currentMode !== 'RT') {
    elements.rtBadge.textContent = String(state.inviteAlarms.length);
    elements.rtBadge.classList.remove('hidden');
  } else {
    elements.rtBadge.classList.add('hidden');
  }
}

function dmSignature(rooms) {
  return rooms
    .map((room) => {
      const unread = getUnreadCount(room);
      return `${room.roomId}:${room.peerUserId}:${room.lastMessageAt || ''}:${room.lastMessagePreview || ''}:${unread}:${room.roomId === state.activeDmRoomId}`;
    })
    .join('|');
}

let previousDmSignature = '';

export function renderDmList(dmRooms, onSelectDm) {
  const query = state.bDmSearchQuery.trim().toLowerCase();
  const filtered = dmRooms.filter((room) => {
    const nickname = String(getUserDisplayName(room.peerUserId) || '').toLowerCase();
    return nickname.includes(query);
  });

  const nextSignature = dmSignature(filtered);
  if (nextSignature === previousDmSignature) {
    return;
  }
  previousDmSignature = nextSignature;

  elements.bDmList.innerHTML = '';
  if (!dmRooms.length) {
    renderSimpleList(elements.bDmList, [], 'No DM rooms');
    return;
  }
  if (!filtered.length) {
    renderSimpleList(elements.bDmList, [], 'No matching users');
    return;
  }

  filtered.forEach((room) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `b-dm-item${room.roomId === state.activeDmRoomId ? ' active' : ''}`;
    btn.addEventListener('click', async () => {
      await onSelectDm(room.peerUserId);
    });

    const main = document.createElement('div');
    main.className = 'b-dm-main';
    const label = document.createElement('span');
    label.textContent = `@ ${getUserDisplayName(room.peerUserId)}`;
    main.appendChild(label);

    const unread = getUnreadCount(room);
    if (unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'b-unread';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      main.appendChild(badge);
    }

    const sub = document.createElement('div');
    sub.className = 'b-dm-sub';
    sub.textContent = toShortPreview(room.lastMessagePreview || 'Direct message');

    btn.appendChild(main);
    btn.appendChild(sub);
    li.appendChild(btn);
    elements.bDmList.appendChild(li);
  });
}

export function resetDmRenderCache() {
  previousDmSignature = '';
}

export function renderFriendRequests({
  incoming,
  outgoing,
  onAccept,
  onReject,
}) {
  elements.bIncomingFriendRequestList.innerHTML = '';
  elements.bOutgoingFriendRequestList.innerHTML = '';

  const incomingList = incoming || [];
  const outgoingList = outgoing || [];

  const pendingCount = incomingList.length;
  if (pendingCount > 0) {
    elements.bRequestBadge.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
    elements.bRequestBadge.classList.remove('hidden');
  } else {
    elements.bRequestBadge.classList.add('hidden');
  }

  if (!incomingList.length) {
    renderSimpleList(elements.bIncomingFriendRequestList, [], 'No incoming requests');
  } else {
    incomingList.forEach((requestItem) => {
      const li = document.createElement('li');
      li.className = 'request-row';

      const head = document.createElement('div');
      head.className = 'request-row-head';
      head.textContent = `@ ${getUserDisplayName(requestItem.fromUserId)}`;

      const meta = document.createElement('div');
      meta.className = 'request-row-meta';
      meta.textContent = new Date(requestItem.createdAt).toLocaleString();

      const actions = document.createElement('div');
      actions.className = 'request-row-actions';

      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'request-action-btn accept';
      accept.textContent = 'Accept';
      accept.addEventListener('click', async () => {
        await onAccept(requestItem.id);
      });

      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'request-action-btn reject';
      reject.textContent = 'Reject';
      reject.addEventListener('click', async () => {
        await onReject(requestItem.id);
      });

      actions.appendChild(accept);
      actions.appendChild(reject);
      li.appendChild(head);
      li.appendChild(meta);
      li.appendChild(actions);
      elements.bIncomingFriendRequestList.appendChild(li);
    });
  }

  if (!outgoingList.length) {
    renderSimpleList(elements.bOutgoingFriendRequestList, [], 'No outgoing requests');
  } else {
    outgoingList.forEach((requestItem) => {
      const li = document.createElement('li');
      li.className = 'request-row';

      const head = document.createElement('div');
      head.className = 'request-row-head';
      head.textContent = `@ ${getUserDisplayName(requestItem.toUserId)}`;

      const meta = document.createElement('div');
      meta.className = 'request-row-meta';
      meta.textContent = `Pending · ${new Date(requestItem.createdAt).toLocaleString()}`;

      li.appendChild(head);
      li.appendChild(meta);
      elements.bOutgoingFriendRequestList.appendChild(li);
    });
  }
}
