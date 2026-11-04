import { useEffect, useRef, useState } from 'react';
import { parseLpInput, type LpOp } from '../game/lpInput';
import { displayName, other, PHASE_LABEL, PHASES, SEATS, type Action, type GameState, type Seat } from '../game/state';
import { SevenSeg } from './SevenSeg';

type Props = { state: GameState; me: Seat; dispatch: (a: Action) => void; readOnly: boolean };

/** 席の色の印。色だけに頼らず、名前と並べて使う */
export function SeatMark({ seat }: { seat: Seat }) {
  return <i className={`seat-mark seat-${seat}`} aria-hidden />;
}

/**
 * 両者の LP と、入力欄。入力欄は1つにまとめ、行を選んでどちらの LP を変えるかを決める。
 * 既定は自分で、選んだ先は入力欄の案内と計算結果に名前で出す
 */
export function LpBoard({ state, me, dispatch, readOnly }: Props) {
  const [target, setTarget] = useState<Seat>(me);
  useEffect(() => setTarget(me), [me]);
  return (
    <section className="lp-board">
      {[other(me), me].map((s) => (
        <LpRow
          key={s}
          state={state}
          seat={s}
          selected={!readOnly && s === target}
          onSelect={readOnly ? undefined : () => setTarget(s)}
        />
      ))}
      {!readOnly && <LpEntry state={state} seat={target} dispatch={dispatch} />}
    </section>
  );
}

/** LP が変わったとき、電卓の数字のように数えながら新しい値へ動かす。動きを減らす設定なら、すぐ切り替える */
function useCountedLp(target: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const start = current.current;
    if (start === target) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = target;
      setShown(target);
      return;
    }
    const begin = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - begin) / 700);
      const v = Math.round(start + (target - start) * (1 - (1 - k) ** 3));
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** 表示中の LP と、直前の増減。増減は変わった直後の少しの間だけ返す */
function useLpDisplay(lp: number) {
  const shown = useCountedLp(lp);
  const [change, setChange] = useState<number | null>(null);
  const prev = useRef(lp);
  useEffect(() => {
    if (lp === prev.current) return;
    setChange(lp - prev.current);
    prev.current = lp;
    const t = setTimeout(() => setChange(null), 1200);
    return () => clearTimeout(t);
  }, [lp]);
  return { shown, change };
}

function lpClass(lp: number, change: number | null) {
  const flash = change === null ? '' : change < 0 ? 'down' : 'up';
  return `lp-value ${flash} ${lp === 0 ? 'zero' : ''}`;
}

/** 映像の左上に重ねる、映っている人の名前と LP。視線を映像から外さずに読めるようにする */
export function VideoTag({ state, seat, label }: { state: GameState; seat: Seat; label: string }) {
  const lp = state.players[seat].lp;
  const { shown, change } = useLpDisplay(lp);
  return (
    <div className="video-tag">
      <span className="video-tag-name">
        <SeatMark seat={seat} />
        {displayName(state, seat)}の{label}
      </span>
      <span className={lpClass(lp, change)} role="img" aria-label={`LP ${lp}`}>
        <SevenSeg value={shown} />
      </span>
    </div>
  );
}

function LpRow({
  state,
  seat,
  selected,
  onSelect,
}: {
  state: GameState;
  seat: Seat;
  selected: boolean;
  onSelect?: () => void;
}) {
  const p = state.players[seat];
  const { shown, change } = useLpDisplay(p.lp);
  const turn = state.turnPlayer === seat;

  const value = (
    <span className={lpClass(p.lp, change)} role="img" aria-label={`LP ${p.lp}`}>
      <SevenSeg value={shown} />
    </span>
  );

  return (
    <div className={`lp-row lp-row-${seat} ${selected ? 'selected' : ''} ${turn ? 'turn' : ''}`} onClick={onSelect}>
      <div className="lp-who">
        <span className="lp-name">
          <SeatMark seat={seat} />
          {displayName(state, seat)}
        </span>
        <span className="lp-meta">
          {state.firstPlayer === seat ? '先攻' : '後攻'}
          {turn && <b>ターン</b>}
          {change !== null && (
            <span className={change < 0 ? 'lp-delta down' : 'lp-delta up'}>
              {change < 0 ? `−${-change}` : `+${change}`}
            </span>
          )}
        </span>
      </div>
      {onSelect ? (
        <button className="lp-pick" aria-pressed={selected} title="この LP を変更する">
          {value}
        </button>
      ) : (
        value
      )}
    </div>
  );
}

