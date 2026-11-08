import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function HoverDetail({ children, text, className = '', ariaLabel }: { children: ReactNode; text: string; className?: string; ariaLabel: string }) {
  const id = useId();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const close = () => { closeTimer.current = setTimeout(() => setPos(null), 150); };
  function show(element: HTMLElement) {
    clearTimeout(closeTimer.current);
    const rect = element.getBoundingClientRect();
    setPos({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 340)), top: rect.bottom + 10 > window.innerHeight - 190 ? Math.max(12, rect.top - 180) : rect.bottom + 10 });
  }
  return <><button type="button" className={`detail-trigger ${className}`} aria-label={ariaLabel} aria-describedby={pos ? id : undefined} onMouseEnter={e => show(e.currentTarget)} onMouseLeave={close} onFocus={e => show(e.currentTarget)} onBlur={() => setPos(null)} onKeyDown={e => { if (e.key === 'Escape') setPos(null); }} onClick={e => show(e.currentTarget)}>{children}</button>{pos && createPortal(<div id={id} role="tooltip" className="detail-tooltip" onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={close} style={{ ...pos, maxHeight: Math.min(window.innerHeight * 0.48, window.innerHeight - pos.top - 12) }}>{text}</div>, document.body)}</>;
}
