import QRCode from 'qrcode';
import { useEffect, useState, type ReactNode } from 'react';
import { canChangeSeats, displayName, other, SEATS, type Action, type GameState, type Seat } from '../game/state';
import { forgetCamKey, getCamKey, getClientId, loadCamLayout, loadName, renewCamKey, roomUrl, saveCamLayout, shortRoom } from '../identity';
import { deleteHostKey, loadHostKey, type HostKey } from '../net/hostKey';
import { ROOM_CLOSED_TEXT, SPECTATOR_MAX, type PublicMember, type RoomClient, type View } from '../net/room';
import { useRoom } from '../net/useRoom';
import { MyCamera, OpponentCams, selfFeeds, Snapshots, SpectatorCams } from './CameraArea';
import { Modal, StatusPill, Toast } from './common';
import { ResultPanel } from './ResultPanel';
import { ChainPanel, FirstPlayer, LogPanel, LpBoard, RollFlash, RollPanel, TurnBar } from './SidePanels';

type Tab = 'duel' | 'camera' | 'snaps' | 'room' | 'log';
const TABS: { id: Tab; label: string }[] = [
  { id: 'duel', label: 'デュエル' },
  { id: 'camera', label: 'カメラ' },
  { id: 'snaps', label: '撮影' },
  { id: 'room', label: '部屋' },
  { id: 'log', label: '履歴' },
];

/** ホストの鍵を読み込んでから部屋を開く。鍵のないブラウザは、リンクに host=1 を付けてもホストになれない */
export function HostRoom({ room }: { room: string }) {
  const [key, setKey] = useState<HostKey | null | undefined>(undefined);
  useEffect(() => {
    void loadHostKey(room)
      .then(setKey)
      .catch(() => setKey(null));
  }, [room]);
  if (key === undefined) return <div className="center muted">ルームを開いています…</div>;
  if (key) return <Duel room={room} hostKey={key} spectator={false} />;
  return (
    <div className="app">
      <div className="center">
        <p>この部屋はホストとして開けません。</p>
        <p className="muted small">部屋を閉じたか、1日以上使っていないか、部屋を作ったブラウザとは別のブラウザです。</p>
        <button className="primary" onClick={() => (location.search = '')}>
          最初の画面へ
        </button>
      </div>
    </div>
  );
}

