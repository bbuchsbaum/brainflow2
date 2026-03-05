/**
 * useLayerPanelServices - Manages service initialization for LayerPanel
 * Simplifies the complex retry logic into a single hook
 */

import { useState, useEffect } from 'react';
import { getLayerService } from '@/services/LayerService';
import { getEventBus, type EventMap } from '@/events/EventBus';

export function useLayerPanelServices() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    const maxAttempts = 10; // 1 second max wait

    const checkService = () => {
      if (!mounted) return;

      try {
        getLayerService();
        setIsInitialized(true);
        setError(null);
      } catch (err) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkService, 100);
        } else {
          // After 1 second, just assume it's ready
          // The UI should be visible regardless
          setIsInitialized(true);
          setError('Service initialization delayed');
        }
      }
    };

    // Also listen for explicit initialization
    const handleInit = (event: EventMap['services.initialized']) => {
      if (event.service === 'LayerService') {
        setIsInitialized(true);
      }
    };

    const eventBus = getEventBus();
    const unsubscribeInit = eventBus.on('services.initialized', handleInit);

    checkService();

    return () => {
      mounted = false;
      unsubscribeInit();
    };
  }, []);

  return { isInitialized, error };
}
