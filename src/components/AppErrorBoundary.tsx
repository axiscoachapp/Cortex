import { Component, type ErrorInfo, type ReactNode } from 'react';

export function RecoveryScreen() {
  return <main role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 className="text-xl font-semibold">Não foi possível exibir esta tela</h1>
    <p>As consultas salvas continuam no prontuário. Recarregue para tentar novamente.</p>
    <button className="rounded border px-4 py-2" onClick={() => window.location.reload()}>Recarregar aplicativo</button>
  </main>;
}

/** Keep a rendering/chunk error recoverable without logging patient payloads. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Clinical content must not enter console logs. */ }
  render() {
    if (this.state.failed) return <RecoveryScreen />;
    return this.props.children;
  }
}
