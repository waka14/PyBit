import { lazy, Suspense } from 'react';
import { AuthGate } from './auth/AuthGate';
import { ProductionApp } from './pages/ProductionApp';

const demoEnabled = () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';
// Rollup removes this import from a production build. The mock ledger is never loaded by production users.
const DemoApp = import.meta.env.DEV ? lazy(() => import('./DemoApp')) : null;

export default function App() {
  if (DemoApp && demoEnabled()) return <Suspense fallback={<main className="locked-page"><p className="hint">正在加载演示数据…</p></main>}><DemoApp /></Suspense>;
  return <AuthGate>{(identity, signOut) => <ProductionApp identity={identity} signOut={signOut} />}</AuthGate>;
}
