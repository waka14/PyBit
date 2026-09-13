import type { ReactNode } from 'react';

export function MetricCard({ label, value, hint, className = '' }: { label: string; value: ReactNode; hint?: string; className?: string }) {
  return <section className={`panel metric-card ${className}`}><div className="eyebrow">{label}</div><div className="metric-value">{value}</div>{hint && <div className="hint">{hint}</div>}</section>;
}
