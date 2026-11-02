// カメラ映像の取得・送信品質の調整・高画質スナップショット

export const TEST_PATTERN_ID = 'test-pattern';

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

export async function openCamera(deviceId?: string, facing?: 'environment' | 'user'): Promise<MediaStream> {
  if (deviceId === TEST_PATTERN_ID) return testPatternStream();
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('このブラウザではカメラを使えません(HTTPS で開いているか確認してください)');
  }
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else if (facing) video.facingMode = { ideal: facing };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  // カードの文字を読みたいので、フレームレートより解像度を優先させる
  for (const t of stream.getVideoTracks()) t.contentHint = 'detail';
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** 接続が確立したら呼ぶ。ビットレートの上限を上げ、帯域不足時も解像度を保たせる */
export async function tuneSenders(pc: RTCPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = 4_000_000;
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      'maintain-resolution';
    await sender.setParameters(params).catch(() => {});
  }
}

const MAX_SNAPSHOT_BYTES = 2_500_000;
const MAX_SNAPSHOT_EDGE = 3200;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** 送信側で、圧縮前のカメラ画像から静止画を撮る */
export async function captureStill(stream: MediaStream): Promise<Blob> {
  const track = stream.getVideoTracks()[0];
  if (!track) throw new Error('カメラが止まっています');
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } })
    .ImageCapture;
  if (IC && !isTestPattern(stream)) {
    try {
      const photo = await withTimeout(new IC(track).takePhoto(), 4000);
      return photo.size > MAX_SNAPSHOT_BYTES ? await shrink(photo) : photo;
    } catch {
      // takePhoto に対応しないカメラもあるので、映像のフレームから撮る
    }
  }
  return frameToJpeg(stream);
}

async function frameToJpeg(stream: MediaStream): Promise<Blob> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play();
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d')!.drawImage(v, 0, 0);
  v.srcObject = null;
  return toJpeg(canvas);
}

async function shrink(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SNAPSHOT_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return toJpeg(canvas);
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/jpeg', 0.92),
  );
}

// 開発用: カメラがない環境でも拡大やスナップショットを試せるテスト映像
const testStreams = new WeakSet<MediaStream>();
const isTestPattern = (s: MediaStream) => testStreams.has(s);

function testPatternStream(): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  const draw = () => {
    const t = Date.now() / 1000;
    ctx.fillStyle = '#1d3b2a';
    ctx.fillRect(0, 0, 1920, 1080);
    for (let i = 0; i < 5; i++) {
      const x = 160 + i * 340;
      ctx.fillStyle = '#c9a86a';
      ctx.fillRect(x, 300, 240, 350);
      ctx.fillStyle = '#222';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(`テストカード ${i + 1}`, x + 16, 340);
      ctx.font = '11px sans-serif';
      for (let l = 0; l < 6; l++) ctx.fillText(`小さな効果テキスト 行${l + 1}`, x + 16, 560 + l * 14);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '40px monospace';
    ctx.fillText(`TEST PATTERN ${t.toFixed(1)}`, 60, 90);
    ctx.beginPath();
    ctx.arc(960 + Math.cos(t) * 700, 900, 30, 0, Math.PI * 2);
    ctx.fill();
  };
  draw();
  const timer = setInterval(draw, 1000 / 15);
  const stream = canvas.captureStream(15);
  stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
  const origStop = MediaStreamTrack.prototype.stop;
  stream.getVideoTracks()[0].stop = function () {
    clearInterval(timer);
    origStop.call(this);
  };
  testStreams.add(stream);
  return stream;
}
