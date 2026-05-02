/**
 * useLayerPanelServices - Tracks LayerService availability for the volume panel.
 *
 * Important: a slow startup is not itself an error. The panel should stay in an
 * initializing state until LayerService becomes available or an explicit
 * services.error event reports a real failure.
 */

import { useEffect, useState } from 'react';
import { getLayerService } from '@/services/LayerService';
import { getEventBus, type EventMap } from '@/events/EventBus';

const MAX_BOOTSTRAP_ATTEMPTS = 10;
const RETRY_DELAY_MS = 100;

export function useLayerPanelServices() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const checkService = () => {
      if (!mounted) {
        return;
      }

      try {
        getLayerService();
        setIsInitialized(true);
        setError(null);
      } catch {
        attempts += 1;
        if (attempts < MAX_BOOTSTRAP_ATTEMPTS) {
          retryTimer = setTimeout(checkService, RETRY_DELAY_MS);
        }
      }
    };

    const handleInit = (event: EventMap['services.initialized']) => {
      if (event.service === 'LayerService') {
        setIsInitialized(true);
        setError(null);
      }
    };

    const handleError = (event: EventMap['services.error']) => {
      const isLayerServiceError = event.service === 'LayerService';
      const isFatalBootstrapError = !event.service && event.fatal;
      if (!isLayerServiceError && !isFatalBootstrapError) {
        return;
      }

      setIsInitialized(false);
      setError(event.error || 'LayerService initialization failed');
    };

    const eventBus = getEventBus();
    const unsubscribeInit = eventBus.on('services.initialized', handleInit);
    const unsubscribeError = eventBus.on('services.error', handleError);

    checkService();

    return () => {
      mounted = false;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribeInit();
      unsubscribeError();
    };
  }, []);

  return { isInitialized, error };
}
