// ルームの接続管理。ホストを正とするスター型で状態を同期し、カメラ映像だけは送信者から視聴者へ直接送る
import Peer, { type DataConnection, type MediaConnection, type PeerOptions } from 'peerjs';
import {
  appendLog,
  canChangeSeats,
  deleteState,
  initialState,
  keepSeatOwners,
  loadState,
  moveSeat,
  normalizeState,
  parseAction,
  publicState,
  reduce,
  saveState,
  SEATS,
  seatOf,
  type Action,
  type GameState,
  type Seat,
} from '../game/state';
import { captureStill, toRotation, tuneSenders, type Rotation } from '../media/camera';

const PEER_PREFIX = 'ygord-v1-';
export const hostPeerId = (room: string) => PEER_PREFIX + room;

export type Role = 'player' | 'camera' | 'spectator';
/** 観戦者の上限(観戦中のホストも含む)。カメラ端末は見る人の数だけ映像を送るので、多すぎるとプレイヤーへの映像まで劣化する */
export const SPECTATOR_MAX = 4;
export const ROOM_CLOSED_TEXT = 'ホストが部屋を閉じました';
/**
 * ホストが持つ参加者の情報。席は持たず、状態の players[seat].clientId から引く。
 * カメラ端末は持ち主(合言葉を作った人)の clientId を owner に持ち、持ち主の席の映像として扱う
 */
type Member = { peerId: string; clientId: string; camera: boolean; owner: string | null; name: string; rotate: Rotation };
/** 他の端末に配る参加者情報。席の取り戻しに使う clientId は含めない */
export type PublicMember = {
  peerId: string;
  role: Role;
  seat: Seat | null;
  name: string;
  host?: boolean;
  /** カメラ端末が決めた映像の向き。見る側で回して表示する */
  rotate?: Rotation;
};
export type RemoteCam = { peerId: string; seat: Seat | null; label: string; rotate: Rotation; stream: MediaStream };
export type Snap = { id: string; seat: Seat | null; label: string; rotate: Rotation; url: string; at: number };
export type Status = 'connecting' | 'online' | 'reconnecting' | 'full' | 'error' | 'closed';

export type View = {
  status: Status;
  detail: string;
  seat: Seat | null;
  state: GameState | null;
  canUndo: boolean;
  members: PublicMember[];
  cams: RemoteCam[];
  localStream: MediaStream | null;
  snaps: Snap[];
  snapBusy: boolean;
  notice: { id: number; text: string } | null;
};

export type RoomOptions = {
  room: string;
  isHost: boolean;
  /** ゲストが入るときの希望。席は空いていればホストが割り当てる */
  role: Role;
  name: string;
  clientId: string;
  /** カメラ端末用リンクの合言葉。プレイヤーは自分の分を、カメラ端末はリンクで受け取った分を送る */
  camKey: string;
  /** カメラ端末が送る映像の向き */
  rotate?: Rotation;
};

type RoomMsg =
  | { t: 'hello'; clientId: string; role: Role; name: string; camKey: string }
  | { t: 'welcome'; seat: Seat | null; full: boolean; denied?: boolean; reject?: string }
  | { t: 'state'; state: GameState; canUndo: boolean }
  | { t: 'members'; members: PublicMember[] }
  | { t: 'intent'; action: Action }
  /** 席を移りたい(null なら観戦に回る) */
  | { t: 'seat'; seat: Seat | null }
  /** ホストからのお知らせ(席を移れなかった理由など) */
  | { t: 'notice'; text: string }
  /** ホストが部屋を閉じた */
  | { t: 'closed' }
  /** ホストに退出させられた */
  | { t: 'kicked' }
  /** プレイヤーがカメラ用の合言葉を作り直した */
  | { t: 'camKey'; camKey: string }
  /** カメラ端末が映像の向きを変えた */
  | { t: 'rotate'; rotate: Rotation };

type CamMsg =
  | { t: 'snapReq'; reqId: string }
  | { t: 'snap'; reqId: string; mime: string; data: ArrayBuffer }
  | { t: 'snapErr'; reqId: string; message: string };