function LpEntry({ state, seat, dispatch }: { state: GameState; seat: Seat; dispatch: (a: Action) => void }) {
  const lp = state.players[seat].lp;
  const name = displayName(state, seat);
  const [input, setInput] = useState('');

  // 数値でも式でもよい。「1800」はダメージ、「+500」は回復、「=4000」は値の指定
  const submit = (mode?: LpOp['kind']) => {
    const op = parseLpInput(input, mode);
    if (!op) return;
    if (op.kind === 'set') dispatch({ type: 'lpSet', seat, value: op.amount });
    else dispatch({ type: 'lpAdd', seat, delta: op.kind === 'heal' ? op.amount : -op.amount });
    setInput('');
  };
  const typing = !!input.trim();
  const preview = typing ? parseLpInput(input) : null;
  const after =
    preview && Math.max(0, preview.kind === 'set' ? preview.amount : lp + (preview.kind === 'heal' ? preview.amount : -preview.amount));

  return (
    <div className="lp-entry">
      <div className="row">
        <input
          className="lp-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
          placeholder={`${name}の LP`}
          title="数字か式(+ - * / と括弧)。Enter はダメージ。先頭に + で回復、= で値の指定"
        />
        <button onClick={() => submit('damage')} className="key danger">
          ダメージ
        </button>
        <button className="key" onClick={() => submit('heal')}>
          回復
        </button>
        <button className="key" onClick={() => submit('set')} title="入力した値を LP にする">
          指定
        </button>
      </div>
      {/* 計算結果は、固定額のボタンと同じ場所に出す。入力中に下の欄が動かないようにするため */}
      {typing ? (
        <div className={`lp-preview ${preview ? '' : 'error'}`}>
          {preview
            ? `${name} ${lp} → ${after}(Enter で${{ damage: 'ダメージ', heal: '回復', set: '指定' }[preview.kind]})`
            : '計算できない式です'}
        </div>
      ) : (
        <div className="row chips">
          {[100, 500, 1000].map((n) => (
            <button key={n} className="key" onClick={() => dispatch({ type: 'lpAdd', seat, delta: -n })}>
              −{n}
            </button>
          ))}
          <button className="key" onClick={() => dispatch({ type: 'lpHalve', seat })}>
            半分
          </button>
        </div>
      )}
    </div>
  );
}

export function TurnBar({ state, dispatch, readOnly, canUndo }: Props & { canUndo: boolean }) {
  return (
    <section className="rail-sec">
      <div className="turn-line">
        <span className="turn-no">
          ターン <b>{state.turn}</b>
        </span>
        <span className="turn-who">
          <SeatMark seat={state.turnPlayer} />
          {displayName(state, state.turnPlayer)}
        </span>
        <span className="muted">{PHASE_LABEL[state.phase]}</span>
      </div>
      <div className="phases">
        {PHASES.map((ph) => (
          <button
            key={ph}
            className={ph === state.phase ? 'active' : ''}
            disabled={readOnly}
            onClick={() => dispatch({ type: 'setPhase', phase: ph })}
            title={PHASE_LABEL[ph]}
          >
            {ph}
          </button>
        ))}
      </div>
      {!readOnly && (
        <div className="row turn-actions">
          <button className="key primary" onClick={() => dispatch({ type: 'nextPhase' })}>
            次のフェイズ
          </button>
          <button className="key" onClick={() => dispatch({ type: 'endTurn' })}>
            ターン終了
          </button>
          <button className="key" disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} title="直前の操作を取り消す">
            戻す
          </button>
        </div>
      )}
    </section>
  );
}

