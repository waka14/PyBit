export type UiIconName = 'trend' | 'wallet' | 'ledger' | 'line' | 'candle' | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'chevron-up' | 'refresh' | 'download' | 'logout';

export function UiIcon({ name, size = 18 }: { name: UiIconName; size?: number }) {
  const common = { className: 'ui-icon', width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (name === 'trend') return <svg {...common}><path d="M4 18V6M4 18h16"/><path d="m7 14 3-3 3 2 5-6"/><path d="M15 7h3v3"/></svg>;
  if (name === 'wallet') return <svg {...common}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M4 8h14.5A1.5 1.5 0 0 1 20 9.5V12h-4a2 2 0 1 0 0 4h4"/><circle cx="16" cy="14" r=".6" fill="currentColor" stroke="none"/></svg>;
  if (name === 'ledger') return <svg {...common}><rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>;
  if (name === 'line') return <svg {...common}><path d="M4 18V6M4 18h16"/><path d="m7 14 3-3 3 2 4-5"/></svg>;
  if (name === 'candle') return <svg {...common}><path d="M8 4v4M8 15v5M16 3v6M16 16v5"/><rect x="6" y="8" width="4" height="7" rx="1"/><rect x="14" y="9" width="4" height="7" rx="1"/></svg>;
  if (name === 'chevron-left') return <svg {...common}><path d="m14.5 6-6 6 6 6"/></svg>;
  if (name === 'chevron-right') return <svg {...common}><path d="m9.5 6 6 6-6 6"/></svg>;
  if (name === 'chevron-down') return <svg {...common}><path d="m6 9 6 6 6-6"/></svg>;
  if (name === 'chevron-up') return <svg {...common}><path d="m6 15 6-6 6 6"/></svg>;
  if (name === 'refresh') return <svg {...common}><path d="M20 7v5h-5"/><path d="M18.3 16a8 8 0 1 1 .8-7L20 12"/></svg>;
  if (name === 'download') return <svg {...common}><path d="M12 3v11M8 10l4 4 4-4"/><path d="M5 18v2h14v-2"/></svg>;
  return <svg {...common}><path d="M10 5H5v14h5"/><path d="m14 8 4 4-4 4M18 12H9"/></svg>;
}
