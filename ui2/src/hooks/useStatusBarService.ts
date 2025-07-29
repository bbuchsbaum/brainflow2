/**
 * Hook to initialize StatusBarService
 * This replaces useStatusBarUpdates to avoid render loops
 */

import { useEffect } from 'react';
import { useStatusUpdater } from '@/contexts/StatusContext';
import { getStatusBarService } from '@/services/StatusBarService';

export function useStatusBarService() {
  const statusUpdater = useStatusUpdater();

  useEffect(() => {
    const service = getStatusBarService();
    
    // Initialize the service with the status updater
    service.initialize(statusUpdater);

    // Cleanup on unmount
    return () => {
      service.cleanup();
    };
  }, [statusUpdater]); // Include statusUpdater in dependencies
}