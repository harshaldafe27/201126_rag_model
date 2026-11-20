const WORKSPACE_STORAGE_KEY = 'aai_workspace_id';

export function getWorkspaceId(): string {
  try {
    const existing = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const nextId = `ws_${randomPart}`;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return 'ws_session_local';
  }
}
