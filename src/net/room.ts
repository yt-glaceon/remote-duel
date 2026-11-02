// ルームの接続管理。ホストを正とするスター型で状態を同期し、カメラ映像だけは送信者から視聴者へ直接送る
import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from 'peerjs';
import { appendLog, initialState, loadState, reduce, saveState, type Action, type GameState, type Seat } from '../game/state';
import { captureStill, tuneSenders } from '../media/camera';

const PEER_PREFIX = 'ygord-v1-';
export const hostPeerId = (room: string) => PEER_PREFIX + room;

export type Role = 'player' | 'camera';
export type Member = { peerId: string; clientId: string; role: Role; seat: Seat | null; name: string };
export type RemoteCam = { peerId: string; seat: Seat | null; label: string; stream: MediaStream };
export type Snap = { id: string; seat: Seat | null; label: string; url: string; at: number };
export type Status = 'connecting' | 'online' | 'reconnecting' | 'full' | 'error';

export type View = {
  status: Status;
  detail: string;
  seat: Seat | null;
  state: GameState | null;
  canUndo: boolean;
  members: Member[];
  cams: RemoteCam[];
  localStream: MediaStream | null;
  snaps: Snap[];
  snapBusy: boolean;
  notice: { id: number; text: string } | null;
};

export type RoomOptions = {
  room: string;
  isHost: boolean;
  role: Role;
  /** カメラ専用端末が、どちらの席の映像として送るか */
  seat?: Seat;
  name: string;
  clientId: string;
};

type RoomMsg =
  | { t: 'hello'; clientId: string; role: Role; seat: Seat | null; name: string }
  | { t: 'welcome'; seat: Seat | null; full: boolean }
  | { t: 'state'; state: GameState; canUndo: boolean }
  | { t: 'members'; members: Member[] }
  | { t: 'intent'; action: Action };

type CamMsg =
  | { t: 'snapReq'; reqId: string }
  | { t: 'snap'; reqId: string; mime: string; data: ArrayBuffer }
  | { t: 'snapErr'; reqId: string; message: string };

type CamMeta = { kind: 'cam'; seat: Seat | null; label: string };

function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.VITE_TURN_URL) {
    iceServers.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
  }
  const opts: PeerOptions = { config: { iceServers }, debug: 1 };
  if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    opts.port = Number(env.VITE_PEER_PORT || 443);
    opts.path = env.VITE_PEER_PATH || '/';
    opts.secure = true;
  }
  return opts;
}

const randomId = () => Math.random().toString(36).slice(2, 10);
const HISTORY_MAX = 100;

export class RoomClient {
  private view: View;
  private listeners = new Set<() => void>();
  private peer: Peer | null = null;
  private destroyed = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private camLabel = 'カメラ';

