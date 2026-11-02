import { useState } from 'react';
import { loadName, newRoomId, ROOM_RE, saveName } from '../identity';

/** 招待リンクを開いた人が、対戦するか観戦するかを選ぶ画面 */
export function JoinChoice({ room }: { room: string }) {
  const [name, setName] = useState(loadName());
  const join = (as: 'play' | 'watch') => {
    saveName(name.trim());
    location.search = new URLSearchParams({ room, as }).toString();
  };
  return (
    <div className="lobby">
      <h1>リモートデュエル</h1>
      <p className="muted">ルーム {room} に招待されています。</p>
      <label className="field">
        <span>あなたの名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="例: たろう" />
      </label>
      <div className="card">
        <h2>対戦する</h2>
        <p className="muted">対戦相手として参加します。席が埋まっているときは観戦になります。</p>
        <button className="primary" onClick={() => join('play')}>
          対戦する
        </button>
      </div>
      <div className="card">
        <h2>観戦する</h2>
        <p className="muted">LP やカメラ映像を見るだけで、操作はしません(観戦は4人まで)。</p>
        <button onClick={() => join('watch')}>観戦する</button>
      </div>
    </div>
  );
}

export function Lobby() {
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const go = (params: Record<string, string>) => {
    saveName(name.trim());
    location.search = new URLSearchParams(params).toString();
  };

  const join = () => {
    // 招待リンクを丸ごと貼られても、ルームコードだけを取り出す
    const m = code.trim().toLowerCase().match(/room=([a-z0-9]+)/);
    const room = m ? m[1] : code.trim().toLowerCase();
    if (!ROOM_RE.test(room)) {
      setError('ルームコードか招待リンクを入れてください');
      return;
    }
    go({ room });
  };

  return (
    <div className="lobby">
      <h1>リモートデュエル</h1>
      <p className="muted">ライフ・フェイズ・チェーンを共有し、相手のカメラ映像を手元で拡大して見られます。</p>
      <label className="field">
        <span>あなたの名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="例: たろう" />
      </label>
      <div className="card">
        <h2>ルームを作る</h2>
        <p className="muted">作ったあと、招待リンクを相手に送ってください。</p>
        <button className="primary" onClick={() => go({ room: newRoomId(), host: '1' })}>
          ルームを作る
        </button>
      </div>
      <div className="card">
        <h2>ルームに入る</h2>
        <div className="row">
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="ルームコード または 招待リンク"
          />
          <button onClick={join}>入る</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
