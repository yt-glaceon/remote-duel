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

/** カメラ端末用リンクに入れる合言葉。部屋ごと・タブごとに作り、再読み込みでは変えない */
export function getCamKey(room: string): string {
  const key = `ygord-camkey-${room}`;
  const v = safeGet(sessionStorage, key) ?? randomToken();
  safeSet(sessionStorage, key, v);
  return v;
}

/** 合言葉を作り直す。以後、古いカメラ用リンクでは入れない */
export function renewCamKey(room: string): string {
  const v = randomToken();
  safeSet(sessionStorage, `ygord-camkey-${room}`, v);
  return v;
}

export function forgetCamKey(room: string): void {
  try {
    sessionStorage.removeItem(`ygord-camkey-${room}`);
  } catch {
    // 消せなくてもタブを閉じれば消える
  }
}

function randomToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => n.toString(16).padStart(2, '0')).join('');
}

export const loadName = () => safeGet(localStorage, 'ygord-name') ?? '';
export const saveName = (name: string) => safeSet(localStorage, 'ygord-name', name);

export function newRoomId(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  // 推測されにくいよう 10 文字(約 49 ビット)にする
  const a = new Uint32Array(10);
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
