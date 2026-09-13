export type ModuleGlyphName = 'market' | 'allocation' | 'withdrawal';

function ModuleGlyph({ name }: { name: ModuleGlyphName }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true };
  if (name === 'market') return <svg {...common}><path d="M2.5 13.5 6 10l2.6 1.8L14.8 5.5"/><path d="M11.5 5.5h3.3v3.3"/><rect x="2.5" y="2.5" width="3" height="3"/></svg>;
  if (name === 'allocation') return <svg {...common}><rect x="2.5" y="2.5" width="5" height="5"/><rect x="10.5" y="2.5" width="5" height="5"/><rect x="2.5" y="10.5" width="5" height="5"/><path d="M10.5 13h5M13 10.5v5"/></svg>;
  return <svg {...common}><path d="M3 5.5h9.5M9.5 2.5l3 3-3 3"/><path d="M15 12.5H5.5M8.5 9.5l-3 3 3 3"/><rect x="2.5" y="2.5" width="13" height="13" rx="3"/></svg>;
}

export function ModuleTitle({ icon, children }: { icon: ModuleGlyphName; children: string }) {
  return <span className="module-title"><span className={`module-glyph module-glyph-${icon}`}><ModuleGlyph name={icon} /></span><span>{children}</span></span>;
}
