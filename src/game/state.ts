// デュエルの共有状態と、その更新ルール。更新はホストだけが行い、結果を全員に配る

export type Seat = 'p1' | 'p2';
export const SEATS: Seat[] = ['p1', 'p2'];
export const other = (s: Seat): Seat => (s === 'p1' ? 'p2' : 'p1');

export type Phase = 'DP' | 'SP' | 'M1' | 'BP' | 'M2' | 'EP';
export const PHASES: Phase[] = ['DP', 'SP', 'M1', 'BP', 'M2', 'EP'];
// 公式ルールブックの表記に合わせる
export const PHASE_LABEL: Record<Phase, string> = {
  DP: 'ドローフェイズ',
  SP: 'スタンバイフェイズ',
  M1: 'メインフェイズ1',
  BP: 'バトルフェイズ',
  M2: 'メインフェイズ2',
  EP: 'エンドフェイズ',
};

export const START_LP = 8000;

export type Player = { name: string; lp: number; clientId: string | null };
export type ChainLink = { card: string; by: Seat; resolved: boolean };
export type LogEntry = { id: number; at: number; by: Seat | null; text: string };
export type Roll = { id: number; kind: 'coin' | 'dice'; value: string; by: Seat; at: number };

export type GameState = {
  version: number;
  players: Record<Seat, Player>;
  turn: number;
  turnPlayer: Seat;
  /** 先攻のプレイヤー。奇数ターンが先攻、偶数ターンが後攻のターン */
  firstPlayer: Seat;
  phase: Phase;
  chain: ChainLink[];
  log: LogEntry[];
  lastRoll: Roll | null;
  /** このルームで何戦目か */
  duelNo: number;
  /** いまのデュエルの決着。まだなら null */
  result: DuelResult | null;
  /** このルームでの通算の戦績 */
  record: DuelRecord;
};

export type ResultReason = 'lp' | 'deck' | 'special' | 'other';
export const REASON_LABEL: Record<ResultReason, string> = {
  lp: 'LP 0',
  deck: 'デッキ切れ',
  special: '特殊勝利',
  other: 'その他',
};
/** winner が null なら引き分け */
export type DuelResult = { winner: Seat | null; reason: ResultReason; at: number };
export type DuelRecord = { p1: number; p2: number; draws: number };

export type Action =
  | { type: 'lpAdd'; seat: Seat; delta: number }
  | { type: 'lpSet'; seat: Seat; value: number }
  | { type: 'lpHalve'; seat: Seat }
  | { type: 'setPhase'; phase: Phase }
  | { type: 'nextPhase' }
  | { type: 'endTurn' }
  | { type: 'setTurnPlayer'; seat: Seat }
  | { type: 'setFirstPlayer'; seat: Seat }
  | { type: 'chainAdd'; card: string }
  | { type: 'chainResolve' }
  | { type: 'chainClear' }
  | { type: 'coin' }
  | { type: 'dice' }
  | { type: 'rename'; name: string }
  | { type: 'declareResult'; winner: Seat | null; reason: ResultReason }
  /** 決着後に次のデュエルへ進む。敗者を先攻の既定値にする */
  | { type: 'nextDuel' }
  /** 勝敗を記録せずに、いまのデュエルを最初からやり直す */
  | { type: 'resetDuel' }
  | { type: 'resetRecord' }
  | { type: 'undo' };

const LOG_MAX = 200;
const CHAIN_MAX = 30;
const LP_MAX = 999_999;

export function initialState(): GameState {
  return {
    version: 1,
    players: {
      p1: { name: '', lp: START_LP, clientId: null },
      p2: { name: '', lp: START_LP, clientId: null },
    },
    turn: 1,
    turnPlayer: 'p1',
    firstPlayer: 'p1',
    phase: 'DP',
    chain: [],
    log: [],
    lastRoll: null,
    duelNo: 1,
    result: null,
    record: { p1: 0, p2: 0, draws: 0 },
  };
}

/** 盤面だけを開始時に戻す(名前・先攻・戦績・履歴は残す) */
function freshBoard(st: GameState, firstPlayer: Seat): GameState {
  return {
    ...st,
    players: {
      p1: { ...st.players.p1, lp: START_LP },
      p2: { ...st.players.p2, lp: START_LP },
    },
    turn: 1,
    firstPlayer,
    turnPlayer: firstPlayer,
    phase: 'DP',
    chain: [],
    lastRoll: null,
    result: null,
  };
}

function addResult(record: DuelRecord, r: DuelResult, sign: 1 | -1): DuelRecord {
  const key = r.winner ?? 'draws';
  return { ...record, [key]: Math.max(0, record[key] + sign) };
}

