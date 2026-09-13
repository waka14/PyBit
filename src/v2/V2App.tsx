import { useEffect, useRef, useState } from 'react';
import { formatB, formatPercent, parseBToCents, summarizeRounds, tone } from './domain';
import type { PendingMandateInput, RoundPatch, SaveRoundInput, V2Repository, V2ViewState } from './repository';
import type { DerivedMandate, DerivedMemberRound, DerivedRound, GameType, MandateType, V2Member } from './types';
import { V2Chart, type ChartDatum } from './V2Chart';
import { BMark, BottomNav, FlipNumber, ModuleTitle, PageTransition, PixelStorm, UiIcon } from '../ui';
import './v2.css';

type Tab = 'home' | 'assets' | 'ledger';
type Range = '5' | '10' | 'all';
type EarningsFilter = 'all' | MandateType;
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date());
const isAdmin = (member: V2Member) => member.role === 'czh' || member.role === 'waka';
const gameName = (gameType: GameType) => gameType === 'texas' ? '德州' : '其他';
const mandateName = (mandateType: MandateType) => mandateType === 'regular' ? '常规' : '单独委托';
const statusName = (status: DerivedMandate['status']) => ({ pending: '待接手', executing: '执行中', settled: '已结算', cancelled: '已撤销' })[status];

const errorMessage = (error: unknown) => {
  const value = error instanceof Error ? error.message : String(error);
  if (value.includes('RATIO_EXCEEDS_REMAINDER')) return '超过当前剩余比例，原比例没有改变。';
  if (value.includes('ASSET_BELOW_LOCKED')) return '总资产不能低于已锁定的委托资金。';
  if (value.includes('ASSET_INSUFFICIENT')) return '可用资产不足，请减少投入或先记录资金变动。';
  if (value.includes('ROUND_VERSION_CONFLICT')) return '这条记录已被更新，请重新加载后再操作。';
  if (value.includes('RESULT_REQUIRED')) return '结算时必须填写产出；0.00 B 是合法结果。';
  if (value.includes('FORBIDDEN')) return '你没有权限执行这个操作。';
  if (value.includes('INVALID')) return '填写内容不符合要求，请检查金额、日期和类型。';
  return '操作未完成，请检查网络后重试。';
};

function lastRange<T>(items: T[], range: Range) {
  return range === 'all' ? items : items.slice(-Number(range));
}

function assetRange<T extends { kind?: 'round' | 'capital'; source?: 'capital' | 'regular' | 'individual' }>(items: T[], range: Range) {
  if (range === 'all') return items;
  const roundIndexes = items.reduce<number[]>((indexes, item, index) => item.kind === 'round' || item.source === 'regular' || item.source === 'individual' ? [...indexes, index] : indexes, []);
  if (!roundIndexes.length) return items;
  return items.slice(roundIndexes[Math.max(0, roundIndexes.length - Number(range))]);
}

function ChartControls({ mode, range, onMode, onRange }: { mode: 'line' | 'candle'; range: Range; onMode: (value: 'line' | 'candle') => void; onRange: (value: Range) => void }) {
  return <div className="v2-chart-controls"><div className="v2-segment"><button aria-label="折线图" className={mode === 'line' ? 'active' : ''} onClick={() => onMode('line')}><UiIcon name="line" />折线</button><button aria-label="场次 K 线图" className={mode === 'candle' ? 'active' : ''} onClick={() => onMode('candle')}><UiIcon name="candle" />场次 K 线</button></div><div className="v2-filters">{([['5', '近五场'], ['10', '近十场'], ['all', '全部']] as const).map(([value, label]) => <button className={range === value ? 'v2-chip active' : 'v2-chip'} key={value} onClick={() => onRange(value)}>{label}</button>)}</div></div>;
}

