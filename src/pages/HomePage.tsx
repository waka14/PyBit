import { useMemo, useState } from 'react';
import { Chart } from '../components/Chart';
import { MetricCard } from '../components/MetricCard';
import type { MemberDashboard, SettledMemberRound } from '../data/types';
import { formatB, formatPercent, tone } from '../domain/ledger';

const DETAIL_LABELS = ['场次前总资产', '本场投入', '本场结束所得', '本场资产变动', '本场收益率', '结束后总资产', '手续费', '抽水'] as const;
function detailValues(round: SettledMemberRound) {
  return [
    formatB(round.preTotalCents), formatB(round.stakeCents), formatB(round.settlementCents), formatB(round.assetChangeCents, true),
    formatPercent(round.returnBps), formatB(round.endTotalCents), formatB(round.feeCents), formatB(round.rakeCents)
  ];
}

export function HomePage({ dashboard }: { dashboard: MemberDashboard }) {
  const [mode, setMode] = useState<'line' | 'candle'>('line');
  const [period, setPeriod] = useState<'5' | '10' | 'all'>('5');
  const settledRounds = dashboard.rounds.filter((round): round is SettledMemberRound => round.status === 'SETTLED');
  const [selectedId, setSelectedId] = useState<string | null>(settledRounds.at(-1)?.id ?? null);
  const rounds = useMemo(() => period === 'all' ? settledRounds : settledRounds.slice(-(period === '5' ? 5 : 10)), [settledRounds, period]);
  const selected = rounds.find((row) => row.id === selectedId) ?? null;
  const choose = (id: string) => setSelectedId((current) => current === id ? null : id);
  return <main className="page">
    <div className="eyebrow">我的当前总资产 · 最近更新 {dashboard.updatedAt}</div>
    <div className="hero-amount">{formatB(dashboard.currentTotalCents)}</div>
    <div className="two-grid"><MetricCard label="累计盈亏" value={<span className={tone(dashboard.cumulativeProfitCents)}>{formatB(dashboard.cumulativeProfitCents, true)}</span>} /><MetricCard label="累计收益率" value={<span className={tone(dashboard.cumulativeProfitCents)}>{formatPercent(dashboard.cumulativeReturnBps)}</span>} hint="按累计实际入金" /></div>
    <section className="panel chart-panel"><div className="section-heading"><div><h2>资产走势</h2><p>按已结算场次记录</p></div><div className="segmented"><button className={mode === 'line' ? 'active' : ''} onClick={() => setMode('line')}>资产折线</button><button className={mode === 'candle' ? 'active' : ''} onClick={() => setMode('candle')}>场次K线</button></div></div>
      <div className="filters">{([['5', '近5场'], ['10', '近10场'], ['all', '全部']] as const).map(([value, label]) => <button key={value} className={period === value ? 'chip active' : 'chip'} onClick={() => setPeriod(value)}>{label}</button>)}</div>
      <p className="hint">点按查看场次详情</p>
      <Chart rounds={rounds} mode={mode} selectedId={selectedId} onSelect={choose} />
      {selected && <section className="detail-card"><div className="detail-title">{selected.occurredAt} · {selected.name} · 已结算</div><div className="detail-grid">{DETAIL_LABELS.map((label, index) => <div className="detail-cell" key={label}><span>{label}</span><strong className={index === 3 || index === 4 ? tone(selected.assetChangeCents) : index > 5 ? 'negative' : ''}>{detailValues(selected)[index]}</strong></div>)}</div><div className="detail-nav"><button className="chip" disabled={rounds.findIndex((row) => row.id === selected.id) <= 0} onClick={() => { const index = rounds.findIndex((row) => row.id === selected.id); if (index > 0) setSelectedId(rounds[index - 1]!.id); }}>上一场</button><button className="chip" disabled={rounds.findIndex((row) => row.id === selected.id) >= rounds.length - 1} onClick={() => { const index = rounds.findIndex((row) => row.id === selected.id); if (index < rounds.length - 1) setSelectedId(rounds[index + 1]!.id); }}>下一场</button></div></section>}
    </section>
  </main>;
}
