/**
 * MetadataStatusBridge - Connects MetadataStatusService to the StatusContext
 * This component must be rendered within StatusProvider
 */

import { useEffect } from 'react';
import { useStatusUpdater } from '@/contexts/StatusContext';
import { getMetadataStatusService } from '@/services/MetadataStatusService';

export function MetadataStatusBridge() {
  const statusUpdater = useStatusUpdater();
  
  useEffect(() => {
    const service = getMetadataStatusService();
    service.setStatusUpdater(statusUpdater);
    
    return () => {
      // Don't destroy the service, just disconnect updater
      // The service persists across component lifecycles
    };
  }, [statusUpdater]);
  
  return null; // This component doesn't render anything
}