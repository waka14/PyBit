import { UiIcon, type UiIconName } from './UiIcon';

export type AppTab = 'home' | 'assets' | 'ledger';

const items: { id: AppTab; label: string; icon: UiIconName }[] = [
  { id: 'home', label: '收益', icon: 'trend' },
  { id: 'assets', label: '资产', icon: 'wallet' },
  { id: 'ledger', label: '账本', icon: 'ledger' }
];

export function BottomNav({ active, pending = 0, onChange }: { active: AppTab; pending?: number; onChange: (tab: AppTab) => void }) {
  return <nav className="bottom-nav" aria-label="主要功能">
    {items.map((item) => <button key={item.id} className={active === item.id ? 'active' : ''} aria-current={active === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
      <span className="nav-icon-bubble"><UiIcon name={item.icon} size={19} /></span>
      <span className="nav-label">{item.label}{item.id === 'ledger' && pending > 0 && <i className="badge">{pending}</i>}</span>
    </button>)}
  </nav>;
}