function RoundDetail({ round, row, czh }: { round: DerivedRound; row?: DerivedMemberRound; czh: boolean }) {
  const returnBps = row?.stakeCents ? Math.round(row.netProfitCents * 10000 / row.stakeCents) : null;
  const displayedRake = czh && round.mandateType === 'individual' ? row?.managerRakeIncomeCents ?? round.rakeCents : row?.rakeCents ?? round.rakeCents;
  return <div className="v2-detail"><strong>{round.name}</strong><div className="v2-data-grid"><span>投入<b>{formatB(row?.stakeCents ?? round.totalStakeCents)}</b></span><span>毛产出<b>{formatB(row?.grossCents ?? round.grossResultCents ?? 0)}</b></span><span>{czh && round.mandateType === 'individual' ? '委托抽水' : '抽水'}<b>{formatB(displayedRake)}</b></span><span>净盈亏<b className={tone(row?.netProfitCents ?? 0)}>{formatB(row?.netProfitCents ?? 0, true)}</b></span><span>本场收益率<b>{formatPercent(returnBps)}</b></span><span>结算后资产<b>{formatB(row?.endAssetCents ?? 0)}</b></span></div></div>;
}

function HomePage({ state }: { state: V2ViewState }) {
  const [mode, setMode] = useState<'line' | 'candle'>('line');
  const [range, setRange] = useState<Range>('5');
  const [filter, setFilter] = useState<EarningsFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filteredAll = state.me.rounds.filter((round) => filter === 'all' || round.mandateType === filter);
  let running = 0;
  const allData = filteredAll.map((round) => {
    const datum = { id: round.roundId, label: round.label, preCents: running, endCents: running + round.netProfitCents, kind: 'round' as const };
    running += round.netProfitCents;
    return datum;
  });
  const data = lastRange(allData, range);
  const selected = filteredAll.find((round) => round.roundId === selectedId);
  const selectedRound = selected ? state.rounds.find((round) => round.id === selected.roundId) : undefined;
  const visibleIds = new Set(data.map((datum) => datum.id));
  const visibleRounds = filteredAll.filter((round) => visibleIds.has(round.roundId));
  const summary = summarizeRounds(visibleRounds);
  const composition = (state.actor.isCzh
    ? [['regular', '自投收益', summary.regularNetProfitCents], ['individual', '委托抽水', summary.managerRakeIncomeCents]] as const
    : [['regular', '常规比赛', summary.regularNetProfitCents], ['individual', '单独委托', summary.individualNetProfitCents]] as const
  ).filter(([kind]) => filter === 'all' || filter === kind);
  return <main className="v2-page"><div className="v2-page-title"><div><p>我的当前总资产</p><h1><FlipNumber target={state.me.currentAssetCents} format={formatB} /></h1><small className="v2-submetric">{state.actor.isCzh ? '累计比赛盈亏（含委托抽水）' : '累计比赛盈亏'} <b className={tone(state.me.cumulativeGameProfitCents)}>{formatB(state.me.cumulativeGameProfitCents, true)}</b></small></div><div className="v2-stat"><span>累计收益率</span><strong>{formatPercent(state.me.cumulativeReturnBps)}</strong><small>{state.actor.isCzh ? '含抽水／按自投本金' : '不受图表筛选影响'}</small></div></div><section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="market">收益曲线</ModuleTitle></h2><p>只计算已结算比赛，先筛选类型，再取最近场次</p></div></div><div className="v2-segment"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button><button className={filter === 'regular' ? 'active' : ''} onClick={() => setFilter('regular')}>常规</button><button className={filter === 'individual' ? 'active' : ''} onClick={() => setFilter('individual')}>单独委托</button></div><ChartControls mode={mode} range={range} onMode={setMode} onRange={setRange} /><V2Chart data={data} mode={mode} selectedId={selectedId} onSelect={(id) => setSelectedId((current) => current === id ? null : id)} unit="累计收益 B" />{selected && selectedRound && <RoundDetail round={selectedRound} row={selected} czh={state.actor.isCzh} />}<div className="v2-stat-grid"><span><small>筛选场次</small><b>{summary.count}</b></span><span><small>胜场</small><b>{summary.winningCount}</b></span><span><small>胜率</small><b>{formatPercent(summary.winningRateBps)}</b></span></div><div className="v2-composition">{composition.map(([, label, value]) => <div key={label}><span>{label}</span><b className={tone(value)}>{formatB(value, true)}</b></div>)}</div></section><CommonRecord state={state} /></main>;
}

