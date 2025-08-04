/**
 * LayerStatusBar - Status messages component for LayerPanel
 */

import React from 'react';

interface LayerStatusBarProps {
  error?: string | null;
  isInitializing?: boolean;
  fileLoadingStatus?: string | null;
}

export const LayerStatusBar: React.FC<LayerStatusBarProps> = ({
  error,
  isInitializing,
  fileLoadingStatus
}) => {
  if (error) {
    return (
      <div className="bg-red-500/20 border border-red-500/50 rounded p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-red-400">⚠️</span>
          <div>
            <div className="font-medium text-red-300">Service Error</div>
            <div className="text-sm text-red-300/80">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="bg-yellow-500/20 border border-yellow-500/50 rounded p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-yellow-400">⏳</span>
          <div className="text-sm text-yellow-300">Initializing services...</div>
        </div>
      </div>
    );
  }

  if (fileLoadingStatus) {
    return (
      <div className="bg-blue-500/20 border border-blue-500/50 rounded p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-blue-400">📁</span>
          <div className="text-sm text-blue-300">{fileLoadingStatus}</div>
        </div>
      </div>
    );
  }

  return null;
};