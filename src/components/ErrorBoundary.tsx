import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('PyBit render failure', { message: error.message, stack: error.stack, componentStack: info.componentStack }); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="locked-page"><div className="brand">PY<span>BIT</span></div><section className="panel"><h1>页面暂时无法显示</h1><p className="hint">数据没有被自动清除。请重新加载；若问题持续，请联系管理员检查账户与账本记录。</p><p className="field-error">{this.state.error.message || '发生未知渲染错误。'}</p><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></section></main>;
  }
}
