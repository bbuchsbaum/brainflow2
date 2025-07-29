/**
 * Hook to initialize StatusBar with Zustand store
 * This replaces useStatusBarService to avoid React Context render loops
 */

import { useEffect } from 'react';
import { getStatusBarService } from '@/services/StatusBarService';

export function useStatusBarInit() {
  useEffect(() => {
    const service = getStatusBarService();
    
    // Initialize the service
    service.initialize();

    // Cleanup on unmount
    return () => {
      service.cleanup();
    };
  }, []); // Empty deps - only initialize once
}