function CommonRecord({ state }: { state: V2ViewState }) {
  const [mode, setMode] = useState<'line' | 'candle'>('line');
  const [range, setRange] = useState<Range>('5');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  let running = 0;
  const allData = state.commonRecord.rounds.map((round) => {
    const datum = { id: round.id, label: round.label, preCents: running, endCents: running + round.rows.reduce((sum, row) => sum + row.netProfitCents, 0) };
    running = datum.endCents;
    return datum;
  });
  const data = lastRange(allData, range);
  const selected = state.commonRecord.rounds.find((round) => round.id === selectedId);
  return <section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="market">常规共同记录</ModuleTitle></h2><p>三位股东的总投入、总产出和净收益</p></div><strong>{formatB(state.commonRecord.totalNetProfitCents, true)}</strong></div><ChartControls mode={mode} range={range} onMode={setMode} onRange={setRange} /><V2Chart data={data} mode={mode} selectedId={selectedId} onSelect={(id) => setSelectedId((current) => current === id ? null : id)} unit="共同净收益 B" />{selected && <div className="v2-detail"><strong>{selected.name}</strong><div className="v2-data-grid"><span>总投入<b>{formatB(selected.totalStakeCents)}</b></span><span>总产出<b>{formatB(selected.grossResultCents ?? 0)}</b></span><span>总净收益<b className={tone(selected.rows.reduce((sum, row) => sum + row.netProfitCents, 0))}>{formatB(selected.rows.reduce((sum, row) => sum + row.netProfitCents, 0), true)}</b></span></div><div className="v2-member-lines">{selected.rows.filter((row) => row.stakeCents > 0).map((row) => <div key={row.memberId}><span>{state.members.find((member) => member.id === row.memberId)?.name}</span><span>投入 {formatB(row.stakeCents)} · 分配 {formatB(row.grossCents)}</span></div>)}</div></div>}</section>;
}

function MandateForm({ state, repository, run, onDone }: { state: V2ViewState; repository: V2Repository; run: (action: () => Promise<unknown>, success: string) => Promise<boolean>; onDone: () => void }) {
  const [stake, setStake] = useState('');
  const [gameType, setGameType] = useState<GameType>('texas');
  const [error, setError] = useState('');
  const submit = async () => {
    const totalStakeCents = parseBToCents(stake);
    if (totalStakeCents === null || totalStakeCents <= 0) { setError('请输入正数投入。'); return; }
    setError('');
    const input: PendingMandateInput = { scheduledDate: today(), totalStakeCents, gameType };
    if (await run(() => repository.createMandate(input), '单独委托已发出，资金已锁定。')) { setStake(''); onDone(); }
  };
  return <div className="v2-form"><label>比赛类型<select value={gameType} onChange={(event) => setGameType(event.target.value as GameType)}><option value="texas">德州</option><option value="other">其他</option></select></label><label>委托投入 B<input inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} placeholder="例如 700" /></label>{error && <p className="v2-form-error" role="alert">{error}</p>}<button className="v2-primary" onClick={() => void submit()}>发出委托</button></div>;
}

