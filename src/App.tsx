import { lazy, Suspense, useMemo } from 'react';
import { AuthGate } from './auth/AuthGate';
import { SupabaseV2Repository } from './v2/supabaseRepository';
import { V2App } from './v2/V2App';

const demoEnabled = () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';
// Rollup removes this import from a production build. The mock ledger is never loaded by production users.
const DemoApp = import.meta.env.DEV ? lazy(() => import('./v2/V2DemoApp')) : null;

export default function App() {
  if (DemoApp && demoEnabled()) return <Suspense fallback={<main className="locked-page"><p className="hint">正在加载演示数据…</p></main>}><DemoApp /></Suspense>;
  return <AuthGate>{(identity, signOut) => <ProductionV2 signOut={signOut} />}</AuthGate>;
}

function ProductionV2({ signOut }: { signOut: () => Promise<void> }) {
  const repository = useMemo(() => new SupabaseV2Repository(), []);
  return <V2App repository={repository} onSignOut={signOut} />;
}
