/**
 * LoadingQueueIndicator - Shows active file loading operations
 * Displays in the status bar or as a standalone component
 */

import React from 'react';
import { useLoadingQueue, loadingQueueSelectors } from '@/stores/loadingQueueStore';
import { Loader2 } from 'lucide-react';

interface LoadingQueueIndicatorProps {
  className?: string;
  showDetails?: boolean;
}

export const LoadingQueueIndicator: React.FC<LoadingQueueIndicatorProps> = ({
  className = '',
  showDetails = false
}) => {
  const activeCount = useLoadingQueue(loadingQueueSelectors.totalActive);
  const queuedCount = useLoadingQueue(loadingQueueSelectors.totalQueued);
  const activeLoads = useLoadingQueue(loadingQueueSelectors.activeLoadsList);
  
  // Don't show if nothing is loading
  if (activeCount === 0 && queuedCount === 0) {
    return null;
  }
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
      <span className="text-sm text-gray-600">
        {activeCount > 0 && `Loading ${activeCount} file${activeCount > 1 ? 's' : ''}`}
        {queuedCount > 0 && ` (${queuedCount} queued)`}
      </span>
      
      {showDetails && activeLoads.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 p-2 bg-white border rounded-md shadow-lg min-w-[200px]">
          {activeLoads.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-2 py-1">
              <span className="text-xs truncate flex-1">{item.displayName}</span>
              {item.progress !== undefined && (
                <span className="text-xs text-gray-500">{item.progress}%</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};