function MandateQueue({ state, repository, run }: { state: V2ViewState; repository: V2Repository; run: (action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [gameTypes, setGameTypes] = useState<Record<string, GameType>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = state.mandates.filter((mandate) => mandate.status === 'pending' || mandate.status === 'executing');
  const admin = isAdmin(state.actor);
  const edit = (mandate: DerivedMandate) => {
    setStakes((current) => ({ ...current, [mandate.id]: current[mandate.id] ?? (mandate.totalStakeCents / 100).toFixed(2) }));
    setGameTypes((current) => ({ ...current, [mandate.id]: current[mandate.id] ?? mandate.gameType }));
    setErrors((current) => ({ ...current, [mandate.id]: '' }));
    setEditing((current) => current === mandate.id ? null : mandate.id);
  };
  const saveEditableMandate = async (mandate: DerivedMandate) => {
    const cents = parseBToCents(stakes[mandate.id] ?? (mandate.totalStakeCents / 100).toFixed(2));
    if (cents === null || cents <= 0) {
      setErrors((current) => ({ ...current, [mandate.id]: '请输入正数投入。' }));
      return;
    }
    setErrors((current) => ({ ...current, [mandate.id]: '' }));
    const input = { scheduledDate: mandate.scheduledDate, totalStakeCents: cents, gameType: gameTypes[mandate.id] ?? mandate.gameType, ownerMemberId: mandate.ownerMemberId };
    const save = mandate.status === 'executing'
      ? () => repository.updateExecutingMandate(mandate.id, input, mandate.revision)
      : () => repository.updatePendingMandate(mandate.id, input, mandate.revision);
    if (await run(save, '委托已更新。')) setEditing(null);
  };
  if (!active.length) return <div className="v2-empty v2-compact-empty">暂无待处理委托</div>;
  return <div className="v2-mandate-list">{active.map((mandate) => {
    const owner = state.members.find((member) => member.id === mandate.ownerMemberId);
    const mine = mandate.ownerMemberId === state.actor.id;
    const canEdit = (mandate.status === 'pending' && (admin || mine)) || (mandate.status === 'executing' && admin);
    const resultError = errors[mandate.id];
    return <article className="v2-mandate-card" key={mandate.id}>
      <div className="v2-mandate-top"><div><strong>{owner?.name} · {gameName(mandate.gameType)}</strong><small>{mandate.scheduledDate} · {statusName(mandate.status)}</small></div><b>{formatB(mandate.totalStakeCents)}</b></div>
      {mandate.status === 'pending' && <p className="v2-lock-note">已锁定 {formatB(mandate.lockedAssetCents)}，可用资产暂时不包含这笔钱</p>}
      {mandate.status === 'executing' && <p className="v2-lock-note">执行中 · 锁定 {formatB(mandate.lockedAssetCents)}</p>}
      <div className="v2-mandate-actions">
        {canEdit && <button className="v2-chip" onClick={() => edit(mandate)}>编辑</button>}
        {mandate.status === 'pending' && (mine || admin) && <button className="v2-chip" onClick={() => void run(() => repository.cancelMandate(mandate.id, mandate.revision), '委托已撤销，锁定资金已释放。')}>撤销</button>}
        {admin && mandate.status === 'pending' && <button className="v2-primary compact" onClick={() => void run(() => repository.startMandate(mandate.id, mandate.revision), '委托已开始执行。')}>开始执行</button>}
        {admin && mandate.status === 'executing' && <><input className="v2-result-input" inputMode="decimal" placeholder="产出 B（可填 0）" value={results[mandate.id] ?? ''} onChange={(event) => { setResults((current) => ({ ...current, [mandate.id]: event.target.value })); setErrors((current) => ({ ...current, [mandate.id]: '' })); }} /><button className="v2-primary compact" onClick={() => { const result = parseBToCents(results[mandate.id] ?? ''); if (result === null) { setErrors((current) => ({ ...current, [mandate.id]: '请填写产出；0.00 B 是合法结果。' })); return; } setErrors((current) => ({ ...current, [mandate.id]: '' })); void run(() => repository.settleMandate(mandate.id, result, mandate.revision), '委托已结算，账目已更新。'); }}>结算</button></>}
        {admin && <button className="v2-danger-link" onClick={() => void run(() => repository.deleteRound(mandate.id, mandate.revision), '委托已删除，锁定资金已释放。')}>删除</button>}
      </div>
      {resultError && <p className="v2-form-error" role="alert">{resultError}</p>}
      {editing === mandate.id && <div className="v2-inline-form"><label>投入 B<input inputMode="decimal" value={stakes[mandate.id] ?? (mandate.totalStakeCents / 100).toFixed(2)} onChange={(event) => setStakes((current) => ({ ...current, [mandate.id]: event.target.value }))} /></label><label>比赛类型<select value={gameTypes[mandate.id] ?? mandate.gameType} onChange={(event) => setGameTypes((current) => ({ ...current, [mandate.id]: event.target.value as GameType }))}><option value="texas">德州</option><option value="other">其他</option></select></label><button className="v2-primary" onClick={() => void saveEditableMandate(mandate)}>保存</button></div>}
    </article>;
  })}</div>;
}

function AssetPage({ state, repository, run }: { state: V2ViewState; repository: V2Repository; run: (action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<'line' | 'candle'>('line');
  const [range, setRange] = useState<Range>('5');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [assetInput, setAssetInput] = useState('');
  const [ratioInput, setRatioInput] = useState((state.me.member.ratioBps / 100).toFixed(2));
  const [plannedTotal, setPlannedTotal] = useState('');
  const [showAsset, setShowAsset] = useState(false);
  const [showMandate, setShowMandate] = useState(false);
  const [formError, setFormError] = useState('');
  const assetEvents = assetRange(state.me.assetEvents, range);
  const personalData: ChartDatum[] = assetEvents.map((event) => ({ id: event.id, label: event.label, preCents: event.preAssetCents, endCents: event.endAssetCents, kind: event.kind }));
  const marketEvents = assetRange(state.market.assetEvents, range);
  const marketData: ChartDatum[] = marketEvents.map((event) => ({ id: event.id, label: event.label, preCents: event.preTotalAssetCents, endCents: event.totalAssetCents }));
  const selectedAsset = state.me.assetEvents.find((event) => event.id === selectedAssetId);
  const selectedMarket = state.market.assetEvents.find((event) => event.id === selectedMarketId);
  const saveAsset = async () => { const cents = parseBToCents(assetInput); if (cents === null) { setFormError('请输入不小于 0.00 B、最多两位小数的资产金额。'); return; } setFormError(''); if (await run(() => repository.adjustOwnAsset(cents), '资产已更新并记录资金变动。')) { setShowAsset(false); setAssetInput(''); } };
  const saveRatio = async () => { const points = Number(ratioInput); if (!Number.isFinite(points) || points < 0 || !Number.isInteger(points * 100)) { setFormError('比例必须是不小于 0、最多两位小数的百分数。'); return; } setFormError(''); await run(() => repository.changeOwnRatio(Math.round(points * 100)), '下一场参与比例已更新。'); };
  const plannedCents = parseBToCents(plannedTotal);
  return <main className="v2-page">{formError && <p className="v2-form-error" role="alert">{formError}</p>}<section className="v2-panel v2-asset-hero"><p>我的当前总资产</p><h1><FlipNumber target={state.me.currentAssetCents} format={formatB} /></h1>{state.me.lockedMandateCents > 0 && <div className="v2-asset-split"><span>可用 {formatB(state.me.availableAssetCents)}</span><span>锁定 {formatB(state.me.lockedMandateCents)}</span></div>}<button className="v2-link" onClick={() => { setShowAsset((value) => !value); setAssetInput((state.me.currentAssetCents / 100).toFixed(2)); setFormError(''); }}>{showAsset ? '收起' : '修改资产'}</button>{showAsset && <div className="v2-inline-form"><label>目标总资产 B<input inputMode="decimal" value={assetInput} onChange={(event) => setAssetInput(event.target.value)} /></label><button className="v2-primary" onClick={() => void saveAsset()}>保存并记录变动</button></div>}</section><section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="market">个人资产曲线</ModuleTitle></h2><p>比赛结算和资金增减都会改变资产</p></div></div><ChartControls mode={mode} range={range} onMode={setMode} onRange={setRange} /><V2Chart data={personalData} mode={mode} selectedId={selectedAssetId} onSelect={(id) => setSelectedAssetId((current) => current === id ? null : id)} unit="资产 B" />{selectedAsset && <div className="v2-detail"><strong>{selectedAsset.label}</strong><div className="v2-data-grid"><span>日期<b>{selectedAsset.occurredAt}</b></span><span>变动<b className={tone(selectedAsset.deltaCents)}>{formatB(selectedAsset.deltaCents, true)}</b></span><span>变动前<b>{formatB(selectedAsset.preAssetCents)}</b></span><span>变动后<b>{formatB(selectedAsset.endAssetCents)}</b></span></div></div>}</section><section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="market">股东总资产曲线</ModuleTitle></h2><p>只看三位股东，不含 czh</p></div><strong>{formatB(state.market.currentTotalCents)}</strong></div><V2Chart data={marketData} mode="line" selectedId={selectedMarketId} onSelect={(id) => setSelectedMarketId((current) => current === id ? null : id)} unit="股东总资产 B" />{selectedMarket && <div className="v2-detail"><strong>{selectedMarket.label}</strong><div className="v2-data-grid"><span>日期<b>{selectedMarket.occurredAt}</b></span><span>来源<b>{selectedMarket.source === 'capital' ? '资金变动' : selectedMarket.source === 'regular' ? '常规比赛' : '单独委托'}</b></span><span>变动前总资产<b>{formatB(selectedMarket.preTotalAssetCents)}</b></span><span>变动后总资产<b>{formatB(selectedMarket.totalAssetCents)}</b></span></div><div className="v2-member-lines">{selectedMarket.balances.map((balance) => <div key={balance.memberId}><span>{balance.name}</span><b>{formatB(balance.assetCents)}</b></div>)}</div></div>}<div className="v2-balance-list">{state.market.shares.map((share) => <div key={share.memberId}><span>{share.name}</span><b>{formatB(share.assetCents)}</b></div>)}</div></section><section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="allocation">下一场参与比例</ModuleTitle></h2><p>只影响下一场常规比赛，历史记录不变</p></div></div><div className="v2-ratio-bar">{state.members.map((member, index) => <span key={member.id} data-color={index} style={{ width: `${member.ratioBps / 100}%` }} title={`${member.name} ${formatPercent(member.ratioBps)}`} />)}</div><div className="v2-ratio-legend">{state.members.map((member) => <span key={member.id}>{member.name} {formatPercent(member.ratioBps)}</span>)}</div>{!state.actor.isCzh && <><div className="v2-inline-form"><label>我的目标比例 %<input inputMode="decimal" value={ratioInput} onChange={(event) => setRatioInput(event.target.value)} /></label><button className="v2-primary" onClick={() => void saveRatio()}>保存比例</button></div><label className="v2-planned-input">计划投入总额 B<input inputMode="decimal" value={plannedTotal} onChange={(event) => setPlannedTotal(event.target.value)} placeholder="只预览，不会保存" /></label>{plannedCents !== null && <div className="v2-planned-list">{state.members.map((member) => <div key={member.id}><span>{member.name}</span><b>{formatB(Math.round(plannedCents * member.ratioBps / 10000))}</b></div>)}</div>}</>}</section><section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="withdrawal">单独委托</ModuleTitle></h2><p>{state.actor.isCzh ? '全部委托待办，开始执行后录入产出' : '填写投入和类型即可发出，产出由 czh 或 waka 后续录入'}</p></div>{!state.actor.isCzh && <button className="v2-chip" onClick={() => setShowMandate((value) => !value)}>{showMandate ? '收起' : '新增委托'}</button>}</div>{!state.actor.isCzh && showMandate && <MandateForm state={state} repository={repository} run={run} onDone={() => setShowMandate(false)} />}<div className="v2-subheading">{state.actor.isCzh ? '全部待办委托' : '我的待办委托'}</div><MandateQueue state={state} repository={repository} run={run} /></section></main>;
}

function RoundForm({ state, initial, onSave, onCancel }: { state: V2ViewState; initial?: DerivedRound; onSave: (input: SaveRoundInput) => Promise<void>; onCancel: () => void }) {
  const admin = isAdmin(state.actor);
  const [date, setDate] = useState(initial?.scheduledDate ?? today());
  const [stake, setStake] = useState(initial ? (initial.totalStakeCents / 100).toFixed(2) : '');
  const [result, setResult] = useState(initial ? ((initial.grossResultCents ?? 0) / 100).toFixed(2) : '');
  const [gameType, setGameType] = useState<GameType>(initial?.gameType ?? 'texas');
  const [mandateType, setMandateType] = useState<MandateType>(initial?.mandateType ?? 'regular');
  const [owner, setOwner] = useState(initial?.ownerMemberId ?? state.members.find((member) => !member.isCzh)?.id ?? '');
  const [formError, setFormError] = useState('');
  const submit = async () => {
    const totalStakeCents = parseBToCents(stake); const grossResultCents = parseBToCents(result);
    if (!date || totalStakeCents === null || totalStakeCents <= 0 || grossResultCents === null || (mandateType === 'individual' && !owner)) { setFormError('请填写日期、正数投入、产出和委托股东。'); return; }
    setFormError('');
    await onSave({ scheduledDate: date, totalStakeCents, grossResultCents, gameType, mandateType, ownerMemberId: mandateType === 'individual' ? owner : undefined });
  };
  return <div className="v2-form"><label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>比赛类型<select value={gameType} onChange={(event) => setGameType(event.target.value as GameType)}><option value="texas">德州</option><option value="other">其他</option></select></label>{admin && <label>委托类型<select value={mandateType} onChange={(event) => setMandateType(event.target.value as MandateType)}><option value="regular">常规</option><option value="individual">单独委托</option></select></label>}{admin && mandateType === 'individual' && <label>委托股东<select value={owner} onChange={(event) => setOwner(event.target.value)}>{state.members.filter((member) => !member.isCzh).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}<label>投入 B<input inputMode="decimal" value={stake} onChange={(event) => setStake(event.target.value)} /></label><label>产出 B<input inputMode="decimal" value={result} onChange={(event) => setResult(event.target.value)} /></label>{formError && <p className="v2-form-error" role="alert">{formError}</p>}<div className="v2-form-actions"><button className="v2-chip" onClick={onCancel}>取消</button><button className="v2-primary" onClick={() => void submit()}>{initial ? '保存修改' : '保存常规比赛'}</button></div></div>;
}

function LedgerPage({ state, repository, run }: { state: V2ViewState; repository: V2Repository; run: (action: () => Promise<unknown>, success: string) => Promise<boolean> }) {
  const [view, setView] = useState<'rounds' | 'capital'>('rounds'); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<string | null>(null);
  const saveNew = async (input: SaveRoundInput) => { if (await run(() => repository.createRound({ ...input, mandateType: 'regular' }), '常规比赛已保存并结算。')) setCreating(false); };
  const saveEdit = async (round: DerivedRound, input: SaveRoundInput) => { const patch: RoundPatch = { ...input, revision: round.revision }; if (await run(() => repository.updateRound(round.id, patch), '比赛修改已生效，相关账目已重算。')) setEditing(null); };
  const admin = isAdmin(state.actor);
  return <main className="v2-page"><div className="v2-heading v2-ledger-head"><div><h1>账本</h1><p>比赛、委托和资金变动</p></div>{admin && <button className="v2-primary compact" onClick={() => setCreating((value) => !value)}>{creating ? '收起' : '新增常规比赛'}</button>}</div>{creating && <section className="v2-panel"><RoundForm state={state} onSave={saveNew} onCancel={() => setCreating(false)} /></section>}<section className="v2-panel"><div className="v2-heading"><div><h2><ModuleTitle icon="withdrawal">{admin ? '委托待办' : '我的委托'}</ModuleTitle></h2><p>{admin ? `待接手 ${state.mandates.filter((mandate) => mandate.status === 'pending').length} 条，执行中也在这里结算` : '待接手时可以编辑或撤销'}</p></div></div><MandateQueue state={state} repository={repository} run={run} /></section><div className="v2-segment wide"><button className={view === 'rounds' ? 'active' : ''} onClick={() => setView('rounds')}>比赛记录</button><button className={view === 'capital' ? 'active' : ''} onClick={() => setView('capital')}>资金变动</button></div>{view === 'rounds' ? <div className="v2-list">{[...state.rounds].reverse().map((round) => { const own = round.rows.find((row) => row.memberId === state.actor.id); const totalNet = round.rows.reduce((sum, row) => sum + row.netProfitCents, 0); return <article className="v2-panel v2-ledger-row" key={round.id}><button className="v2-row-summary" onClick={() => setEditing((value) => value === round.id ? null : round.id)}><span><strong>{round.name}</strong><small>{gameName(round.gameType)} · {mandateName(round.mandateType)}</small></span><b className={tone(own?.netProfitCents ?? totalNet)}>{formatB(own?.netProfitCents ?? totalNet, true)}</b></button>{editing === round.id && <div className="v2-detail"><div className="v2-data-grid"><span>总投入<b>{formatB(round.totalStakeCents)}</b></span><span>总产出<b>{formatB(round.grossResultCents ?? 0)}</b></span><span>总抽水<b>{formatB(round.rakeCents)}</b></span><span>记录人<b>{state.members.find((member) => member.id === round.createdBy)?.name ?? '未知'}</b></span></div>{admin && <><RoundForm state={state} initial={round} onSave={(input) => saveEdit(round, input)} onCancel={() => setEditing(null)} /><button className="v2-danger" onClick={() => void run(() => repository.deleteRound(round.id, round.revision), '比赛已删除，相关账目和当天编号已重算。')}>删除这场比赛</button></>}</div>}</article>; })}{!state.rounds.length && <div className="v2-empty">暂无已结算比赛</div>}</div> : <div className="v2-list">{[...state.capitalEvents].reverse().map((event) => <article className="v2-panel v2-capital-row" key={event.id}><div><strong>{state.members.find((member) => member.id === event.memberId)?.name}</strong><small>{event.occurredAt}</small></div><b className={tone(event.deltaCents)}>{formatB(event.deltaCents, true)}</b><p>{formatB(event.beforeCents)} → {formatB(event.targetCents)}</p></article>)}{!state.capitalEvents.length && <div className="v2-empty">暂无资金变动记录</div>}</div>}</main>;
}

export function V2App({ repository, onSignOut, demoMembers, onDemoActorChange, onResetDemo }: { repository: V2Repository; onSignOut?: () => Promise<void>; demoMembers?: V2Member[]; onDemoActorChange?: (id: string) => void; onResetDemo?: () => void }) {
  const [state, setState] = useState<V2ViewState | null>(null); const [tab, setTab] = useState<Tab>('home'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [updateReady, setUpdateReady] = useState(false);
  const savingRef = useRef(false);
  const load = async () => setState(await repository.load());
  useEffect(() => { void load().catch((error) => setMessage(errorMessage(error))); }, [repository]);
  useEffect(() => { const handler = () => setUpdateReady(true); window.addEventListener('pybit-update-ready', handler); return () => window.removeEventListener('pybit-update-ready', handler); }, []);
  const run = async (action: () => Promise<unknown>, success: string) => { if (savingRef.current) return false; if (!navigator.onLine) { setMessage('当前离线，无法保存。'); return false; } savingRef.current = true; setBusy(true); try { await action(); await load(); setMessage(success); return true; } catch (error) { setMessage(errorMessage(error)); return false; } finally { savingRef.current = false; setBusy(false); } };
  const exportVisibleLedger = () => { if (!state) return; const content = JSON.stringify({ exportedAt: new Date().toISOString(), scope: state.actor.id, state }, null, 2); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `pybit-v2-${today()}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); };
  if (!state) return <main className="v2-locked"><div className="v2-brand"><BMark /><span>PY</span><em>BIT</em></div><p>{message || '正在读取账本…'}</p></main>;
  return <div className="v2-shell"><PixelStorm /><header className="v2-header"><div><div className="v2-brand"><BMark /><span>PY</span><em>BIT</em></div><small>{state.actor.role === 'czh' ? '主要管理员' : state.actor.role === 'waka' ? '备用管理员' : '股东'} · {state.actor.name}</small></div><div className="v2-header-actions">{demoMembers && onDemoActorChange && <select aria-label="切换演示身份" value={state.actor.id} onChange={(event) => onDemoActorChange(event.target.value)}>{demoMembers.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select>}{onResetDemo && <button className="v2-chip" onClick={onResetDemo}>重置</button>}{onSignOut && <button className="v2-chip" onClick={exportVisibleLedger}>导出</button>}{onSignOut && <button className="v2-chip" onClick={() => void onSignOut()}>登出</button>}</div></header>{updateReady && !busy && <p className="v2-toast">新版本已准备好 <button onClick={() => navigator.serviceWorker.getRegistration().then((registration) => registration?.waiting?.postMessage('PYBIT_ACTIVATE_UPDATE'))}>更新</button></p>}{busy && <p className="v2-saving">正在保存…</p>}<PageTransition key={tab}>{tab === 'home' ? <HomePage state={state} /> : tab === 'assets' ? <AssetPage state={state} repository={repository} run={run} /> : <LedgerPage state={state} repository={repository} run={run} />}</PageTransition><BottomNav active={tab} pending={state.mandates.filter((mandate) => mandate.status === 'pending' || mandate.status === 'executing').length} onChange={setTab} />{message && <div className="v2-toast">{message}<button onClick={() => setMessage('')}>知道了</button></div>}</div>;
}
