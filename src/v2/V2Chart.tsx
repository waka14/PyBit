import { useRef } from 'react';
import { formatB, tone } from './domain';

export type ChartDatum = {
  id: string;
  label: string;
  preCents: number;
  endCents: number;
  kind?: 'round' | 'capital';
};

export function V2Chart({ data, mode, selectedId, onSelect, unit }: {
  data: ChartDatum[];
  mode: 'line' | 'candle';
  selectedId: string | null;
  onSelect: (id: string) => void;
  unit: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const skipClickRef = useRef(false);
  if (!data.length) return <div className="v2-empty">暂无可绘制的数据</div>;

  const width = 720; const height = 280; const left = 72; const right = 18; const top = 22; const bottom = 48;
  const plotWidth = width - left - right;
  const values = data.flatMap((row) => [row.preCents, row.endCents]);
  const min = Math.min(...values); const max = Math.max(...values); const padding = Math.max((max - min) * .16, 1000);
  const low = min - padding; const high = max + padding;
  const x = (index: number) => mode === 'line'
    ? left + (index + 1) * plotWidth / data.length
    : data.length === 1 ? (left + width - right) / 2 : left + index * plotWidth / (data.length - 1);
  const y = (value: number) => top + (high - value) / (high - low) * (height - top - bottom);
  const ticks = Array.from({ length: 4 }, (_, index) => high - (high - low) * index / 3);
  const path = `M ${left} ${y(data[0].preCents)} ${data.map((row, index) => `L ${x(index)} ${y(row.endCents)}`).join(' ')}`;
  const nearestIndex = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const viewX = (clientX - rect.left) / rect.width * width;
    let nearest = 0;
    data.forEach((_, index) => { if (Math.abs(viewX - x(index)) < Math.abs(viewX - x(nearest))) nearest = index; });
    return nearest;
  };
  const keySelect = (index: number) => onSelect(data[Math.max(0, Math.min(data.length - 1, index))].id);
  const selectedIndex = Math.max(0, data.findIndex((row) => row.id === selectedId));
  return <div className="v2-chart-wrap"><svg ref={svgRef} className="v2-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${unit}走势图`}
    onClick={(event) => { if (skipClickRef.current) { skipClickRef.current = false; return; } onSelect(data[nearestIndex(event.clientX)].id); }}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); pointerRef.current = { x: event.clientX, y: event.clientY, moved: false }; }}
    onPointerMove={(event) => {
      const start = pointerRef.current;
      if (!start) return;
      const dx = event.clientX - start.x; const dy = event.clientY - start.y;
      if (Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) {
        event.preventDefault(); start.moved = true; skipClickRef.current = true; keySelect(nearestIndex(event.clientX));
      }
    }}
    onPointerUp={(event) => { event.currentTarget.releasePointerCapture?.(event.pointerId); pointerRef.current = null; }}
    onPointerCancel={() => { pointerRef.current = null; }}>
    {ticks.map((value, index) => <g key={index}><line className="v2-grid-line" x1={left} x2={width - right} y1={top + index * (height - top - bottom) / 3} y2={top + index * (height - top - bottom) / 3} /><text className="v2-axis" x={left - 8} y={top + index * (height - top - bottom) / 3 + 4} textAnchor="end">{formatB(Math.round(value)).replace('.00', '')}</text></g>)}
    <text className="v2-axis" x="8" y="14">{unit}</text>
    {mode === 'line' && <path className="v2-line" d={path} />}
    {data.map((row, index) => {
      const cx = x(index); const openY = y(row.preCents); const closeY = y(row.endCents); const selected = row.id === selectedId;
      return <g className="v2-chart-hit" key={row.id} tabIndex={0} role="button" aria-label={`${row.label} ${formatB(row.endCents)}`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); keySelect(selectedIndex - 1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); keySelect(selectedIndex + 1); }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(row.id); }
        }}>
        {selected && <line className="v2-selection" x1={cx} x2={cx} y1={top} y2={height - bottom} />}
        {mode === 'line' ? <circle className={`v2-dot ${selected ? 'selected' : ''} ${row.kind === 'capital' ? 'capital' : ''}`} cx={cx} cy={closeY} r={selected ? 7 : 5} /> : <rect className={`v2-candle ${tone(row.endCents - row.preCents)} ${row.kind === 'capital' ? 'capital' : ''}`} x={cx - 8} y={Math.min(openY, closeY)} width="16" height={Math.max(Math.abs(openY - closeY), 3)} rx="2" />}
        <circle className="v2-touch" cx={cx} cy={(openY + closeY) / 2} r="24" />
        <text className="v2-axis" x={cx} y={height - 17} textAnchor="middle">{row.label}</text>
      </g>;
    })}
  </svg></div>;
}
