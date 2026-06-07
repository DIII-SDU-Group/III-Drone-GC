export type StoredSession = {
  token: string;
  endpointId: string;
  runtimeName: string;
};

const SESSION_KEY = "iii-gc-v2-session";
const LAST_ENDPOINT_KEY = "iii-gc-v2-last-endpoint";

export function loadStoredSession(storage: Storage = window.sessionStorage): StoredSession | null {
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed.token && parsed.endpointId && parsed.runtimeName) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function saveStoredSession(session: StoredSession, storage: Storage = window.sessionStorage): void {
  storage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(storage: Storage = window.sessionStorage): void {
  storage.removeItem(SESSION_KEY);
}

export function loadLastEndpoint(storage: Storage = window.localStorage): string | null {
  return storage.getItem(LAST_ENDPOINT_KEY);
}

export function saveLastEndpoint(endpointId: string, storage: Storage = window.localStorage): void {
  storage.setItem(LAST_ENDPOINT_KEY, endpointId);
}
