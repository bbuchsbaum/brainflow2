import React, { Component, ErrorInfo, ReactNode } from 'react';

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
          <div className="bg-red-500/20 border border-red-500/50 rounded p-4">
            <h3 className="text-red-400 font-semibold mb-2">
              {this.props.panelName} Error
            </h3>
            <p className="text-red-300 text-sm mb-2">
              An error occurred in this panel:
            </p>
            <pre className="text-xs text-red-200 bg-red-900/20 p-2 rounded overflow-auto max-h-48">
              {this.state.error?.message}
              {'\n\n'}
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-3 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}