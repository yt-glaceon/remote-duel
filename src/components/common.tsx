import { useEffect, useState, type ReactNode } from 'react';
import type { Status, View } from '../net/room';

const STATUS_LABEL: Record<Status, string> = {
  connecting: '接続中',
  online: '接続済み',
  reconnecting: '再接続中',
  full: '観戦',
  error: 'エラー',
};

export function StatusPill({ status, detail }: { status: Status; detail: string }) {
  return (
    <span className={`pill pill-${status}`} title={detail}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Toast({ notice }: { notice: View['notice'] }) {
  const [shown, setShown] = useState<View['notice']>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const t = setTimeout(() => setShown(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  return shown ? <div className="toast">{shown.text}</div> : null;
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