export function Duel({ room, hostKey, spectator }: { room: string; hostKey: HostKey | null; spectator: boolean }) {
  const isHost = !!hostKey;
  // 合言葉は最初の1回だけ読む(描画のたびに読むと、部屋を閉じて消した直後に作り直してしまう)
  const [camKey] = useState(() => getCamKey(room));
  const [view, client] = useRoom({
    room,
    isHost,
    hostKey: hostKey ?? undefined,
    role: spectator ? 'spectator' : 'player',
    name: loadName(),
    clientId: hostKey?.clientId ?? getClientId(),
    camKey,
  });
  const [showPhone, setShowPhone] = useState(false);
  const [copied, setCopied] = useState(false);
  // 観戦者は、まず席や参加者の様子を見たいので部屋のタブから始める
  const [tab, setTab] = useState<Tab>(spectator ? 'room' : 'duel');
  const [camLayout, setCamLayout] = useState(loadCamLayout);
  const { state, seat } = view;
  const me = seat ?? 'p1';
  const readOnly = !seat || view.status === 'full';
  const dispatch = (a: Action) => client.dispatch(a);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(roomUrl(room)).catch(() => prompt('招待リンク', roomUrl(room)));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleCamLayout = () => {
    const next = camLayout === 'row' ? 'col' : 'row';
    setCamLayout(next);
    saveCamLayout(next);
  };

  const seatTaken = (s: Seat) => view.members.some((m) => m.role === 'player' && m.seat === s);
  const watchers = view.members.filter((m) => m.role === 'spectator');

  // LP が 0 になった、または勝敗が付いたら、確定の操作があるタブを開く
  const needsResult = !!state && (!!state.result || SEATS.some((s) => state.players[s].lp === 0));
  useEffect(() => {
    if (needsResult) setTab('duel');
  }, [needsResult]);

  // 撮るのは細部を読むためなので、撮れたらすぐ見られるようにする
  const latestSnap = view.snaps[0]?.id;
  useEffect(() => {
    if (latestSnap) setTab('snaps');
  }, [latestSnap]);

  const closeRoom = () => {
    if (!confirm('部屋を閉じますか?相手との接続を切り、この部屋の保存データ(LP・履歴・戦績)を消します。')) return;
    client.closeRoom();
    forgetCamKey(room);
    void deleteHostKey(room).catch(() => {});
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
        <code className="muted">{shortRoom(room)}</code>
        <StatusPill status={view.status} detail={view.detail} />
        {view.detail && view.detail !== '観戦中' && <span className="muted small">{view.detail}</span>}
        <span className="spacer" />
        {watchers.length > 0 && <span className="muted small">観戦 {watchers.length}</span>}
        {state && !seat && (
          <button className="small-btn" onClick={toggleCamLayout}>
            {camLayout === 'row' ? '縦に並べる' : '横に並べる'}
          </button>
        )}
      </header>

      {!state ? (
        <div className="center muted">ルームに接続しています…</div>
      ) : (
        <main className="duel">
          <section className="stage">
            {seat ? (
              <OpponentCams
                view={view}
                client={client}
                seat={other(seat)}
                me={seat}
                state={state}
                empty={
                  <BlankSlate
                    view={view}
                    waitingOpponent={!seatTaken(other(seat))}
                    copied={copied}
                    onInvite={() => void copyInvite()}
                    onCamera={() => setTab('camera')}
                  />
                }
              />
            ) : (
              <SpectatorCams view={view} client={client} state={state} layout={camLayout} />
            )}
          </section>
          <aside className="side">
            <LpBoard state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            <TurnBar state={state} me={me} dispatch={dispatch} readOnly={readOnly} canUndo={view.canUndo} />
            <ChainPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
            <RollFlash state={state} />
            <RailTabs
              tab={tab === 'camera' && !seat ? 'room' : tab}
              onTab={setTab}
              hasCamera={!!seat}
              // 自分の映像が相手に届いていないことと、勝敗の確定待ちは、タブを閉じていても分かるようにする
              dots={{ camera: !!seat && selfFeeds(view, seat).length === 0, duel: needsResult && tab !== 'duel' }}
            >
              {{
                duel: (
                  <div className={needsResult ? 'duel-tab result-first' : 'duel-tab'}>
                    <RollPanel state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
                    <FirstPlayer state={state} me={me} dispatch={dispatch} readOnly={readOnly} />
                    <ResultPanel state={state} dispatch={dispatch} readOnly={readOnly} />
                  </div>
                ),
                camera: seat && <MyCamera view={view} client={client} me={me} onPhone={() => setShowPhone(true)} />,
                snaps: <Snapshots snaps={view.snaps} state={state} />,
                room: (
                  <>
                    <SeatsPanel view={view} client={client} state={state} isHost={isHost} />
                    <div className="tab-sec room-actions">
                      <button onClick={() => void copyInvite()}>{copied ? 'コピーしました' : '招待リンクをコピー'}</button>
                      {isHost && (
                        <button className="danger" onClick={closeRoom}>
                          部屋を閉じる
                        </button>
                      )}
                    </div>
                  </>
                ),
                log: <LogPanel state={state} />,
              }}
            </RailTabs>
          </aside>
        </main>
      )}

      {showPhone && seat && <PhoneCameraModal room={room} client={client} onClose={() => setShowPhone(false)} />}
      <Toast notice={view.notice} />
    </div>
  );
}

/**
 * 右列の下半分のタブ。切り替えても中身を消さない(自分のカメラの選択などを保つ)ので、
 * 全部を描画して hidden で隠す
 */
function RailTabs({
  tab,
  onTab,
  hasCamera,
  dots,
  children,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  hasCamera: boolean;
  dots: Partial<Record<Tab, boolean>>;
  children: Record<Tab, ReactNode>;
}) {
  return (
    <div className="rail-tabs">
      <div className="tab-list" role="tablist">
        {TABS.filter((t) => hasCamera || t.id !== 'camera').map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => onTab(t.id)}>
            {t.label}
            {dots[t.id] && <i className="tab-dot" />}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} className="tab-body" role="tabpanel" hidden={tab !== t.id}>
          {children[t.id]}
        </div>
      ))}
    </div>
  );
}

