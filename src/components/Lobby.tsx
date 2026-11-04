import { useState, type ReactNode } from 'react';
import { getClientId, loadName, saveName, shortRoom } from '../identity';
import { createHostKey } from '../net/hostKey';
import { SevenSeg } from './SevenSeg';

/** 俯瞰のカメラに映る卓の絵。実在のカードは描かず、位置と色だけの無地のカードにする */
const TABLE_CARDS: [x: number, y: number, rotate: number, color: string][] = [
  [510, 250, -1.5, '#a8854f'],
  [910, 246, 2, '#5f6f8f'],
  [310, 532, 1.5, '#8a5a68'],
  [510, 528, -2.5, '#a8854f'],
  [710, 534, 1, '#6d7f58'],
  [1110, 530, -1, '#5f6f8f'],
  [1330, 300, 4, '#3b3e44'],
];

function TableScene() {
  return (
    <svg className="table-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="1600" height="1000" fill="#17231f" />
      {[210, 492].map((y) =>
        [270, 470, 670, 870, 1070].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="170" height="250" rx="4" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="2" />
        )),
      )}
      {TABLE_CARDS.map(([x, y, rotate, color]) => (
        <g key={`${x}-${y}`} transform={`rotate(${rotate} ${x + 75} ${y + 109})`}>
          <rect x={x + 5} y={y + 7} width="150" height="218" rx="5" fill="#000" fillOpacity="0.4" />
          <rect x={x} y={y} width="150" height="218" rx="5" fill={color} />
          <rect x={x + 16} y={y + 42} width="118" height="104" fill="#000" fillOpacity="0.28" />
          <rect x={x + 16} y={y + 16} width="88" height="9" fill="#000" fillOpacity="0.32" />
          <rect x={x + 16} y={y + 162} width="118" height="5" fill="#000" fillOpacity="0.26" />
          <rect x={x + 16} y={y + 176} width="96" height="5" fill="#000" fillOpacity="0.26" />
        </g>
      ))}
    </svg>
  );
}

/** 最初の画面も対戦画面と同じ形にする。左が映像の枠、右が操作の列 */
function LobbyShell({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  return (
    <main className="lobby">
      <section className="lobby-stage">
        <TableScene />
        <p className="lobby-lead">{lead}</p>
      </section>
      <section className="lobby-rail">
        <h1>リモートデュエル</h1>
        <SevenSeg value={8000} className="lobby-lp" />
        {children}
      </section>
    </main>
  );
}

/** 招待リンクを開いた人が、対戦するか観戦するかを選ぶ画面 */
export function JoinChoice({ room }: { room: string }) {
  const [name, setName] = useState(loadName());
  const join = (as: 'play' | 'watch') => {
    saveName(name.trim());
    location.search = new URLSearchParams({ room, as }).toString();
  };
  return (
    <LobbyShell lead={<>ルーム <code>{shortRoom(room)}</code> への招待</>}>
      <label className="field">
        <span>名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="たろう" />
      </label>
      <button className="key primary lobby-go" onClick={() => join('play')}>
        対戦する
      </button>
      <button className="key lobby-go" onClick={() => join('watch')}>
        観戦する
      </button>
      <p className="muted small">席が埋まっているときは観戦になります。観戦は4人まで。</p>
    </LobbyShell>
  );
}

export function Lobby({ invalidLink = false }: { invalidLink?: boolean }) {
  const [name, setName] = useState(loadName());
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');

  const go = (params: Record<string, string>) => {
    saveName(name.trim());
    location.search = new URLSearchParams(params).toString();
  };

  const create = async () => {
    setCreateError('');
    try {
      go({ room: await createHostKey(getClientId()), host: '1' });
    } catch {
      setCreateError('ルームを作れませんでした。ブラウザの設定でサイトのデータの保存が許可されているか確かめてください');
    }
  };

  const join = () => {
    // 部屋 ID にはホストの確認に使う情報が入っているので、手入力ではなく招待リンクで入ってもらう
    const m = link.trim().toLowerCase().match(/[?&]room=([0-9a-f]{32})(?:[&#]|$)/);
    if (!m) {
      setError('招待リンクをそのまま貼ってください');
      return;
    }
    go({ room: m[1] });
  };

  return (
    <LobbyShell
      lead={
        <>
          <span>手元のカードをカメラに映して、</span>
          <span>離れた相手と対戦する。</span>
        </>
      }
    >
      {invalidLink && <p className="error">このリンクは使えません。古い形式のリンクの場合は、ホストに新しい招待リンクをもらってください。</p>}
      <label className="field">
        <span>名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="たろう" />
      </label>
      <button className="key primary lobby-go" onClick={() => void create()}>
        ルームを作る
      </button>
      {createError && <p className="error">{createError}</p>}
      <div className="lobby-join">
        <label className="field">
          <span>招待リンクがあるとき</span>
          <div className="row">
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="https://…"
            />
            <button onClick={join}>入る</button>
          </div>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </LobbyShell>
  );
}
