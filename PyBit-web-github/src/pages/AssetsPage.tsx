import { useEffect, useRef, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import type { MemberDashboard, ReturnRequest, Workspace } from '../data/types';
import { formatB, formatPercent, parseBToCents } from '../domain/ledger';

const statusText = (request: ReturnRequest) => {
  if (request.status === 'requested') return '待czh确认转出';
  if (request.status === 'transferred') return `czh已转出 · ${request.transferredAt ?? ''}`;
  if (request.status === 'completed') return `已完成 · ${request.completedAt ?? ''}`;
  if (request.status === 'needs_review') return `待核对：${request.reviewBlockReason}`;
  return `已拒绝${request.rejectedAt ? ` · ${request.rejectedAt}` : ''}${request.rejectReason ? ` · 原因：${request.rejectReason}` : ''}`;
};

export function AssetsPage({ dashboard, workspace, shareBps, onReturnRequest, onConfirmReceipt }: { dashboard: MemberDashboard; workspace: Workspace; shareBps: number; onReturnRequest: (cents: number, idempotencyKey: string) => void; onConfirmReceipt: (requestId: string) => void }) {
  const draftKey = `pybit-demo-draft-assets-${dashboard.member.id}`; const saved = (() => { try { return JSON.parse(sessionStorage.getItem(draftKey) || '{}') as { returnInput?: string }; } catch { return {}; } })();
  const [returnInput, setReturnInput] = useState(saved.returnInput ?? ''); const [notice, setNotice] = useState(''); const [returnError, setReturnError] = useState(''); const [allRequests, setAllRequests] = useState(false); const [receiptTarget, setReceiptTarget] = useState<ReturnRequest | null>(null);
  const returnKey = useRef<string | null>(null);
  const maxRequest = dashboard.availableInvestmentCents;
  useEffect(() => { sessionStorage.setItem(draftKey, JSON.stringify({ returnInput })); }, [draftKey, returnInput]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);
  const submitRequest = () => { setReturnError(''); const cents = parseBToCents(returnInput); if (cents === null || cents <= 0 || cents > maxRequest) return setReturnError(`可申请取回金额为${formatB(maxRequest)}。`); try { returnKey.current ??= globalThis.crypto?.randomUUID?.() ?? `return-${Date.now()}`; onReturnRequest(cents, returnKey.current); setReturnInput(''); returnKey.current = null; setNotice('取回申请已提交，资金已锁定，等待czh确认转出。'); } catch { setReturnError('取回申请失败，请稍后重试。'); } };
  const confirmReceipt = (request: ReturnRequest) => { try { onConfirmReceipt(request.id); setReceiptTarget(null); setNotice('已确认收到，本笔取回结单。'); } catch { setReturnError('确认失败，请稍后重试。'); } };
  const mine = workspace.returnRequests.filter((request) => request.memberId === dashboard.member.id); const visibleRequests = (allRequests ? mine : mine.slice(-3)).slice().reverse();
  return <main className="page"><h1>我的资产</h1><MetricCard label="当前投资余额" value={formatB(dashboard.investmentAssetCents)} hint={`可用 ${formatB(dashboard.availableInvestmentCents)} · 场次中已投入 ${formatB(dashboard.lockedRoundCostCents)}`} /><div className="two-grid"><MetricCard label="转回处理中余额" value={formatB(dashboard.pendingReturnCents)} hint="取回完成前不参加后续场次" /><MetricCard label="已经实际转回余额" value={formatB(dashboard.returnedCents)} hint="历史实际转回" /></div>
    <section className="panel"><h2>下场参与份额</h2><p>我的份额：<b>{formatPercent(shareBps)}</b></p><p className="hint">份额按当前可用余额占全体可用余额的比例自动计算，无需手动设置：申请取回后份额立即缩小，追加入金后自动扩大。每一场按份额分摊投入和结算。</p></section>
    {!dashboard.member.isCzh && <section className="panel"><h2>取回资金</h2><p className="hint">① 成员在此提出取回申请，资金立即锁定；② czh确认转出；③ 成员确认收到后结单。</p><p className="hint">可申请取回金额：{formatB(maxRequest)}（= 当前可用投资余额）</p>{maxRequest === 0 ? <p className="hint">当前没有可申请的可用余额。</p> : <><label className="input-label">申请取回金额 B<input value={returnInput} inputMode="decimal" onChange={(e) => setReturnInput(e.target.value)} placeholder={`最多 ${formatB(maxRequest)}`} /></label>{returnError && <p className="field-error">{returnError}</p>}<button className="primary-button" onClick={submitRequest}>提出取回申请</button></>}<div className="section-heading"><h2>申请记录</h2>{mine.length > 3 && <button className="chip" onClick={() => setAllRequests((shown) => !shown)}>{allRequests ? '收起' : '查看全部'}</button>}</div>{visibleRequests.map((request) => <div className="return-record" key={request.id}><div className="return-amount">{formatB(request.amountCents)}</div><p className="hint">申请 {request.createdAt} · {statusText(request)}</p>{request.status === 'transferred' && <button className="primary-button" onClick={() => setReceiptTarget(request)}>确认已收到款项</button>}</div>)}</section>}
    {receiptTarget && <section className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-card"><h2>确认已收到这笔转回款项？</h2><p>czh 已确认转出 {formatB(receiptTarget.amountCents)}（申请于 {receiptTarget.createdAt}）。请核实你的收款账户已实际到账，确认后本笔取回结单，结单后不可撤销。</p><div className="modal-actions"><button className="chip" onClick={() => setReceiptTarget(null)}>取消</button><button className="primary-button" onClick={() => confirmReceipt(receiptTarget)}>确认已收到款项</button></div></div></section>}
    {notice && <p className="notice toast-notice">{notice}</p>}
  </main>;
}
