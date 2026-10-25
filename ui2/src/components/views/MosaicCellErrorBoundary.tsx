/**
 * MosaicCellErrorBoundary Component
 * 
 * Error boundary that isolates failures to individual mosaic cells
 * preventing entire grid crashes when individual cells fail to render.
 */

import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  cellId: string;
  sliceIndex: number;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class MosaicCellErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[MosaicCellErrorBoundary] ${this.props.cellId} crashed:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-bf-bg-panel-sunken border border-bf-border-subtle text-bf-text-secondary">
          <div className="text-sm font-medium">Slice {this.props.sliceIndex}</div>
          <div className="text-bf-xs text-bf-danger">Render error</div>
          <div className="text-bf-xs text-muted-foreground mt-1">
            {this.state.error?.message || 'Unknown error'}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
