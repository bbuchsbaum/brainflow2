/**
 * RenderErrorBoundary - Catches errors in render pipeline and displays user-friendly messages
 * 
 * This component prevents the "black screen" issue by catching errors that would
 * otherwise silently fail. It provides visual feedback when rendering fails.
 */

import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  viewId?: string;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class RenderErrorBoundary extends Component<Props, State> {
  private resetTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { viewId, onError } = this.props;
    const { errorCount } = this.state;
    
    // Log error details for debugging
    console.error(`[RenderErrorBoundary${viewId ? ` - ${viewId}` : ''}] Caught error:`, error);
    console.error('Component stack:', errorInfo.componentStack);
    
    // Update state with error details
    this.setState({
      errorInfo,
      errorCount: errorCount + 1
    });
    
    // Call parent error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }
    
    // Auto-reset after 5 seconds if this is the first error
    // This helps recover from transient issues
    if (errorCount === 0) {
      this.scheduleAutoReset();
    }
  }
  
  componentWillUnmount() {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
    }
  }
  
  scheduleAutoReset = () => {
    this.resetTimeoutId = setTimeout(() => {
      console.log('[RenderErrorBoundary] Auto-resetting after error');
      this.handleReset();
    }, 5000);
  };
  
  handleReset = () => {
    if (this.resetTimeoutId) {
      clearTimeout(this.resetTimeoutId);
      this.resetTimeoutId = null;
    }
    
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    });
  };
  
  render() {
    const { hasError, error, errorCount } = this.state;
    const { children, fallback, viewId } = this.props;
    
    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return <>{fallback}</>;
      }
      
      // Default error UI
      return (
        <div className="flex flex-col items-center justify-center h-full bg-bf-bg-panel-sunken text-bf-text-secondary p-4">
          <AlertCircle className="w-12 h-12 text-bf-warning mb-3" />
          
          <h3 className="text-bf-lg font-semibold text-foreground mb-2">
            Rendering error {viewId && `in ${viewId}`}
          </h3>
          
          <p className="text-bf-sm text-bf-text-secondary mb-4 text-center max-w-md">
            {error?.message || 'An unexpected error occurred while rendering'}
          </p>
          
          {errorCount > 2 && (
            <p className="text-bf-xs text-bf-warning mb-3">
              Multiple errors detected - rendering may be unstable
            </p>
          )}
          
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 h-7 px-2.5 bg-foreground text-background hover:brightness-110
                     rounded-sm transition-colors text-bf-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <RefreshCw className="w-4 h-4" />
            Retry render
          </button>
          
          {process.env.NODE_ENV === 'development' && error && (
            <details className="mt-4 text-bf-xs text-muted-foreground max-w-full">
              <summary className="cursor-pointer hover:text-bf-text-secondary">
                Error details (development only)
              </summary>
              <pre className="mt-2 p-2 bg-card rounded-sm overflow-auto max-h-32">
                {error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }
    
    return children;
  }
}

/**
 * Hook to wrap a component with error boundary
 */
export function withRenderErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  viewId?: string
) {
  return function RenderErrorBoundaryWrapped(props: P) {
    return (
      <RenderErrorBoundary viewId={viewId}>
        <Component {...props} />
      </RenderErrorBoundary>
    );
  };
}
