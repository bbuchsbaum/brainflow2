/**
 * GlobalProgressBar - Minimal progress indicator at the top of the window
 * Shows aggregate progress of all active tasks
 */

import React from 'react';
import { useProgressStore } from '@/stores/progressStore';

export function GlobalProgressBar() {
  // Subscribe to the raw tasks Map and compute values locally
  const tasks = useProgressStore(state => state.tasks);
  
  // Compute derived values from tasks
  const activeTasks = React.useMemo(() => {
    const active: any[] = [];
    tasks.forEach(task => {
      if (task.status === 'active') {
        active.push(task);
      }
    });
    return active;
  }, [tasks]);
  
  const hasActive = activeTasks.length > 0;
  const taskCount = activeTasks.length;
  
  const progress = React.useMemo(() => {
    if (activeTasks.length === 0) return 100;
    
    const determinateTasks = activeTasks.filter(t => t.progress >= 0);
    if (determinateTasks.length === 0) return -1;
    
    const totalProgress = determinateTasks.reduce((sum, task) => sum + task.progress, 0);
    return Math.round(totalProgress / determinateTasks.length);
  }, [activeTasks]);
  
  // Don't render if no active tasks
  if (!hasActive) {
    return null;
  }
  
  const isIndeterminate = progress === -1;
  const activeCount = taskCount;
  
  return (
    <div 
      className="fixed top-0 left-0 right-0 z-50 h-1 bg-gray-900/20"
      style={{ 
        // Position below window controls on macOS
        paddingTop: 'env(titlebar-area-height, 0px)'
      }}
    >
      {isIndeterminate ? (
        // Indeterminate progress - pulsing animation
        <div className="h-full relative overflow-hidden">
          <div 
            className="absolute inset-0 animate-pulse"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, var(--layer-accent) 50%, transparent 100%)',
              animation: 'shimmer 2s infinite'
            }}
          />
        </div>
      ) : (
        // Determinate progress bar
        <div 
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: `${progress}%`,
            backgroundColor: 'var(--layer-accent)',
            boxShadow: '0 0 10px var(--layer-accent)'
          }}
        />
      )}
      
      {/* Task count indicator */}
      {activeCount > 1 && (
        <div 
          className="absolute right-2 top-1 text-xs px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: 'var(--layer-bg)',
            color: 'var(--layer-text)',
            border: '1px solid var(--layer-divider)',
            transform: 'translateY(100%)'
          }}
        >
          {activeCount} tasks
        </div>
      )}
      
      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>
    </div>
  );
}