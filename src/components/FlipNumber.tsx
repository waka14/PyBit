import { useEffect, useState } from 'react';

export function FlipNumber({ target, format, className = '', live = true }: { target: number; format: (value: number) => string; className?: string; live?: boolean }) {
  const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(() => canAnimate ? 0 : target);
  const [settled, setSettled] = useState(() => !canAnimate);
  useEffect(() => {
    if (!canAnimate) { setValue(target); setSettled(true); return; }
    setSettled(false);
    let frame = 0; const started = performance.now(); let lastStep = -1;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 760); const eased = 1 - Math.pow(1 - progress, 3); const step = Math.floor(eased * 24);
      if (step !== lastStep) { lastStep = step; setValue(Math.round(target * step / 24)); }
      if (progress < 1) frame = requestAnimationFrame(tick); else { setValue(target); setSettled(true); }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, canAnimate]);
  const display = format(value);
  return <span className={`quote-flip ${live && settled ? 'quote-flip-live' : ''} ${className}`} aria-label={format(target)}><span className="quote-flip-value" key={display} aria-hidden="true">{display}</span></span>;
}
