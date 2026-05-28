import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { useAppStore } from './store/useAppStore';

// Expose store for dev/testing via browser console
(window as unknown as Record<string, unknown>).__store = useAppStore;

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  componentDidCatch(e: Error, info: React.ErrorInfo) {
    console.error('[App crash]', e, info);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error;
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#f87171', background: '#090d16', minHeight: '100vh' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>⚠ App crashed</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>{e.message}</div>
          <pre style={{ fontSize: 11, color: '#64748b', whiteSpace: 'pre-wrap' }}>{e.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
