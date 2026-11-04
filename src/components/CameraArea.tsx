import { useEffect, useState, type ReactNode } from 'react';
import { displayName, type GameState, type Seat } from '../game/state';
import { listCameras, nextRotation, openCamera, stopStream, TEST_PATTERN_ID, type Rotation } from '../media/camera';
import type { RoomClient, Snap, View } from '../net/room';
import { Modal } from './common';
import { Rotated, StreamVideo, ZoomView } from './ZoomView';

/** 見たい席(プレイヤーなら相手、観戦者なら両方)の映像を大きく表示する。複数あればタブで切り替える */
export function OpponentCams({
  view,
  client,
  seats,
  me,
  state,
  empty,
}: {
  view: View;
  client: RoomClient;
  seats: Seat[];
  /** プレイヤーなら自分の席。自分のカメラを隅に小さく出す。観戦者は null */
  me: Seat | null;
  state: GameState;
  /** 映像がないときに、映像の枠に出す案内 */
  empty: ReactNode;
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
              <Rotated rotate={cam.rotate}>
                <StreamVideo stream={cam.stream} className="video-fit" />
              </Rotated>
            </ZoomView>
            {me && <SelfPip feeds={selfFeeds(view, me)} client={client} />}
          </div>
          <div className="row stage-tools">
            <span className="muted small">
              {cam.seat ? displayName(state, cam.seat) : '相手'}の{cam.label}
            </span>
            <span className="muted small stage-hint">ホイールで拡大・ドラッグで移動・ダブルクリックで戻す</span>
            <span className="spacer" />
            <button disabled={view.snapBusy} onClick={() => client.requestSnapshot(cam.peerId)}>
              {view.snapBusy ? '撮影中…' : '高画質で撮る'}
            </button>
          </div>
        </>
      ) : (
        <div className="video-wrap">
          <div className="video-box placeholder">
            {empty}
          </div>
          {me && <SelfPip feeds={selfFeeds(view, me)} client={client} />}
        </div>
      )}
    </div>
  );
}

/** 自分のカメラの選択と、相手に送っている映像の確認 */
export function MyCamera({ view, client, me, onPhone }: { view: View; client: RoomClient; me: Seat; onPhone: () => void }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const stream = view.localStream;
  const feeds = selfFeeds(view, me);
  const open = feeds.find((f) => f.id === openId);

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
    <div className="tab-sec my-camera">
      {stream && (
        <p className="muted small">
          送信中 <code>{settings?.width}×{settings?.height}</code>
        </p>
      )}
      <select value={deviceId} onChange={(e) => void start(e.target.value)}>
        <option value="">使わない</option>
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId || `cam-${i}`}>
            {d.label || `カメラ ${i + 1}`}
          </option>
        ))}
        {import.meta.env.DEV && <option value={TEST_PATTERN_ID}>テスト映像(開発用)</option>}
      </select>
      <button onClick={onPhone}>スマホをカメラにする</button>
      {error && <p className="error small">{error}</p>}
      <div className="thumbs">
        {feeds.map((f) => (
          <figure key={f.id} className="clickable" onClick={() => setOpenId(f.id)} title="クリックで大きく表示">
            <Rotated rotate={f.rotate} className="thumb-video">
              <StreamVideo stream={f.stream} className="video-fit" />
            </Rotated>
            <figcaption className="muted small">
              {f.label}
              <RotateButton feed={f} client={client} />
            </figcaption>
          </figure>
        ))}
      </div>
      {open && <FeedModal feed={open} client={client} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** id はこの PC のカメラなら 'local'、スマホのカメラ端末ならその peerId */
type SelfFeed = { id: string; label: string; rotate: Rotation; stream: MediaStream };

/** 自分のスマホの映像を、PC から回す。向きは全員の画面とスマホの画面に反映される */
function RotateButton({ feed, client }: { feed: SelfFeed; client: RoomClient }) {
  if (feed.id === 'local') return null;
  return (
    <button
      className="small-btn"
      title="スマホの映像を 90° 回す(相手や観戦者の画面にも反映されます)"
      onClick={(e) => {
        e.stopPropagation();
        client.rotateCam(feed.id, nextRotation(feed.rotate));
      }}
    >
      回転 {feed.rotate}°
    </button>
  );
}

/** 自分が相手に送っている映像(この PC のカメラと、自分の席のスマホカメラ) */
export function selfFeeds(view: View, me: Seat): SelfFeed[] {
  const feeds: SelfFeed[] = [];
  if (view.localStream) feeds.push({ id: 'local', label: 'この PC のカメラ', rotate: 0, stream: view.localStream });
  for (const c of view.cams) if (c.seat === me) feeds.push({ id: c.peerId, label: c.label, rotate: c.rotate, stream: c.stream });
  return feeds;
}

function FeedModal({ feed, client, onClose }: { feed: SelfFeed; client: RoomClient; onClose: () => void }) {
  return (
    <Modal wide onClose={onClose}>
      <h2>あなたのカメラ({feed.label})</h2>
      <ZoomView className="snap-box">
        <Rotated rotate={feed.rotate}>
          <StreamVideo stream={feed.stream} className="video-fit" />
        </Rotated>
      </ZoomView>
      <div className="row">
        <p className="muted small">相手に送っている映像です。</p>
        <RotateButton feed={feed} client={client} />
      </div>
    </Modal>
  );
}

/** 相手の映像の隅に、自分のカメラを小さく重ねて表示する。クリックで大きく表示する */
function SelfPip({ feeds, client }: { feeds: SelfFeed[]; client: RoomClient }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = feeds.find((f) => f.id === openId);
  if (feeds.length === 0) return null;
  return (
    <>
      <div className="self-pip" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {feeds.map((f) => (
          <button key={f.id} className="self-pip-item" onClick={() => setOpenId(f.id)} title="クリックで大きく表示">
            <Rotated rotate={f.rotate}>
              <StreamVideo stream={f.stream} className="video-fit" />
            </Rotated>
            <span className="self-pip-label">自分・{f.label}</span>
          </button>
        ))}
      </div>
      {open && <FeedModal feed={open} client={client} onClose={() => setOpenId(null)} />}
    </>
  );
}

export function Snapshots({ snaps, state }: { snaps: Snap[]; state: GameState }) {
  const [open, setOpen] = useState<Snap | null>(null);
  if (snaps.length === 0) return null;
  return (
    <div className="snap-strip">
      <div className="snaps">
        {snaps.map((s) => (
          <button key={s.id} className="snap-thumb" onClick={() => setOpen(s)} title="クリックで拡大">
            <Rotated rotate={s.rotate}>
              <img src={s.url} className="video-fit" alt="スナップショット" />
            </Rotated>
          </button>
        ))}
      </div>
      {open && (
        <Modal wide onClose={() => setOpen(null)}>
          <ZoomView className="snap-box">
            <Rotated rotate={open.rotate}>
              <img src={open.url} className="video-fit" alt="スナップショット" draggable={false} />
            </Rotated>
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
