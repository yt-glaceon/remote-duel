// 端末ごとの識別子と表示名。clientId はタブごとに分け、再読み込みでは変わらない

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // 保存できない環境でも動かす
  }
}

let memoClientId: string | null = null;

export function getClientId(): string {
  if (memoClientId) return memoClientId;
  memoClientId = safeGet(sessionStorage, 'ygord-client') ?? crypto.randomUUID();
  safeSet(sessionStorage, 'ygord-client', memoClientId);
  return memoClientId;
}

export const loadName = () => safeGet(localStorage, 'ygord-name') ?? '';
export const saveName = (name: string) => safeSet(localStorage, 'ygord-name', name);

export function newRoomId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}

export const ROOM_RE = /^[a-z0-9]{4,12}$/;

export function roomUrl(room: string, extra: Record<string, string> = {}): string {
  const u = new URL(location.href);
  u.search = new URLSearchParams({ room, ...extra }).toString();
  u.hash = '';
  return u.toString();
}
