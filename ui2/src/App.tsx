import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { GoldenLayoutRoot } from '@/components/layout/GoldenLayoutRoot';
import { NotificationToast } from '@/components/ui/NotificationToast';
import { TooltipOverlay } from '@/components/TooltipOverlay';
import { StatusBar } from '@/components/ui/StatusBar';
import { MultiViewBatchToggle } from '@/components/ui/MultiViewBatchToggle';
import { GlobalProgressBar } from '@/components/ui/GlobalProgressBar';
import { StatusProvider } from '@/contexts/StatusContext';
import { CrosshairProvider } from '@/contexts/CrosshairContext';
import { useBackendSync } from '@/hooks/useBackendSync';
import { useMountListener } from '@/hooks/useMountListener';
import { useServicesInit } from '@/hooks/useServicesInit';
import { useStatusBarInit } from '@/hooks/useStatusBarInit';
import { useWorkspaceMenuListener } from '@/hooks/useWorkspaceMenuListener';
import { usePanelMenuListener } from '@/hooks/usePanelMenuListener';
import { useAtlasMenuListener } from '@/hooks/useAtlasMenuListener';
import { useSurfaceTemplateMenuListener } from '@/hooks/useSurfaceTemplateMenuListener';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';
import { getProgressService } from '@/services/ProgressService';
import { ProgressDebug } from '@/components/ui/ProgressDebug';
import { MetadataStatusBridge } from '@/components/MetadataStatusBridge';
import { initializeCrosshairMenuService, destroyCrosshairMenuService } from '@/services/CrosshairMenuService';
import { CrosshairSettingsDialog } from '@/components/dialogs/CrosshairSettingsDialog';
import { GoToCoordinateDialog } from '@/components/dialogs/GoToCoordinateDialog';
import { ImageHeaderDialog } from '@/components/dialogs/ImageHeaderDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useNavigationShortcuts } from '@/hooks/useNavigationShortcuts';
import { PerformanceDashboard } from '@/components/debug/PerformanceDashboard';
import { migrateLayerRenderToViewState, isMigrationComplete } from '@/utils/migrateLayerRenderToViewState';
import { storeLog } from '@/utils/debugLog';
import { KeyboardShortcutsDialog } from '@/components/dialogs/KeyboardShortcutsDialog';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import { useLayerStore } from '@/stores/layerStore';

function ErrorFallback({ error, resetErrorBoundary }: any) {
  return (
    <div className="h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-red-900 border border-red-700 rounded-lg p-6 max-w-md">
        <h2 className="text-red-400 text-lg font-semibold mb-2">Something went wrong</h2>
        <pre className="text-red-300 text-sm mb-4 whitespace-pre-wrap">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={resetErrorBoundary}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
          >
            Try again
          </button>
          <button
            onClick={() => {
              localStorage.removeItem('brainflow2-workspace');
              window.location.reload();
            }}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Clear Cache & Reload
          </button>
        </div>
      </div>
    </div>
  );
}

// DebugPanel removed - was used for testing

