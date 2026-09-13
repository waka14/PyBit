import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { authRedirectUrl, getAuthCallbackState, getSupabaseClient, isSupabaseConfigured, profileFromState, type AuthCallbackMode, type AuthenticatedProfile } from './supabaseClient';

type Props = { children: (identity: AuthenticatedProfile, signOut: () => Promise<void>) => ReactNode };
const messageFor = (error: unknown) => {
  const source = error instanceof Error ? error.message : String(error);
  if (/PROFILE_NOT_BOUND/.test(source)) return '此受邀账号尚未绑定成员资料。请联系 czh 完成绑定后重新打开邀请链接。';
  if (/PRODUCTION_HTTPS_REQUIRED/.test(source)) return '生产账号操作必须从已允许的 HTTPS EdgeOne 网址打开。';
  if (/invalid login credentials/i.test(source)) return '邮箱或密码不正确。';
  if (/expired|otp_expired|access_denied/i.test(source)) return '链接已失效或无效，请联系 czh 重新发送。';
  return '操作未完成，请检查网络后重试。';
};
const clearCallbackUrl = () => window.history.replaceState({}, document.title, window.location.origin);

function PasswordSetup({ mode, onDone }: { mode: Exclude<AuthCallbackMode, null>; onDone: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const submit = async () => {
    setError(''); if (password.length < 8) { setError('密码至少需要 8 个字符。'); return; } if (password !== confirm) { setError('两次输入的密码不一致。'); return; }
    setSaving(true);
    try { const { error: updateError } = await getSupabaseClient().auth.updateUser({ password }); if (updateError) throw updateError; clearCallbackUrl(); onDone(); }
    catch (failure) { setError(messageFor(failure)); } finally { setSaving(false); }
  };
  const title = mode === 'invite' ? '设置登录密码' : '重设登录密码';
  return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel login-panel"><h1>{title}</h1><p className="hint">此页面只处理受邀或找回密码链接，不提供公开注册。</p><label className="input-label">新密码<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="input-label">确认新密码<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} /></label>{error && <p className="field-error">{error}</p>}<button className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? '正在保存…' : '保存密码并继续'}</button></section></main>;
}

export function AuthGate({ children }: Props) {
  const callback = useMemo(() => getAuthCallbackState(window.location.href), []);
  const [callbackMode, setCallbackMode] = useState<AuthCallbackMode>(callback.mode); const [callbackError, setCallbackError] = useState(callback.error);
  const [session, setSession] = useState<Session | null>(null); const [identity, setIdentity] = useState<AuthenticatedProfile | null>(null); const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [submitting, setSubmitting] = useState(false); const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured()) { setLoading(false); return; }
    const supabase = getSupabaseClient(); let cancelled = false;
    const bind = async (next: Session | null) => {
      if (cancelled) return; setSession(next); setIdentity(null);
      if (!next) { setLoading(false); return; }
      try { const { data, error: rpcError } = await supabase.rpc('app_screen_state'); if (rpcError) throw rpcError; if (!cancelled) setIdentity(profileFromState(data, next.user.id)); }
      catch (failure) { if (!cancelled) setError(messageFor(failure)); }
      finally { if (!cancelled) setLoading(false); }
    };
    void supabase.auth.getSession().then(({ data }) => bind(data.session)).catch((failure) => { if (!cancelled) { setError(messageFor(failure)); setLoading(false); } });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => { if (event === 'PASSWORD_RECOVERY') setCallbackMode('recovery'); void bind(next); });
    return () => { cancelled = true; subscription.subscription.unsubscribe(); };
  }, []);

  const signIn = async () => { setError(''); setNotice(''); if (!email.trim() || !password) { setError('请输入受邀邮箱和密码。'); return; } setSubmitting(true); try { const { error: authError } = await getSupabaseClient().auth.signInWithPassword({ email: email.trim(), password }); if (authError) throw authError; } catch (failure) { setError(messageFor(failure)); } finally { setSubmitting(false); } };
  const requestReset = async () => { setError(''); setNotice(''); if (!email.trim()) { setError('请先填写受邀邮箱，再发送重设密码链接。'); return; } setSendingReset(true); try { const { error: resetError } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl('recovery') }); if (resetError) throw resetError; setNotice('如该邮箱已受邀，重设密码链接已发送。请在允许的 EdgeOne 网址完成操作。'); } catch (failure) { setError(messageFor(failure)); } finally { setSendingReset(false); } };
  const signOut = async () => { setIdentity(null); setSession(null); setError(''); setNotice(''); await getSupabaseClient().auth.signOut(); };
  const completePassword = () => { setCallbackMode(null); setCallbackError(null); if (identity) return; setNotice('密码已保存，请使用新密码登录。'); };

  if (!isSupabaseConfigured()) return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><h1>尚未配置登录服务</h1><p className="hint">生产模式不会读取浏览器中的模拟身份或账本数据。配置 Supabase 项目地址和 publishable key 后，只有受邀账号能登录。</p></section></main>;
  if (loading) return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><p className="hint">正在安全检查登录状态…</p></section></main>;
  if (callbackError) return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><h1>{callbackError === 'invite_expired' ? '邀请链接已失效' : callbackError === 'recovery_expired' ? '重设密码链接已失效' : '链接无效'}</h1><p className="hint">{callbackError === 'invite_expired' ? '请联系 czh 在 Supabase 控制台重新发送邀请。' : callbackError === 'recovery_expired' ? '请返回登录页重新发送重设密码链接。' : '请从受邀邮件或重设密码邮件重新打开链接。'}</p><button className="chip" onClick={() => { clearCallbackUrl(); setCallbackError(null); setCallbackMode(null); }}>返回登录</button></section></main>;
  if (callbackMode && !session) return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><h1>{callbackMode === 'invite' ? '邀请链接无法继续使用' : '重设密码链接无法继续使用'}</h1><p className="hint">链接可能已过期、已使用，或不是当前允许的 EdgeOne 网址。{callbackMode === 'invite' ? '请联系 czh 重新发送邀请。' : '请返回登录页重新发送重设密码链接。'}</p><button className="chip" onClick={() => { clearCallbackUrl(); setCallbackMode(null); }}>返回登录</button></section></main>;
  if (callbackMode && session && identity) return <PasswordSetup mode={callbackMode} onDone={completePassword} />;
  if (callbackMode && session && !identity) return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><h1>账号尚未绑定成员资料</h1><p className="hint">请让 czh 先在 Supabase SQL Editor 将此 Auth 用户 UUID 绑定到稳定 member_id，然后重新发送邀请。为了避免完成设置后无法进入账本，本次不继续设置密码。</p><button className="chip" onClick={() => void signOut()}>退出并联系 czh</button></section></main>;
  if (identity) return <>{children(identity, signOut)}</>;
  return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel login-panel"><h1>受邀成员登录</h1><p className="hint">仅限 czh、waka 与已受邀股东。这里没有公开注册入口。</p><label className="input-label">邮箱<input autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="input-label">密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void signIn(); }} /></label>{error && <p className="field-error">{error}</p>}{notice && <p className="notice">{notice}</p>}<button className="primary-button" disabled={submitting} onClick={() => void signIn()}>{submitting ? '正在登录…' : '登录'}</button><button className="chip" disabled={sendingReset} onClick={() => void requestReset()}>{sendingReset ? '正在发送…' : '忘记密码'}</button></section></main>;
}
