/**
 * MosaicCellErrorBoundary Component
 * 
 * Error boundary that isolates failures to individual mosaic cells
 * preventing entire grid crashes when individual cells fail to render.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

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
        <div className="flex flex-col items-center justify-center h-full bg-gray-100 border border-gray-300 text-gray-600">
          <div className="text-sm font-medium">Slice {this.props.sliceIndex}</div>
          <div className="text-xs text-red-600">Render Error</div>
          <div className="text-xs text-gray-500 mt-1">
            {this.state.error?.message || 'Unknown error'}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}