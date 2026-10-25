import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  panelName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[${this.props.panelName}] Error:`, error);
    console.error(`[${this.props.panelName}] Error Info:`, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-full p-4">
          <div className="bg-bf-danger-soft border border-destructive/50 rounded-sm p-4">
            <h3 className="text-bf-danger font-semibold mb-2">
              {this.props.panelName} error
            </h3>
            <p className="text-foreground text-bf-sm mb-2">
              An error occurred in this panel:
            </p>
            <pre className="text-bf-xs text-bf-text-secondary bg-bf-bg-panel-sunken p-2 rounded-sm overflow-auto max-h-48">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 h-7 px-2.5 bg-bf-bg-panel-raised border border-border text-foreground text-bf-sm rounded-sm hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