export function ChainPanel({ state, dispatch, readOnly }: Props) {
  const [card, setCard] = useState('');
  const add = () => {
    if (!card.trim()) return;
    dispatch({ type: 'chainAdd', card });
    setCard('');
  };
  const hasChain = state.chain.length > 0;
  return (
    <section className="rail-sec chain-sec">
      <h3>
        チェーン{hasChain && <span> {state.chain.length}</span>}
      </h3>
      {hasChain && (
        <ol className="chain">
          {state.chain.map((l, i) => (
            <li key={i} className={l.resolved ? 'resolved' : ''}>
              <span className="chain-no">{i + 1}</span>
              <SeatMark seat={l.by} />
              <span className="chain-card">{l.card}</span>
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <div className="row">
          <input
            value={card}
            maxLength={60}
            onChange={(e) => setCard(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
            placeholder="カード名"
          />
          <button onClick={add}>積む</button>
          {hasChain && (
            <>
              <button disabled={!state.chain.some((l) => !l.resolved)} onClick={() => dispatch({ type: 'chainResolve' })}>
                解決
              </button>
              <button onClick={() => dispatch({ type: 'chainClear' })}>消す</button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function rollText(r: NonNullable<GameState['lastRoll']>) {
  return `${r.kind === 'coin' ? 'コイン' : 'サイコロ'} ${r.value}`;
}

/** どのタブを開いていても見落とさないよう、振られた直後だけ結果を出す */
export function RollFlash({ state }: { state: GameState }) {
  const r = state.lastRoll;
  const prevId = useRef(r?.id);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!r) {
      prevId.current = undefined;
      setShow(false);
      return;
    }
    if (r.id === prevId.current) return;
    prevId.current = r.id;
    setShow(true);
    const t = setTimeout(() => setShow(false), 10_000);
    return () => clearTimeout(t);
  }, [r?.id]);
  if (!show || !r) return null;
  return (
    <div className="roll-flash" role="status">
      <SeatMark seat={r.by} />
      {displayName(state, r.by)}
      <b>{rollText(r)}</b>
    </div>
  );
}

export function RollPanel({ state, dispatch, readOnly }: Props) {
  const r = state.lastRoll;
  return (
    <div className="tab-sec">
      {!readOnly && (
        <div className="row">
          <button onClick={() => dispatch({ type: 'coin' })}>コイントス</button>
          <button onClick={() => dispatch({ type: 'dice' })}>サイコロ</button>
          {r && <span className="roll-last">{rollText(r)}</span>}
        </div>
      )}
      {readOnly && <p className="muted small">{r ? rollText(r) : 'コイン・サイコロはまだ振られていません'}</p>}
    </div>
  );
}

export function FirstPlayer({ state, dispatch, readOnly }: Props) {
  return (
    <div className="tab-sec first-player">
      <span className="muted small">先攻</span>
      {SEATS.map((s) => (
        <button
          key={s}
          className={state.firstPlayer === s ? 'active' : ''}
          disabled={readOnly}
          onClick={() => dispatch({ type: 'setFirstPlayer', seat: s })}
        >
          {displayName(state, s)}
        </button>
      ))}
    </div>
  );
}

export function LogPanel({ state }: Pick<Props, 'state'>) {
  const fmt = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <ul className="log">
      {[...state.log].reverse().map((e) => (
        <li key={e.id}>
          <time>{fmt(e.at)}</time>
          {e.by && <SeatMark seat={e.by} />}
          <span>{e.text}</span>
        </li>
      ))}
    </ul>
  );
}
