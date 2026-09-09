import type { SettledMemberRound } from '../data/types';
import { formatB, tone } from '../domain/ledger';

type Mode = 'line' | 'candle';
const CHART_WIDTH = 680; const CHART_HEIGHT = 264; const TOP = 20; const BOTTOM = 42; const LEFT = 68; const RIGHT = 12;
const plotHeight = CHART_HEIGHT - TOP - BOTTOM;

function scaleFor(rounds: SettledMemberRound[]) {
  if (rounds.length === 0) return { low: 0, high: 10000, y: (_value: number) => TOP + plotHeight / 2 };
  const values = rounds.flatMap((round) => [round.preTotalCents, round.endTotalCents]);
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(max - min, Math.max(Math.abs(max), 10000) * 0.08, 1000);
  const low = Math.max(0, min - span * 0.15); const high = max + span * 0.15;
  return { low, high, y: (value: number) => TOP + (high - value) / (high - low) * plotHeight };
}

export function Chart({ rounds, mode, selectedId, onSelect }: { rounds: SettledMemberRound[]; mode: Mode; selectedId: string | null; onSelect: (id: string) => void }) {
  if (rounds.length === 0) return <div className="chart-empty">暂无已结算场次</div>;
  const { low, high, y } = scaleFor(rounds);
  const x = (index: number) => rounds.length === 1 ? (LEFT + CHART_WIDTH - RIGHT) / 2 : LEFT + index * (CHART_WIDTH - LEFT - RIGHT) / (rounds.length - 1);
  const ticks = Array.from({ length: 5 }, (_, index) => high - (high - low) * index / 4);
  const closePath = rounds.map((round, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(round.endTotalCents)}`).join(' ');
  return <div className="chart-wrap" aria-label="按场次资产图表">
    <svg className="chart-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img">
      {ticks.map((value, index) => <g key={value}><line className="grid-line" x1={LEFT} x2={CHART_WIDTH - RIGHT} y1={TOP + index * plotHeight / 4} y2={TOP + index * plotHeight / 4} /><text className="axis-label" x={LEFT - 8} y={TOP + index * plotHeight / 4 + 4} textAnchor="end">{formatB(Math.round(value)).replace('.00', '')}</text></g>)}
      <text className="axis-unit" x="7" y="13">资产 B</text>
      <path className="close-line" d={closePath} />
      {rounds.map((round, index) => {
        const cx = x(index); const openY = y(round.preTotalCents); const closeY = y(round.endTotalCents); const selected = selectedId === round.id; const colorClass = tone(round.assetChangeCents);
        return <g key={round.id} className="chart-hit" onClick={() => onSelect(round.id)}>
          {selected && <line className="selection-line" x1={cx} x2={cx} y1={TOP} y2={TOP + plotHeight} />}
          {mode === 'line' ? <><circle className={`chart-dot ${selected ? 'selected' : ''}`} cx={cx} cy={closeY} r={selected ? 7 : 4.5} /><circle className="touch-target" cx={cx} cy={closeY} r="20" /></> : <>
            <rect className={`candle-body ${colorClass}`} x={cx - 7} y={Math.min(openY, closeY)} width="14" height={Math.max(Math.abs(openY - closeY), 3)} rx="1" />
            <circle className="touch-target" cx={cx} cy={(openY + closeY) / 2} r="22" />
          </>}
          <text className="x-label" x={cx} y={CHART_HEIGHT - 13} textAnchor="middle">{round.label}</text>
        </g>;
      })}
    </svg>
  </div>;
}
