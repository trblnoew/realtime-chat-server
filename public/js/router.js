export function parseRoute(pathname) {
  const path = (pathname || '/').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'a' && parts[1]) {
    return { mode: 'A', roomId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'b' && parts[1]) {
    return { mode: 'B', peerUserId: decodeURIComponent(parts[1]) };
  }
  return { mode: 'RT' };
}

export function buildPath(route) {
  if (route.mode === 'A' && route.roomId) {
    return `/a/${encodeURIComponent(route.roomId)}`;
  }
  if (route.mode === 'B' && route.peerUserId) {
    return `/b/${encodeURIComponent(route.peerUserId)}`;
  }
  return '/rt';
}

export function createRouter({ handleRoute, setCurrentRoute }) {
  async function navigateTo(route, options = {}) {
    const normalized = route || { mode: 'RT' };
    const path = buildPath(normalized);

    if (!options.silent) {
      if (options.replace) {
        history.replaceState(normalized, '', path);
      } else {
        history.pushState(normalized, '', path);
      }
    }

    setCurrentRoute(normalized);
    await handleRoute(normalized);
  }

  return { navigateTo };
}