// Component that uses the status context
function AppContent() {
  storeLog('AppContent', 'AppContent component rendering');
  
  // All hooks must be called before any conditional returns
  const renderTimes = useRef<number[]>([]);
  const renderLoopGuard = useRef<{
    lastWindowId: number | null;
    consecutiveHighSeconds: number;
    lastTriggerWindow: number | null;
    lastMetrics?: {
      rendersPerSecond: number;
      avgIntervalMs: number;
      sampleCount: number;
    };
  }>({
    lastWindowId: null,
    consecutiveHighSeconds: 0,
    lastTriggerWindow: null,
  });
  const [showCrosshairSettings, setShowCrosshairSettings] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showGoToCoordinate, setShowGoToCoordinate] = useState(false);
  const [showImageHeader, setShowImageHeader] = useState(false);
  const [imageHeaderVolumeId, setImageHeaderVolumeId] = useState<string | null>(null);
  const selectedLayerId = useLayerStore(s => s.selectedLayerId);
  const layers = useLayerStore(s => s.layers);

  // Initialize KeyboardShortcutService early (single global listener)
  useEffect(() => {
    getKeyboardShortcutService().init();
  }, []);

  // Initialize services first - this is the root of all initialization
  useServicesInit();
  
  // Enable coalescing after services are initialized
  useEffect(() => {
    storeLog('AppContent', 'Enabling coalescing middleware');
    coalesceUtils.setEnabled(true);
    
    // Perform one-time migration of layerRender data to ViewState
    if (!isMigrationComplete()) {
      storeLog('AppContent', 'Performing layerRender to ViewState migration...');
      const migrated = migrateLayerRenderToViewState();
      if (migrated) {
        storeLog('AppContent', 'Migration complete - layerRender data moved to ViewState');
      }
    } else {
      storeLog('AppContent', 'Migration already complete, skipping...');
    }
  }, []);
  
  // Then initialize other hooks that depend on services
  // Re-enable these one by one to test
  // Connect to backend sync - DISABLED: duplicate of useServicesInit callback
  // useBackendSync();
  
  // Listen for mount directory events
  useMountListener();
  
  // Listen for workspace menu events
  useWorkspaceMenuListener();
  
  // Listen for panel menu events
  usePanelMenuListener();

  // Listen for atlas and surface template menu events
  useAtlasMenuListener();
  useSurfaceTemplateMenuListener();
  
  // Initialize status bar service using Zustand store
  useStatusBarInit();
  
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  // Initialize navigation shortcuts (G, O, C)
  useNavigationShortcuts({ onOpenGoToDialog: () => setShowGoToCoordinate(true) });

  // Register '?' shortcut to open the keyboard shortcuts dialog
  useEffect(() => {
    const service = getKeyboardShortcutService();
    const unregister = service.register({
      id: 'app.showShortcuts',
      key: '?',
      modifiers: { shift: true },
      category: 'General',
      description: 'Show keyboard shortcuts',
      handler: () => setShowKeyboardShortcuts(prev => !prev),
    });
    return unregister;
  }, []);

  // Register Cmd+I shortcut to open image header dialog for selected layer
  useEffect(() => {
    const service = getKeyboardShortcutService();
    const unregister = service.register({
      id: 'app.showImageHeader',
      key: 'i',
      modifiers: { meta: true },
      category: 'Info',
      description: 'Show image header info',
      handler: () => {
        const layer = layers.find(l => l.id === selectedLayerId);
        if (layer?.volumeId) {
          setImageHeaderVolumeId(layer.volumeId);
          setShowImageHeader(true);
        }
      },
    });
    return unregister;
  }, [selectedLayerId, layers]);

  // Initialize crosshair menu service
  useEffect(() => {
    storeLog('AppContent', 'Initializing crosshair menu service');
    initializeCrosshairMenuService();
    
    return () => {
      storeLog('AppContent', 'Destroying crosshair menu service');
      destroyCrosshairMenuService();
    };
  }, []);

  // Listen for open crosshair settings event
  useEffect(() => {
    const handleOpenSettings = () => {
      storeLog('AppContent', 'Opening crosshair settings dialog');
      setShowCrosshairSettings(true);
    };

    window.addEventListener('open-crosshair-settings', handleOpenSettings);
    return () => {
      window.removeEventListener('open-crosshair-settings', handleOpenSettings);
    };
  }, []);
  
  // Global render logging (after hooks)
  if (typeof window !== 'undefined' && (window as any).__logRender) {
    (window as any).__logRender('AppContent');
  }
  
  // Time-based render loop detection (after all hooks)
  const now = performance.now();
  renderTimes.current.push(now);
  
  // Keep only renders from the last 1 second
  renderTimes.current = renderTimes.current.filter(time => now - time < 1000);
  
  // Detect render loop: compare render rate and cadence to avoid false positives
  const rendersPerSecond = renderTimes.current.length;
  const guard = renderLoopGuard.current;
  const windowId = Math.floor(now / 1000);
  const intervals = renderTimes.current.length > 1
    ? renderTimes.current.slice(1).map((time, idx) => time - renderTimes.current[idx])
    : [];
  const avgIntervalMs = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : Number.POSITIVE_INFINITY;
  const renderRateSuspicious = rendersPerSecond >= 240 && avgIntervalMs < 6;
  const thresholdSeconds = 6;

  if (guard.lastWindowId === null || guard.lastWindowId !== windowId) {
    guard.lastWindowId = windowId;
    guard.consecutiveHighSeconds = renderRateSuspicious ? guard.consecutiveHighSeconds + 1 : 0;
  } else if (!renderRateSuspicious) {
    guard.consecutiveHighSeconds = 0;
    guard.lastTriggerWindow = null;
  }

  if (renderRateSuspicious) {
    guard.lastMetrics = {
      rendersPerSecond,
      avgIntervalMs,
      sampleCount: intervals.length,
    };
    console.warn(
      '[AppContent] Render rate spike detected:',
      `${rendersPerSecond}/s avgInterval=${avgIntervalMs.toFixed(2)}ms consecutiveHighSeconds=${guard.consecutiveHighSeconds}`,
    );
    if (guard.consecutiveHighSeconds >= thresholdSeconds && guard.lastTriggerWindow !== windowId) {
      guard.lastTriggerWindow = windowId;
      console.error('[AppContent] RENDER LOOP DETECTED! Renders in last second:', rendersPerSecond);
      console.error('[AppContent] Render loop diagnostics:', guard.lastMetrics);
      console.trace('Stack trace:');
      (window as any).__renderLoopDiagnostics = {
        triggeredAt: now,
        ...guard.lastMetrics,
      };
      return (
        <div className="h-screen bg-gray-950 flex items-center justify-center text-red-500">
          <div className="text-center">
            <h2 className="text-lg font-semibold mb-2">Render Loop Detected</h2>
            <p className="mb-4">The application encountered an infinite render loop</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
  }
  
  // Progress service is initialized in useServicesInit
  
  // Note: Threshold logic has been fixed in the shader - no workaround needed
  
  storeLog('AppContent', 'AppContent initialization complete');
  
  return (
    <div className="h-screen flex flex-col">
      <MetadataStatusBridge />
      <ProgressDebug />
      <GlobalProgressBar />
      <div className="flex-1 overflow-hidden">
        <GoldenLayoutRoot />
      </div>
      <StatusBar
        rightContent={<MultiViewBatchToggle />}
        onCrosshairClick={() => setShowGoToCoordinate(true)}
      />
      <NotificationToast />
      <TooltipOverlay />
      
      {/* Crosshair Settings Dialog */}
      {showCrosshairSettings && (
        <CrosshairSettingsDialog
          onClose={() => setShowCrosshairSettings(false)}
        />
      )}

      {/* Go To Coordinate Dialog */}
      <GoToCoordinateDialog
        open={showGoToCoordinate}
        onClose={() => setShowGoToCoordinate(false)}
      />

      {/* Keyboard Shortcuts Help Dialog */}
      {showKeyboardShortcuts && (
        <KeyboardShortcutsDialog
          onClose={() => setShowKeyboardShortcuts(false)}
        />
      )}

      {/* Image Header Dialog (Cmd+I) */}
      <ImageHeaderDialog
        open={showImageHeader}
        onClose={() => setShowImageHeader(false)}
        volumeId={imageHeaderVolumeId}
      />

      {/* Performance Dashboard (development only) */}
      {process.env.NODE_ENV === 'development' && <PerformanceDashboard />}
    </div>
  );
}

// Initial status bar slots configuration
const initialStatusSlots = [
  { id: 'coordSys', label: 'Coordinate System:', value: 'LPI', width: '25ch' },
  { id: 'crosshair', label: 'Crosshair:', value: '(0.0, 0.0, 0.0)', width: '30ch' },
  { id: 'mouse', label: 'Mouse:', value: '--', width: '30ch' },
  { id: 'layer', label: 'Layer:', value: 'None', width: '30ch' },
  { id: 'fps', label: 'FPS:', value: '--', width: '12ch' },
  { id: 'gpu', label: 'GPU:', value: 'Ready', width: '15ch' }
];

function App() {
  storeLog('App', 'App component rendering');
  
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <StatusProvider initial={initialStatusSlots}>
        <CrosshairProvider>
          <AppContent />
        </CrosshairProvider>
      </StatusProvider>
    </ErrorBoundary>
  );
}

export default App;
