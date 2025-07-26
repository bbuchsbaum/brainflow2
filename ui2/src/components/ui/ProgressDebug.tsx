import React, { useEffect } from 'react';
import { useProgressStore } from '@/stores/progressStore';

export function ProgressDebug() {
  // Subscribe to tasks with a console log
  const tasksSize = useProgressStore(state => {
    console.log('[ProgressDebug] Store update detected, tasks size:', state.tasks.size);
    return state.tasks.size;
  });
  
  useEffect(() => {
    console.log('[ProgressDebug] Component mounted, initial tasks size:', tasksSize);
    return () => {
      console.log('[ProgressDebug] Component unmounting');
    };
  }, []);
  
  useEffect(() => {
    console.log('[ProgressDebug] Tasks size changed to:', tasksSize);
  }, [tasksSize]);
  
  return null; // This component doesn't render anything
}