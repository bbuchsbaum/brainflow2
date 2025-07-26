/**
 * StatusBarProgress - Compact progress indicator for the status bar
 * Shows current task info with click to open detailed view
 */

import React, { useState } from 'react';
import { useProgressStore } from '@/stores/progressStore';
import { ProgressDrawer } from './ProgressDrawer';

export function StatusBarProgress() {
  const [showDrawer, setShowDrawer] = useState(false);
  
  // Subscribe to the raw tasks Map
  const tasks = useProgressStore(state => state.tasks);
  
  // Compute active tasks locally
  const activeTasks = React.useMemo(() => {
    const active: any[] = [];
    tasks.forEach(task => {
      if (task.status === 'active') {
        active.push(task);
      }
    });
    return active;
  }, [tasks]);
  
  // Compute overall progress locally
  const overallProgress = React.useMemo(() => {
    if (activeTasks.length === 0) return 100;
    
    const determinateTasks = activeTasks.filter(t => t.progress >= 0);
    if (determinateTasks.length === 0) return -1;
    
    const totalProgress = determinateTasks.reduce((sum, task) => sum + task.progress, 0);
    return Math.round(totalProgress / determinateTasks.length);
  }, [activeTasks]);
  
  if (activeTasks.length === 0) {
    return null;
  }
  
  const currentTask = activeTasks[0]; // Show first active task
  const isIndeterminate = overallProgress === -1;
  
  return (
    <>
      <button
        className="flex items-center gap-2 px-3 py-1 text-xs hover:bg-gray-700/50 transition-colors cursor-pointer"
        onClick={() => setShowDrawer(true)}
        title="Click to view all tasks"
        style={{ color: '#d1d5db' }}  // gray-300 to match status bar
      >
        {/* Progress indicator */}
        <div className="relative w-4 h-4">
          {isIndeterminate ? (
            // Spinning circle for indeterminate
            <svg 
              className="animate-spin" 
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle 
                cx="12" 
                cy="12" 
                r="10" 
                stroke="currentColor" 
                strokeWidth="2"
                opacity="0.25"
              />
              <path 
                d="M12 2a10 10 0 0 1 10 10" 
                stroke="#60a5fa"  // blue-400 for good contrast
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            // Circular progress for determinate
            <svg viewBox="0 0 24 24" className="transform -rotate-90">
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.25"
              />
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="#60a5fa"  // blue-400 for good contrast
                strokeWidth="2"
                strokeDasharray={`${2 * Math.PI * 10}`}
                strokeDashoffset={`${2 * Math.PI * 10 * (1 - overallProgress / 100)}`}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          )}
        </div>
        
        {/* Task info */}
        <span className="max-w-[200px] truncate">
          {currentTask.title}
        </span>
        
        {/* Task count badge */}
        {activeTasks.length > 1 && (
          <span 
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ 
              backgroundColor: '#60a5fa',  // blue-400
              color: '#111827'  // gray-900 for contrast
            }}
          >
            +{activeTasks.length - 1}
          </span>
        )}
      </button>
      
      {/* Progress drawer */}
      {showDrawer && (
        <ProgressDrawer onClose={() => setShowDrawer(false)} />
      )}
    </>
  );
}