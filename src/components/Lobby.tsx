import { useState } from 'react';
import { getClientId, loadName, saveName, shortRoom } from '../identity';
import { createHostKey } from '../net/hostKey';

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
      <p className="muted">ルーム {shortRoom(room)} に招待されています。</p>
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
    <div className="lobby">
      <h1>リモートデュエル</h1>
      <p className="muted">ライフ・フェイズ・チェーンを共有し、相手のカメラ映像を手元で拡大して見られます。</p>
      {invalidLink && <p className="error">このリンクは使えません。古い形式のリンクの場合は、ホストに新しい招待リンクをもらってください。</p>}
      <label className="field">
        <span>あなたの名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="例: たろう" />
      </label>
      <div className="card">
        <h2>ルームを作る</h2>
        <p className="muted">作ったあと、招待リンクを相手に送ってください。</p>
        <button className="primary" onClick={() => void create()}>
          ルームを作る
        </button>
        {createError && <p className="error">{createError}</p>}
      </div>
      <div className="card">
        <h2>ルームに入る</h2>
        <div className="row">
          <input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            placeholder="招待リンク"
          />
          <button onClick={join}>入る</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
