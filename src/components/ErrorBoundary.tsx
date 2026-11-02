// src/components/ErrorBoundary.tsx — a page-level crash isn't recoverable
// without this: React unmounts the whole tree above a thrown render error,
// which (2026-11-01, real incident — the Connections page's own black-
// screen crash, fixed at the data level but with no safety net if the next
// one isn't caught as cleanly) left the entire app shell blank with nothing
// on screen to click, no way back to a working page without a full restart.
// Wrapped once around the whole app shell in main.tsx (so a crash anywhere
// doesn't take the titlebar/sidebar down too) AND once around just the
// active page's content in App.tsx (so switching away from the page that
// crashed, via the "Back to Dashboard" button below, can actually recover
// without restarting the process at all).
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { COLORS } from './ui';

interface Props {
  children: ReactNode;
  // onReset (2026-11-01) — lets the App-level boundary navigate back to a
  // known-good page (e.g. the dashboard) instead of only offering a full
  // reload; the root boundary in main.tsx has nothing sensible to reset TO,
  // so it only gets the reload button.
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught a render crash', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', padding: 40, textAlign: 'center', color: COLORS.text, gap: 14,
      }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Something went wrong on this page</div>
        <div style={{ fontSize: 13, color: COLORS.textDim, maxWidth: 480 }}>
          This is a bug, not something you did — the rest of the app (overlay, OBS, lights) kept running
          the whole time. Reload to recover; if it keeps happening, let us know what you were doing.
        </div>
        <div style={{
          fontSize: 12, color: COLORS.textFaint, fontFamily: 'monospace', maxWidth: 560,
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {error.message || String(error)}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {this.props.onReset && (
            <button onClick={this.reset} style={buttonStyle(true)}>Back to Dashboard</button>
          )}
          <button onClick={() => window.location.reload()} style={buttonStyle(false)}>Reload the App</button>
        </div>
      </div>
    );
  }
}

function buttonStyle(primary: boolean) {
  return {
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' as const,
    background: primary ? COLORS.accent : '#1b1b24',
    border: `1px solid ${primary ? COLORS.accent : COLORS.border}`,
    color: '#fff',
  };
}
