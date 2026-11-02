import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { canChangeSeats, displayName, other, SEATS, type Action, type GameState, type Seat } from '../game/state';
import { forgetCamKey, getCamKey, getClientId, loadName, renewCamKey, roomUrl } from '../identity';
import { ROOM_CLOSED_TEXT, SPECTATOR_MAX, type RoomClient, type View } from '../net/room';
import { useRoom } from '../net/useRoom';
import { MyCamera, OpponentCams, Snapshots } from './CameraArea';
import { Modal, StatusPill, Toast } from './common';
import { ResultPanel } from './ResultPanel';
import { ChainPanel, LogPanel, LpCard, RollPanel, TurnBar } from './SidePanels';

export function Duel({ room, isHost, spectator }: { room: string; isHost: boolean; spectator: boolean }) {
  // 合言葉は最初の1回だけ読む(描画のたびに読むと、部屋を閉じて消した直後に作り直してしまう)
  const [camKey] = useState(() => getCamKey(room));
  const [view, client] = useRoom({
    room,
    isHost,
    role: spectator ? 'spectator' : 'player',
    name: loadName(),
    clientId: getClientId(),
    camKey,
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

  const seatTaken = (s: Seat) => view.members.some((m) => m.role === 'player' && m.seat === s);
  const watchers = view.members.filter((m) => m.role === 'spectator');

  const closeRoom = () => {
    if (!confirm('部屋を閉じますか?相手との接続を切り、この部屋の保存データ(LP・履歴・戦績)を消します。')) return;
    client.closeRoom();
    forgetCamKey(room);
    setTimeout(() => (location.search = ''), 1000);
  };

  if (view.status === 'closed') {
    return (
      <div className="app">
        <div className="center">
          <p>{view.detail}</p>
          {(isHost || view.detail === ROOM_CLOSED_TEXT) && (
            <p className="muted small">この部屋の招待リンクは、もう使わないでください。</p>
          )}
          <button className="primary" onClick={() => (location.search = '')}>
            最初の画面へ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="bar">
        <strong>リモートデュエル</strong>
        <span className="muted">ルーム {room}</span>
        <StatusPill status={view.status} detail={view.detail} />
        {view.detail && <span className="muted small">{view.detail}</span>}
        <span className="spacer" />
        {isHost && state && !SEATS.every(seatTaken) && <span className="muted small">プレイヤーを待っています →</span>}
        {watchers.length > 0 && <span className="muted small">観戦 {watchers.length}人</span>}
        <button onClick={() => void copyInvite()}>{copied ? 'コピーしました' : '招待リンクをコピー'}</button>
        {seat && <button onClick={() => setShowPhone(true)}>スマホをカメラにする</button>}
        {isHost && (
          <button className="danger" onClick={closeRoom}>
            部屋を閉じる
          </button>
        )}
      </header>

      {!state ? (
        <div className="center muted">ルームに接続しています…</div>
      ) : (
        <main className="duel">
          <section className="stage">
            {/* 観戦者は両方のプレイヤーの映像を見る */}
            <OpponentCams view={view} client={client} seats={seat ? [other(me)] : ['p1', 'p2']} me={seat} state={state} />
            <Snapshots snaps={view.snaps} state={state} />
          </section>
          <aside className="side">
            <SeatsPanel view={view} client={client} state={state} isHost={isHost} />
            <LpCard state={state} seat={other(me)} isMe={false} me={me} dispatch={dispatch} readOnly={readOnly} />
            <LpCard state={state} seat={me} isMe={!readOnly} me={me} dispatch={dispatch} readOnly={readOnly} />
            <ResultPanel state={state} dispatch={dispatch} readOnly={readOnly} />
            <TurnBar state={state} me={me} dispatch={dispatch} readOnly={readOnly} canUndo={view.canUndo} />
            <ChainPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            <RollPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            {seat && <MyCamera view={view} client={client} me={me} />}
            <LogPanel state={state} />
          </aside>
        </main>
      )}

      {showPhone && seat && <PhoneCameraModal room={room} client={client} onClose={() => setShowPhone(false)} />}
      <Toast notice={view.notice} />
    </div>
  );
}

function PhoneCameraModal({ room, client, onClose }: { room: string; client: RoomClient; onClose: () => void }) {
  const [camKey, setCamKey] = useState(() => getCamKey(room));
  const url = roomUrl(room, { cam: '1', key: camKey });
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setQr);
  }, [url]);
  const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost';
  return (
    <Modal onClose={onClose}>
      <h2>スマホをカメラにする</h2>
      <p className="muted">スマホでこの QR コードを読み取り、盤面の真上に固定してください。映像は相手に届き、あなたの画面にも小さく表示されます。</p>
      <p className="muted small">席を移っても、スマホはあなたに付いていきます。観戦に回っている間は、映像を送りません。</p>
      <p className="muted small">このリンクにはあなた専用の合言葉が入っています。ほかの人には送らないでください。</p>
      {qr && <img src={qr} alt="カメラ端末用リンクの QR コード" className="qr" />}
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button
        onClick={() => {
          if (!confirm('合言葉を作り直しますか?いまのリンクで接続中のカメラ端末は切断され、古いリンクでは入れなくなります。')) return;
          const key = renewCamKey(room);
          client.renewCamKey(key);
          setCamKey(key);
        }}
      >
        合言葉を作り直す
      </button>
      <p className="muted small">リンクを他の人に知られたときや、カメラ端末を替えたいときに使います。</p>
      {insecure && <p className="error small">いまは HTTPS ではないため、スマホのカメラは使えません。公開した URL か `npm run dev:lan` で開いてください。</p>}
    </Modal>
  );
}