export function resultText(st: GameState, r: DuelResult): string {
  const reason = REASON_LABEL[r.reason];
  return r.winner ? `${displayName(st, r.winner)}の勝ち(${reason})` : `引き分け(${reason})`;
}

export function displayName(st: GameState, seat: Seat): string {
  return st.players[seat].name || (seat === 'p1' ? 'プレイヤー1' : 'プレイヤー2');
}

export function appendLog(st: GameState, by: Seat | null, text: string): GameState {
  const id = (st.log.at(-1)?.id ?? 0) + 1;
  const log = [...st.log, { id, at: Date.now(), by, text }].slice(-LOG_MAX);
  return { ...st, log };
}

function randomInt(max: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}

function setLp(st: GameState, seat: Seat, lp: number, by: Seat): GameState {
  const before = st.players[seat].lp;
  const after = Math.min(LP_MAX, Math.max(0, Math.round(lp)));
  if (after === before) return st;
  const diff = after - before;
  const players = { ...st.players, [seat]: { ...st.players[seat], lp: after } };
  const sign = diff > 0 ? '+' : '';
  return appendLog({ ...st, players }, by, `${displayName(st, seat)} LP ${before} → ${after}(${sign}${diff})`);
}

/** 状態を1手進める。変化がなければ同じオブジェクトを返す。undo は呼び出し側で扱う */
export function reduce(st: GameState, action: Action, by: Seat): GameState {
  const next = step(st, action, by);
  return next === st ? st : { ...next, version: st.version + 1 };
}

function step(st: GameState, a: Action, by: Seat): GameState {
  const who = displayName(st, by);
  switch (a.type) {
    case 'lpAdd':
      return setLp(st, a.seat, st.players[a.seat].lp + a.delta, by);
    case 'lpSet':
      return setLp(st, a.seat, a.value, by);
    case 'lpHalve':
      return setLp(st, a.seat, Math.ceil(st.players[a.seat].lp / 2), by);
    case 'setPhase':
      if (a.phase === st.phase) return st;
      return appendLog({ ...st, phase: a.phase }, by, PHASE_LABEL[a.phase]);
    case 'nextPhase': {
      const i = PHASES.indexOf(st.phase);
      if (i === PHASES.length - 1) return step(st, { type: 'endTurn' }, by);
      // 先攻の1ターン目はバトルフェイズを行えず、バトルフェイズを行わないときはメインフェイズ2もない。
      // 止めはしないので、必要ならフェイズのボタンで直接選べる
      const phase = st.phase === 'M1' && st.turn === 1 ? 'EP' : PHASES[i + 1];
      return appendLog({ ...st, phase }, by, PHASE_LABEL[phase]);
    }
    case 'endTurn': {
      const turnPlayer = other(st.turnPlayer);
      const turn = st.turn + 1;
      return appendLog(
        { ...st, turn, turnPlayer, phase: 'DP', chain: [] },
        by,
        `ターン${turn}: ${displayName(st, turnPlayer)}のターン`,
      );
    }
    case 'setTurnPlayer':
      if (a.seat === st.turnPlayer) return st;
      return appendLog({ ...st, turnPlayer: a.seat }, by, `ターンプレイヤーを${displayName(st, a.seat)}に変更`);
    case 'setFirstPlayer': {
      if (a.seat === st.firstPlayer) return st;
      // 途中で変えても、いまのターン数に合ったターンプレイヤーにそろえる
      const turnPlayer = st.turn % 2 === 1 ? a.seat : other(a.seat);
      return appendLog({ ...st, firstPlayer: a.seat, turnPlayer }, by, `先攻: ${displayName(st, a.seat)}`);
    }
    case 'chainAdd': {
      const card = a.card.trim().slice(0, 60);
      if (!card || st.chain.length >= CHAIN_MAX) return st;
      const chain = [...st.chain, { card, by, resolved: false }];
      return appendLog({ ...st, chain }, by, `チェーン${chain.length}: ${card}(${who})`);
    }
    case 'chainResolve': {
      const idx = st.chain.map((l) => l.resolved).lastIndexOf(false);
      if (idx < 0) return st;
      const chain = st.chain.map((l, i) => (i === idx ? { ...l, resolved: true } : l));
      return appendLog({ ...st, chain }, by, `チェーン${idx + 1} 解決: ${st.chain[idx].card}`);
    }
    case 'chainClear':
      if (st.chain.length === 0) return st;
      return appendLog({ ...st, chain: [] }, by, 'チェーンをクリア');
    case 'coin':
    case 'dice': {
      const value = a.type === 'coin' ? (randomInt(2) === 0 ? '表' : '裏') : String(randomInt(6) + 1);
      const lastRoll: Roll = { id: (st.lastRoll?.id ?? 0) + 1, kind: a.type, value, by, at: Date.now() };
      const what = a.type === 'coin' ? 'コイントス' : 'サイコロ';
      return appendLog({ ...st, lastRoll }, by, `${who}の${what}: ${value}`);
    }
    case 'rename': {
      const name = a.name.trim().slice(0, 20);
      if (name === st.players[by].name) return st;
      const players = { ...st.players, [by]: { ...st.players[by], name } };
      return appendLog({ ...st, players }, by, `${who} → ${name || '(名前なし)'} に改名`);
    }
    case 'declareResult': {
      if (st.result) return st;
      const result: DuelResult = { winner: a.winner, reason: a.reason, at: Date.now() };
      const record = addResult(st.record, result, 1);
      return appendLog({ ...st, result, record }, by, `デュエル${st.duelNo}: ${resultText(st, result)}`);
    }
    case 'nextDuel': {
      if (!st.result) return st;
      // 2戦目以降は直前のデュエルの敗者が先攻・後攻を選ぶので、敗者を先攻の既定値にする。引き分けなら変えない
      const loser = st.result.winner ? other(st.result.winner) : st.firstPlayer;
      const next = { ...freshBoard(st, loser), duelNo: st.duelNo + 1 };
      return appendLog(next, by, `デュエル${next.duelNo}を開始(先攻: ${displayName(st, loser)})`);
    }
    case 'resetDuel': {
      // 決着を付けたあとのやり直しなら、その勝敗も戦績から取り消す
      const record = st.result ? addResult(st.record, st.result, -1) : st.record;
      return appendLog(
        { ...freshBoard(st, st.firstPlayer), record },
        by,
        `デュエル${st.duelNo}をやり直し(先攻: ${displayName(st, st.firstPlayer)})`,
      );
    }
    case 'resetRecord': {
      const { p1, p2, draws } = st.record;
      if (p1 + p2 + draws === 0) return st;
      return appendLog({ ...st, record: { p1: 0, p2: 0, draws: 0 } }, by, '通算の戦績をリセット');
    }
    case 'undo':
      return st;
  }
}