  // ゲスト側
  private hostConn: DataConnection | null = null;
  // ホスト側
  private roomConns = new Map<string, DataConnection>();
  private memberMap = new Map<string, Member>();
  private history: { state: GameState; label: string }[] = [];
  // カメラ送信(視聴者の peerId ごと)
  private outCalls = new Map<string, { media: MediaConnection; data: DataConnection }>();
  // カメラ受信(送信者の peerId ごと)
  private inCalls = new Map<string, MediaConnection>();
  private camConns = new Map<string, DataConnection>();
  private pendingSnaps = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private o: RoomOptions) {
    this.view = {
      status: 'connecting',
      detail: '',
      seat: o.role === 'camera' ? (o.seat ?? null) : o.isHost ? 'p1' : null,
      state: null,
      canUndo: false,
      members: [],
      cams: [],
      localStream: null,
      snaps: [],
      snapBusy: false,
      notice: null,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getView = () => this.view;

  private set(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((f) => f());
  }

  private notify(text: string) {
    this.set({ notice: { id: (this.view.notice?.id ?? 0) + 1, text } });
  }

  start() {
    if (this.destroyed) return;
    if (this.o.isHost) this.startHost();
    else this.startGuest();
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.connectTimer);
    this.teardownConnections();
    this.peer?.destroy();
    this.peer = null;
    this.view.snaps.forEach((s) => URL.revokeObjectURL(s.url));
  }

  // ---- 接続の確立 ----

  private startHost() {
    if (!this.view.state) {
      const st = loadState(this.o.room) ?? initialState();
      st.players.p1 = { ...st.players.p1, clientId: this.o.clientId, name: st.players.p1.name || this.o.name };
      this.set({ state: st });
    }
    const peer = new Peer(hostPeerId(this.o.room), peerOptions());
    this.peer = peer;
    this.bindCommon(peer);
    peer.on('open', () => {
      this.set({ status: 'online', detail: '' });
      this.publishMembers();
    });
  }

  private startGuest() {
    const peer = new Peer(peerOptions());
    this.peer = peer;
    this.bindCommon(peer);
    peer.on('open', () => this.connectHost());
  }

  private bindCommon(peer: Peer) {
    peer.on('connection', (c) => this.onConnection(c));
    peer.on('call', (c) => this.onCall(c));
    peer.on('error', (err) => this.onPeerError(err));
    peer.on('disconnected', () => {
      // シグナリングサーバーとの接続だけが切れた状態。確立済みの P2P はそのまま使える
      if (this.peer === peer && !peer.destroyed && !this.destroyed) peer.reconnect();
    });
  }

  private onPeerError(err: { type: string; message: string }) {
    if (this.destroyed) return;
    switch (err.type) {
      case 'unavailable-id':
        this.set({ status: 'reconnecting', detail: '前回の接続が残っているため、少し待って再試行します…' });
        this.restartPeer(4000);
        break;
      case 'peer-unavailable':
        // ホストが見つからない(カメラの送り先が消えた場合も来るので、ゲストの未接続時だけ扱う)
        if (!this.o.isHost && !this.hostConn?.open) {
          this.hostConn = null;
          this.set({ status: 'reconnecting', detail: 'ホストが見つかりません。ホストがページを開いているか確認してください' });
          this.scheduleConnect(3000);
        }
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        this.set({ status: 'reconnecting', detail: '接続サーバーにつながりません。再試行中…' });
        this.restartPeer(3000);
        break;
      case 'browser-incompatible':
        this.set({ status: 'error', detail: 'このブラウザは WebRTC に対応していません' });
        break;
      default:
        console.warn('[room]', err.type, err.message);
    }
  }

  private teardownConnections() {
    this.hostConn?.close();
    this.hostConn = null;
    this.roomConns.forEach((c) => c.close());
    this.roomConns.clear();
    this.memberMap.clear();
    this.closeOutCalls();
    this.inCalls.forEach((c) => c.close());
    this.inCalls.clear();
    this.camConns.forEach((c) => c.close());
    this.camConns.clear();
    this.set({ members: [], cams: [] });
  }

  private restartPeer(delay: number) {
    if (this.restartTimer) return;
    this.teardownConnections();
    this.peer?.destroy();
    this.peer = null;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delay);
  }

  private scheduleConnect(ms: number) {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => this.connectHost(), ms);
  }

  private connectHost() {
    const peer = this.peer;
    if (!peer || peer.destroyed || this.destroyed || this.hostConn?.open) return;
    this.hostConn?.close();
    this.set({ status: this.view.state ? 'reconnecting' : 'connecting' });
    const conn = peer.connect(hostPeerId(this.o.room), { reliable: true, metadata: { kind: 'room' } });
    this.hostConn = conn;
    conn.on('open', () => {
      const seat = this.o.role === 'camera' ? (this.o.seat ?? null) : null;
      this.send(conn, { t: 'hello', clientId: this.o.clientId, role: this.o.role, seat, name: this.o.name });
    });
    conn.on('data', (d) => this.onGuestMsg(d as RoomMsg));
    conn.on('close', () => {
      if (this.hostConn !== conn) return;
      this.hostConn = null;
      this.set({ status: 'reconnecting', detail: 'ホストとの接続が切れました。再接続中…', members: [] });
      this.syncCalls();
      this.scheduleConnect(2000);
    });
  }

  private send(conn: DataConnection, msg: RoomMsg | CamMsg) {
    if (conn.open) conn.send(msg);
  }

  // ---- 状態の同期 ----

  private onGuestMsg(msg: RoomMsg) {
    switch (msg.t) {
      case 'welcome':
        this.set({
          seat: this.o.role === 'camera' ? this.view.seat : msg.seat,
          status: msg.full ? 'full' : 'online',
          detail: msg.full ? 'このルームは満員のため観戦モードです' : '',
        });
        // ホストが入れ替わった可能性があるので、カメラの送信を張り直す
        this.closeOutCalls();
        this.syncCalls();
        break;
      case 'state':
        this.set({ state: msg.state, canUndo: msg.canUndo });
        break;
      case 'members':
        this.set({ members: msg.members });
        this.syncCalls();
        break;
    }
  }

  private onConnection(conn: DataConnection) {
    const kind = (conn.metadata as { kind?: string } | undefined)?.kind;
    if (kind === 'cam') {
      this.onCamConn(conn);
      return;
    }
    if (kind !== 'room' || !this.o.isHost) {
      conn.close();
      return;
    }
    conn.on('data', (d) => this.onHostMsg(conn, d as RoomMsg));
    conn.on('close', () => {
      if (this.roomConns.get(conn.peer) !== conn) return;
      this.roomConns.delete(conn.peer);
      this.memberMap.delete(conn.peer);
      this.publishMembers();
    });
  }

  private onHostMsg(conn: DataConnection, msg: RoomMsg) {
    const st = this.view.state;
    if (!st) return;
    if (msg.t === 'hello') {
      let seat: Seat | null = null;
      let full = false;
      if (msg.role === 'camera') {
        seat = msg.seat === 'p1' || msg.seat === 'p2' ? msg.seat : null;
      } else {
        const p2Online = [...this.memberMap.values()].some(
          (m) => m.role === 'player' && m.seat === 'p2' && m.peerId !== conn.peer,
        );
        // 同じ端末の再接続か、P2 が空いていれば P2 として迎える
        if (st.players.p2.clientId === msg.clientId || !p2Online) seat = 'p2';
        else full = true;
      }
      const name = String(msg.name ?? '').slice(0, 20);
      this.memberMap.set(conn.peer, { peerId: conn.peer, clientId: msg.clientId, role: msg.role, seat, name });
      this.roomConns.set(conn.peer, conn);
      if (seat === 'p2' && msg.role === 'player') {
        const p2 = st.players.p2;
        if (p2.clientId !== msg.clientId || (!p2.name && name)) {
          const players = { ...st.players, p2: { ...p2, clientId: msg.clientId, name: p2.name && p2.clientId === msg.clientId ? p2.name : name } };
          this.commit({ ...st, players, version: st.version + 1 });
        }
      }
      this.send(conn, { t: 'welcome', seat, full });
      this.send(conn, { t: 'state', state: this.view.state!, canUndo: this.history.length > 0 });
      this.publishMembers();
    } else if (msg.t === 'intent') {
      const m = this.memberMap.get(conn.peer);
      if (m?.role === 'player' && m.seat) this.apply(msg.action, m.seat);
    }
  }

  dispatch(action: Action) {
    if (this.o.isHost) this.apply(action, 'p1');
    else if (this.hostConn) this.send(this.hostConn, { t: 'intent', action });
  }

  private apply(action: Action, by: Seat) {
    const cur = this.view.state;
    if (!cur) return;
    if (action.type === 'undo') {
      const prev = this.history.pop();
      if (!prev) return;
      this.commit(appendLog({ ...prev.state, version: cur.version + 1 }, by, `↶ 取り消し: ${prev.label}`));
      return;
    }
    const next = reduce(cur, action, by);
    if (next === cur) return;
    this.history.push({ state: cur, label: next.log.at(-1)?.text ?? '' });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.commit(next);
  }

  private commit(st: GameState) {
    const canUndo = this.history.length > 0;
    this.set({ state: st, canUndo });
    saveState(this.o.room, st);
    for (const conn of this.roomConns.values()) this.send(conn, { t: 'state', state: st, canUndo });
  }

  private publishMembers() {
    if (!this.peer?.open) return;
    const self: Member = { peerId: this.peer.id, clientId: this.o.clientId, role: 'player', seat: 'p1', name: this.o.name };
    const members = [self, ...this.memberMap.values()];
    this.set({ members });
    for (const conn of this.roomConns.values()) this.send(conn, { t: 'members', members });
    this.syncCalls();
  }

  // ---- カメラ送信 ----

  setLocalStream(stream: MediaStream | null, label: string) {
    this.camLabel = label;
    this.set({ localStream: stream });
    this.closeOutCalls();
    this.syncCalls();
  }

  private closeOutCalls() {
    for (const c of this.outCalls.values()) {
      c.media.close();
      c.data.close();
    }
    this.outCalls.clear();
  }

  /** 自分以外のプレイヤー全員に、カメラ映像の通話を張る(多すぎる分は閉じる) */
  private syncCalls() {
    const peer = this.peer;
    const stream = this.view.localStream;
    if (!peer?.open) return;
    const targets = stream ? this.view.members.filter((m) => m.role === 'player' && m.peerId !== peer.id) : [];
    const ids = new Set(targets.map((t) => t.peerId));
    for (const [id, c] of this.outCalls) {
      if (ids.has(id)) continue;
      c.media.close();
      c.data.close();
      this.outCalls.delete(id);
    }
    for (const t of targets) {
      if (this.outCalls.has(t.peerId) || !stream) continue;
      const metadata: CamMeta = { kind: 'cam', seat: this.view.seat, label: this.camLabel };
      const media = peer.call(t.peerId, stream, { metadata });
      const data = peer.connect(t.peerId, { reliable: true, metadata });
      const entry = { media, data };
      this.outCalls.set(t.peerId, entry);
      const drop = () => {
        if (this.outCalls.get(t.peerId) !== entry) return;
        this.outCalls.delete(t.peerId);
        media.close();
        data.close();
        setTimeout(() => this.syncCalls(), 1500);
      };
      media.on('close', drop);
      media.on('error', drop);
      data.on('data', (d) => void this.onSnapReq(data, d as CamMsg));
      const pc = media.peerConnection;
      pc?.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') void tuneSenders(pc);
        if (pc.connectionState === 'failed') drop();
      });
    }
  }

  private async onSnapReq(conn: DataConnection, msg: CamMsg) {
    if (msg.t !== 'snapReq') return;
    const stream = this.view.localStream;
    try {
      if (!stream) throw new Error('カメラが止まっています');
      const blob = await captureStill(stream);
      const data = await blob.arrayBuffer();
      this.send(conn, { t: 'snap', reqId: msg.reqId, mime: blob.type || 'image/jpeg', data });
      this.notify('高画質スナップショットを送りました');
    } catch (e) {
      this.send(conn, { t: 'snapErr', reqId: msg.reqId, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // ---- カメラ受信 ----

  private onCall(call: MediaConnection) {
    const md = call.metadata as CamMeta | undefined;
    if (md?.kind !== 'cam') {
      call.close();
      return;
    }
    this.inCalls.get(call.peer)?.close();
    this.inCalls.set(call.peer, call);
    call.answer();
    call.on('stream', (stream) => {
      if (this.inCalls.get(call.peer) !== call) return;
      const cam: RemoteCam = { peerId: call.peer, seat: md.seat ?? null, label: md.label || 'カメラ', stream };
      this.set({ cams: [...this.view.cams.filter((c) => c.peerId !== call.peer), cam] });
    });
    const remove = () => {
      if (this.inCalls.get(call.peer) !== call) return;
      this.inCalls.delete(call.peer);
      this.set({ cams: this.view.cams.filter((c) => c.peerId !== call.peer) });
    };
    call.on('close', remove);
    call.on('error', remove);
  }

  private onCamConn(conn: DataConnection) {
    this.camConns.get(conn.peer)?.close();
    this.camConns.set(conn.peer, conn);
    conn.on('data', (d) => this.onCamMsg(conn, d as CamMsg));
    conn.on('close', () => {
      if (this.camConns.get(conn.peer) === conn) this.camConns.delete(conn.peer);
    });
  }

  requestSnapshot(peerId: string) {
    const conn = this.camConns.get(peerId);
    if (!conn?.open) {
      this.notify('相手のカメラとの接続がまだできていません');
      return;
    }
    const reqId = randomId();
    this.pendingSnaps.set(
      reqId,
      setTimeout(() => {
        this.pendingSnaps.delete(reqId);
        this.set({ snapBusy: this.pendingSnaps.size > 0 });
        this.notify('スナップショットが届きませんでした');
      }, 30000),
    );
    this.set({ snapBusy: true });
    this.send(conn, { t: 'snapReq', reqId });
  }

  private onCamMsg(conn: DataConnection, msg: CamMsg) {
    if (msg.t !== 'snap' && msg.t !== 'snapErr') return;
    const timer = this.pendingSnaps.get(msg.reqId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingSnaps.delete(msg.reqId);
    this.set({ snapBusy: this.pendingSnaps.size > 0 });
    if (msg.t === 'snapErr') {
      this.notify(`スナップショットに失敗しました: ${msg.message}`);
      return;
    }
    const cam = this.view.cams.find((c) => c.peerId === conn.peer);
    const url = URL.createObjectURL(new Blob([msg.data], { type: msg.mime }));
    const snap: Snap = { id: msg.reqId, seat: cam?.seat ?? null, label: cam?.label ?? 'カメラ', url, at: Date.now() };
    const snaps = [snap, ...this.view.snaps];
    snaps.slice(20).forEach((s) => URL.revokeObjectURL(s.url));
    this.set({ snaps: snaps.slice(0, 20) });
  }
}
