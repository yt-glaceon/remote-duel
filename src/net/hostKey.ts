// ホストの本人確認に使う鍵。部屋 ID を公開鍵のハッシュにするので、招待リンクを持つ人がホストの ID を取っても、
// 秘密鍵がなければゲストに署名を返せない。秘密鍵は取り出せない形で、ホストのブラウザの IndexedDB に置く
import { hasSavedState } from '../game/state';

const DB_NAME = 'ygord-host';
const STORE_NAME = 'keys';
const KEY_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' };
/** 保存データがなくなった部屋の鍵を残す時間 */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

export type HostKey = {
  room: string;
  /** タブを閉じた後に開き直しても、自分の席に戻れるように持っておく */
  clientId: string;
  privateKey: CryptoKey;
  /** 公開鍵(16進数)。署名と一緒にゲストへ送る */
  publicKey: string;
  savedAt: number;
};

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (n) => n.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const encode = (text: string) => new TextEncoder().encode(text);

async function roomIdOf(publicKey: BufferSource): Promise<string> {
  // 128 ビットあれば、同じ部屋 ID になる鍵を探すことはできない
  return toHex(await crypto.subtle.digest('SHA-256', publicKey)).slice(0, 32);
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME, { keyPath: 'room' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
      req.onsuccess = () => {
        db.close();
        resolve(req.result);
      };
    };
  });
}

/** 新しい部屋の鍵を作って保存し、部屋 ID を返す */
export async function createHostKey(clientId: string): Promise<string> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(KEY_ALGORITHM, false, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  const room = await roomIdOf(raw);
  const key: HostKey = { room, clientId, privateKey, publicKey: toHex(raw), savedAt: Date.now() };
  await withStore('readwrite', (s) => s.put(key));
  return room;
}

export async function loadHostKey(room: string): Promise<HostKey | null> {
  const key = await withStore<HostKey | undefined>('readonly', (s) => s.get(room));
  return key ?? null;
}

export async function deleteHostKey(room: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(room));
}

/** 期限切れの鍵を消す。保存データの残っている部屋の鍵は、続きを遊べるよう残す。起動時に呼ぶ */
export async function purgeHostKeys(): Promise<void> {
  const keys = await withStore<HostKey[]>('readonly', (s) => s.getAll());
  const expired = keys.filter((k) => Date.now() - k.savedAt > KEY_TTL_MS && !hasSavedState(k.room));
  await Promise.all(expired.map((k) => deleteHostKey(k.room)));
}

export async function signProof(key: HostKey, text: string): Promise<string> {
  return toHex(await crypto.subtle.sign(SIGN_ALGORITHM, key.privateKey, encode(text)));
}

/** ゲストが、部屋 ID に合う公開鍵の持ち主の署名かどうかを確かめる */
export async function verifyProof(room: string, publicKey: unknown, signature: unknown, text: string): Promise<boolean> {
  if (typeof publicKey !== 'string' || typeof signature !== 'string') return false;
  try {
    const raw = fromHex(publicKey);
    if ((await roomIdOf(raw)) !== room) return false;
    const key = await crypto.subtle.importKey('raw', raw, KEY_ALGORITHM, false, ['verify']);
    return await crypto.subtle.verify(SIGN_ALGORITHM, key, fromHex(signature), encode(text));
  } catch {
    return false;
  }
}
