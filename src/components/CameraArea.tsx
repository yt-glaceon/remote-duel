import { useEffect, useState } from 'react';
import { displayName, type GameState, type Seat } from '../game/state';
import { listCameras, openCamera, stopStream, TEST_PATTERN_ID } from '../media/camera';
import type { RoomClient, Snap, View } from '../net/room';
import { Modal } from './common';
import { StreamVideo, ZoomView } from './ZoomView';

/** 見たい席(プレイヤーなら相手、観戦者なら両方)の映像を大きく表示する。複数あればタブで切り替える */
export function OpponentCams({
  view,
  client,
  seats,
  me,
  state,
}: {
  view: View;
  client: RoomClient;
  seats: Seat[];
  /** プレイヤーなら自分の席。自分のカメラを隅に小さく出す。観戦者は null */
  me: Seat | null;
  state: GameState;
}) {
  // 席が確定していない映像は表示しない
  const cams = view.cams.filter((c) => c.seat && seats.includes(c.seat));
  const [selected, setSelected] = useState<string | null>(null);
  const cam = cams.find((c) => c.peerId === selected) ?? cams[0];
  const watching = seats.length > 1;

  return (
    <div className="stage-main">
      {cams.length > 1 && (
        <div className="tabs">
          {cams.map((c) => (
            <button key={c.peerId} className={c === cam ? 'active' : ''} onClick={() => setSelected(c.peerId)}>
              {watching && c.seat ? `${displayName(state, c.seat)}の` : ''}
              {c.label}
            </button>
          ))}
        </div>
      )}
      {cam ? (
        <>
          <div className="video-wrap">
            <ZoomView className="video-box">
              <StreamVideo stream={cam.stream} className="video-fit" />
            </ZoomView>
            {me && <SelfPip feeds={selfFeeds(view, me)} />}
          </div>
          <div className="row stage-tools">
            <span className="muted small">
              {cam.seat ? displayName(state, cam.seat) : '相手'}の{cam.label}
              ・ホイール/ピンチで拡大、ドラッグで移動、ダブルクリックで戻る
            </span>
            <button className="primary" disabled={view.snapBusy} onClick={() => client.requestSnapshot(cam.peerId)}>
              {view.snapBusy ? '撮影中…' : '📷 高画質で撮る'}
            </button>
          </div>
        </>
      ) : (
        <div className="video-wrap">
          <div className="video-box placeholder">
            <p>{watching ? 'カメラ映像はまだ届いていません' : '相手のカメラ映像はまだ届いていません'}</p>
            <p className="muted small">
              {watching ? 'プレイヤーがカメラを開始すると、ここに表示されます' : '相手がカメラを開始すると、ここに表示されます'}
            </p>
          </div>
          {me && <SelfPip feeds={selfFeeds(view, me)} />}
        </div>
      )}
    </div>
  );
}

/** 自分のカメラの選択と、相手に送っている映像の確認 */
export function MyCamera({ view, client, me }: { view: View; client: RoomClient; me: Seat }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<SelfFeed | null>(null);
  const stream = view.localStream;

  useEffect(() => {
    void listCameras().then(setDevices).catch(() => {});
  }, []);

  const start = async (id: string) => {
    setError('');
    setDeviceId(id);
    stopStream(stream);
    if (!id) {
      client.setLocalStream(null, '');
      return;
    }
    try {
      // 許可前は deviceId が空で返るので、そのときは既定のカメラを開く
      const s = await openCamera(id.startsWith('cam-') ? undefined : id);
      client.setLocalStream(s, id === TEST_PATTERN_ID ? 'テスト映像' : 'PCカメラ');
      // 許可を得た後でないとカメラ名が取れないので取り直す
      setDevices(await listCameras());
      if (id !== TEST_PATTERN_ID) setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId ?? id);
    } catch (e) {
      setDeviceId('');
      client.setLocalStream(null, '');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const settings = stream?.getVideoTracks()[0]?.getSettings();

  return (
    <div className="panel my-camera">
      <div className="panel-head">
        <strong>自分のカメラ</strong>
        {stream && <span className="muted small">送信中 {settings?.width}×{settings?.height}</span>}
      </div>
      <select value={deviceId} onChange={(e) => void start(e.target.value)}>
        <option value="">使わない</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId || `cam-${i}`}>
            {d.label || `カメラ ${i + 1}`}
          </option>
        ))}
        {import.meta.env.DEV && <option value={TEST_PATTERN_ID}>テスト映像(開発用)</option>}
      </select>
      {error && <p className="error small">{error}</p>}
      <div className="thumbs">
        {selfFeeds(view, me).map((f) => (
          <figure key={f.id} className="clickable" onClick={() => setOpen(f)} title="クリックで大きく表示">
            <StreamVideo stream={f.stream} className="thumb-video" />
            <figcaption className="muted small">{f.label}</figcaption>
          </figure>
        ))}
      </div>
      {open && <FeedModal feed={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

type SelfFeed = { id: string; label: string; stream: MediaStream };

/** 自分が相手に送っている映像(この PC のカメラと、自分の席のスマホカメラ) */
export function selfFeeds(view: View, me: Seat): SelfFeed[] {
  const feeds: SelfFeed[] = [];
  if (view.localStream) feeds.push({ id: 'local', label: 'この PC のカメラ', stream: view.localStream });
  for (const c of view.cams) if (c.seat === me) feeds.push({ id: c.peerId, label: c.label, stream: c.stream });
  return feeds;
}

function FeedModal({ feed, onClose }: { feed: SelfFeed; onClose: () => void }) {
  return (
    <Modal wide onClose={onClose}>
      <h2>あなたのカメラ({feed.label})</h2>
      <ZoomView className="snap-box">
        <StreamVideo stream={feed.stream} className="video-fit" />
      </ZoomView>
      <p className="muted small">相手に送っている映像です。盤面が映っているか、文字が読めるかを確かめられます。</p>
    </Modal>
  );
}

/** 相手の映像の隅に、自分のカメラを小さく重ねて表示する。クリックで大きく表示する */
function SelfPip({ feeds }: { feeds: SelfFeed[] }) {
  const [open, setOpen] = useState<SelfFeed | null>(null);
  if (feeds.length === 0) return null;
  return (
    <>
      <div className="self-pip" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {feeds.map((f) => (
          <button key={f.id} className="self-pip-item" onClick={() => setOpen(f)} title="クリックで大きく表示">
            <StreamVideo stream={f.stream} className="video-fit" />
            <span className="self-pip-label">自分・{f.label}</span>
          </button>
        ))}
      </div>
      {open && <FeedModal feed={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function Snapshots({ snaps, state }: { snaps: Snap[]; state: GameState }) {
  const [open, setOpen] = useState<Snap | null>(null);
  if (snaps.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>スナップショット</strong>
        <span className="muted small">クリックで拡大</span>
      </div>
      <div className="snaps">
        {snaps.map((s) => (
          <img key={s.id} src={s.url} alt="スナップショット" onClick={() => setOpen(s)} />
        ))}
      </div>
      {open && (
        <Modal wide onClose={() => setOpen(null)}>
          <ZoomView className="snap-box">
            <img src={open.url} className="video-fit" alt="スナップショット" draggable={false} />
          </ZoomView>
          <div className="row">
            <span className="muted small">
              {open.seat ? displayName(state, open.seat) : ''} {new Date(open.at).toLocaleTimeString('ja-JP')}
            </span>
            <a className="button" href={open.url} download={`snapshot-${open.at}.jpg`}>
              保存
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