type CamMeta = { kind: 'cam'; label: string };

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
const isSeat = (v: unknown): v is Seat => v === 'p1' || v === 'p2';
const cameraDetail = (seat: Seat | null) => (seat ? '' : '持ち主が観戦中のため、映像は送っていません');
const HISTORY_MAX = 100;
const SNAP_MAX_BYTES = 10_000_000;
// スナップショットは画像としてしか扱わない。text/html などを通すと blob URL 経由で XSS になる
const SNAP_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class RoomClient {
  private view: View;
  private listeners = new Set<() => void>();
  private peer: Peer | null = null;
  private destroyed = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private camLabel = 'カメラ';
  private camRotate: Rotation;
  private camKey: string;
  private closed = false;

  // ゲスト側
  private hostConn: DataConnection | null = null;
  private denied = false;
  // ホスト側
  private roomConns = new Map<string, DataConnection>();
  private memberMap = new Map<string, Member>();
  private history: { state: GameState; label: string }[] = [];
  /** カメラ用の合言葉。人(clientId)ごとに持ち、席を移ってもカメラ端末が付いていく */
  private camKeys = new Map<string, string>();
  private hostName: string;
  // カメラ送信(視聴者の peerId ごと)
  private outCalls = new Map<string, { media: MediaConnection; data: DataConnection }>();
  // カメラ受信(送信者の peerId ごと)
  private inCalls = new Map<string, MediaConnection>();
  private camConns = new Map<string, DataConnection>();
  private pendingSnaps = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private o: RoomOptions) {
    this.camKey = o.camKey;
    this.camRotate = toRotation(o.rotate);
    this.hostName = o.name;
    this.view = {
      status: 'connecting',
      detail: '',
      seat: null,
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

  /** 参加者一覧の中から自分を見分けるのに使う */
  selfPeerId = () => this.peer?.id ?? null;

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
    this.camKeys.set(this.o.clientId, this.camKey);
    if (!this.view.state) {
      const saved = loadState(this.o.room);
      const st = saved ?? initialState();
      // 新しい部屋ではホストが P1 に座る。保存データから再開するときは、前の席に戻る(席がなければ観戦から)
      if (!saved) st.players.p1 = { ...st.players.p1, clientId: this.o.clientId, name: this.o.name };
      this.set({ state: st, seat: seatOf(st, this.o.clientId) });
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
    if (!peer || peer.destroyed || this.destroyed || this.closed || this.hostConn?.open) return;
    this.hostConn?.close();
    if (!this.denied) this.set({ status: this.view.state ? 'reconnecting' : 'connecting' });
    const conn = peer.connect(hostPeerId(this.o.room), { reliable: true, metadata: { kind: 'room' } });
    this.hostConn = conn;
    conn.on('open', () => {
      this.send(conn, {
        t: 'hello',
        clientId: this.o.clientId,
        role: this.o.role,
        name: this.o.name,
        camKey: this.camKey,
      });
    });
    conn.on('data', (d) => this.onGuestMsg(d as RoomMsg));
    conn.on('close', () => {
      if (this.hostConn !== conn) return;
      this.hostConn = null;
      if (this.closed) return;
      if (this.denied) {
        this.set({
          status: 'error',
          detail: 'カメラ用リンクが無効です。プレイヤーの画面から QR コードを読み取り直してください',
          members: [],
        });
      } else {
        this.set({ status: 'reconnecting', detail: 'ホストとの接続が切れました。再接続中…', members: [] });
      }
      this.syncCalls();
      // 拒否された場合も、プレイヤーの再接続待ちの可能性があるので間隔を空けて再試行する
      this.scheduleConnect(this.denied ? 8000 : 2000);
    });
  }

  private send(conn: DataConnection, msg: RoomMsg | CamMsg) {
    if (conn.open) conn.send(msg);
  }

  // ---- 状態の同期 ----

  private onGuestMsg(msg: RoomMsg) {
    switch (msg.t) {
      case 'welcome':
        this.denied = !!msg.denied;
        if (msg.denied) return;
        if (msg.reject) {
          // 断られたら再接続しない(入り直すにはページを開き直す)
          this.closed = true;
          this.set({ status: 'error', detail: String(msg.reject).slice(0, 100), members: [] });
          this.hostConn?.close();
          return;
        }
        if (this.o.role === 'camera' && this.camRotate && this.hostConn) {
          this.send(this.hostConn, { t: 'rotate', rotate: this.camRotate });
        }
        this.set({
          seat: msg.seat,
          status: this.o.role === 'camera' || msg.seat ? 'online' : 'full',
          detail:
            this.o.role === 'camera'
              ? cameraDetail(msg.seat)
              : msg.full
                ? '対戦の席が埋まっているため、観戦者として参加しました'
                : msg.seat
                  ? ''
                  : '観戦中',
        });
        // ホストが入れ替わった可能性があるので、カメラの送信を張り直す
        this.closeOutCalls();
        this.syncCalls();
        break;
      case 'state': {
        // ホストからの状態も、画面が落ちないよう形を確かめてから使う
        const state = normalizeState(msg.state);
        if (state) this.set({ state, canUndo: !!msg.canUndo });
        break;
      }
      case 'closed':
      case 'kicked':
        // 部屋が閉じられたとき、退出させられたときは、再接続もしない
        this.closed = true;
        this.closeOutCalls();
        this.set({
          status: 'closed',
          detail: msg.t === 'closed' ? ROOM_CLOSED_TEXT : 'ホストによって退出しました',
          members: [],
          cams: [],
        });
        this.hostConn?.close();
        break;
      case 'members':
        if (Array.isArray(msg.members)) this.setMembers(msg.members.filter((m) => m && typeof m.peerId === 'string'));
        break;
      case 'notice':
        if (typeof msg.text === 'string') this.notify(msg.text.slice(0, 100));
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
      const m = this.memberMap.get(conn.peer);
      this.roomConns.delete(conn.peer);
      this.memberMap.delete(conn.peer);
      // 席のない人の合言葉は、抜けたら忘れる(接続を繰り返して合言葉の表を膨らませられないように)。
      // 席のある人の分は、再接続を待つあいだカメラ端末が入れるよう残す
      if (m && !m.camera && !this.isOnline(m.clientId) && !(this.view.state && seatOf(this.view.state, m.clientId))) {
        this.camKeys.delete(m.clientId);
      }
      this.publishMembers();
    });
  }

  private onHostMsg(conn: DataConnection, msg: RoomMsg) {
    const st = this.view.state;
    if (!st || !msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      // 名乗るのは接続ごとに1回だけ(同じ接続で clientId を替えて、席を2つ取るのを防ぐ)
      if (this.memberMap.has(conn.peer)) return;
      if (
        (msg.role !== 'player' && msg.role !== 'camera' && msg.role !== 'spectator') ||
        typeof msg.clientId !== 'string' ||
        msg.clientId.length > 64 ||
        typeof msg.camKey !== 'string' ||
        msg.camKey.length > 64
      ) {
        conn.close();
        return;
      }
      const name = String(msg.name ?? '').slice(0, 20);
      if (msg.role === 'camera') {
        // 合言葉の合うカメラ端末だけを受け入れ、合言葉を作った人の席の映像として扱う
        const owner = [...this.camKeys].find(([, key]) => key === msg.camKey)?.[0];
        if (!msg.camKey || !owner) {
          this.send(conn, { t: 'welcome', seat: null, full: false, denied: true });
          setTimeout(() => conn.close(), 500);
          return;
        }
        this.memberMap.set(conn.peer, { peerId: conn.peer, clientId: msg.clientId, camera: true, owner, name, rotate: 0 });
        this.roomConns.set(conn.peer, conn);
        this.send(conn, { t: 'welcome', seat: seatOf(st, owner), full: false });
        this.publishMembers();
        return;
      }
      // 再接続なら元の席に戻す。対戦を選んだ人は、空いている席があれば座らせる
      let seat = seatOf(st, msg.clientId);
      if (!seat && msg.role === 'player') seat = SEATS.find((s) => !this.seatProblem(msg.clientId, s)) ?? null;
      // カメラ端末は見る人の数だけ映像を送るので、観戦者の数に上限を設ける
      if (!seat && this.watcherCount(conn.peer) >= SPECTATOR_MAX) {
        this.send(conn, { t: 'welcome', seat: null, full: true, reject: `観戦者が満員です(${SPECTATOR_MAX}人まで)` });
        setTimeout(() => conn.close(), 500);
        return;
      }
      this.memberMap.set(conn.peer, { peerId: conn.peer, clientId: msg.clientId, camera: false, owner: null, name, rotate: 0 });
      this.roomConns.set(conn.peer, conn);
      if (msg.camKey) this.camKeys.set(msg.clientId, msg.camKey);
      if (seat && !seatOf(st, msg.clientId)) this.takeSeat(st, msg.clientId, name, seat);
      else if (seat && !st.players[seat].name && name) {
        this.commit({ ...st, players: { ...st.players, [seat]: { ...st.players[seat], name } }, version: st.version + 1 });
      }
      this.send(conn, { t: 'welcome', seat, full: msg.role === 'player' && !seat });
      this.send(conn, { t: 'state', state: publicState(this.view.state!), canUndo: this.history.length > 0 });
      this.publishMembers();
    } else if (msg.t === 'seat') {
      const m = this.memberMap.get(conn.peer);
      if (!m || m.camera || (msg.seat !== null && !isSeat(msg.seat))) return;
      const problem = this.changeSeat(m.clientId, m.name, msg.seat);
      if (problem) this.send(conn, { t: 'notice', text: problem });
    } else if (msg.t === 'camKey') {
      const m = this.memberMap.get(conn.peer);
      if (m && !m.camera && typeof msg.camKey === 'string' && msg.camKey && msg.camKey.length <= 64) {
        this.applyCamKey(m.clientId, msg.camKey);
      }
    } else if (msg.t === 'rotate') {
      // 向きを変えられるのはカメラ端末だけ。値は 0・90・180・270 に限る
      const m = this.memberMap.get(conn.peer);
      const rotate = toRotation(msg.rotate);
      if (m?.camera && rotate !== m.rotate) {
        m.rotate = rotate;
        this.publishMembers();
      }
    } else if (msg.t === 'intent') {
      const m = this.memberMap.get(conn.peer);
      const seat = m && !m.camera ? seatOf(st, m.clientId) : null;
      const action = parseAction(msg.action);
      if (seat && action) this.apply(action, seat);
    }
  }

  // ---- 席(ホスト側) ----

  /** その clientId の人がいま接続しているか(ホスト自身を含む) */
  private isOnline(clientId: string): boolean {
    if (clientId === this.o.clientId) return true;
    for (const m of this.memberMap.values()) if (!m.camera && m.clientId === clientId) return true;
    return false;
  }

  /** 観戦者の数(観戦中のホストを含む)。except の接続は数えない */
  private watcherCount(except?: string): number {
    const st = this.view.state;
    if (!st) return 0;
    let n = seatOf(st, this.o.clientId) ? 0 : 1;
    for (const m of this.memberMap.values()) {
      if (!m.camera && m.peerId !== except && !seatOf(st, m.clientId)) n++;
    }
    return n;
  }

  /** その人がその席(null なら観戦)に移れないなら、理由を返す */
  private seatProblem(clientId: string, to: Seat | null): string | null {
    const st = this.view.state;
    if (!st) return '準備中です';
    const from = seatOf(st, clientId);
    if (from === to) return null;
    const free = canChangeSeats(st);
    if (to === null) {
      if (!free) return 'デュエル中は観戦に回れません。決着後か、やり直した後に移ってください';
      if (this.watcherCount() >= SPECTATOR_MAX) return `観戦者が満員です(${SPECTATOR_MAX}人まで)`;
      return null;
    }
    const holder = st.players[to].clientId;
    if (holder && this.isOnline(holder)) return 'その席には他のプレイヤーが座っています';
    // デュエル中でも、空いた席に観戦者が入るのは認める(回線が切れた人の復帰や代打のため)
    if (from && !free) return 'デュエル中は席を移れません。決着後か、やり直した後に移ってください';
    return null;
  }

  /** 席を移す。移れなければ理由を返す */
  private changeSeat(clientId: string, name: string, to: Seat | null): string | null {
    const st = this.view.state;
    const problem = this.seatProblem(clientId, to);
    if (!st || problem) return problem ?? '準備中です';
    this.takeSeat(st, clientId, name, to);
    this.publishMembers();
    return null;
  }

  private takeSeat(st: GameState, clientId: string, name: string, to: Seat | null) {
    const next = moveSeat(st, clientId, name, to);
    if (next === st) return;
    // 回線が切れた人の席を引き継いだら、その人の合言葉は忘れる(カメラ端末が新しい持ち主の席に映らないように)
    const prev = to ? st.players[to].clientId : null;
    if (prev && prev !== clientId && !this.isOnline(prev)) this.camKeys.delete(prev);
    this.commit(next);
  }

  /** 自分の席を移る(null なら観戦に回る) */
  /** カメラ端末から、送っている映像の向きを伝える */
  setRotate(rotate: Rotation) {
    this.camRotate = rotate;
    if (this.hostConn) this.send(this.hostConn, { t: 'rotate', rotate });
  }

  requestSeat(to: Seat | null) {
    if (this.o.isHost) {
      const problem = this.changeSeat(this.o.clientId, this.hostName, to);
      if (problem) this.notify(problem);
    } else if (this.hostConn) this.send(this.hostConn, { t: 'seat', seat: to });
  }

  /** ホストだけが使える。全員を切断し、この部屋の保存データを消す */
  closeRoom() {
    if (!this.o.isHost) return;
    for (const conn of this.roomConns.values()) this.send(conn, { t: 'closed' });
    deleteState(this.o.room);
    this.closed = true;
    this.set({ status: 'closed', detail: '部屋を閉じました' });
    // 「閉じた」の連絡が届くよう、少し待ってから切断する
    setTimeout(() => this.destroy(), 800);
  }

  /** ホストだけが使える。観戦者を退出させる(プレイヤーとカメラ端末は対象外) */
  kick(peerId: string) {
    const m = this.memberMap.get(peerId);
    if (!this.o.isHost || !m || m.camera || !this.view.state || seatOf(this.view.state, m.clientId)) return;
    const conn = this.roomConns.get(peerId);
    if (!conn) return;
    this.send(conn, { t: 'kicked' });
    setTimeout(() => conn.close(), 500);
  }

  /** カメラ用の合言葉を差し替える。古い合言葉で入っているカメラ端末は切断する */
  renewCamKey(camKey: string) {
    this.camKey = camKey;
    if (this.o.isHost) this.applyCamKey(this.o.clientId, camKey);
    else if (this.hostConn) this.send(this.hostConn, { t: 'camKey', camKey });
  }

  private applyCamKey(clientId: string, camKey: string) {
    this.camKeys.set(clientId, camKey);
    for (const [peerId, m] of this.memberMap) {
      if (m.camera && m.owner === clientId) this.roomConns.get(peerId)?.close();
    }
  }

  dispatch(action: Action) {
    if (this.o.isHost) {
      // 観戦中のホストは操作しない
      const seat = this.view.state ? seatOf(this.view.state, this.o.clientId) : null;
      if (seat) this.apply(action, seat);
    } else if (this.hostConn) this.send(this.hostConn, { t: 'intent', action });
  }

  private apply(action: Action, by: Seat) {
    const cur = this.view.state;
    if (!cur) return;
    if (action.type === 'undo') {
      const prev = this.history.pop();
      if (!prev) return;
      const restored = keepSeatOwners(prev.state, cur);
      this.commit(appendLog({ ...restored, version: cur.version + 1 }, by, `↶ 取り消し: ${prev.label}`));
      return;
    }
    const next = reduce(cur, action, by);
    if (next === cur) return;
    this.history.push({ state: cur, label: next.log.at(-1)?.text ?? '' });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this.commit(next);
    if (action.type === 'rename') {
      // 席を移っても名前が付いていくよう、参加者の名前も変える
      const clientId = next.players[by].clientId;
      const name = next.players[by].name;
      if (clientId === this.o.clientId) this.hostName = name;
      for (const m of this.memberMap.values()) if (!m.camera && m.clientId === clientId) m.name = name;
      this.publishMembers();
    }
  }

  private commit(st: GameState) {
    const canUndo = this.history.length > 0;
    this.set({ state: st, canUndo, ...(this.o.isHost ? { seat: seatOf(st, this.o.clientId) } : {}) });
    saveState(this.o.room, st);
    const wire = publicState(st);
    for (const conn of this.roomConns.values()) this.send(conn, { t: 'state', state: wire, canUndo });
  }

  private publishMembers() {
    const st = this.view.state;
    if (!this.peer?.open || !st) return;
    const hostSeat = seatOf(st, this.o.clientId);
    const self: PublicMember = {
      peerId: this.peer.id,
      role: hostSeat ? 'player' : 'spectator',
      seat: hostSeat,
      name: this.hostName,
      host: true,
    };
    const others = [...this.memberMap.values()].map((m): PublicMember => {
      const seat = seatOf(st, m.camera ? m.owner : m.clientId);
      if (m.camera) return { peerId: m.peerId, role: 'camera', seat, name: m.name, rotate: m.rotate };
      return { peerId: m.peerId, role: seat ? 'player' : 'spectator', seat, name: m.name };
    });
    const members = [self, ...others];
    for (const conn of this.roomConns.values()) this.send(conn, { t: 'members', members });
    this.setMembers(members);
  }

  /** 映像の席は送信者の自己申告を信じず、ホストが割り当てた参加者一覧から引く。自分の席もここで追う */
  private setMembers(members: PublicMember[]) {
    const of = (peerId: string) => members.find((m) => m.peerId === peerId);
    const cams = this.view.cams.map((c) => ({ ...c, seat: of(c.peerId)?.seat ?? null, rotate: toRotation(of(c.peerId)?.rotate) }));
    const patch: Partial<View> = { members, cams };
    const me = members.find((m) => m.peerId === this.peer?.id);
    if (me && me.seat !== this.view.seat) {
      patch.seat = isSeat(me.seat) ? me.seat : null;
      if (this.o.role === 'camera') patch.detail = cameraDetail(patch.seat);
      else if (!this.o.isHost && (this.view.status === 'online' || this.view.status === 'full')) {
        patch.status = patch.seat ? 'online' : 'full';
        patch.detail = patch.seat ? '' : '観戦中';
      }
    }
    this.set(patch);
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

  /** 席のある自分以外のプレイヤーと観戦者に、カメラ映像の通話を張る(不要になった分は閉じる) */
  private syncCalls() {
    const peer = this.peer;
    const stream = this.view.localStream;
    if (!peer?.open) return;
    // 送るのは自分(カメラ端末なら持ち主)が席にいるときだけ。観戦者の上限はホストが管理する
    const targets = stream && this.view.seat
      ? this.view.members.filter(
          (m) => ((m.role === 'player' && m.seat) || m.role === 'spectator') && m.peerId !== peer.id,
        )
      : [];
    const ids = new Set(targets.map((t) => t.peerId));
    for (const [id, c] of this.outCalls) {
      if (ids.has(id)) continue;
      c.media.close();
      c.data.close();
      this.outCalls.delete(id);
    }
    for (const t of targets) {
      if (this.outCalls.has(t.peerId) || !stream) continue;
      const metadata: CamMeta = { kind: 'cam', label: this.camLabel };
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
    if (msg?.t !== 'snapReq' || typeof msg.reqId !== 'string') return;
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
    const md = call.metadata as Partial<CamMeta> | undefined;
    if (md?.kind !== 'cam') {
      call.close();
      return;
    }
    this.inCalls.get(call.peer)?.close();
    this.inCalls.set(call.peer, call);
    call.answer();
    call.on('stream', (stream) => {
      if (this.inCalls.get(call.peer) !== call) return;
      const member = this.view.members.find((m) => m.peerId === call.peer);
      const label = typeof md.label === 'string' && md.label ? md.label.slice(0, 20) : 'カメラ';
      const cam: RemoteCam = { peerId: call.peer, seat: member?.seat ?? null, label, rotate: toRotation(member?.rotate), stream };
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
    if (msg?.t !== 'snap' && msg?.t !== 'snapErr') return;
    const timer = this.pendingSnaps.get(msg.reqId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingSnaps.delete(msg.reqId);
    this.set({ snapBusy: this.pendingSnaps.size > 0 });
    if (msg.t === 'snapErr') {
      this.notify(`スナップショットに失敗しました: ${String(msg.message).slice(0, 100)}`);
      return;
    }
    // PeerJS は大きなデータを分割して送り、受け取る側で Uint8Array として組み立てることがあるので、どちらも受け付ける
    const data: unknown = msg.data;
    const bytes = data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data : null;
    if (!bytes || bytes.byteLength > SNAP_MAX_BYTES || !SNAP_MIMES.has(msg.mime)) {
      this.notify('不正なスナップショットを受け取ったため破棄しました');
      return;
    }
    const cam = this.view.cams.find((c) => c.peerId === conn.peer);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: msg.mime }));
    const snap: Snap = {
      id: msg.reqId,
      seat: cam?.seat ?? null,
      label: cam?.label ?? 'カメラ',
      rotate: cam?.rotate ?? 0,
      url,
      at: Date.now(),
    };
    const snaps = [snap, ...this.view.snaps];
    snaps.slice(20).forEach((s) => URL.revokeObjectURL(s.url));
    this.set({ snaps: snaps.slice(0, 20) });
  }
}
