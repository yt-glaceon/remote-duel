import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Rotation } from '../media/camera';

type T = { s: number; x: number; y: number };
const IDENTITY: T = { s: 1, x: 0, y: 0 };
const MAX_SCALE = 8;

/** 中身をホイール・ピンチで拡大し、ドラッグで動かせる枠。ダブルクリックで元に戻る */
export function ZoomView({ children, className = '' }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<T>(IDENTITY);
  const tRef = useRef(t);
  tRef.current = t;
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // 拡大後も枠の外に余白が出ないように位置を収める
  const clamp = (n: T): T => {
    const el = box.current;
    if (!el) return n;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const s = Math.min(MAX_SCALE, Math.max(1, n.s));
    return { s, x: Math.min(0, Math.max(w - w * s, n.x)), y: Math.min(0, Math.max(h - h * s, n.y)) };
  };

  const zoomAt = (px: number, py: number, factor: number) => {
    const cur = tRef.current;
    const s = Math.min(MAX_SCALE, Math.max(1, cur.s * factor));
    const k = s / cur.s;
    setT(clamp({ s, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k }));
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // React の onWheel は passive なので preventDefault できない。直接登録する
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    box.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    if (ps.size === 1) {
      const cur = tRef.current;
      setT(clamp({ ...cur, x: cur.x + p.x - prev.x, y: cur.y + p.y - prev.y }));
    } else if (ps.size === 2) {
      const [a, b] = [...ps.entries()].map(([id, v]) => (id === e.pointerId ? p : v));
      const [pa, pb] = [...ps.values()];
      const d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      const d1 = Math.hypot(a.x - b.x, a.y - b.y);
      if (d0 > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d1 / d0);
    }
    ps.set(e.pointerId, p);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const zoomCenter = (factor: number) => {
    const el = box.current;
    if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, factor);
  };

  return (
    <div
      ref={box}
      className={`zoom ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setT(IDENTITY)}
    >
      <div className="zoom-inner" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>
        {children}
      </div>
      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomCenter(1.5)} aria-label="拡大">＋</button>
        <button type="button" onClick={() => zoomCenter(1 / 1.5)} aria-label="縮小">－</button>
        <button type="button" onClick={() => setT(IDENTITY)} aria-label="元の大きさ">{t.s.toFixed(1)}×</button>
      </div>
    </div>
  );
}

/** 中身を枠いっぱいに収めたまま、時計回りに回して表示する(90°・270°では縦横を入れ替える) */
export function Rotated({ rotate, className = '', children }: { rotate: Rotation; className?: string; children: ReactNode }) {
  return (
    <div className={`rot rot-${rotate} ${className}`}>
      <div className="rot-body">{children}</div>
    </div>
  );
}

export function StreamVideo({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted />;
}