/**
 * 席と観戦者の一覧。決着後か開始前なら、自分で席を移ったり観戦に回ったりできる。
 * デュエル中でも、空いた席(回線が切れた人の席を含む)には観戦者が座れる
 */
function SeatsPanel({ view, client, state, isHost }: { view: View; client: RoomClient; state: GameState; isHost: boolean }) {
  const free = canChangeSeats(state);
  const me = view.seat;
  const selfId = client.selfPeerId();
  const watchers = view.members.filter((m) => m.role === 'spectator');

  const sit = (s: Seat, away: boolean) => {
    if (away && !confirm(`${state.players[s].name}は回線が切れています。代わりにこの席に座りますか?`)) return;
    client.requestSeat(s);
  };

  return (
    <div className="panel seats">
      <div className="panel-head">
        <strong>席</strong>
        <span className="muted small">{free ? '入れ替えできます' : 'デュエル中は入れ替えできません'}</span>
      </div>
      {SEATS.map((s) => {
        const seated = view.members.some((m) => m.role === 'player' && m.seat === s);
        const away = !seated && !!state.players[s].name;
        return (
          <div key={s} className="seat-row">
            <span className="seat-label">{s === 'p1' ? 'P1' : 'P2'}</span>
            <span className="seat-name">
              {seated ? displayName(state, s) : away ? `${state.players[s].name}(切断中)` : <span className="muted">空席</span>}
              {me === s && <small> (あなた)</small>}
            </span>
            {!seated && me !== s && (free || !me) && (
              <button className="small-btn" onClick={() => sit(s, away)}>
                {me ? 'ここに移る' : '座る'}
              </button>
            )}
          </div>
        );
      })}
      <div className="seat-row">
        <span className="seat-label">観戦</span>
        <span className="seat-name muted">
          {watchers.length} / {SPECTATOR_MAX}人
        </span>
        {me && free && (
          <button className="small-btn" onClick={() => client.requestSeat(null)}>
            観戦に回る
          </button>
        )}
      </div>
      {watchers.length > 0 && (
        <ul className="watchers">
          {watchers.map((w) => (
            <li key={w.peerId}>
              <span>
                {w.name || '(名前なし)'}
                {w.peerId === selfId && <small> (あなた)</small>}
              </span>
              {isHost && w.peerId !== selfId && (
                <button className="danger small-btn" onClick={() => client.kick(w.peerId)}>
                  退出させる
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!free && <p className="muted small">決着後か、やり直した後に入れ替えられます。空いた席には、観戦者がいつでも座れます。</p>}
    </div>
  );
}