const isSeat = (v: unknown): v is Seat => v === 'p1' || v === 'p2';
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** ゲストから届いた操作は信用せず、形を確かめてから使う。不正なら null */
export function parseAction(v: unknown): Action | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  switch (a.type) {
    case 'lpAdd':
      return isSeat(a.seat) && isInt(a.delta, -LP_MAX, LP_MAX) ? { type: a.type, seat: a.seat, delta: a.delta } : null;
    case 'lpSet':
      return isSeat(a.seat) && isInt(a.value, 0, LP_MAX) ? { type: a.type, seat: a.seat, value: a.value } : null;
    case 'lpHalve':
    case 'setTurnPlayer':
    case 'setFirstPlayer':
      return isSeat(a.seat) ? { type: a.type, seat: a.seat } : null;
    case 'setPhase':
      return PHASES.includes(a.phase as Phase) ? { type: a.type, phase: a.phase as Phase } : null;
    case 'chainAdd':
      return isText(a.card, 200) ? { type: a.type, card: a.card } : null;
    case 'rename':
      return isText(a.name, 100) ? { type: a.type, name: a.name } : null;
    case 'declareResult':
      return (a.winner === null || isSeat(a.winner)) && typeof a.reason === 'string' && Object.hasOwn(REASON_LABEL, a.reason)
        ? { type: a.type, winner: a.winner, reason: a.reason as ResultReason }
        : null;
    case 'nextPhase':
    case 'endTurn':
    case 'chainResolve':
    case 'chainClear':
    case 'coin':
    case 'dice':
    case 'nextDuel':
    case 'resetDuel':
    case 'resetRecord':
    case 'undo':
      return { type: a.type };
    default:
      return null;
  }
}

function isGameState(v: unknown): v is GameState {
  const s = v as GameState;
  return !!s && typeof s.version === 'number' && !!s.players?.p1 && !!s.players?.p2 && Array.isArray(s.log);
}

const storageKey = (room: string) => `ygord-state-${room}`;

export function loadState(room: string): GameState | null {
  try {
    const raw = localStorage.getItem(storageKey(room));
    const v = raw ? JSON.parse(raw) : null;
    if (!isGameState(v)) return null;
    // 後から足した項目がない古い保存データは、既定値で補って読み込む
    return {
      ...v,
      firstPlayer: isSeat(v.firstPlayer) ? v.firstPlayer : 'p1',
      duelNo: isInt(v.duelNo, 1, 1_000_000) ? v.duelNo : 1,
      result: v.result ?? null,
      record: v.record ?? { p1: 0, p2: 0, draws: 0 },
    };
  } catch {
    return null;
  }
}

export function saveState(room: string, st: GameState): void {
  try {
    localStorage.setItem(storageKey(room), JSON.stringify(st));
  } catch {
    // 保存できなくても対戦は続けられる
  }
}
