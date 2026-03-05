/**
 * ProgressDrawer - Detailed progress view showing all active and recent tasks
 * Slides out from the right side of the window
 */

import React, { useEffect, useRef } from 'react';
import { useProgressStore, type ProgressTask } from '@/stores/progressStore';
import { getProgressService } from '@/services/ProgressService';
import { 
  VscSync, 
  VscLoading, 
  VscCheck, 
  VscError, 
  VscStopCircle,
  VscClose,
} from 'react-icons/vsc';
import './ProgressDrawer.css';

interface ProgressDrawerProps {
  onClose: () => void;
}

// Test progress buttons component
function TestProgressButtons() {
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const progressService = getProgressService();
  
  const startTest = () => {
    const id = progressService.startTask('computation', 'Test Progress Task', {
      message: 'Starting...',
      cancellable: true
    });
    setTaskId(id);
    
    // Simulate progress updates
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      progressService.updateTask(id, progress, `Progress: ${progress}%`);
      
      if (progress >= 100) {
        clearInterval(interval);
        progressService.completeTask(id);
        setTaskId(null);
      }
    }, 500);
  };
  
  const cancelTest = () => {
    if (taskId) {
      progressService.cancelTask(taskId);
      setTaskId(null);
    }
  };
  
  return (
    <div className="flex gap-2">
      <button 
        onClick={startTest}
        disabled={taskId !== null}
        className="flex-1 py-1.5 px-3 text-xs rounded transition-colors"
        style={{
          backgroundColor: taskId ? 'var(--layer-hover)' : 'var(--app-accent-bg)',
          color: taskId ? 'var(--layer-text-secondary)' : 'var(--app-accent-text)',
          opacity: taskId ? 0.5 : 1,
          cursor: taskId ? 'not-allowed' : 'pointer'
        }}
      >
        Start Test
      </button>
      {taskId && (
        <button 
          onClick={cancelTest}
          className="py-1.5 px-3 text-xs rounded transition-colors"
          style={{
            backgroundColor: '#ef444420',
            color: '#ef4444'
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}

export function ProgressDrawer({ onClose }: ProgressDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  
  // Subscribe to the raw tasks Map
  const tasksMap = useProgressStore(state => state.tasks);
  
  // Convert to sorted array locally
  const tasks = React.useMemo(() => {
    return Array.from(tasksMap.values()).sort((a, b) => b.startTime - a.startTime);
  }, [tasksMap]);
  
  const progressService = getProgressService();
  
  // Handle escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  
  // Handle click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    
    // Delay to avoid immediate close from the open click
    setTimeout(() => {
      window.addEventListener('mousedown', handleClickOutside);
    }, 100);
    
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);
  
  function formatDuration(startTime: number, endTime?: number): string {
    const duration = (endTime || Date.now()) - startTime;
    const seconds = Math.floor(duration / 1000);
    
    if (seconds < 60) {
      return `${seconds}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  function getStatusIcon(task: ProgressTask) {
    const iconClass = "w-5 h-5";
    
    switch (task.status) {
      case 'active':
        return task.progress >= 0 
          ? <VscSync className={`${iconClass} animate-spin`} />
          : <VscLoading className={`${iconClass} animate-spin`} />;
      case 'completed':
        return <VscCheck className={`${iconClass} text-green-500`} />;
      case 'error':
        return <VscError className={`${iconClass} text-red-500`} />;
      case 'cancelled':
        return <VscStopCircle className={`${iconClass} text-gray-500`} />;
    }
  }
  
  function getStatusColor(status: ProgressTask['status']) {
    switch (status) {
      case 'active':
        return '#10b981';  // green-500 for better visibility
      case 'completed':
        return '#10b981';  // green-500
      case 'error':
        return '#ef4444';  // red-500
      case 'cancelled':
        return '#6b7280';  // gray-500
    }
  }
  
  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 bottom-0 w-96 z-50 shadow-xl animate-slide-in-right overflow-hidden flex flex-col"
        style={{ 
          backgroundColor: 'var(--layer-bg)',
          borderLeft: '1px solid var(--layer-divider)'
        }}
        role="region"
        aria-label="Progress panel"
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-4"
          style={{ borderBottom: '1px solid var(--layer-divider)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--layer-text)' }}>
            Progress Tasks
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700/50 transition-colors"
            title="Close"
            aria-label="Close progress panel"
          >
            <VscClose className="w-5 h-5" />
          </button>
        </div>
        
        {/* Task list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" role="list" aria-label="Progress tasks">
          {tasks.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: '#94a3b8' }}>
              No active or recent tasks
            </p>
          ) : (
            tasks.map(task => (
              <div
                key={task.id}
                className="p-3 rounded-lg border transition-all"
                style={{
                  backgroundColor: task.status === 'active' ? 'rgba(16, 185, 129, 0.05)' : 'transparent',  // Lighter green tint
                  borderColor: task.status === 'active' 
                    ? getStatusColor(task.status) 
                    : 'var(--app-border, #374151)', // Stronger border for better contrast
                  borderWidth: '1px',
                  borderStyle: 'solid'
                }}
                role="listitem"
                aria-live={task.status === 'active' ? 'polite' : 'off'}
                aria-label={`${task.title} - ${task.status}`}
              >
                {/* Task header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex-shrink-0">{getStatusIcon(task)}</div>
                    <div className="flex-1">
                      <h3 className="font-medium text-sm" style={{ color: 'var(--layer-text)' }}>
                        {task.title}
                      </h3>
                      {task.message && (
                        <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
                          {task.message}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {/* Cancel button for active cancellable tasks */}
                  {task.status === 'active' && task.cancellable && (
                    <button
                      onClick={() => progressService.cancelTask(task.id)}
                      className="p-1 rounded hover:bg-red-500/20 transition-colors"
                      title="Cancel task"
                      aria-label="Cancel task"
                    >
                      <VscClose className="w-4 h-4 text-red-400" />
                    </button>
                  )}
                </div>
                
                {/* Progress bar */}
                {task.status === 'active' && (
                  <div className="mb-2">
                    {task.progress >= 0 ? (
                      // Determinate progress bar
                      <>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: '#94a3b8' }}>Progress</span>
                          <span style={{ color: '#10b981', fontWeight: 600 }}>{task.progress}%</span>
                        </div>
                        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden shadow-inner">
                          <div
                            className="h-full transition-all duration-300 relative overflow-hidden rounded-full"
                            style={{
                              width: `${task.progress}%`,
                              backgroundColor: getStatusColor(task.status),
                              backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)',
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      // Indeterminate progress bar
                      <>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: '#94a3b8' }}>Processing...</span>
                        </div>
                        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div className="absolute inset-0 -left-full animate-pulse"
                            style={{
                              background: `linear-gradient(90deg, transparent, ${getStatusColor(task.status)}, transparent)`,
                              animation: 'shimmer 1.5s infinite'
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
                
                {/* Task metadata */}
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: '#94a3b8' }}>
                    Duration: {formatDuration(task.startTime, task.endTime)}
                  </span>
                  <span 
                    className="capitalize"
                    style={{ color: getStatusColor(task.status) }}
                  >
                    {task.status}
                  </span>
                </div>
                
                {/* Error message */}
                {task.error && (
                  <div 
                    className="mt-2 p-2 rounded text-xs"
                    style={{ 
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444'
                    }}
                  >
                    {task.error.message}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        
        {/* Footer actions */}
        <div 
          className="p-4 space-y-2"
          style={{ borderTop: '1px solid var(--layer-divider)' }}
        >
          {/* Clear completed button */}
          {tasks.some(t => t.status === 'completed' || t.status === 'cancelled') && (
            <button
              onClick={() => useProgressStore.getState().clearCompleted()}
              className="w-full py-2 px-4 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--layer-hover)',
                color: 'var(--layer-text)'
              }}
            >
              Clear Completed Tasks
            </button>
          )}
          
          {/* Debug-only controls */}
          {import.meta.env.DEV && <TestProgressButtons />}
        </div>
      </div>
    </>
  );
}
