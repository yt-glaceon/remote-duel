import { useEffect, useState } from 'react';
import { getClientId, loadCamRotate, loadName, saveCamRotate, shortRoom } from '../identity';
import { listCameras, nextRotation, openCamera, stopStream, toRotation } from '../media/camera';
import { useRoom } from '../net/useRoom';
import { Rotated, StreamVideo } from './ZoomView';
import { StatusPill, Toast } from './common';

/** スマホなどをカメラ専用の端末としてルームに参加させる画面 */
export function CameraOnly({ room, camKey }: { room: string; camKey: string }) {
  // 映像の向きは端末ごとに覚えておき、接続したらホストへ伝える
  const [initialRotate] = useState(() => toRotation(loadCamRotate()));
  const [view, client] = useRoom({
    room,
    isHost: false,
    role: 'camera',
    name: loadName(),
    clientId: getClientId(),
    camKey,
    rotate: initialRotate,
  });
  // 持ち主が PC から変えた向きも、ここに届く
  const rotate = view.rotate;
  useEffect(() => saveCamRotate(rotate), [rotate]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement);
  const stream = view.localStream;

  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const start = async (id?: string, face: 'environment' | 'user' = facing) => {
    setError('');
    // Android はカメラを2台同時に開けないので、今のカメラを先に止めてから開く
    const prevId = deviceId;
    const prev = client.getView().localStream;
    if (prev) {
      stopStream(prev);
      client.setLocalStream(null, '');
    }
    const open = async (devId: string | undefined, f: 'environment' | 'user') => {
      const s = await openCamera(devId, f);
      client.setLocalStream(s, 'スマホカメラ');
      setDevices(await listCameras());
      const settings = s.getVideoTracks()[0]?.getSettings();
      setDeviceId(settings?.deviceId ?? '');
      if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') setFacing(settings.facingMode);
      else setFacing(f);
    };
    try {
      await open(id || undefined, face);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`このカメラは開けませんでした(${msg})。`);
      // 切り替えに失敗したら、元のカメラに戻す
      if (prev) await open(prevId || undefined, facing).catch(() => {});
    }
  };

  // インカメと外カメの切り替え。端末によってはカメラの一覧に出ないので、向きで指定して開く
  const flip = () => void start(undefined, facing === 'environment' ? 'user' : 'environment');

  const turn = () => client.setRotate(nextRotation(rotate));

  // 全画面にして横向きに固定する。iPhone など固定できない端末では、手で横に持ってもらう
  const toggleLandscape = async () => {
    setError('');
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock(o: string): Promise<void> }).lock('landscape');
    } catch {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      setError(
        'この端末では画面を横向きに固定できません。端末の画面の回転ロックを外して横に持つか、「映像を回す」で向きを合わせてください。',
      );
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // 盤面の真上に置いている間、画面が消えないようにする
  useEffect(() => {
    if (!stream || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [stream]);

  // iPhone の Safari は、ページの全画面表示と向きの固定に対応していない
  const canFullscreen = typeof document.documentElement.requestFullscreen === 'function';
  const settings = stream?.getVideoTracks()[0]?.getSettings();
  const seat = view.seat;
  // 持ち主が観戦中のときは送らない
  const viewers = seat ? view.members.filter((m) => m.role !== 'camera' && m.seat !== seat).length : 0;

  return (
    <div className="camera-only">
      <div className="cam-side">
        <header className="bar">
          <strong>カメラ端末</strong>
          <span className="muted">
            ルーム {shortRoom(room)} / {seat ? `${seat === 'p1' ? 'プレイヤー1' : 'プレイヤー2'}の映像` : '持ち主は観戦中'}
          </span>
          <StatusPill status={view.status} detail={view.detail} />
        </header>
        {view.detail && <p className="muted small cam-detail">{view.detail}</p>}
        {stream ? (
          <>
            <p className="muted">
              送信中 {settings?.width}×{settings?.height} ・ 視聴者 {viewers} 人
            </p>
            <p className="muted small">映像は、相手の画面に映るのと同じ向きで表示しています。</p>
            <div className="cam-actions">
              <button onClick={turn}>↻ 映像を回す({rotate}°)</button>
              <button onClick={flip}>{facing === 'environment' ? 'インカメにする' : '外カメにする'}</button>
              {canFullscreen && (
                <button onClick={() => void toggleLandscape()}>{fullscreen ? '全画面をやめる' : '横画面にする'}</button>
              )}
            </div>
            {!canFullscreen && (
              <p className="muted small">この画面を横向きで見るときは、端末の画面の回転ロックを外して横に持ってください。</p>
            )}
            {devices.length > 1 && (
              <select value={deviceId} onChange={(e) => void start(e.target.value)}>
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `カメラ ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
            <p className="muted small">広角や望遠のカメラは、端末がブラウザに見せている場合だけ上の一覧に出ます。</p>
            <button
              onClick={() => {
                stopStream(stream);
                client.setLocalStream(null, '');
              }}
            >
              カメラを止める
            </button>
          </>
        ) : (
          <div className="card">
            <p>このスマホを盤面の真上に固定して、カメラを開始してください。</p>
            <button className="primary" onClick={() => void start()}>
              カメラを開始
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      {stream && (
        <div className="cam-stage">
          <Rotated rotate={rotate}>
            <StreamVideo stream={stream} className="video-fit" />
          </Rotated>
        </div>
      )}
      <Toast notice={view.notice} />
    </div>
  );
}
