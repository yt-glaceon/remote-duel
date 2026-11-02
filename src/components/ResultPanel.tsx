import { useState } from 'react';
import {
  displayName,
  other,
  REASON_LABEL,
  resultText,
  SEATS,
  type Action,
  type GameState,
  type ResultReason,
  type Seat,
} from '../game/state';

type Props = { state: GameState; dispatch: (a: Action) => void; readOnly: boolean };

/** 勝敗の宣言、次のデュエル・やり直し、通算の戦績 */
export function ResultPanel({ state, dispatch, readOnly }: Props) {
  const zero = SEATS.filter((s) => state.players[s].lp === 0);
  const [reason, setReason] = useState<ResultReason | ''>('');
  // LP が 0 のプレイヤーがいれば理由の既定値を「LP 0」にする
  const effectiveReason: ResultReason = reason || (zero.length > 0 ? 'lp' : 'other');
  const r = state.result;
  const rec = state.record;

  const declare = (winner: Seat | null) => {
    dispatch({ type: 'declareResult', winner, reason: effectiveReason });
    setReason('');
  };

  return (
    <div className={`panel result-panel ${!r && zero.length > 0 ? 'alert' : ''}`}>
      <div className="panel-head">
        <strong>デュエル {state.duelNo}</strong>
        <span className="muted small">
          通算 {displayName(state, 'p1')} {rec.p1}勝 − {rec.p2}勝 {displayName(state, 'p2')}
          {rec.draws > 0 && `(引き分け ${rec.draws})`}
        </span>
      </div>

      {r ? (
        <div className={`result-banner ${r.winner ? `win-${r.winner}` : 'draw'}`}>{resultText(state, r)}</div>
      ) : (
        zero.length > 0 && (
          <p className="small result-hint">
            {zero.length === 2
              ? 'お互いの LP が 0 です。引き分けなら「引き分け」で確定してください'
              : `${displayName(state, zero[0])}の LP が 0 です。勝敗を確定してください`}
          </p>
        )
      )}

      {!readOnly && (
        <>
          {!r && (
            <>
              <div className="result-buttons">
                <span className="muted small">勝者</span>
                {SEATS.map((s) => (
                  <button
                    key={s}
                    // LP が 0 になった相手側の勝ちボタンを目立たせる
                    className={zero.length === 1 && zero[0] === other(s) ? 'primary' : ''}
                    onClick={() => declare(s)}
                    title={`${displayName(state, s)}の勝ちで確定`}
                  >
                    {displayName(state, s)}
                  </button>
                ))}
                <button className={zero.length === 2 ? 'primary' : ''} onClick={() => declare(null)}>
                  引き分け
                </button>
              </div>
              <label className="row small muted">
                理由
                <select value={effectiveReason} onChange={(e) => setReason(e.target.value as ResultReason)}>
                  {(Object.keys(REASON_LABEL) as ResultReason[]).map((k) => (
                    <option key={k} value={k}>
                      {REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <div className="row">
            {r && (
              <button className="primary" onClick={() => dispatch({ type: 'nextDuel' })}>
                次のデュエル ▶
              </button>
            )}
            <button
              onClick={() =>
                confirm(
                  r
                    ? 'このデュエルの勝敗を取り消して、最初からやり直しますか?'
                    : 'LP を 8000 に戻して、このデュエルを最初からやり直しますか?(勝敗は記録しません)',
                ) && dispatch({ type: 'resetDuel' })
              }
            >
              やり直し
            </button>
            <span className="spacer" />
            <button
              className="small-btn"
              disabled={rec.p1 + rec.p2 + rec.draws === 0}
              onClick={() => confirm('通算の戦績を 0 に戻しますか?') && dispatch({ type: 'resetRecord' })}
            >
              戦績をリセット
            </button>
          </div>
          {r && (
            <p className="muted small">
              次のデュエルは、負けたプレイヤーが先攻になります(先攻・後攻は、ターン欄のボタンで変えられます)
            </p>
          )}
        </>
      )}
    </div>
  );
}
