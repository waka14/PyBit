import type { CSSProperties } from 'react';
import { BMark } from './BMark';

const pixels = Array.from({ length: 32 }, (_, index) => ({
  index, left: (index * 37 + 11) % 100, size: 2 + (index % 4), duration: 8 + (index % 7) * 1.1,
  delay: -(index % 9) * 1.3, drift: ((index * 19) % 90) - 45, depth: 20 + (index % 6) * 22
}));

type GlyphName = 'btc' | 'eth' | 'zec' | 'cube' | 'cross' | 'spark' | 'chain' | 'b';
const glyphs: { name: GlyphName; left: number; duration: number; delay: number; drift: number; depth: number }[] = [
  ['btc', 8, 19, -3, 36, 80], ['cube', 18, 23, -14, -26, 120], ['eth', 29, 21, -8, 24, 60], ['spark', 40, 17, -12, -18, 145],
  ['zec', 52, 24, -5, 30, 95], ['chain', 64, 20, -17, -38, 135], ['b', 76, 26, -9, 18, 45], ['cross', 90, 18, -2, -24, 110],
  ['eth', 13, 22, -19, 28, 150], ['btc', 35, 25, -21, -32, 75], ['cube', 57, 18, -7, 22, 100], ['zec', 84, 21, -15, -20, 130],
  ['spark', 23, 20, -4, 34, 55], ['b', 47, 28, -24, -26, 85], ['chain', 70, 23, -11, 32, 125], ['cross', 95, 19, -16, -18, 65]
].map(([name, left, duration, delay, drift, depth]) => ({ name: name as GlyphName, left: left as number, duration: duration as number, delay: delay as number, drift: drift as number, depth: depth as number }));

function PixelGlyph({ name }: { name: Exclude<GlyphName, 'b'> }) {
  const common = { viewBox: '0 0 16 16', fill: 'currentColor', shapeRendering: 'crispEdges' as const, 'aria-hidden': true };
  if (name === 'btc') return <svg {...common}><path d="M5 1h6v1h2v2h2v8h-2v2h-2v1H5v-1H3v-2H1V4h2V2h2zm2 3v1H5v2h2v4H5v2h2v-1h2v1h2v-1h1V9h-1V8h1V5h-1V4H9V3H7zm0 2h3v2H7zm0 3h3v2H7z"/></svg>;
  if (name === 'eth') return <svg {...common}><path d="M8 1 3 8l5 3 5-3zm0 11-5-3 5 6 5-6z"/></svg>;
  if (name === 'zec') return <svg {...common}><path d="M5 1h6v1h2v2h2v8h-2v2h-2v1H5v-1H3v-2H1V4h2V2h2zm1 3v2h4L5 10v2h6v-2H7l4-4V4z"/></svg>;
  if (name === 'cube') return <svg {...common}><path d="M7 1h2v2h3v2h2v6h-2v2H9v2H7v-2H4v-2H2V5h2V3h3zm0 4H5v5h2zm2 0v5h2V5zm-1-1v8h1V4z"/></svg>;
  if (name === 'cross') return <svg {...common}><path d="M7 1h2v4h2V3h2v2h2v2h-4v2h4v2h-2v2h-2v-2H9v4H7v-4H5v2H3v-2H1V9h4V7H1V5h2V3h2v2h2z"/></svg>;
  if (name === 'spark') return <svg {...common}><path d="M7 1h2v4h2v2h4v2h-4v2H9v4H7v-4H5V9H1V7h4V5h2z"/></svg>;
  return <svg {...common}><path d="M3 3h4v2H5v2h2v2H5v2h2v2H3zm6 0h4v10H9v-2h2V9H9V7h2V5H9z"/></svg>;
}

export function PixelStorm() {
  return <div className="pixel-storm" aria-hidden="true">
    {pixels.map((pixel) => <i className="storm-pixel" key={`pixel-${pixel.index}`} style={{ '--pixel-left': `${pixel.left}%`, '--pixel-size': `${pixel.size}px`, '--pixel-duration': `${pixel.duration}s`, '--pixel-delay': `${pixel.delay}s`, '--pixel-drift': `${pixel.drift}px`, '--pixel-depth': `${pixel.depth}px` } as CSSProperties} />)}
    {glyphs.map((glyph, index) => <span className={`storm-glyph storm-glyph-${glyph.name}`} key={`${glyph.name}-${index}`} style={{ '--pixel-left': `${glyph.left}%`, '--pixel-duration': `${glyph.duration}s`, '--pixel-delay': `${glyph.delay}s`, '--pixel-drift': `${glyph.drift}px`, '--pixel-depth': `${glyph.depth}px` } as CSSProperties}>{glyph.name === 'b' ? <BMark variant="mono" /> : <PixelGlyph name={glyph.name} />}</span>)}
  </div>;
}
