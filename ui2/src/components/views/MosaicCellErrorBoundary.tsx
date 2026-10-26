/**
 * MosaicCellErrorBoundary Component
 * 
 * Error boundary that isolates failures to individual mosaic cells
 * preventing entire grid crashes when individual cells fail to render.
 */

import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Notice } from '@/components/ui/bf';

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
        <div className="flex h-full items-center justify-center bg-bf-bg-canvas p-2">
          <Notice severity="danger" surface="canvas" role="alert" className="max-w-full">
            <div className="font-medium">Slice {this.props.sliceIndex}: render error</div>
            <div className="break-words text-bf-text-secondary">
              {this.state.error?.message || 'Unknown error'}
            </div>
          </Notice>
        </div>
      );
    }

    return this.props.children;
  }
}
