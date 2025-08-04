/**
 * useFileLoadingStatus - Manages file loading status messages
 * Extracts the complex event handling from LayerPanel
 */

import { useState, useEffect } from 'react';
import { getEventBus } from '@/events/EventBus';

export function useFileLoadingStatus() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const eventBus = getEventBus();

    const handleLoading = (event: any) => {
      setStatus(`Loading: ${event.filename || 'file'}`);
    };

    const handleLoaded = () => {
      setStatus(null);
    };

    const handleError = (event: any) => {
      const msg = `Error: ${event.filename || 'file'} - ${event.error || 'Unknown error'}`;
      setStatus(msg);
      // Auto-clear after 5 seconds
      setTimeout(() => setStatus(null), 5000);
    };

    eventBus.on('file.loading', handleLoading);
    eventBus.on('file.loaded', handleLoaded);
    eventBus.on('file.error', handleError);

    return () => {
      eventBus.off('file.loading', handleLoading);
      eventBus.off('file.loaded', handleLoaded);
      eventBus.off('file.error', handleError);
    };
  }, []);

  return status;
}