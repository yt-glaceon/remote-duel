import { useEffect, useRef, useState } from 'react';
import { parseLpInput, type LpOp } from '../game/lpInput';
import { displayName, PHASE_LABEL, PHASES, SEATS, type Action, type GameState, type Seat } from '../game/state';

type Props = { state: GameState; me: Seat; dispatch: (a: Action) => void; readOnly: boolean };

export function LpCard({ state, seat, isMe, dispatch, readOnly }: Props & { seat: Seat; isMe: boolean }) {
  const p = state.players[seat];
  const [input, setInput] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [flash, setFlash] = useState<'down' | 'up' | null>(null);
  const prevLp = useRef(p.lp);

  useEffect(() => {
    if (p.lp === prevLp.current) return;
    setFlash(p.lp < prevLp.current ? 'down' : 'up');
    prevLp.current = p.lp;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [p.lp]);

  // 数値でも式でもよい。「1800」はダメージ、「+500」は回復、「=4000」は値の指定
  const submit = (mode?: LpOp['kind']) => {
    const op = parseLpInput(input, mode);
    if (!op) return;
    if (op.kind === 'set') dispatch({ type: 'lpSet', seat, value: op.amount });
    else dispatch({ type: 'lpAdd', seat, delta: op.kind === 'heal' ? op.amount : -op.amount });
    setInput('');
  };
  const preview = input.trim() ? parseLpInput(input) : null;
  const after =
    preview &&
    Math.max(0, preview.kind === 'set' ? preview.amount : p.lp + (preview.kind === 'heal' ? preview.amount : -preview.amount));

  return (
    <div className={`lp-card ${isMe ? 'me' : 'opp'} ${state.turnPlayer === seat ? 'turn' : ''}`}>
      <div className="lp-head">
        {isMe && editingName ? (
          <input
            autoFocus
            defaultValue={p.name}
            maxLength={20}
            onBlur={(e) => {
              dispatch({ type: 'rename', name: e.target.value });
              setEditingName(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <span className="lp-name" onClick={() => isMe && !readOnly && setEditingName(true)} title={isMe ? 'クリックで名前を変更' : ''}>
            {displayName(state, seat)}
            {isMe && <small> (あなた)</small>}
          </span>
        )}
        <span className="badges">
          <span className="badge-sub">{state.firstPlayer === seat ? '先攻' : '後攻'}</span>
          {state.turnPlayer === seat && <span className="badge">ターン</span>}
        </span>
      </div>
      <div className={`lp-value ${flash ?? ''} ${p.lp === 0 ? 'zero' : ''}`}>{p.lp}</div>
      {!readOnly && (
        <>
          <div className="row">
            <input
              className="lp-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
              placeholder="例: 1800、2400*2"
              title="数字か式(+ - * / と括弧)。Enter はダメージ。先頭に + で回復、= で値の指定もできる"
            />
            <button onClick={() => submit('damage')} className="danger">
              ダメージ
            </button>
            <button onClick={() => submit('heal')}>回復</button>
            <button onClick={() => submit('set')} title="入力した値を LP にする">
              指定
            </button>
          </div>
          {input.trim() && (
            <div className={`lp-preview small ${preview ? '' : 'error'}`}>
              {preview
                ? `Enter で${{ damage: 'ダメージ', heal: '回復', set: '指定' }[preview.kind]} ${preview.amount}(${p.lp} → ${after})`
                : '計算できない式です'}
            </div>
          )}
          <div className="row chips">
            {[100, 500, 1000].map((n) => (
              <button key={n} onClick={() => dispatch({ type: 'lpAdd', seat, delta: -n })}>
                −{n}
              </button>
            ))}
            <button onClick={() => dispatch({ type: 'lpHalve', seat })}>半分</button>
          </div>
        </>
      )}
    </div>
  );
}

export function TurnBar({ state, dispatch, readOnly, canUndo }: Props & { canUndo: boolean }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>ターン {state.turn}</strong>
        <span className="muted">
          {displayName(state, state.turnPlayer)}のターン・{PHASE_LABEL[state.phase]}
        </span>
      </div>
      <div className="first-player">
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
        <div className="row">
          <button onClick={() => dispatch({ type: 'nextPhase' })}>次のフェイズ ▶</button>
          <button onClick={() => dispatch({ type: 'endTurn' })}>ターン終了</button>
          <button disabled={!canUndo} onClick={() => dispatch({ type: 'undo' })} title="直前の操作を取り消す">
            ↶ 戻す
          </button>
        </div>
      )}
    </div>
  );
}

export function ChainPanel({ state, dispatch, readOnly }: Props) {
  const [card, setCard] = useState('');
  const add = () => {
    if (!card.trim()) return;
    dispatch({ type: 'chainAdd', card });
    setCard('');
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>チェーン</strong>
        {state.chain.length > 0 && <span className="muted">{state.chain.length} 個</span>}
      </div>
      {state.chain.length === 0 ? (
        <p className="muted small">なし</p>
      ) : (
        <ol className="chain">
          {state.chain.map((l, i) => (
            <li key={i} className={`${l.resolved ? 'resolved' : ''} by-${l.by}`}>
              <span className="chain-no">{i + 1}</span>
              <span className="chain-card">{l.card}</span>
              <span className="muted small">{displayName(state, l.by)}</span>
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <>
          <div className="row">
            <input
              value={card}
              maxLength={60}
              onChange={(e) => setCard(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
              placeholder="カード名(例: 灰流うらら)"
            />
            <button onClick={add}>積む</button>
          </div>
          <div className="row">
            <button disabled={!state.chain.some((l) => !l.resolved)} onClick={() => dispatch({ type: 'chainResolve' })}>
              1つ解決
            </button>
            <button disabled={state.chain.length === 0} onClick={() => dispatch({ type: 'chainClear' })}>
              クリア
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function RollPanel({ state, dispatch, readOnly }: Props) {
  const r = state.lastRoll;
  const fresh = r && Date.now() - r.at < 10_000;
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>コイン・サイコロ</strong>
      </div>
      {r && (
        <div key={r.id} className={`roll ${fresh ? 'fresh' : ''}`}>
          <span className="roll-value">{r.kind === 'coin' ? `🪙 ${r.value}` : `🎲 ${r.value}`}</span>
          <span className="muted small">{displayName(state, r.by)}が振った</span>
        </div>
      )}
      {!readOnly && (
        <div className="row">
          <button onClick={() => dispatch({ type: 'coin' })}>コイントス</button>
          <button onClick={() => dispatch({ type: 'dice' })}>サイコロ</button>
        </div>
      )}
    </div>
  );
}

export function LogPanel({ state }: Pick<Props, 'state'>) {
  const fmt = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>履歴</strong>
      </div>
      <ul className="log">
        {[...state.log].reverse().map((e) => (
          <li key={e.id} className={e.by ? `by-${e.by}` : ''}>
            <span className="muted small">{fmt(e.at)}</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
