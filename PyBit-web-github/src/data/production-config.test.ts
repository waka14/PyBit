import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('production safety configuration', () => {
  it('keeps demo routing out of production and out of the production App branch', () => {
    const source = read('src/App.tsx');
    expect(source).toContain("import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1'");
    expect(source).toContain('return <AuthGate>');
  });
  it('documents only public Supabase browser variables', () => {
    const env = read('.env.example');
    expect(env).toContain('VITE_SUPABASE_URL');
    expect(env).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(env).not.toMatch(/VITE_.*SERVICE_ROLE|VITE_.*PASSWORD|VITE_.*JWT_SECRET/);
  });
  it('ships a versioned network-first service worker with no ledger local-storage cache', () => {
    const worker = read('public/sw.js');
    expect(worker).toContain('__PYBIT_BUILD_VERSION__');
    expect(worker).toContain("event.request.mode === 'navigate'");
    expect(worker).not.toContain('localStorage');
  });
  it('includes RLS and transactional unique-request safeguards in migrations', () => {
    const sql = read('supabase/migrations/202609050002_rls_and_rpc.sql');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('app_review_withdrawal');
    expect(sql).toContain('for update');
    expect(sql).toContain('app_idempotency');
    expect(sql).toContain('pg_advisory_xact_lock');
  });
  it('uses EdgeOne-native configuration and a guarded root-level production packer', () => {
    const edgeone = read('edgeone.json'); const packer = read('scripts/package-production.mjs'); const schema = read('supabase/migrations/202609050001_initial_schema.sql');
    expect(edgeone).toContain('"rewrites"'); expect(edgeone).toContain('"destination": "/index.html"'); expect(edgeone).toContain('X-Frame-Options');
    expect(packer).toContain('VITE_SUPABASE_URL'); expect(packer).toContain('VITE_SUPABASE_PUBLISHABLE_KEY'); expect(packer).toContain("VITE_ALLOW_DEMO: 'false'"); expect(packer).toContain("['-qr', temporaryZip, '.']");
    expect(schema).toContain('auth_user_id uuid primary key'); expect(schema).toContain('member_id uuid not null unique');
  });
});
