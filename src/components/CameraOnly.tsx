import { useEffect, useState } from 'react';
import { getClientId, loadName } from '../identity';
import { listCameras, openCamera, stopStream } from '../media/camera';
import { useRoom } from '../net/useRoom';
import { StreamVideo } from './ZoomView';
import { StatusPill, Toast } from './common';

/** スマホなどをカメラ専用の端末としてルームに参加させる画面 */
export function CameraOnly({ room, camKey }: { room: string; camKey: string }) {
  const [view, client] = useRoom({
    room,
    isHost: false,
    role: 'camera',
    name: loadName(),
    clientId: getClientId(),
    camKey,
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const stream = view.localStream;

  const start = async (id?: string) => {
    setError('');
    try {
      const s = await openCamera(id || undefined, 'environment');
      stopStream(client.getView().localStream);
      client.setLocalStream(s, 'スマホカメラ');
      setDevices(await listCameras());
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

  const settings = stream?.getVideoTracks()[0]?.getSettings();
  const seat = view.seat;
  // 持ち主が観戦中のときは送らない
  const viewers = seat ? view.members.filter((m) => m.role !== 'camera' && m.seat !== seat).length : 0;

  return (
    <div className="camera-only">
      <header className="bar">
        <strong>カメラ端末</strong>
        <span className="muted">
          ルーム {room} / {seat ? `${seat === 'p1' ? 'プレイヤー1' : 'プレイヤー2'}の映像` : '持ち主は観戦中'}
        </span>
        <StatusPill status={view.status} detail={view.detail} />
      </header>
      {view.detail && <p className="muted small">{view.detail}</p>}
      {stream ? (
        <>
          <StreamVideo stream={stream} className="cam-preview" />
          <p className="muted">
            送信中 {settings?.width}×{settings?.height} ・ 視聴者 {viewers} 人
          </p>
          {devices.length > 1 && (
            <select value={deviceId} onChange={(e) => void start(e.target.value)}>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `カメラ ${i + 1}`}
                </option>
              ))}
            </select>
          )}
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
      <Toast notice={view.notice} />
    </div>
  );
}
