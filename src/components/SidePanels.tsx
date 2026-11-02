import { useEffect, useRef, useState } from 'react';
import { displayName, PHASE_LABEL, PHASES, type Action, type GameState, type Seat } from '../game/state';

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

  // 「1800」はダメージ、「+500」は回復、「=4000」は値の指定
  const submit = (mode?: 'damage' | 'heal' | 'set') => {
    const raw = input.trim().replace(/[，,]/g, '');
    const m = raw.match(/^([+\-=]?)(\d{1,6})$/);
    if (!m) return;
    const n = Number(m[2]);
    const kind = mode ?? (m[1] === '+' ? 'heal' : m[1] === '=' ? 'set' : 'damage');
    if (kind === 'set') dispatch({ type: 'lpSet', seat, value: n });
    else dispatch({ type: 'lpAdd', seat, delta: kind === 'heal' ? n : -n });
    setInput('');
  };

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
        {state.turnPlayer === seat && <span className="badge">ターン</span>}
      </div>
      <div className={`lp-value ${flash ?? ''} ${p.lp === 0 ? 'zero' : ''}`}>{p.lp}</div>
      {!readOnly && (
        <>
          <div className="row">
            <input
              className="lp-input"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="1800 / +500 / =4000"
            />
            <button onClick={() => submit('damage')} className="danger">
              ダメージ
            </button>
            <button onClick={() => submit('heal')}>回復</button>
          </div>
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
        <span className="muted">{displayName(state, state.turnPlayer)}のターン</span>
      </div>
      <div className="phases">
        {PHASES.map((ph) => (
          <button
            key={ph}
            className={ph === state.phase ? 'active' : ''}
            disabled={readOnly}
            onClick={() => dispatch({ type: 'setPhase', phase: ph })}
            title={`${PHASE_LABEL[ph]}フェイズ`}
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

export function LogPanel({ state, dispatch, readOnly }: Props) {
  const fmt = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>履歴</strong>
        {!readOnly && (
          <button
            className="small-btn"
            onClick={() => confirm('LP を 8000 に戻して新しいデュエルを始めますか?') && dispatch({ type: 'resetDuel' })}
          >
            新しいデュエル
          </button>
        )}
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