/** 映像がまだないときの案内。次にすることのボタンを、ここに置く */
function BlankSlate({
  view,
  waitingOpponent,
  copied,
  onInvite,
  onCamera,
}: {
  view: View;
  waitingOpponent: boolean;
  copied: boolean;
  onInvite: () => void;
  onCamera: () => void;
}) {
  const seat = view.seat;
  const noCamera = !!seat && selfFeeds(view, seat).length === 0;
  return (
    <>
      <h2>{waitingOpponent ? '相手を待っています' : '相手のカメラを待っています'}</h2>
      {waitingOpponent && <p className="muted">招待リンクを送ると、相手はブラウザだけで参加できます。</p>}
      <div className="row">
        {waitingOpponent && (
          <button className="primary" onClick={onInvite}>
            {copied ? 'コピーしました' : '招待リンクをコピー'}
          </button>
        )}
        {noCamera && <button onClick={onCamera}>自分のカメラを設定</button>}
      </div>
    </>
  );
}

function PhoneCameraModal({ room, client, onClose }: { room: string; client: RoomClient; onClose: () => void }) {
  const [camKey, setCamKey] = useState(() => getCamKey(room));
  const url = roomUrl(room, { cam: '1' }, { key: camKey });
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setQr);
  }, [url]);
  const insecure = location.protocol !== 'https:' && location.hostname !== 'localhost';
  return (
    <Modal onClose={onClose}>
      <h2>スマホをカメラにする</h2>
      <p className="muted">QR コードを読み取り、スマホを盤面の真上に固定します。</p>
      {qr && <img src={qr} alt="カメラ端末用リンクの QR コード" className="qr" />}
      <p className="small">このリンクにはあなた専用の合言葉が入っています。ほかの人には送らないでください。</p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <details>
        <summary>リンクを知られたとき</summary>
        <p className="muted small">合言葉を作り直すと、古いリンクでは入れなくなり、接続中のカメラ端末は切断されます。</p>
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
      </details>
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
  const [editingName, setEditingName] = useState(false);
  const watchers = view.members.filter((m) => m.role === 'spectator');

  const sit = (s: Seat, away: boolean) => {
    if (away && !confirm(`${state.players[s].name}は回線が切れています。代わりにこの席に座りますか?`)) return;
    client.requestSeat(s);
  };

  const people = view.members.filter((m) => m.role !== 'camera').length;
  const tags = (m: PublicMember | undefined) => (
    <>
      {m?.host && <span className="tag">ホスト</span>}
      {m && m.peerId === selfId && <span className="tag tag-me">あなた</span>}
    </>
  );

  return (
    <div className="tab-sec seats">
      <p className="muted small meta-row">
        <span>参加者 {people}人</span>
        {free && <span>席を入れ替えできます</span>}
      </p>
      {SEATS.map((s) => {
        const holder = view.members.find((m) => m.role === 'player' && m.seat === s);
        const cams = view.members.filter((m) => m.role === 'camera' && m.seat === s).length;
        const seated = !!holder;
        const away = !seated && !!state.players[s].name;
        return (
          <div key={s} className="seat-row">
            <span className="seat-label">{s === 'p1' ? 'P1' : 'P2'}</span>
            <span className="seat-name">
              {seated && s === me && editingName ? (
                <input
                  autoFocus
                  defaultValue={state.players[s].name}
                  maxLength={20}
                  aria-label="名前"
                  onBlur={(e) => {
                    client.dispatch({ type: 'rename', name: e.target.value });
                    setEditingName(false);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
                />
              ) : seated ? (
                displayName(state, s)
              ) : away ? (
                `${state.players[s].name}(切断中)`
              ) : (
                <span className="muted">空席</span>
              )}
              {tags(holder)}
              {cams > 0 && (
                <span className="tag" title="この席の映像を送っているスマホ">
                  スマホ{cams > 1 ? ` ×${cams}` : ''}
                </span>
              )}
            </span>
            {seated && s === me && !editingName && (
              <button className="small-btn" onClick={() => setEditingName(true)}>
                名前を変更
              </button>
            )}
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
              <span className="seat-name">
                {w.name || '(名前なし)'}
                {tags(w)}
              </span>
              {isHost && !w.host && (
                <button className="danger small-btn" onClick={() => client.kick(w.peerId)}>
                  退出させる
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!free && <p className="muted small">席の入れ替えは決着後かやり直し後。空席には観戦者も座れます(回線が切れた席は1分後)。</p>}
    </div>
  );
}
