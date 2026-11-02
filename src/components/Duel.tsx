import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { other, type Action } from '../game/state';
import { getCamKey, getClientId, loadName, roomUrl } from '../identity';
import { useRoom } from '../net/useRoom';
import { MyCamera, OpponentCams, Snapshots } from './CameraArea';
import { Modal, StatusPill, Toast } from './common';
import { ChainPanel, LogPanel, LpCard, RollPanel, TurnBar } from './SidePanels';

export function Duel({ room, isHost }: { room: string; isHost: boolean }) {
  const [view, client] = useRoom({
    room,
    isHost,
    role: 'player',
    name: loadName(),
    clientId: getClientId(),
    camKey: getCamKey(room),
  });
  const [showPhone, setShowPhone] = useState(false);
  const [copied, setCopied] = useState(false);
  const { state, seat } = view;
  const me = seat ?? 'p1';
  const readOnly = !seat || view.status === 'full';
  const dispatch = (a: Action) => client.dispatch(a);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(roomUrl(room)).catch(() => prompt('招待リンク', roomUrl(room)));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const p2Online = view.members.some((m) => m.role === 'player' && m.seat === 'p2');

  return (
    <div className="app">
      <header className="bar">
        <strong>リモートデュエル</strong>
        <span className="muted">ルーム {room}</span>
        <StatusPill status={view.status} detail={view.detail} />
        {view.detail && <span className="muted small">{view.detail}</span>}
        <span className="spacer" />
        {isHost && !p2Online && <span className="muted small">相手を待っています →</span>}
        <button onClick={() => void copyInvite()}>{copied ? 'コピーしました' : '招待リンクをコピー'}</button>
        {seat && <button onClick={() => setShowPhone(true)}>スマホをカメラにする</button>}
      </header>

      {!state ? (
        <div className="center muted">ルームに接続しています…</div>
      ) : (
        <main className="duel">
          <section className="stage">
            <OpponentCams view={view} client={client} me={me} state={state} />
            <Snapshots snaps={view.snaps} state={state} />
          </section>
          <aside className="side">
            <LpCard state={state} seat={other(me)} isMe={false} me={me} dispatch={dispatch} readOnly={readOnly} />
            <LpCard state={state} seat={me} isMe={!readOnly} me={me} dispatch={dispatch} readOnly={readOnly} />
            <TurnBar state={state} me={me} dispatch={dispatch} readOnly={readOnly} canUndo={view.canUndo} />
            <ChainPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            <RollPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            {seat && <MyCamera view={view} client={client} me={me} />}
            <LogPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
          </aside>
        </main>
      )}

      {showPhone && seat && <PhoneCameraModal room={room} seat={seat} onClose={() => setShowPhone(false)} />}
      <Toast notice={view.notice} />
    </div>
  );
}

function PhoneCameraModal({ room, seat, onClose }: { room: string; seat: 'p1' | 'p2'; onClose: () => void }) {
  const url = roomUrl(room, { cam: seat, key: getCamKey(room) });
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setQr);
  }, [url]);
  const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost';
  return (
    <Modal onClose={onClose}>
      <h2>スマホをカメラにする</h2>
      <p className="muted">スマホでこの QR コードを読み取り、盤面の真上に固定してください。映像は相手に届き、あなたの画面にも小さく表示されます。</p>
      <p className="muted small">このリンクにはあなた専用の合言葉が入っています。ほかの人には送らないでください。</p>
      {qr && <img src={qr} alt="カメラ端末用リンクの QR コード" className="qr" />}
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      {insecure && <p className="error small">いまは HTTPS ではないため、スマホのカメラは使えません。公開した URL か `npm run dev:lan` で開いてください。</p>}
    </Modal>
  );
}
