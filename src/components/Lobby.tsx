import { useState } from 'react';
import { getClientId, loadName, saveName, shortRoom } from '../identity';
import { createHostKey } from '../net/hostKey';
import { SevenSeg } from './SevenSeg';

/** 招待リンクを開いた人が、対戦するか観戦するかを選ぶ画面 */
export function JoinChoice({ room }: { room: string }) {
  const [name, setName] = useState(loadName());
  const join = (as: 'play' | 'watch') => {
    saveName(name.trim());
    location.search = new URLSearchParams({ room, as }).toString();
  };
  return (
    <main className="lobby">
      <SevenSeg value={8000} className="lobby-lp" />
      <h1>リモートデュエル</h1>
      <p className="lobby-lead">
        ルーム <code>{shortRoom(room)}</code> への招待
      </p>
      <label className="field">
        <span>名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="たろう" />
      </label>
      <button className="primary wide" onClick={() => join('play')}>
        対戦する
      </button>
      <button className="wide" onClick={() => join('watch')}>
        観戦する
      </button>
      <p className="muted small">席が埋まっているときは観戦になります。観戦は4人まで。</p>
    </main>
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
    <main className="lobby">
      <SevenSeg value={8000} className="lobby-lp" />
      <h1>リモートデュエル</h1>
      <p className="lobby-lead">手元のカードをカメラに映して、離れた相手と対戦する。</p>
      {invalidLink && <p className="error">このリンクは使えません。古い形式のリンクの場合は、ホストに新しい招待リンクをもらってください。</p>}
      <label className="field">
        <span>名前</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="たろう" />
      </label>
      <button className="primary wide" onClick={() => void create()}>
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
    </main>
  );
}
