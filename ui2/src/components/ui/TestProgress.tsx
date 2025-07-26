import React, { useState } from 'react';
import { getProgressService } from '@/services/ProgressService';

export function TestProgress() {
  const [taskId, setTaskId] = useState<string | null>(null);
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
    <div style={{ position: 'fixed', bottom: 60, left: 10, zIndex: 1000 }}>
      <button 
        onClick={startTest}
        disabled={taskId !== null}
        style={{
          padding: '8px 16px',
          marginRight: '8px',
          backgroundColor: taskId ? '#666' : '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: taskId ? 'not-allowed' : 'pointer'
        }}
      >
        Start Test Progress
      </button>
      {taskId && (
        <button 
          onClick={cancelTest}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
      )}
    </div>
  );
}