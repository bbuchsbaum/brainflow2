/**
 * LayerEmptyState - Clean empty state component for LayerPanel
 */

import React from 'react';

interface LayerEmptyStateProps {
  onRefresh?: () => void;
  showRefreshButton?: boolean;
}

export const LayerEmptyState: React.FC<LayerEmptyStateProps> = ({
  onRefresh,
  showRefreshButton = false
}) => {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded p-4 text-center">
      <div className="text-gray-400 mb-2">No layers loaded</div>
      <div className="text-sm text-gray-500">Load neuroimaging files using the File Browser</div>
      
      {showRefreshButton && onRefresh && (
        <button
          onClick={onRefresh}
          className="mt-3 px-3 py-1 bg-yellow-600/80 text-white text-sm rounded hover:bg-yellow-600 transition-colors"
        >
          Refresh Layer State
        </button>
      )}
    </div>
  );
};