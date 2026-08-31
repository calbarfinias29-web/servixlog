import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Global crash guard: prevents white screens by showing a recoverable error UI. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('SERVIX runtime error:', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8" style={{ background: 'var(--background)' }}>
          <div className="max-w-md rounded-2xl border bg-[var(--surface)] p-8 text-center shadow-lg" style={{ borderColor: 'var(--border)' }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--primary)' }}>SERVIX</p>
            <h1 className="mt-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>A apărut o eroare neașteptată</h1>
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{this.state.error.message || 'Eroare necunoscută.'}</p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="mt-6 rounded-lg px-5 py-3 text-sm font-bold text-white"
              style={{ background: 'var(--button)' }}
            >
              Reîncarcă aplicația
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
